// 远程终端：基于历史命令的自动补全（下拉候选，回车确认）
// 设计说明见 docs/requirements/远程终端模块.md 第 12.3 节
//
// 关键点：
// - 命令内容从屏幕读取（输入起点锚点 → 光标），而不是拼接按键，
//   这样远端 Tab 补全、↑ 历史、行内编辑后的结果都能正确识别
// - 远端不回显（密码）时屏幕上读不到内容，自然不会弹出候选或被记录
// - 历史全局共享，数据在主进程 terminalExtras.js 持久化；渲染端保留一份内存索引用于查询

(function () {
    const MAX_COMMAND_LENGTH = 500;
    const MIN_RECORD_LENGTH = 2;
    const MAX_CANDIDATES = 8;
    const MAX_INPUT_LINES = 10;   // 一条命令最多跨的屏幕行数（折行）
    const DAY = 86400000;

    // 疑似含敏感信息的命令不记录
    const SENSITIVE_PATTERNS = [
        /\b(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key)\s*[=:]/i,
        /--(?:pass(?:word)?|token|secret|api-key)(?:[= ]|$)/i,
        /\bmysql(?:dump|admin)?\b.*\s-p\S/,
        /\bsshpass\b.*\s-p\s*\S/,
        /\bauthorization\s*:/i,
        /\bcurl\b.*\s(?:-u|--user)\s+\S+:\S+/,
        /\b(?:redis-cli)\b.*\s-a\s+\S/,
        /:\/\/[^\s:/@]+:[^\s@/]+@/          // URL 中的 user:pass@
    ];

    function isSensitive(cmd) {
        return SENSITIVE_PATTERNS.some(re => re.test(cmd));
    }

    /** 判断一条命令是否应进入历史 */
    function shouldRecord(raw) {
        if (typeof raw !== 'string') return false;
        if (/^\s/.test(raw)) return false;                 // 以空格开头：沿用 HISTCONTROL=ignorespace 习惯
        const cmd = raw.trim();
        if (cmd.length < MIN_RECORD_LENGTH || cmd.length > MAX_COMMAND_LENGTH) return false;
        // eslint-disable-next-line no-control-regex
        if (/[\x00-\x1f\x7f]/.test(cmd)) return false;
        if (isSensitive(cmd)) return false;
        return true;
    }

    /** 从 bash 反向搜索提示中提取命令；不是反向搜索行时返回 null */
    function extractReverseSearch(line) {
        const m = /\((?:failed )?(?:reverse-)?i-search\)`[^']*': ?(.*)$/.exec(line);
        return m ? m[1] : null;
    }

    function scoreEntry(e, hostId, now) {
        const ageDays = Math.max(0, (now - (e.t || 0)) / DAY);
        let s = Math.log2((e.n || 1) + 1) * 2 + 3 / (1 + ageDays / 3);
        if (hostId != null && Array.isArray(e.h) && e.h.includes(hostId)) s += 1.5;
        return s;
    }

    /** 全局共享的历史索引（渲染端），与主进程 CommandHistoryStore 使用相同的条目格式 */
    class HistoryIndex {
        constructor() {
            this.map = new Map();   // command -> { c, n, t, h }
        }

        load(entries) {
            this.map.clear();
            for (const e of entries || []) {
                if (e && typeof e.c === 'string') this.map.set(e.c, { c: e.c, n: e.n || 1, t: e.t || 0, h: Array.isArray(e.h) ? e.h : [] });
            }
        }

        get size() {
            return this.map.size;
        }

        add(cmd, hostId, now = Date.now()) {
            let e = this.map.get(cmd);
            if (!e) {
                e = { c: cmd, n: 0, t: now, h: [] };
                this.map.set(cmd, e);
            }
            e.n += 1;
            e.t = now;
            if (hostId != null) {
                e.h = [hostId, ...e.h.filter(x => x !== hostId)].slice(0, 20);
            }
        }

        remove(cmd) {
            this.map.delete(cmd);
        }

        clear() {
            this.map.clear();
        }

        /**
         * 查询候选：前缀匹配优先，其次包含匹配；同类按得分排序。
         * 与输入完全相同的命令不作为候选。
         */
        query(input, hostId, limit = MAX_CANDIDATES, now = Date.now()) {
            const q = input.toLowerCase();
            if (!q) return [];
            const prefix = [];
            const contains = [];
            for (const e of this.map.values()) {
                if (e.c === input) continue;
                const lc = e.c.toLowerCase();
                if (lc.startsWith(q)) prefix.push(e);
                else if (lc.includes(q)) contains.push(e);
            }
            const byScore = (a, b) => scoreEntry(b, hostId, now) - scoreEntry(a, hostId, now);
            prefix.sort(byScore);
            const out = prefix.slice(0, limit);
            if (out.length < limit) {
                contains.sort(byScore);
                out.push(...contains.slice(0, limit - out.length));
            }
            return out.map(e => e.c);
        }
    }

    const history = new HistoryIndex();

    // ============================================================
    // 单个终端标签的补全控制器
    // ============================================================

    // 会打断当前输入行的按键：Ctrl+C / Ctrl+D / Ctrl+L（清屏后提示符位置改变），下次输入时重新取锚点
    const RESET_INPUTS = new Set(['\x03', '\x04', '\x0c']);

    class AutocompleteController {
        /**
         * @param {Object} view - TerminalView（提供 term、host、state、el、sendInput）
         * @param {Object} opts - { getSettings: () => settings, onRecord(cmd, hostId), onRemove(cmd) }
         */
        constructor(view, opts) {
            this.view = view;
            this.opts = opts;
            this.anchor = null;          // { marker, x }
            this.typed = false;          // 自锚点以来用户是否输入过内容
            this.reverseSearch = false;  // 本行是否用过 Ctrl+R
            this.pending = false;        // 等待远端回显后刷新候选
            this.suppressed = false;     // 刚确认候选，下一次按键前不再弹出
            this.items = [];
            this.sel = -1;
            this.popup = null;
            this._frame = null;
            this._disposables = [];
        }

        attach() {
            const term = this.view.term;
            this._disposables.push(
                term.onWriteParsed(() => this._schedule()),
                term.onScroll(() => this._schedule()),
                term.onResize(() => this.hide())
            );
            if (term.textarea) {
                this._onBlur = () => this.hide();
                term.textarea.addEventListener('blur', this._onBlur);
            }
        }

        get enabled() {
            const s = this.opts.getSettings();
            return !!(s && s.autocompleteEnabled);
        }

        get visible() {
            return !!(this.popup && this.items.length);
        }

        _buffer() {
            return this.view.term.buffer.active;
        }

        _isNormalBuffer() {
            return this._buffer().type === 'normal';
        }

        _setAnchor() {
            this._clearAnchor();
            const buf = this._buffer();
            const marker = this.view.term.registerMarker(0);
            if (!marker) return;
            this.anchor = { marker, x: buf.cursorX };
        }

        _clearAnchor() {
            if (this.anchor && this.anchor.marker) this.anchor.marker.dispose();
            this.anchor = null;
            this.typed = false;
            this.reverseSearch = false;
        }

        /** 重置行状态（回车、Ctrl+C、断线、重连等） */
        resetLine() {
            this._clearAnchor();
            this.pending = false;
            this.suppressed = false;
            this.hide();
        }

        /**
         * 读取锚点到光标（或到输入末尾）的文本。
         * 返回 null 表示锚点失效（被清屏、跨了换行等）。
         */
        _readInput({ toCursor, fromColumnZero = false }) {
            const a = this.anchor;
            if (!a || a.marker.isDisposed || a.marker.line < 0) return null;
            const buf = this._buffer();
            const startY = a.marker.line;
            const cursorY = buf.baseY + buf.cursorY;
            if (cursorY < startY || cursorY - startY > MAX_INPUT_LINES) return null;
            let endY = cursorY;
            if (!toCursor) {
                while (endY - startY < MAX_INPUT_LINES) {
                    const next = buf.getLine(endY + 1);
                    if (!next || !next.isWrapped) break;
                    endY++;
                }
            }
            let text = '';
            for (let y = startY; y <= endY; y++) {
                const line = buf.getLine(y);
                if (!line) return null;
                if (y > startY && !line.isWrapped) return null;     // 中间出现真正的换行，说明已不是同一条输入
                const from = y === startY && !fromColumnZero ? a.x : 0;
                if (y === endY) {
                    text += toCursor ? line.translateToString(false, from, buf.cursorX) : line.translateToString(true, from);
                } else {
                    text += line.translateToString(false, from);
                }
            }
            return text;
        }

        /** 光标后（同一行）是否还有内容：有则说明用户在行中间编辑，不弹候选 */
        _hasTextAfterCursor() {
            const buf = this._buffer();
            const line = buf.getLine(buf.baseY + buf.cursorY);
            if (!line) return false;
            const next = buf.getLine(buf.baseY + buf.cursorY + 1);
            return line.translateToString(true, buf.cursorX).length > 0 || !!(next && next.isWrapped);
        }

        // ---------------- 输入事件（来自 term.onData，发往远端之前） ----------------

        onInput(data) {
            if (!data) return;
            if (data === '\r' || data === '\n') {
                this._recordCurrent();
                this.resetLine();
                return;
            }
            if (RESET_INPUTS.has(data)) {
                this.resetLine();
                return;
            }
            // 粘贴：含换行时远端会直接执行，作为断行处理
            if (data.startsWith('\x1b[200~') || data.length > 1 && /[\r\n]/.test(data)) {
                if (/[\r\n]/.test(data.replace(/\x1b\[20[01]~/g, ''))) {
                    this.resetLine();
                    return;
                }
                if (!this.anchor) this._setAnchor();
                this.typed = true;
                this.suppressed = false;
                this.pending = true;
                return;
            }
            if (data === '\x12') {                     // Ctrl+R 反向搜索
                if (!this.anchor) this._setAnchor();
                this.typed = true;
                this.reverseSearch = true;
                this.hide();
                return;
            }
            if (data === '\t') {                       // 交给远端原生补全
                if (!this.anchor) this._setAnchor();
                this.typed = true;
                this.hide();
                return;
            }
            if (data === '\x7f' || data === '\b') {
                if (this.anchor) {
                    this.suppressed = false;
                    this.pending = true;
                }
                return;
            }
            if (data === '\x1b[A' || data === '\x1b[B' || data === '\x1bOA' || data === '\x1bOB') {
                // 远端 ↑/↓ 历史：内容由远端填入，回车时从屏幕读取
                if (!this.anchor) this._setAnchor();
                this.typed = true;
                this.suppressed = true;
                this.hide();
                return;
            }
            if (data.charCodeAt(0) === 0x1b || data.charCodeAt(0) < 0x20) {
                this.hide();                           // 其他控制键 / 光标移动
                return;
            }
            // 可打印字符（含输入法上屏的中文）
            if (!this.anchor) this._setAnchor();
            this.typed = true;
            this.suppressed = false;
            this.pending = true;
        }

        _recordCurrent() {
            if (!this.typed || !this.anchor || !this._isNormalBuffer()) return;
            let text;
            if (this.reverseSearch) {
                const line = this._readInput({ toCursor: false, fromColumnZero: true });
                text = line == null ? null : extractReverseSearch(line);
            } else {
                text = this._readInput({ toCursor: false });
            }
            if (text == null || !shouldRecord(text)) return;
            const cmd = text.trim();
            const hostId = this.view.host && this.view.host.id;
            history.add(cmd, hostId);
            if (this.opts.onRecord) this.opts.onRecord(cmd, hostId);
        }

        // ---------------- 候选刷新 ----------------

        _schedule() {
            if (!this.pending && !this.visible) return;
            if (this._frame) return;
            this._frame = requestAnimationFrame(() => {
                this._frame = null;
                this._update();
            });
        }

        _update() {
            const wasPending = this.pending;
            this.pending = false;
            if (!wasPending && !this.visible) return;
            const settings = this.opts.getSettings() || {};
            const buf = this._buffer();
            if (!this.enabled || this.suppressed || this.reverseSearch || !this.typed ||
                this.view.state !== 'ready' || !this._isNormalBuffer() || buf.viewportY !== buf.baseY) {
                this.hide();
                return;
            }
            const text = this._readInput({ toCursor: true });
            const minChars = Math.max(1, settings.autocompleteMinChars || 2);
            if (text == null || text.trim().length < minChars || /^\s/.test(text) || this._hasTextAfterCursor()) {
                this.hide();
                return;
            }
            const items = history.query(text, this.view.host && this.view.host.id);
            if (!items.length) {
                this.hide();
                return;
            }
            const prevSelected = this.sel >= 0 ? this.items[this.sel] : null;
            this.items = items;
            this.sel = prevSelected ? items.indexOf(prevSelected) : -1;
            this.query = text;
            this._render();
        }

        // ---------------- 键盘（来自 attachCustomKeyEventHandler） ----------------

        /** 返回 false 表示按键已被候选框消费，不再交给 xterm */
        handleKey(e) {
            // keydown 已被消费时，同一次按键的 keypress 也不交给 xterm（preventDefault 通常已阻止 keypress，这里兜底）
            if (e.type === 'keypress' && this._swallowKeypress) {
                this._swallowKeypress = false;
                return false;
            }
            if (e.type === 'keydown') this._swallowKeypress = false;
            if (!this.visible || e.type !== 'keydown' || e.isComposing || e.keyCode === 229) return true;
            const mod = e.ctrlKey || e.metaKey || e.altKey;
            const consume = () => {
                e.preventDefault();
                e.stopPropagation();
                this._swallowKeypress = true;
                return false;
            };
            if (e.key === 'ArrowDown' && !mod && !e.shiftKey) {
                this.sel = this.sel >= this.items.length - 1 ? 0 : this.sel + 1;
                this._render();
                return consume();
            }
            if (e.key === 'ArrowUp' && !mod && !e.shiftKey) {
                this.sel = this.sel <= 0 ? this.items.length - 1 : this.sel - 1;
                this._render();
                return consume();
            }
            if (e.key === 'Enter' && !mod && !e.shiftKey && this.sel >= 0) {
                this.accept(this.items[this.sel]);
                return consume();
            }
            if (e.key === 'Escape' && !mod) {
                this.suppressed = true;
                this.hide();
                return consume();
            }
            if (e.key === 'Delete' && e.shiftKey && this.sel >= 0) {
                this.removeItem(this.items[this.sel]);
                return consume();
            }
            return true;
        }

        /** 把候选填入命令行（不执行） */
        accept(cmd) {
            if (!cmd || this.view.state !== 'ready') return;
            const current = this._readInput({ toCursor: true });
            const prefix = current == null ? (this.query || '') : current;
            let data;
            if (cmd.startsWith(prefix)) {
                data = cmd.slice(prefix.length);
            } else {
                // 非前缀匹配：先退格删掉已输入内容（按字符计，中文按一个字符），再输入完整命令
                data = '\x7f'.repeat(Array.from(prefix).length) + cmd;
            }
            this.suppressed = true;
            this.hide();
            if (data) this.view.sendInput(data);
            this.view.focus();
        }

        removeItem(cmd) {
            history.remove(cmd);
            if (this.opts.onRemove) this.opts.onRemove(cmd);
            const idx = this.items.indexOf(cmd);
            if (idx >= 0) this.items.splice(idx, 1);
            if (!this.items.length) {
                this.hide();
                return;
            }
            if (this.sel >= this.items.length) this.sel = this.items.length - 1;
            this._render();
        }

        // ---------------- 下拉框 ----------------

        _ensurePopup() {
            if (this.popup) return this.popup;
            const el = document.createElement('div');
            el.className = 'terminal-ac';
            // 点击候选时不抢走终端焦点
            el.addEventListener('mousedown', (e) => e.preventDefault());
            el.addEventListener('click', (e) => {
                const del = e.target.closest('.terminal-ac-del');
                const item = e.target.closest('.terminal-ac-item');
                if (!item) return;
                const cmd = this.items[Number(item.dataset.idx)];
                if (del) this.removeItem(cmd);
                else this.accept(cmd);
            });
            this.view.el.appendChild(el);
            this.popup = el;
            return el;
        }

        _render() {
            const el = this._ensurePopup();
            el.textContent = '';
            const q = (this.query || '').toLowerCase();
            this.items.forEach((cmd, i) => {
                const row = document.createElement('div');
                row.className = `terminal-ac-item${i === this.sel ? ' selected' : ''}`;
                row.dataset.idx = String(i);
                const text = document.createElement('span');
                text.className = 'terminal-ac-text';
                const at = cmd.toLowerCase().indexOf(q);
                if (at >= 0 && q) {
                    const mark = document.createElement('mark');
                    mark.textContent = cmd.slice(at, at + q.length);
                    text.append(cmd.slice(0, at), mark, cmd.slice(at + q.length));
                } else {
                    text.textContent = cmd;
                }
                const del = document.createElement('span');
                del.className = 'terminal-ac-del';
                del.title = '从历史中删除 (Shift+Delete)';
                del.textContent = '×';
                row.append(text, del);
                el.appendChild(row);
            });
            const hint = document.createElement('div');
            hint.className = 'terminal-ac-hint';
            hint.textContent = '↑↓ 选择 · Enter 填入 · Esc 关闭';
            el.appendChild(hint);
            el.style.display = '';
            this._position();
            const selected = el.querySelector('.terminal-ac-item.selected');
            if (selected) selected.scrollIntoView({ block: 'nearest' });
        }

        _position() {
            const el = this.popup;
            const term = this.view.term;
            const screen = term.element && term.element.querySelector('.xterm-screen');
            if (!screen || !term.cols || !term.rows) return;
            const hostRect = this.view.el.getBoundingClientRect();
            const rect = screen.getBoundingClientRect();
            const cellW = rect.width / term.cols;
            const cellH = rect.height / term.rows;
            const buf = this._buffer();
            const left0 = rect.left - hostRect.left;
            const top0 = rect.top - hostRect.top;

            el.style.left = '0px';
            el.style.top = '0px';
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            let left = left0 + buf.cursorX * cellW;
            left = Math.max(4, Math.min(left, hostRect.width - w - 8));
            let top = top0 + (buf.cursorY + 1) * cellH + 2;
            if (top + h > hostRect.height - 4) {
                const above = top0 + buf.cursorY * cellH - h - 2;
                top = above >= 4 ? above : Math.max(4, hostRect.height - h - 4);
            }
            el.style.left = `${Math.round(left)}px`;
            el.style.top = `${Math.round(top)}px`;
        }

        hide() {
            this.items = [];
            this.sel = -1;
            if (this.popup) this.popup.style.display = 'none';
        }

        dispose() {
            this.resetLine();
            if (this._frame) cancelAnimationFrame(this._frame);
            this._disposables.forEach(d => d && d.dispose && d.dispose());
            this._disposables = [];
            if (this._onBlur && this.view.term && this.view.term.textarea) {
                this.view.term.textarea.removeEventListener('blur', this._onBlur);
            }
            if (this.popup) this.popup.remove();
            this.popup = null;
        }
    }

    const api = {
        history,
        HistoryIndex,
        AutocompleteController,
        shouldRecord,
        isSensitive,
        extractReverseSearch,
        scoreEntry,
        MAX_COMMAND_LENGTH
    };
    if (typeof window !== 'undefined') window.TerminalAutocomplete = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
