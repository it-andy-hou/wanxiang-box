// 远程终端：AI 分析面板（终端页右侧，可收起）
// 每个终端标签独立一份对话；请求在主进程执行（ai:terminalChat），不阻塞终端数据流
// 内容按原文发送，不脱敏（需求确认见 docs/requirements/远程终端模块.md 第 14 节）

(function () {
    const LINE_OPTIONS = [200, 500, 1000, 2000, 5000];
    const LINES_KEY = 'terminal.aiLines';
    const WIDTH_KEY = 'terminal.aiPanelWidth';
    const MIN_WIDTH = 320;
    const MAX_WIDTH = 720;
    const DEFAULT_WIDTH = 420;
    // 与主进程 aiService.js 中的限制保持一致
    const MAX_CONTEXT_CHARS = 60000;
    const MAX_QUESTION_CHARS = 4000;
    const MAX_ROUNDS = 20;
    const MAX_CONCURRENT = 3;
    const QUOTE_LIMIT = 3000;     // 已有对话时，选中内容不超过此长度则作为引用填入追问
    const DEFAULT_QUESTION = '分析这段终端输出：有没有错误或异常，原因是什么，下一步怎么排查。';
    const SOURCE_TEXT = { selection: '选中内容', recent: '最近输出', screen: '当前屏幕' };

    const esc = (str) => String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function notify(msg, type = 'info') {
        if (window.Utils && Utils.notify) (Utils.notify[type] || Utils.notify.info)(msg);
    }

    function svc() {
        if (!svc._inst && window.AiService) svc._inst = new window.AiService();
        return svc._inst;
    }

    function copyText(text) {
        if (window.TerminalView && window.TerminalView.copyText) window.TerminalView.copyText(text);
        else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    }

    function formatElapsed(ms) {
        const s = Math.floor(ms / 1000);
        return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
    }

    function countLines(text) {
        return text ? text.split('\n').length : 0;
    }

    // ---------------- Markdown（先转义再转换，不支持原始 HTML） ----------------

    function inlineMd(text) {
        // 按反引号切分，行内代码内部不再做其他转换
        return String(text).split(/(`[^`\n]+`)/g).map(part => {
            if (/^`[^`\n]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
            return esc(part).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        }).join('');
    }

    function splitRow(line) {
        return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    }

    /** 返回 { html, codes }，codes 为代码块原文，按 data-code 下标引用 */
    function renderMarkdown(src) {
        const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
        const codes = [];
        const out = [];
        let para = [];
        let list = null;    // { tag, items }

        const flushPara = () => {
            if (para.length) out.push(`<p>${para.map(inlineMd).join('<br>')}</p>`);
            para = [];
        };
        const flushList = () => {
            if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inlineMd(i)}</li>`).join('')}</${list.tag}>`);
            list = null;
        };
        const flush = () => { flushPara(); flushList(); };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
            if (fence) {
                flush();
                const body = [];
                i++;
                while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
                const code = body.join('\n');
                const idx = codes.push(code) - 1;
                const lang = fence[1] || '';
                out.push(`<div class="tai-code">
                    <div class="tai-code-bar"><span>${esc(lang || 'code')}</span>
                        <button type="button" data-code-act="copy" data-code="${idx}">复制</button>
                        <button type="button" data-code-act="insert" data-code="${idx}" title="填入终端命令行，不自动执行">插入终端</button>
                    </div><pre><code>${esc(code)}</code></pre></div>`);
                continue;
            }
            // 表格：表头行 + 分隔行
            if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
                flush();
                const head = splitRow(line);
                i += 2;
                const rows = [];
                while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
                i--;
                out.push(`<div class="tai-table"><table><thead><tr>${head.map(c => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
                continue;
            }
            if (!line.trim()) { flush(); continue; }
            const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
            if (heading) {
                flush();
                const level = Math.min(6, heading[1].length + 2);   // 面板内缩小标题层级
                out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
                continue;
            }
            if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
            const quote = line.match(/^\s*>\s?(.*)$/);
            if (quote) { flush(); out.push(`<blockquote>${inlineMd(quote[1])}</blockquote>`); continue; }
            const ul = line.match(/^\s*[-*+]\s+(.*)$/);
            const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (ul || ol) {
                flushPara();
                const tag = ul ? 'ul' : 'ol';
                if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
                list.items.push((ul || ol)[1]);
                continue;
            }
            // 列表项的续行
            if (list && /^\s{2,}\S/.test(line)) {
                list.items[list.items.length - 1] += ' ' + line.trim();
                continue;
            }
            flushList();
            para.push(line);
        }
        flush();
        return { html: out.join(''), codes };
    }

    // ---------------- 面板 ----------------

    class TerminalAiPanel {
        constructor(page, el) {
            this.page = page;
            this.el = el;
            this.states = new Map();     // view -> 对话状态
            this.visible = false;
            this.view = null;            // 面板当前显示的标签
            this.ticker = null;
            this.lines = Number(localStorage.getItem(LINES_KEY)) || 500;
            if (!LINE_OPTIONS.includes(this.lines)) this.lines = 500;
            const w = Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH;
            this.el.style.width = `${Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))}px`;
            this._build();
        }

        _state(view) {
            let st = this.states.get(view);
            if (!st) {
                st = {
                    context: '', source: 'recent', lines: 0, // 待发送内容及来源
                    sentContext: null,                       // 第一次发送后固定
                    turns: [],                               // [{ role, content, meta }]
                    pending: null,                           // { requestId, startedAt }
                    error: '',
                    draft: '',
                    unread: false
                };
                this.states.set(view, st);
            }
            return st;
        }

        /** 标签角标状态：'pending' | 'unread' | null */
        tabState(view) {
            const st = this.states.get(view);
            if (!st) return null;
            if (st.pending) return 'pending';
            return st.unread ? 'unread' : null;
        }

        _build() {
            this.el.innerHTML = `
                <div class="tai-resizer" title="拖动调整宽度"></div>
                <div class="tai-head">
                    <span class="tai-title">AI 分析</span>
                    <span class="tai-host"></span>
                    <button type="button" class="tai-head-btn" data-act="new" title="清空当前标签的对话，重新获取内容">新对话</button>
                    <button type="button" class="tai-head-btn tai-head-close" data-act="close" title="收起（分析会在后台继续）">×</button>
                </div>
                <div class="tai-scroll">
                    <div class="tai-empty">未打开终端</div>
                    <details class="tai-context" open>
                        <summary class="tai-context-summary"></summary>
                        <div class="tai-context-tools">
                            <label>最近 <select class="tai-lines">${LINE_OPTIONS.map(n => `<option value="${n}">${n}</option>`).join('')}</select> 行</label>
                            <button type="button" class="tai-link" data-act="fetch">重新获取</button>
                            <span class="tai-spacer"></span>
                            <button type="button" class="tai-link" data-act="clear-context">清空</button>
                        </div>
                        <textarea class="tai-context-text" spellcheck="false" placeholder="选中终端输出后点击「问 AI」，或点击「重新获取」读取最近输出。可在此编辑要发送的内容。"></textarea>
                        <div class="tai-context-meta"></div>
                        <div class="tai-notice">内容将按原文（不脱敏）发送至当前配置的大模型服务。AI 建议仅供参考，命令不会自动执行。</div>
                    </details>
                    <div class="tai-messages"></div>
                </div>
                <div class="tai-input">
                    <textarea class="tai-question" rows="2" maxlength="${MAX_QUESTION_CHARS}" placeholder="想问什么？留空则按默认要求分析（Enter 发送，Shift+Enter 换行）"></textarea>
                    <div class="tai-input-bar">
                        <span class="tai-status"></span>
                        <button type="button" class="btn btn-sm btn-secondary" data-act="cancel" style="display: none;">取消</button>
                        <button type="button" class="btn btn-sm btn-primary" data-act="send">发送</button>
                    </div>
                </div>`;
            const q = (s) => this.el.querySelector(s);
            this.hostEl = q('.tai-host');
            this.emptyEl = q('.tai-empty');
            this.scrollEl = q('.tai-scroll');
            this.contextEl = q('.tai-context');
            this.summaryEl = q('.tai-context-summary');
            this.contextText = q('.tai-context-text');
            this.contextMeta = q('.tai-context-meta');
            this.linesEl = q('.tai-lines');
            this.messagesEl = q('.tai-messages');
            this.questionEl = q('.tai-question');
            this.statusEl = q('.tai-status');
            this.sendBtn = q('[data-act="send"]');
            this.cancelBtn = q('[data-act="cancel"]');
            this.toolsEl = q('.tai-context-tools');
            this.linesEl.value = String(this.lines);

            this.el.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-act], [data-code-act]');
                if (!btn || !this.el.contains(btn)) return;
                const act = btn.dataset.act;
                if (act === 'close') this.hide();
                else if (act === 'new') this.newConversation();
                else if (act === 'fetch') this.fetchRecent();
                else if (act === 'clear-context') this._setContext('', 'selection', 0);
                else if (act === 'send') this.send();
                else if (act === 'cancel') this.cancel();
                else if (act === 'copy-reply') this._copyReply(Number(btn.dataset.index));
                else if (btn.dataset.codeAct) this._codeAction(btn);
            });
            this.linesEl.addEventListener('change', () => {
                this.lines = Number(this.linesEl.value) || 500;
                localStorage.setItem(LINES_KEY, String(this.lines));
                this.fetchRecent();
            });
            this.contextText.addEventListener('input', () => {
                const st = this.view && this._state(this.view);
                if (!st || st.sentContext !== null) return;
                st.context = this.contextText.value;
                this._renderContextMeta(st);
            });
            this.questionEl.addEventListener('input', () => {
                if (this.view) this._state(this.view).draft = this.questionEl.value;
            });
            this.questionEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    this.send();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (this.view) this.view.focus();
                }
            });
            this._bindResizer(q('.tai-resizer'));
        }

        _bindResizer(handle) {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const right = this.el.getBoundingClientRect().right;
                document.body.classList.add('tai-resizing');
                const onMove = (ev) => {
                    const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, right - ev.clientX));
                    this.el.style.width = `${w}px`;
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.body.classList.remove('tai-resizing');
                    localStorage.setItem(WIDTH_KEY, String(parseInt(this.el.style.width, 10) || DEFAULT_WIDTH));
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }

        // ---------------- 显示 ----------------

        toggle() {
            if (this.visible) this.hide();
            else this.show();
        }

        show() {
            this.visible = true;
            this.el.style.display = '';
            this._syncButton();
            const view = this.page.active;
            // 首次打开且对话为空：自动读取最近输出
            if (view && view.term) {
                const st = this._state(view);
                if (!st.turns.length && !st.context.trim()) this._fillRecent(view, st);
            }
            this.onActiveChanged();
            setTimeout(() => this.questionEl.focus(), 0);
        }

        hide() {
            this.visible = false;
            this.el.style.display = 'none';
            this._syncButton();
            if (this.page.active) this.page.active.focus();
        }

        _syncButton() {
            const btn = document.getElementById('terminalAiBtn');
            if (btn) btn.classList.toggle('active', this.visible);
        }

        /** 当前标签变化或面板打开时刷新显示 */
        onActiveChanged() {
            const view = this.page.active;
            if (this.view && this.view !== view) {
                // 保存切走标签的输入草稿
                const prev = this.states.get(this.view);
                if (prev) prev.draft = this.questionEl.value;
            }
            this.view = view || null;
            if (!this.visible) return;
            if (view) {
                const st = this._state(view);
                if (st.unread) {
                    st.unread = false;
                    this.page.render();
                }
                this.questionEl.value = st.draft || '';
            }
            this.render();
        }

        onViewRemoved(view) {
            const st = this.states.get(view);
            if (st && st.pending && svc()) svc().terminalCancel(st.pending.requestId);
            this.states.delete(view);
            if (this.view === view) this.view = null;
            this._updateTicker();
        }

        /** 浮动按钮 / 右键菜单入口 */
        async openWith(view, { source, text } = {}) {
            const st = this._state(view);
            if (!this.visible) {
                this.visible = true;
                this.el.style.display = '';
                this._syncButton();
            }
            this.view = view;
            this.questionEl.value = st.draft || '';

            if (source === 'selection') {
                const sel = String(text || '').replace(/\s+$/, '');
                if (!st.turns.length && !st.pending) {
                    this._setContext(sel, 'selection', countLines(sel));
                } else if (sel.length <= QUOTE_LIMIT) {
                    // 已有对话：作为引用填入追问
                    const quoted = `\`\`\`\n${sel}\n\`\`\`\n`;
                    this.questionEl.value = (this.questionEl.value ? this.questionEl.value.replace(/\s+$/, '') + '\n' : '') + quoted;
                    st.draft = this.questionEl.value;
                } else if (await this._confirmNew('选中内容较长，无法作为追问引用。是否开始新对话并用选中内容作为分析上下文？')) {
                    this._reset(view);
                    this._setContext(sel, 'selection', countLines(sel));
                }
            } else if (source === 'recent') {
                if (!st.turns.length && !st.pending) {
                    this._fillRecent(view, st);
                } else if (await this._confirmNew('当前标签已有 AI 对话。是否开始新对话并重新读取最近输出？')) {
                    this._reset(view);
                    this._fillRecent(view, this._state(view));
                }
            }
            this.render();
            setTimeout(() => {
                this.questionEl.focus();
                const len = this.questionEl.value.length;
                this.questionEl.setSelectionRange(len, len);
            }, 0);
        }

        async _confirmNew(message) {
            if (window.Utils && Utils.confirm) return Utils.confirm(message, '开始新对话');
            return window.confirm(message);
        }

        // ---------------- 待发送内容 ----------------

        _fillRecent(view, st) {
            if (!view || !view.term) return;
            const r = view.getRecentOutput(this.lines);
            st.context = r.text;
            st.source = r.source;
            st.lines = r.lines;
        }

        fetchRecent() {
            const view = this.view;
            if (!view || !view.term) return;
            const st = this._state(view);
            if (st.sentContext !== null) return;
            this._fillRecent(view, st);
            if (!st.context) notify('终端暂无输出', 'warning');
            this.render();
        }

        _setContext(text, source, lines) {
            const view = this.view;
            if (!view) return;
            const st = this._state(view);
            if (st.sentContext !== null) return;
            st.context = text;
            st.source = source;
            st.lines = lines;
            this.render();
        }

        async newConversation() {
            const view = this.view;
            if (!view) return;
            const st = this._state(view);
            if (st.pending) {
                notify('正在分析中，请先取消或等待完成', 'warning');
                return;
            }
            if (st.turns.length && !(await this._confirmNew('清空当前标签的 AI 对话？'))) return;
            this._reset(view);
            this._fillRecent(view, this._state(view));
            this.questionEl.value = '';
            this.render();
        }

        _reset(view) {
            const st = this.states.get(view);
            if (st && st.pending && svc()) svc().terminalCancel(st.pending.requestId);
            this.states.delete(view);
            this._updateTicker();
        }

        // ---------------- 发送 ----------------

        async send() {
            const view = this.view;
            if (!view) return;
            const st = this._state(view);
            if (st.pending) return;
            const s = svc();
            if (!s) { notify('仅支持 Electron 环境', 'error'); return; }

            const question = this.questionEl.value.trim();
            const first = st.sentContext === null;
            if (first && !st.context.trim()) {
                notify('待发送内容为空：请选中终端输出后点击「问 AI」，或点击「重新获取」', 'warning');
                return;
            }
            if (!first && !question) {
                notify('请输入追问内容', 'warning');
                return;
            }
            if (st.turns.filter(t => t.role === 'user').length >= MAX_ROUNDS) {
                notify(`单个对话最多 ${MAX_ROUNDS} 轮，请点击「新对话」`, 'warning');
                return;
            }
            const running = [...this.states.values()].filter(x => x.pending).length;
            if (running >= MAX_CONCURRENT) {
                notify(`最多同时进行 ${MAX_CONCURRENT} 个 AI 分析，请稍后再试`, 'warning');
                return;
            }
            if (window.AIAnalysisUI && AIAnalysisUI.isConfigured) {
                const cfg = await AIAnalysisUI.isConfigured();
                if (!cfg.ok) { notify(cfg.msg, 'warning'); return; }
            }
            // 等待配置检查期间可能已发送、开启新对话或关闭标签
            if (st.pending || this.states.get(view) !== st) return;

            if (first) st.sentContext = st.context;
            st.turns.push({ role: 'user', content: question || DEFAULT_QUESTION });
            st.error = '';
            st.draft = '';
            if (this.view === view) this.questionEl.value = '';
            const requestId = `trm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            st.pending = { requestId, startedAt: Date.now() };
            this._updateTicker();
            this.page.render();
            this.render();

            const host = view.host || {};
            let res;
            try {
                res = await s.terminalChat({
                    requestId,
                    host: {
                        label: view.label,
                        hostname: host.hostname || '',
                        osType: host.osType || host.os_type || '',
                        osVersion: host.osVersion || host.os_version || ''
                    },
                    source: st.source,
                    lines: st.lines,
                    context: st.sentContext,
                    turns: st.turns.map(t => ({ role: t.role, content: t.content }))
                });
            } catch (e) {
                res = { success: false, message: e.message };
            }

            // 等待期间标签被关闭或开启了新对话
            if (this.states.get(view) !== st) return;
            st.pending = null;
            this._updateTicker();
            if (res && res.success) {
                const d = res.data || {};
                st.turns.push({
                    role: 'assistant',
                    content: d.content || '',
                    meta: { usage: d.usage, contextTruncated: d.contextTruncated, omittedRounds: d.omittedRounds, at: Date.now() }
                });
                if (window.AIAnalysisUI && AIAnalysisUI.refreshTokenStats) AIAnalysisUI.refreshTokenStats();
                const seen = this.visible && this.page.isActive(view);
                if (!seen) {
                    st.unread = true;
                    notify(`${view.label} 的 AI 分析已完成`, 'success');
                }
            } else {
                // 失败或取消：撤回这条提问，放回输入框便于重试
                const lastQ = st.turns.pop();
                if (!st.turns.length) st.sentContext = null;
                st.error = res && res.cancelled ? '已取消' : ((res && res.message) || '分析失败');
                const restore = lastQ && lastQ.content !== DEFAULT_QUESTION ? lastQ.content : '';
                if (this.view === view && !this.questionEl.value) this.questionEl.value = restore;
                else if (!st.draft) st.draft = restore;
                if (!(res && res.cancelled) && !(this.visible && this.page.isActive(view))) {
                    notify(`${view.label} 的 AI 分析失败：${st.error}`, 'error');
                }
            }
            this.page.render();
            if (this.view === view) this.render();
        }

        cancel() {
            const st = this.view && this.states.get(this.view);
            if (!st || !st.pending || !svc()) return;
            svc().terminalCancel(st.pending.requestId);
        }

        _updateTicker() {
            const anyPending = [...this.states.values()].some(st => st.pending);
            if (anyPending && !this.ticker) {
                this.ticker = setInterval(() => this._renderStatus(), 1000);
            } else if (!anyPending && this.ticker) {
                clearInterval(this.ticker);
                this.ticker = null;
            }
        }

        // ---------------- 渲染 ----------------

        render() {
            if (!this.visible) return;
            const view = this.view;
            const has = !!view;
            this.emptyEl.style.display = has ? 'none' : '';
            this.contextEl.style.display = has ? '' : 'none';
            this.el.querySelector('.tai-input').style.display = has ? '' : 'none';
            this.hostEl.textContent = has ? view.label : '';
            this.hostEl.title = has ? view.label : '';
            if (!has) {
                this.messagesEl.innerHTML = '';
                return;
            }
            const st = this._state(view);
            this._renderContext(st);
            this._renderMessages(st);
            this._renderStatus();
        }

        _renderContext(st) {
            const locked = st.sentContext !== null;
            const text = locked ? st.sentContext : st.context;
            if (this.contextText.value !== text) this.contextText.value = text;
            this.contextText.readOnly = locked;
            this.toolsEl.style.display = locked ? 'none' : '';
            // 首次发送后默认折叠，避免占据对话空间
            if (locked && !this._lockedOnce.has(st)) {
                this.contextEl.open = false;
                this._lockedOnce.add(st);
            } else if (!locked) {
                this.contextEl.open = true;
            }
            this._renderContextMeta(st);
        }

        get _lockedOnce() {
            if (!this.__lockedOnce) this.__lockedOnce = new WeakSet();
            return this.__lockedOnce;
        }

        _renderContextMeta(st) {
            const locked = st.sentContext !== null;
            const text = locked ? st.sentContext : st.context;
            const chars = text.length;
            const lines = countLines(text);
            const tokens = Math.ceil(chars / 3);
            const src = SOURCE_TEXT[st.source] || '';
            this.summaryEl.textContent = locked
                ? `分析上下文（已发送）· ${src} · ${lines} 行 · ${chars.toLocaleString()} 字符`
                : `待发送内容 · ${src || '未获取'}`;
            const parts = [`${lines} 行`, `${chars.toLocaleString()} 字符`, `约 ${tokens.toLocaleString()} tokens（估算）`];
            let warn = '';
            if (chars > MAX_CONTEXT_CHARS) {
                warn = `超过 ${MAX_CONTEXT_CHARS.toLocaleString()} 字符，发送时只保留最后 ${MAX_CONTEXT_CHARS.toLocaleString()} 字符`;
            } else if (st.source === 'screen') {
                warn = '全屏程序运行中，只能取到当前屏幕内容';
            } else if (st.source === 'recent' && !locked && lines < this.lines && lines > 0) {
                warn = `终端缓冲区只有 ${lines} 行`;
            }
            this.contextMeta.innerHTML = `${esc(parts.join(' · '))}${warn ? `<div class="tai-warn">${esc(warn)}</div>` : ''}`;
        }

        _renderMessages(st) {
            this._codes = [];
            const html = st.turns.map((t, index) => {
                if (t.role === 'user') {
                    return `<div class="tai-msg tai-msg-user"><div class="tai-msg-body">${esc(t.content)}</div></div>`;
                }
                const { html: body, codes } = renderMarkdown(t.content);
                const base = this._codes.length;
                this._codes.push(...codes);
                // 代码块下标改为全局下标
                const fixed = base ? body.replace(/data-code="(\d+)"/g, (m, n) => `data-code="${Number(n) + base}"`) : body;
                const m = t.meta || {};
                const notes = [];
                if (m.contextTruncated) notes.push('上下文过长，已只发送末尾部分');
                if (m.omittedRounds) notes.push(`为控制长度省略了较早的 ${m.omittedRounds} 轮追问`);
                const usage = m.usage && m.usage.total ? `${m.usage.total.toLocaleString()} tokens` : '';
                const time = m.at ? new Date(m.at).toLocaleTimeString('zh-CN', { hour12: false }) : '';
                return `<div class="tai-msg tai-msg-ai">
                    <div class="tai-msg-body tai-md">${fixed || '<p>（空回复）</p>'}</div>
                    <div class="tai-msg-meta">
                        <span>${esc([time, usage].filter(Boolean).join(' · '))}</span>
                        ${notes.length ? `<span class="tai-warn">${esc(notes.join('；'))}</span>` : ''}
                        <span class="tai-spacer"></span>
                        <button type="button" class="tai-link" data-act="copy-reply" data-index="${index}">复制回复</button>
                    </div>
                </div>`;
            }).join('');
            const pending = st.pending
                ? '<div class="tai-msg tai-msg-ai tai-pending"><span class="ai-spin"></span> <span class="tai-pending-text">正在分析…</span></div>'
                : '';
            const error = st.error ? `<div class="tai-error">${esc(st.error)}</div>` : '';
            this.messagesEl.innerHTML = html + pending + error;
            if (st.turns.length || st.pending) this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
        }

        _renderStatus() {
            if (!this.visible || !this.view) return;
            const st = this.states.get(this.view);
            const pending = st && st.pending;
            this.sendBtn.disabled = !!pending;
            this.cancelBtn.style.display = pending ? '' : 'none';
            const others = [...this.states.entries()].filter(([v, x]) => x.pending && v !== this.view).length;
            let text = '';
            if (pending) text = `分析中 ${formatElapsed(Date.now() - pending.startedAt)}，可继续操作终端`;
            else if (st && st.turns.length) text = `第 ${st.turns.filter(t => t.role === 'user').length} / ${MAX_ROUNDS} 轮`;
            if (others) text += `${text ? ' · ' : ''}其他标签 ${others} 个分析中`;
            this.statusEl.textContent = text;
            const p = this.messagesEl.querySelector('.tai-pending-text');
            if (p && pending) p.textContent = `正在分析… ${formatElapsed(Date.now() - pending.startedAt)}`;
        }

        // ---------------- 操作 ----------------

        _copyReply(index) {
            const st = this.view && this.states.get(this.view);
            const t = st && st.turns[index];
            if (!t) return;
            copyText(t.content);
            notify('已复制', 'success');
        }

        _codeAction(btn) {
            const code = (this._codes || [])[Number(btn.dataset.code)];
            if (code == null) return;
            if (btn.dataset.codeAct === 'copy') {
                copyText(code);
                notify('已复制', 'success');
                return;
            }
            const view = this.view;
            if (!view || view.state !== 'ready') {
                notify('终端未连接，无法插入', 'warning');
                return;
            }
            // 去掉末尾换行，只填入命令行；多行与高危命令由粘贴确认把关
            view.pasteText(code.replace(/\s+$/, ''));
        }
    }

    TerminalAiPanel.renderMarkdown = renderMarkdown;
    window.TerminalAiPanel = TerminalAiPanel;
})();
