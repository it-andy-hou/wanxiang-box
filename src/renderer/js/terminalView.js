// 远程终端：单个标签的 xterm 封装
// 只负责显示与输入，SSH 连接在主进程（src/main/terminalService.js）
// 依赖：@xterm/xterm 及 addon（nodeIntegration 环境下用 require 加载，UMD 包不会挂到 window）

(function () {
    const { ipcRenderer, clipboard } = window.require('electron');
    const isMac = process.platform === 'darwin';

    let xtermModules = null;
    // 延迟加载：未安装依赖时不影响应用其他功能
    function loadXterm() {
        if (xtermModules) return xtermModules;
        xtermModules = {
            Terminal: window.require('@xterm/xterm').Terminal,
            FitAddon: window.require('@xterm/addon-fit').FitAddon,
            SearchAddon: window.require('@xterm/addon-search').SearchAddon,
            WebLinksAddon: window.require('@xterm/addon-web-links').WebLinksAddon,
            Unicode11Addon: window.require('@xterm/addon-unicode11').Unicode11Addon
        };
        return xtermModules;
    }

    // 终端固定深色主题，不跟随 UI 浅色主题（ls --color 等输出在浅底上可读性差）
    // 中性深灰底 + 提高饱和度的 16 色，接近 WindTerm 默认观感；背景色与 terminal.css 中 --term-bg 保持一致
    const TERMINAL_THEME = {
        background: '#1b1d21',
        foreground: '#dcdfe4',
        cursor: '#f5a623',
        cursorAccent: '#1b1d21',
        selectionBackground: 'rgba(97, 175, 239, 0.35)',
        black: '#4b5263',
        red: '#f0605a',
        green: '#8cc265',
        yellow: '#e5c07b',
        blue: '#4aa5f0',
        magenta: '#c678dd',
        cyan: '#42b3c2',
        white: '#d0d3d9',
        brightBlack: '#7f848e',
        brightRed: '#ff7b72',
        brightGreen: '#a5e075',
        brightYellow: '#f0d48a',
        brightBlue: '#6cb6ff',
        brightMagenta: '#d68ef0',
        brightCyan: '#5fd7e0',
        brightWhite: '#ffffff'
    };

    // Maple Mono NL CN：中英文严格 2:1 等宽，自带中文字形（见 assets/fonts/maple-mono-cn/）
    // 字体文件缺失时回退到 JetBrains Mono + Noto Sans SC
    const PRIMARY_FONT = 'Maple Mono NL CN';
    const FONT_FAMILY = `'${PRIMARY_FONT}', 'JetBrains Mono Variable', 'Noto Sans SC Variable', Consolas, 'Courier New', monospace`;

    const ANSI = {
        gray: (s) => `\x1b[90m${s}\x1b[0m`,
        red: (s) => `\x1b[31m${s}\x1b[0m`,
        yellow: (s) => `\x1b[33m${s}\x1b[0m`
    };

    function copyText(text) {
        if (!text) return;
        try {
            clipboard.writeText(text);
        } catch (e) {
            navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
        }
    }

    function readClipboard() {
        try {
            return clipboard.readText() || '';
        } catch (e) {
            return '';
        }
    }

    class TerminalView {
        /**
         * @param {Object} opts
         * @param {Object} opts.host - 主机（仅用于显示，凭据不经过渲染进程）
         * @param {Object} opts.settings - 终端设置
         * @param {Object} opts.page - TerminalPage，提供粘贴确认、提示框、焦点通知等
         */
        constructor({ host, settings, page, highlight }) {
            this.host = host;
            this.settings = settings;
            this.page = page;
            this.highlight = highlight || { enabled: false, rules: [] };   // { enabled, rules(已编译) }
            this.highlighter = null;
            this.decoder = null;
            this.ac = null;
            this.sessionId = null;
            this.state = 'idle';           // idle | connecting | prompt | ready | closed
            this.closedReason = null;
            this.readyAt = null;
            this.fontSize = settings.fontSize;
            this.disposed = false;

            this.el = document.createElement('div');
            this.el.className = 'terminal-view';
            this.termEl = document.createElement('div');
            this.termEl.className = 'terminal-view-xterm';
            this.el.appendChild(this.termEl);
            this.searchBar = null;
        }

        get label() {
            return `${this.host.username}@${this.host.ip}:${this.host.port || 22}`;
        }

        async init() {
            const { Terminal, FitAddon, SearchAddon, WebLinksAddon, Unicode11Addon } = loadXterm();
            // 先等等宽字体加载完成，否则 xterm 测量的字符宽度错误，光标与文字错位
            try {
                await Promise.all([
                    document.fonts.load(`${this.fontSize}px "${PRIMARY_FONT}"`, 'A中'),
                    document.fonts.load(`bold ${this.fontSize}px "${PRIMARY_FONT}"`, 'A中'),
                    document.fonts.load(`${this.fontSize}px "JetBrains Mono Variable"`)
                ]);
            } catch (e) { /* 字体加载失败时使用后备字体 */ }

            const s = this.settings;
            this.term = new Terminal({
                fontFamily: FONT_FAMILY,
                fontSize: this.fontSize,
                fontWeight: 'normal',
                fontWeightBold: 'bold',
                lineHeight: 1.2,
                scrollback: s.scrollback,
                cursorBlink: s.cursorBlink,
                cursorStyle: s.cursorStyle,
                macOptionIsMeta: true,          // Option 作 Meta，readline 的 Alt+B/F 可用
                macOptionClickForcesSelection: true,
                rightClickSelectsWord: false,
                allowProposedApi: true,         // unicode11 需要
                theme: TERMINAL_THEME
            });

            this.fit = new FitAddon();
            this.search = new SearchAddon();
            this.term.loadAddon(this.fit);
            this.term.loadAddon(this.search);
            // 链接需按住 Cmd/Ctrl 点击才打开，避免选择文本时误触
            this.term.loadAddon(new WebLinksAddon((event, uri) => {
                if (!(event.metaKey || event.ctrlKey)) return;
                if (/^https?:\/\//i.test(uri)) ipcRenderer.invoke('open-external', uri);
            }));
            const unicode11 = new Unicode11Addon();
            this.term.loadAddon(unicode11);
            this.term.unicode.activeVersion = '11';

            this.term.open(this.termEl);

            // 时间戳与行号栏
            if (window.TerminalGutter) {
                this.gutter = new window.TerminalGutter(this.term, {
                    container: this.el,
                    before: this.termEl,
                    onWidthChange: () => this.fitNow()
                });
                this.gutter.setVisible(s.showGutter !== false);
            }

            // 关键词高亮：输出先 UTF-8 流式解码（跨分块的多字节字符由 stream 模式处理），再插入颜色码
            if (window.TerminalHighlighter) {
                this.highlighter = new window.TerminalHighlighter.Highlighter(this.highlight.rules);
                this.decoder = new TextDecoder('utf-8');
            }
            // 历史命令补全
            if (window.TerminalAutocomplete) {
                this.ac = new window.TerminalAutocomplete.AutocompleteController(this, {
                    getSettings: () => this.settings,
                    onRecord: (command, hostId) => this.page.onHistoryRecorded(command, hostId),
                    onRemove: (command) => this.page.onHistoryRemoved(command)
                });
            }
            this._bindEvents();
            if (this.ac) this.ac.attach();
        }

        /** 直接发送输入到远端（补全填入等），不经过粘贴确认 */
        sendInput(data) {
            if (this.state !== 'ready' || !this.sessionId || !data) return;
            ipcRenderer.send('terminal:input', { sessionId: this.sessionId, data });
        }

        /** 更新高亮规则；中途开启时按 xterm 当前是否处于备用屏幕初始化解析状态 */
        applyHighlight(highlight) {
            const wasEnabled = this.highlight.enabled;
            this.highlight = highlight;
            if (!this.highlighter) return;
            this.highlighter.setRules(highlight.rules);
            if (highlight.enabled && !wasEnabled) {
                const alt = !!(this.term && this.term.buffer.active.type === 'alternate');
                this.highlighter.reset({ alt });
            }
        }

        _bindEvents() {
            const term = this.term;

            term.onData((data) => {
                this._hideAskAi();
                if (this.state === 'ready') {
                    if (this.ac) this.ac.onInput(data);
                    ipcRenderer.send('terminal:input', { sessionId: this.sessionId, data });
                } else if (this.state === 'closed' && (data === '\r' || data === '\n')) {
                    this.reconnect();
                }
            });
            // 鼠标上报等非 UTF-8 序列
            term.onBinary((data) => {
                if (this.state === 'ready') {
                    ipcRenderer.send('terminal:input', { sessionId: this.sessionId, data, binary: true });
                }
            });

            let resizeTimer = null;
            term.onResize(({ cols, rows }) => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    if (this.sessionId) ipcRenderer.send('terminal:resize', { sessionId: this.sessionId, cols, rows });
                    this.page.onViewChanged(this);
                }, 100);
            });

            term.onSelectionChange(() => {
                if (this.settings.copyOnSelect && term.hasSelection()) copyText(term.getSelection());
                if (!term.hasSelection()) this._hideAskAi();
            });

            // 选中输出后在松开鼠标处浮出"问 AI"按钮（松开可能在终端区域之外，故监听 window）
            this.termEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                this._hideAskAi();
                const onUp = (ev) => {
                    window.removeEventListener('mouseup', onUp, true);
                    // 等 xterm 先完成选区
                    setTimeout(() => this._showAskAi(ev.clientX, ev.clientY), 0);
                };
                window.addEventListener('mouseup', onUp, true);
            });
            term.onScroll(() => this._hideAskAi());
            this.termEl.addEventListener('wheel', () => this._hideAskAi(), { passive: true });

            term.attachCustomKeyEventHandler((e) => this._handleKey(e));

            // 统一拦截粘贴（菜单粘贴、Cmd+V、Shift+Insert 都会触发 paste 事件），走确认与风险检查
            this.el.addEventListener('paste', (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
                this.pasteText(text);
            }, true);

            // 右键：阻止全局右键菜单，按设置执行复制/粘贴或弹出终端菜单
            this.el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.settings.rightClickAction === 'menu') {
                    this.page.showContextMenu(this, e.clientX, e.clientY);
                    return;
                }
                if (term.hasSelection()) {
                    copyText(term.getSelection());
                    term.clearSelection();
                } else {
                    this.pasteText(readClipboard());
                }
                term.focus();
            }, true);

            if (term.textarea) {
                term.textarea.addEventListener('focus', () => this.page.setTerminalFocused(true));
                term.textarea.addEventListener('blur', () => this.page.setTerminalFocused(false));
            }

            this.resizeObserver = new ResizeObserver(() => this.fitNow());
            this.resizeObserver.observe(this.el);
        }

        /** 返回 false 表示 xterm 不处理该按键 */
        _handleKey(e) {
            // 补全候选框显示时，↑↓/Enter/Esc 由候选框处理
            if (this.ac && this.ac.handleKey(e) === false) return false;
            if (e.type !== 'keydown') return true;
            const key = (e.key || '').toLowerCase();

            if (isMac && e.metaKey) {
                if (key === 'c') { this.copySelection(); return false; }
                if (key === 'v') return false;              // 交给原生 paste 事件
                if (key === 'a') { this.term.selectAll(); return false; }
                if (key === 'f') { e.preventDefault(); this.openSearch(); return false; }
                if (key === 'k') { this.clearScreen(); return false; }
                if (key === '=' || key === '+') { e.preventDefault(); this.zoom(1); return false; }
                if (key === '-') { e.preventDefault(); this.zoom(-1); return false; }
                if (key === '0') { e.preventDefault(); this.zoom(0); return false; }
                return false;                               // 其他 Cmd 组合键不发往远端
            }

            if (!isMac) {
                if (e.ctrlKey && e.shiftKey && !e.altKey) {
                    if (key === 'c') { e.preventDefault(); this.copySelection(); return false; }
                    if (key === 'v') { e.preventDefault(); this.pasteText(readClipboard()); return false; }
                    if (key === 'a') { e.preventDefault(); this.term.selectAll(); return false; }
                    if (key === 'f') { e.preventDefault(); this.openSearch(); return false; }
                }
                if (e.shiftKey && key === 'insert') return false;   // 交给原生 paste 事件
                if (e.ctrlKey && !e.shiftKey && !e.altKey) {
                    if (key === '=' || key === '+') { e.preventDefault(); this.zoom(1); return false; }
                    if (key === '-') { e.preventDefault(); this.zoom(-1); return false; }
                    if (key === '0') { e.preventDefault(); this.zoom(0); return false; }
                }
            }
            return true;
        }

        // ---------------- AI 分析 ----------------

        _showAskAi(clientX, clientY) {
            if (this.disposed || !this.term || !this.term.hasSelection()) return;
            if (!this.term.getSelection().trim()) return;
            if (!this.askAiBtn) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'terminal-ask-ai';
                btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg><span>问 AI</span>';
                btn.title = '把选中内容发送给 AI 分析';
                // 阻止 mousedown 默认行为，否则 xterm 会清除选区
                btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.askAiSelection();
                });
                this.el.appendChild(btn);
                this.askAiBtn = btn;
            }
            const btn = this.askAiBtn;
            const rect = this.el.getBoundingClientRect();
            btn.style.display = '';
            const w = btn.offsetWidth || 72;
            const h = btn.offsetHeight || 24;
            const x = Math.max(4, Math.min(clientX - rect.left + 8, rect.width - w - 12));
            let y = clientY - rect.top + 10;
            if (y + h > rect.height - 4) y = clientY - rect.top - h - 10;
            btn.style.left = `${x}px`;
            btn.style.top = `${Math.max(4, y)}px`;
        }

        _hideAskAi() {
            if (this.askAiBtn) this.askAiBtn.style.display = 'none';
        }

        /** 把当前选区交给 AI 面板 */
        askAiSelection() {
            const text = this.term && this.term.hasSelection() ? this.term.getSelection() : '';
            this._hideAskAi();
            if (!text.trim()) return;
            this.page.askAi(this, { source: 'selection', text });
        }

        /**
         * 读取最近 maxLines 个逻辑行（自动折行拼回原始行）的纯文本。
         * 全屏程序（备用屏幕）只能取到当前屏幕。
         * 返回 { text, lines, source: 'recent' | 'screen' }
         */
        getRecentOutput(maxLines) {
            const buf = this.term.buffer.active;
            const alt = buf.type === 'alternate';
            let end = buf.length - 1;
            // 跳过末尾空行（光标之后的空白区）
            while (end > 0) {
                const line = buf.getLine(end);
                if (!line || line.isWrapped || line.translateToString(true) !== '') break;
                end--;
            }
            let start = end;
            let count = 0;
            for (let i = end; i >= 0; i--) {
                const line = buf.getLine(i);
                if (!line) break;
                start = i;
                if (!line.isWrapped && ++count >= maxLines) break;
            }
            const out = [];
            for (let i = start; i <= end; i++) {
                const line = buf.getLine(i);
                if (!line) continue;
                const next = i < end ? buf.getLine(i + 1) : null;
                // 被折行的物理行不去掉行尾空格，否则拼接后会丢字符间的空格
                const s = line.translateToString(!(next && next.isWrapped));
                if (line.isWrapped && out.length) out[out.length - 1] += s;
                else out.push(s);
            }
            for (let i = 0; i < out.length; i++) out[i] = out[i].replace(/\s+$/, '');
            while (out.length && !out[0].trim()) out.shift();
            while (out.length && !out[out.length - 1].trim()) out.pop();
            return { text: out.join('\n'), lines: out.length, source: alt ? 'screen' : 'recent' };
        }

        /** 本地清屏（清空回滚区，保留当前行） */
        clearScreen() {
            this.term.clear();
            if (this.gutter) this.gutter.handleClear();
        }

        copySelection() {
            if (this.term.hasSelection()) copyText(this.term.getSelection());
        }

        async pasteText(text) {
            if (!text || this.state !== 'ready') return;
            const bracketed = !!(this.term.modes && this.term.modes.bracketedPasteMode);
            const confirmed = await this.page.confirmPaste(this, text, { bracketed });
            if (confirmed && this.state === 'ready') this.term.paste(text);
            this.focus();
        }

        zoom(delta) {
            const next = delta === 0 ? this.settings.fontSize : Math.max(10, Math.min(28, this.fontSize + delta));
            if (next === this.fontSize) return;
            this.fontSize = next;
            this.term.options.fontSize = next;
            this.fitNow();
        }

        applySettings(settings) {
            this.settings = settings;
            this.fontSize = settings.fontSize;
            Object.assign(this.term.options, {
                fontSize: settings.fontSize,
                scrollback: settings.scrollback,
                cursorStyle: settings.cursorStyle,
                cursorBlink: settings.cursorBlink
            });
            if (this.gutter) this.gutter.setVisible(settings.showGutter !== false);
            this.fitNow();
        }

        // ---------------- 连接 ----------------

        async connect({ promptPassword = false } = {}) {
            // 同步适配一次，保证远端 PTY 初始尺寸正确
            if (this.el.offsetWidth > 0 && this.el.offsetHeight > 0) {
                try { this.fit.fit(); } catch (e) { /* ignore */ }
            }
            this.state = 'connecting';
            this.closedReason = null;
            this.page.onViewChanged(this);
            const res = await ipcRenderer.invoke('terminal:open', {
                hostId: this.host.id,
                cols: this.term.cols,
                rows: this.term.rows,
                promptPassword
            });
            if (this.disposed) {
                if (res && res.success) ipcRenderer.invoke('terminal:close', { sessionId: res.sessionId });
                return;
            }
            if (!res || !res.success) {
                this._markClosed('error', (res && res.message) || '无法打开终端');
                return;
            }
            this.sessionId = res.sessionId;
            this.page.registerSession(this.sessionId, this);
            // 等待 invoke 返回期间可能发生过 resize，补发一次当前尺寸
            ipcRenderer.send('terminal:resize', { sessionId: this.sessionId, cols: this.term.cols, rows: this.term.rows });
        }

        reconnect() {
            if (this.state !== 'closed') return;
            const promptPassword = this.closedReason === 'auth_failed';
            if (this.sessionId) this.page.unregisterSession(this.sessionId);
            this.sessionId = null;
            if (this.ac) this.ac.resetLine();
            const ts = new Date().toLocaleString('zh-CN', { hour12: false });
            this.term.write(`\r\n${ANSI.gray(`—— 重新连接 ${ts} ——`)}\r\n`);
            this.connect({ promptPassword });
        }

        handleData(chunk) {
            // 流控 ack 始终按原始字节数计，与是否插入颜色码无关
            const bytes = chunk.byteLength || chunk.length || 0;
            let payload = chunk;
            if (this.highlighter && this.highlight.enabled) {
                const bytesView = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                payload = this.highlighter.process(this.decoder.decode(bytesView, { stream: true }));
            }
            this.term.write(payload, () => {
                // 写入渲染完成后确认，驱动主进程流控
                if (this.sessionId) ipcRenderer.send('terminal:ack', { sessionId: this.sessionId, bytes });
            });
        }

        handleStatus(p) {
            if (p.zmodem) {
                const hint = p.zmodem === 'rz'
                    ? '上传文件请使用左侧「文件上传」功能'
                    : '下载文件请使用 scp 或 SFTP 客户端';
                this.term.write(`\r\n${ANSI.yellow(`● 检测到 ${p.zmodem} 命令：终端暂不支持 ZMODEM 文件传输，已自动取消`)}\r\n${ANSI.gray(hint)}\r\n`);
                return;
            }
            if (p.notice) {
                this.term.write(`${ANSI.gray(p.notice)}\r\n`);
                return;
            }
            if (p.prompt) {
                this.state = 'prompt';
                this.page.onViewChanged(this);
                this.page.showPrompt(this, p.prompt);
                return;
            }
            if (p.promptDone) {
                this.page.dismissPrompt(this, p.promptDone);
            }
            switch (p.state) {
                case 'connecting':
                    this.state = 'connecting';
                    if (p.message && !p.promptDone) this.term.write(`${ANSI.gray(p.message)}\r\n`);
                    break;
                case 'ready':
                    this.state = 'ready';
                    this.readyAt = Date.now();
                    if (this.page.isActive(this)) this.focus();
                    break;
                case 'closed':
                    this._markClosed(p.reason, p.message);
                    return;
                default:
                    break;
            }
            this.page.onViewChanged(this);
        }

        _markClosed(reason, message) {
            this.state = 'closed';
            this.closedReason = reason;
            this.readyAt = null;
            if (this.ac) this.ac.resetLine();
            // 新连接从默认状态开始解析（旧连接可能停在全屏程序或着色中途）
            if (this.highlighter) this.highlighter.reset();
            if (this.decoder) this.decoder = new TextDecoder('utf-8');
            this.page.dismissPrompt(this);
            if (reason !== 'user' || message !== '已关闭') {
                const text = message || '连接已断开';
                const color = reason === 'exit' ? ANSI.yellow : ANSI.red;
                const hint = reason === 'auth_failed' ? '按 Enter 重新输入密码并连接' : '按 Enter 重新连接';
                this.term.write(`\r\n${color('● ' + text)}\r\n${ANSI.gray(hint)}\r\n`);
            }
            this.page.onViewChanged(this);
        }

        // ---------------- 显示 ----------------

        fitNow() {
            if (!this.term || !this.fit) return;
            // 隐藏状态下尺寸为 0，fit 会算出 1 列，必须跳过
            if (this.el.offsetWidth === 0 || this.el.offsetHeight === 0) return;
            if (this._fitFrame) return;
            this._fitFrame = requestAnimationFrame(() => {
                this._fitFrame = null;
                try { this.fit.fit(); } catch (e) { /* ignore */ }
                // 字号变化时行数可能不变（不触发 onResize），行高仍需同步
                if (this.gutter) this.gutter.schedule();
            });
        }

        show() {
            this.el.classList.add('active');
            this.fitNow();
        }

        hide() {
            this.el.classList.remove('active');
            if (this.ac) this.ac.hide();
            this._hideAskAi();
            this.closeSearch();
        }

        focus() {
            if (this.term) this.term.focus();
        }

        // ---------------- 搜索 ----------------

        openSearch() {
            if (!this.searchBar) {
                const bar = document.createElement('div');
                bar.className = 'terminal-search';
                bar.innerHTML = `
                    <input type="text" class="terminal-search-input" placeholder="搜索" spellcheck="false">
                    <button type="button" class="terminal-search-btn" data-act="prev" title="上一个 (Shift+Enter)">↑</button>
                    <button type="button" class="terminal-search-btn" data-act="next" title="下一个 (Enter)">↓</button>
                    <button type="button" class="terminal-search-btn" data-act="close" title="关闭 (Esc)">×</button>
                `;
                const input = bar.querySelector('input');
                const opts = { caseSensitive: false };
                bar.addEventListener('click', (e) => {
                    const act = e.target.dataset && e.target.dataset.act;
                    if (act === 'prev') this.search.findPrevious(input.value, opts);
                    if (act === 'next') this.search.findNext(input.value, opts);
                    if (act === 'close') this.closeSearch();
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.shiftKey ? this.search.findPrevious(input.value, opts) : this.search.findNext(input.value, opts);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.closeSearch();
                    }
                });
                input.addEventListener('input', () => {
                    if (input.value) this.search.findNext(input.value, { ...opts, incremental: true });
                });
                this.el.appendChild(bar);
                this.searchBar = bar;
            }
            this.searchBar.style.display = '';
            const input = this.searchBar.querySelector('input');
            const sel = this.term.getSelection();
            if (sel && !sel.includes('\n')) input.value = sel;
            input.focus();
            input.select();
        }

        closeSearch() {
            if (!this.searchBar || this.searchBar.style.display === 'none') return;
            this.searchBar.style.display = 'none';
            this.term.clearSelection();
            this.focus();
        }

        // ---------------- 释放 ----------------

        dispose() {
            if (this.disposed) return;
            this.disposed = true;
            if (this.sessionId) {
                ipcRenderer.invoke('terminal:close', { sessionId: this.sessionId });
                this.page.unregisterSession(this.sessionId);
            }
            if (this.ac) this.ac.dispose();
            if (this.resizeObserver) this.resizeObserver.disconnect();
            if (this._fitFrame) cancelAnimationFrame(this._fitFrame);
            if (this.gutter) this.gutter.dispose();
            if (this.term) this.term.dispose();
            this.el.remove();
        }
    }

    TerminalView.isAvailable = function () {
        try {
            loadXterm();
            return true;
        } catch (e) {
            console.error('[终端] 加载 xterm 失败:', e);
            return false;
        }
    };
    TerminalView.copyText = copyText;
    TerminalView.readClipboard = readClipboard;

    window.TerminalView = TerminalView;
})();
