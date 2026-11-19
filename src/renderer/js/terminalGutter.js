// 远程终端：左侧时间戳与行号栏（参考 WindTerm）
// 设计说明见 docs/requirements/远程终端模块.md 第 13 节
//
// - 行号按终端缓冲区的物理行编号，从会话开始累计；回滚区满后被裁掉的行仍计入编号
// - 时间戳记录该行首次收到输出（光标到达该行）的时间
// - 自动换行产生的续行不显示时间戳和行号
// - 备用屏幕（vim/top/less 等）期间留空
// 依赖 xterm 公开 API：registerMarker / onWriteParsed / onRender / buffer

(function () {
    const MIN_DIGITS = 3;

    function pad2(n) {
        return n < 10 ? `0${n}` : String(n);
    }

    function formatTime(ms) {
        const d = new Date(ms);
        return `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}]`;
    }

    class TerminalGutter {
        /**
         * @param {import('@xterm/xterm').Terminal} term
         * @param {Object} opts
         * @param {HTMLElement} opts.container - 放置行号栏的父元素
         * @param {HTMLElement} opts.before - 行号栏插在该元素之前
         * @param {Function} opts.onWidthChange - 宽度变化后回调（用于重新 fit 终端）
         */
        constructor(term, { container, before, onWidthChange }) {
            this.term = term;
            this.onWidthChange = onWidthChange || (() => {});
            this.visible = true;
            this.stamps = new Map();       // 绝对行号 -> 时间戳（ms），按插入顺序递增
            this.offset = 0;               // 绝对行号 = offset + 缓冲区行下标
            this.anchor = null;            // 光标行上的 marker，用于感知回滚裁剪与换行重排
            this.anchorLine = 0;
            this.cursorAbs = -1;           // 上次同步时光标所在绝对行号
            this.digits = MIN_DIGITS;
            this.lastHtml = '';
            this.frame = null;

            this.el = document.createElement('div');
            this.el.className = 'terminal-gutter';
            this.el.setAttribute('aria-hidden', 'true');
            container.insertBefore(this.el, before);
            this._applyWidth();

            this.disposables = [
                // 每次换行都检查裁剪：一次输出超过整个回滚区时，marker 也不会被裁掉而丢失计数
                term.onLineFeed(() => this._trackTrim()),
                term.onWriteParsed(() => this._sync()),
                term.onRender(() => this.schedule()),
                term.onScroll(() => this.schedule()),
                term.onResize(() => this.schedule())
            ];
            this._sync();
        }

        setVisible(visible) {
            visible = !!visible;
            if (visible === this.visible) return;
            this.visible = visible;
            this.el.style.display = visible ? '' : 'none';
            this.lastHtml = '';
            if (visible) this.schedule();
            this.onWidthChange();
        }

        /** 本地清屏（term.clear()）后调用：保持当前行的编号不变，之后的行继续累加 */
        handleClear() {
            const buf = this.term.buffer.active;
            if (buf.type !== 'normal' || this.cursorAbs < 0) return;
            this.offset = Math.max(0, this.cursorAbs - (buf.baseY + buf.cursorY));
            this._reanchor();
            this._prune();
            this.schedule();
        }

        _reanchor() {
            if (this.anchor) this.anchor.dispose();
            this.anchor = this.term.registerMarker(0) || null;
            this.anchorLine = this.anchor ? this.anchor.line : 0;
        }

        /**
         * 根据 marker 的位移累计顶部被裁掉的行数（换行重排时位移可能为负）。
         * marker 接近缓冲区顶部时移到光标行，保证不会被裁掉。
         * 返回 false 表示 marker 已失效（如缓冲区被整体替换）。
         */
        _trackTrim() {
            const buf = this.term.buffer.active;
            if (buf.type !== 'normal') return true;
            if (!this.anchor || this.anchor.isDisposed || this.anchor.line < 0) return false;
            const delta = this.anchorLine - this.anchor.line;
            if (delta) this.offset = Math.max(0, this.offset + delta);
            this.anchorLine = this.anchor.line;
            if (this.anchorLine < this.term.rows) this._reanchor();
            return true;
        }

        /** 每批输出解析后：更新行号偏移、给新到达的行打时间戳 */
        _sync() {
            const buf = this.term.buffer.active;
            if (buf.type !== 'normal') {
                this.schedule();
                return;
            }
            const cursorLine = buf.baseY + buf.cursorY;
            if (!this._trackTrim() && this.cursorAbs >= 0) {
                // marker 意外失效：至少保证当前行编号不倒退
                this.offset = Math.max(this.offset, this.cursorAbs - cursorLine);
            }
            const curAbs = this.offset + cursorLine;
            const now = Date.now();
            if (curAbs !== this.cursorAbs) {
                // 光标向下经过的行都是新输出；向上移动（清屏、进度条重绘）只刷新当前行
                const from = curAbs > this.cursorAbs
                    ? Math.max(this.cursorAbs + 1, curAbs - buf.length + 1)
                    : curAbs;
                for (let a = from; a <= curAbs; a++) {
                    this.stamps.delete(a);          // 保持 Map 按行号递增，便于裁剪
                    this.stamps.set(a, now);
                }
                this.cursorAbs = curAbs;
            } else if (!this.stamps.has(curAbs)) {
                this.stamps.set(curAbs, now);
            }
            if (!this.anchor || this.anchor.isDisposed) this._reanchor();
            this._prune();
            this.schedule();
        }

        _prune() {
            if (this.stamps.size <= this.term.buffer.active.length + 200) return;
            for (const key of this.stamps.keys()) {
                if (key >= this.offset) break;
                this.stamps.delete(key);
            }
        }

        _applyWidth() {
            // "[hh:mm:ss] " 共 11 个字符 + 行号位数
            this.el.style.width = `calc(${11 + this.digits}ch + 12px)`;
        }

        schedule() {
            if (!this.visible || this.frame) return;
            this.frame = requestAnimationFrame(() => {
                this.frame = null;
                this._render();
            });
        }

        _render() {
            const term = this.term;
            if (!this.visible || !term.element) return;
            const screen = term.element.querySelector('.xterm-screen');
            if (!screen || !term.rows) return;
            const rowHeight = screen.getBoundingClientRect().height / term.rows;
            if (!rowHeight) return;

            const buf = term.buffer.active;
            const fontSize = Math.max(10, (term.options.fontSize || 14) - 1);
            if (buf.type === 'normal') {
                const digits = Math.max(MIN_DIGITS, String(this.offset + buf.length).length);
                if (digits !== this.digits) {
                    this.digits = digits;
                    this._applyWidth();
                    this.onWidthChange();
                }
            }
            let html = '';
            for (const r of this.rowsModel()) {
                html += r
                    ? `<div class="${r.cur ? 'tg-row tg-cur' : 'tg-row'}"><span class="tg-time">${r.time ? formatTime(r.time) : ''}</span><span class="tg-num">${r.num}</span></div>`
                    : '<div class="tg-row"></div>';
            }
            const style = `${rowHeight}px/${fontSize}px`;
            if (this.el.dataset.metrics !== style) {
                this.el.dataset.metrics = style;
                this.el.style.setProperty('--tg-row-height', `${rowHeight}px`);
                this.el.style.fontSize = `${fontSize}px`;
                this.lastHtml = '';
            }
            if (html !== this.lastHtml) {
                this.el.innerHTML = html;
                this.lastHtml = html;
            }
        }

        /** 当前视口每一行的显示内容：{ num, time, cur } 或 null（留空） */
        rowsModel() {
            const term = this.term;
            const buf = term.buffer.active;
            const out = [];
            if (buf.type !== 'normal') return new Array(term.rows).fill(null);
            const cursorLine = buf.baseY + buf.cursorY;
            for (let i = 0; i < term.rows; i++) {
                const idx = buf.viewportY + i;
                const line = idx < buf.length ? buf.getLine(idx) : null;
                // 续行不显示；光标之后的空行（清屏后残留的区域）不显示
                const show = line && !line.isWrapped
                    && (idx <= cursorLine || line.translateToString(true).length > 0);
                if (!show) {
                    out.push(null);
                    continue;
                }
                const abs = this.offset + idx;
                out.push({ num: abs + 1, time: this.stamps.get(abs) || 0, cur: idx === cursorLine });
            }
            return out;
        }

        dispose() {
            if (this.frame) cancelAnimationFrame(this.frame);
            this.disposables.forEach(d => d.dispose());
            if (this.anchor) this.anchor.dispose();
            this.stamps.clear();
            this.el.remove();
        }
    }

    if (typeof window !== 'undefined') window.TerminalGutter = TerminalGutter;
    if (typeof module !== 'undefined' && module.exports) module.exports = { TerminalGutter, formatTime };
})();
