// 远程终端页面：标签管理、状态栏、主机选择、认证提示、粘贴确认、设置
// 单个终端的显示与输入见 terminalView.js；SSH 连接在主进程 terminalService.js

(function () {
    const { ipcRenderer } = window.require('electron');

    const RECENT_KEY = 'terminal.recentHostIds';
    const RECENT_MAX = 8;
    const PICKER_LIMIT = 100;

    const STATE_TEXT = {
        idle: '未连接',
        connecting: '连接中',
        prompt: '等待输入',
        ready: '已连接'
    };
    const CLOSED_TEXT = {
        exit: '会话已结束',
        network: '连接中断',
        timeout: '连接超时',
        auth_failed: '认证失败',
        hostkey_rejected: '主机指纹不一致',
        user: '已断开',
        error: '连接失败'
    };

    const esc = (str) => String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function formatDuration(ms) {
        const sec = Math.max(0, Math.floor(ms / 1000));
        const h = String(Math.floor(sec / 3600)).padStart(2, '0');
        const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function hostTitle(host) {
        return host.hostname || host.ip;
    }

    /**
     * 通用对话框，复用全局 .modal 样式。返回 Promise<按钮 value>，Esc/遮罩点击返回 null。
     * body 为 DOM 元素；buttons: [{ text, cls, value, primary }]
     */
    const KEEP_OPEN = Symbol('keepOpen');

    function openDialog({ title, body, buttons, width = '480px', onOpen }) {
        let settle;
        const done = new Promise(resolve => { settle = resolve; });
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay terminal-dialog-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal terminal-dialog';
        modal.style.width = width;
        modal.innerHTML = `
            <div class="modal-header"><h3 class="modal-title"></h3><button class="modal-close" type="button">&times;</button></div>
            <div class="modal-body"></div>
            <div class="modal-footer"></div>
        `;
        modal.querySelector('.modal-title').textContent = title;
        modal.querySelector('.modal-body').appendChild(body);
        const footer = modal.querySelector('.modal-footer');
        let primaryBtn = null;
        for (const b of buttons) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `btn ${b.cls || 'btn-secondary'}`;
            btn.textContent = b.text;
            btn.addEventListener('click', () => {
                const v = typeof b.value === 'function' ? b.value() : b.value;
                if (v === KEEP_OPEN) return;           // 校验未通过等情况，保持对话框打开
                close(v);
            });
            footer.appendChild(btn);
            if (b.primary) primaryBtn = btn;
        }
        overlay.appendChild(modal);

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(null);
            }
        };
        function close(value) {
            if (!overlay.isConnected) return;
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            settle(value);
        }
        modal.querySelector('.modal-close').addEventListener('click', () => close(null));
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        if (onOpen) onOpen({ modal, primaryBtn, close });
        else if (primaryBtn) primaryBtn.focus();
        return { done, close };
    }

    class TerminalPageController {
        constructor() {
            this.views = [];              // 标签顺序
            this.active = null;
            this.sessions = new Map();    // sessionId -> view
            this.pending = new Map();     // 尚未登记的 sessionId 的早到消息
            this.retired = new Set();     // 已注销的 sessionId，迟到消息直接丢弃
            this.prompts = new Map();     // view -> { id, close }
            this.settings = null;
            this.initialized = false;
            this.visible = false;
            this.pickerOpen = false;
            this.focusSent = false;
            this.ticker = null;
        }

        // ---------------- 初始化 ----------------

        /** 幂等；并发调用共享同一个 Promise，保证设置加载完成后才能打开标签 */
        init() {
            if (!this._initPromise) this._initPromise = this._doInit();
            return this._initPromise;
        }

        async _doInit() {
            this.initialized = true;
            this.root = document.getElementById('page-terminal');
            this.tabsEl = document.getElementById('terminalTabs');
            this.bodyEl = document.getElementById('terminalBody');
            this.pickerEl = document.getElementById('terminalPicker');
            this.statusEl = document.getElementById('terminalStatusBar');

            document.getElementById('terminalNewTabBtn').addEventListener('click', () => this.togglePicker(true));
            document.getElementById('terminalSettingsBtn').addEventListener('click', () => this.openSettings());
            this._bindPicker();
            this._bindStatusBar();

            // 全局只注册一次，按 sessionId 分发（避免每个标签各注册导致监听器泄漏）
            ipcRenderer.removeAllListeners('terminal:data');
            ipcRenderer.removeAllListeners('terminal:status');
            ipcRenderer.on('terminal:data', (e, { sessionId, chunk }) => this._dispatch(sessionId, 'data', chunk));
            ipcRenderer.on('terminal:status', (e, payload) => this._dispatch(payload.sessionId, 'status', payload));

            try {
                this.settings = await ipcRenderer.invoke('terminal:get-settings');
            } catch (e) {
                this.settings = null;
            }
            if (!this.settings) {
                this.settings = {
                    fontSize: 14, scrollback: 10000, cursorStyle: 'block', cursorBlink: true, copyOnSelect: false,
                    rightClickAction: 'copyPaste', confirmMultilinePaste: true, confirmCloseTab: true, maxSessions: 20,
                    autocompleteEnabled: true, autocompleteMinChars: 2, showGutter: true
                };
            }

            // 关键词高亮规则
            let hlConfig = null;
            try {
                hlConfig = await ipcRenderer.invoke('terminal:get-highlight');
            } catch (e) { /* 使用默认 */ }
            this._setHighlightConfig(hlConfig);

            // 历史命令（全局共享）
            if (window.TerminalAutocomplete) {
                try {
                    window.TerminalAutocomplete.history.load(await ipcRenderer.invoke('terminal:history-get'));
                } catch (e) {
                    console.warn('[终端] 加载历史命令失败:', e);
                }
            }

            // AI 分析面板
            if (window.TerminalAiPanel) {
                this.aiPanel = new window.TerminalAiPanel(this, document.getElementById('terminalAiPanel'));
                document.getElementById('terminalAiBtn').addEventListener('click', () => this.aiPanel.toggle());
            }

            // 快捷命令栏
            if (window.TerminalQuickBar) {
                this.quickBar = new window.TerminalQuickBar(this, document.getElementById('terminalQuickBar'));
                document.getElementById('terminalQuickBarBtn').addEventListener('click', () => this.quickBar.toggle());
                await this.quickBar.init();
            }
            this.render();
        }

        // ---------------- 高亮 / 历史 ----------------

        _setHighlightConfig(config) {
            const H = window.TerminalHighlighter;
            this.highlightConfig = config || (H ? H.defaultConfig() : { enabled: false, builtin: {}, custom: [] });
            this.highlight = {
                enabled: !!(H && this.highlightConfig.enabled),
                rules: H ? H.compileRules(this.highlightConfig) : []
            };
            this.views.forEach(v => v.applyHighlight(this.highlight));
        }

        onHistoryRecorded(command, hostId) {
            ipcRenderer.send('terminal:history-add', { command, hostId });
        }

        onHistoryRemoved(command) {
            ipcRenderer.send('terminal:history-remove', { command });
        }

        _dispatch(sessionId, type, payload) {
            const view = this.sessions.get(sessionId);
            if (!view) {
                if (this.retired.has(sessionId)) return;
                // terminal:open 的 invoke 返回前，主进程可能已推送状态，先暂存
                if (!this.pending.has(sessionId)) {
                    this.pending.set(sessionId, []);
                    setTimeout(() => this.pending.delete(sessionId), 30000);
                }
                this.pending.get(sessionId).push({ type, payload });
                return;
            }
            if (type === 'data') view.handleData(payload);
            else view.handleStatus(payload);
        }

        registerSession(sessionId, view) {
            this.sessions.set(sessionId, view);
            const queued = this.pending.get(sessionId);
            if (queued) {
                this.pending.delete(sessionId);
                for (const m of queued) this._dispatch(sessionId, m.type, m.payload);
            }
        }

        unregisterSession(sessionId) {
            this.sessions.delete(sessionId);
            this.pending.delete(sessionId);
            this.retired.add(sessionId);
        }

        // ---------------- 页面显示 ----------------

        async onShow() {
            await this.init();
            this.visible = true;
            if (this.views.length === 0) this.togglePicker(true);
            if (this.active && !this.pickerOpen) {
                this.active.show();
                this.active.focus();
            }
            this._startTicker();
            this.renderStatus();
        }

        onHide() {
            this.visible = false;
            this._stopTicker();
            this.setTerminalFocused(false);
        }

        isActive(view) {
            return this.visible && this.active === view && !this.pickerOpen;
        }

        setTerminalFocused(focused) {
            // blur 后紧接着另一个标签 focus 时避免抖动
            clearTimeout(this._focusTimer);
            this._focusTimer = setTimeout(() => {
                const value = focused && this.visible;
                if (value === this.focusSent) return;
                this.focusSent = value;
                ipcRenderer.send('terminal:focus', { focused: value });
            }, focused ? 0 : 50);
        }

        _startTicker() {
            this._stopTicker();
            this.ticker = setInterval(() => this.renderStatus(), 1000);
        }

        _stopTicker() {
            if (this.ticker) clearInterval(this.ticker);
            this.ticker = null;
        }

        // ---------------- 打开 / 关闭标签 ----------------

        /** 从其他页面（如主机列表）打开终端 */
        async openHost(host) {
            if (!host) return;
            if (window.app && window.app.navigationManager) window.app.navigationManager.navigateTo('terminal');
            await this.init();
            await this.open(host);
        }

        async open(host) {
            if (!window.TerminalView || !window.TerminalView.isAvailable()) {
                Utils.notify.error('终端组件未安装，请在项目目录执行 npm install 后重启应用');
                return null;
            }
            const openCount = this.views.filter(v => v.state !== 'closed').length;
            if (openCount >= this.settings.maxSessions) {
                Utils.notify.warning(`终端会话数已达上限（${this.settings.maxSessions}），请先关闭部分标签`);
                return null;
            }
            this._remember(host.id);
            const view = new window.TerminalView({ host, settings: this.settings, page: this, highlight: this.highlight });
            this.views.push(view);
            this.bodyEl.appendChild(view.el);
            this.togglePicker(false);
            this.activate(view);
            try {
                await view.init();
            } catch (e) {
                console.error('[终端] 初始化失败:', e);
                Utils.notify.error(`终端初始化失败：${e.message}`);
                this._remove(view);
                return null;
            }
            view.show();
            await view.connect();
            return view;
        }

        activate(view) {
            if (this.active && this.active !== view) this.active.hide();
            this.active = view;
            if (view && !this.pickerOpen) {
                view.show();
                view.focus();
            }
            if (this.aiPanel) this.aiPanel.onActiveChanged();
            this.render();
        }

        /** 终端内发起 AI 分析（浮动按钮、右键菜单） */
        askAi(view, opts) {
            if (!this.aiPanel) {
                Utils.notify.error('AI 面板加载失败');
                return;
            }
            if (this.active !== view) this.activate(view);
            this.aiPanel.openWith(view, opts);
        }

        async closeTab(view) {
            if (view.state === 'ready' && this.settings.confirmCloseTab) {
                const ok = await Utils.confirm(`确定关闭 ${esc(view.label)} 的终端会话？`, '关闭终端');
                if (!ok) {
                    view.focus();
                    return;
                }
            }
            this._remove(view);
        }

        _remove(view) {
            const idx = this.views.indexOf(view);
            this.dismissPrompt(view);
            if (this.aiPanel) this.aiPanel.onViewRemoved(view);
            view.dispose();
            if (idx >= 0) this.views.splice(idx, 1);
            if (this.active === view) {
                this.active = null;
                const next = this.views[idx] || this.views[idx - 1];
                if (next) this.activate(next);
            }
            if (this.views.length === 0) {
                this.setTerminalFocused(false);
                this.togglePicker(true);
            }
            this.render();
        }

        onViewChanged() {
            this.render();
        }

        // ---------------- 渲染 ----------------

        render() {
            if (!this.tabsEl) return;
            this._renderTabs();
            this.renderStatus();
            if (this.quickBar) this.quickBar.refreshState();
        }

        /** 当前可接收输入的标签（快捷命令栏使用） */
        activeReadyView() {
            const v = this.pickerOpen ? null : this.active;
            return v && v.state === 'ready' ? v : null;
        }

        _tabTitle(view) {
            const same = this.views.filter(v => v.host.id === view.host.id);
            const base = hostTitle(view.host);
            return same.length > 1 ? `${base} (${same.indexOf(view) + 1})` : base;
        }

        _stateClass(view) {
            if (view.state === 'ready') return 'is-ready';
            if (view.state === 'closed') return 'is-closed';
            return 'is-connecting';
        }

        _renderTabs() {
            this.tabsEl.textContent = '';
            for (const view of this.views) {
                const tab = document.createElement('div');
                tab.className = `terminal-tab ${this._stateClass(view)}${view === this.active && !this.pickerOpen ? ' active' : ''}`;
                tab.draggable = true;
                tab.title = view.label;
                tab.innerHTML = `
                    <span class="terminal-tab-dot"></span>
                    <span class="terminal-tab-title"></span>
                    <span class="terminal-tab-ai" title="AI 分析有新回复">AI</span>
                    <button type="button" class="terminal-tab-close" title="关闭">×</button>
                `;
                const aiState = this.aiPanel ? this.aiPanel.tabState(view) : null;
                if (aiState) tab.classList.add(`ai-${aiState}`);
                tab.querySelector('.terminal-tab-title').textContent = this._tabTitle(view);
                tab.addEventListener('mousedown', (e) => {
                    if (e.button === 1) e.preventDefault();
                });
                tab.addEventListener('mouseup', (e) => {
                    if (e.button === 1) this.closeTab(view);
                });
                tab.addEventListener('click', (e) => {
                    if (e.target.closest('.terminal-tab-close')) {
                        this.closeTab(view);
                        return;
                    }
                    this.togglePicker(false);
                    this.activate(view);
                });
                tab.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._showTabMenu(view, e.clientX, e.clientY);
                });
                // 拖拽排序
                tab.addEventListener('dragstart', (e) => {
                    this._dragView = view;
                    e.dataTransfer.effectAllowed = 'move';
                    tab.classList.add('dragging');
                });
                tab.addEventListener('dragend', () => {
                    this._dragView = null;
                    this.render();
                });
                tab.addEventListener('dragover', (e) => {
                    const dragging = this._dragView;
                    if (!dragging || dragging === view) return;
                    e.preventDefault();
                    const from = this.views.indexOf(dragging);
                    const to = this.views.indexOf(view);
                    this.views.splice(from, 1);
                    this.views.splice(to, 0, dragging);
                    this._renderTabs();
                });
                this.tabsEl.appendChild(tab);
            }
        }

        renderStatus() {
            if (!this.statusEl) return;
            const view = this.pickerOpen ? null : this.active;
            const labelEl = this.statusEl.querySelector('[data-field="label"]');
            const stateEl = this.statusEl.querySelector('[data-field="state"]');
            const metaEl = this.statusEl.querySelector('[data-field="meta"]');
            const reconnectBtn = this.statusEl.querySelector('[data-act="reconnect"]');
            if (!view) {
                labelEl.textContent = this.views.length ? '选择主机以新建终端' : '未打开终端';
                stateEl.textContent = '';
                stateEl.className = 'terminal-status-state';
                metaEl.textContent = '';
                reconnectBtn.style.display = 'none';
                return;
            }
            labelEl.textContent = view.label;
            let text = STATE_TEXT[view.state] || view.state;
            if (view.state === 'closed') text = CLOSED_TEXT[view.closedReason] || '已断开';
            if (view.state === 'ready' && view.readyAt) text += ` ${formatDuration(Date.now() - view.readyAt)}`;
            stateEl.textContent = text;
            stateEl.className = `terminal-status-state ${this._stateClass(view)}`;
            metaEl.textContent = view.term ? `${view.term.cols}×${view.term.rows} · UTF-8 · ${view.fontSize}px` : '';
            reconnectBtn.style.display = view.state === 'closed' ? '' : 'none';
        }

        _bindStatusBar() {
            this.statusEl.querySelector('[data-act="reconnect"]').addEventListener('click', () => {
                if (this.active) {
                    this.active.reconnect();
                    this.active.focus();
                }
            });
        }

        // ---------------- 主机选择 ----------------

        _bindPicker() {
            this.pickerInput = document.getElementById('terminalPickerSearch');
            this.pickerList = document.getElementById('terminalPickerList');
            this.pickerRecent = document.getElementById('terminalPickerRecent');
            this.pickerInput.addEventListener('input', () => this._renderPicker());
            this.pickerInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const first = this.pickerList.querySelector('.terminal-picker-item');
                    if (first) first.click();
                } else if (e.key === 'Escape' && this.views.length) {
                    this.togglePicker(false);
                }
            });
            const onPick = (e) => {
                const item = e.target.closest('[data-host-id]');
                if (!item) return;
                const host = this._hosts().find(h => String(h.id) === item.dataset.hostId);
                if (host) this.open(host);
            };
            this.pickerList.addEventListener('click', onPick);
            this.pickerRecent.addEventListener('click', onPick);
            document.getElementById('terminalPickerClose').addEventListener('click', () => this.togglePicker(false));
        }

        _hosts() {
            return (window.app && Array.isArray(window.app.hosts)) ? window.app.hosts : [];
        }

        togglePicker(open) {
            if (!this.pickerEl) return;
            this.pickerOpen = !!open;
            this.pickerEl.style.display = open ? '' : 'none';
            document.getElementById('terminalPickerClose').style.display = this.views.length ? '' : 'none';
            if (open) {
                if (this.active) this.active.hide();
                this.setTerminalFocused(false);
                this.pickerInput.value = '';
                this._renderPicker();
                setTimeout(() => this.pickerInput.focus(), 0);
            } else if (this.active) {
                this.active.show();
                this.active.focus();
            }
            this.render();
        }

        _hostItemHtml(h) {
            const sub = [h.ip + (h.port && h.port !== 22 ? `:${h.port}` : ''), h.username, h.systemName || h.system_name, h.environment]
                .filter(Boolean).map(esc).join(' · ');
            return `
                <div class="terminal-picker-item" data-host-id="${esc(h.id)}">
                    <span class="terminal-picker-icon">${Utils.icon('terminal', 14)}</span>
                    <span class="terminal-picker-name">${esc(hostTitle(h))}</span>
                    <span class="terminal-picker-sub">${sub}</span>
                </div>`;
        }

        _renderPicker() {
            const hosts = this._hosts();
            const kw = this.pickerInput.value.trim().toLowerCase();
            const fields = (h) => [h.hostname, h.ip, h.username, h.systemName, h.system_name, h.appName, h.app_name, h.environment, h.datacenter]
                .filter(Boolean).join(' ').toLowerCase();
            const matched = kw ? hosts.filter(h => fields(h).includes(kw)) : hosts;

            const recentIds = Utils.storage.get(RECENT_KEY, []) || [];
            const recent = recentIds.map(id => hosts.find(h => h.id === id)).filter(Boolean);
            const recentWrap = this.pickerRecent.parentElement;
            if (!kw && recent.length) {
                recentWrap.style.display = '';
                this.pickerRecent.innerHTML = recent.map(h => this._hostItemHtml(h)).join('');
            } else {
                recentWrap.style.display = 'none';
                this.pickerRecent.innerHTML = '';
            }

            if (hosts.length === 0) {
                this.pickerList.innerHTML = '<div class="terminal-picker-empty">暂无主机，请先在「主机管理」中添加</div>';
                return;
            }
            if (matched.length === 0) {
                this.pickerList.innerHTML = '<div class="terminal-picker-empty">无匹配主机</div>';
                return;
            }
            const shown = matched.slice(0, PICKER_LIMIT);
            this.pickerList.innerHTML = shown.map(h => this._hostItemHtml(h)).join('') +
                (matched.length > PICKER_LIMIT ? `<div class="terminal-picker-empty">共 ${matched.length} 台，仅显示前 ${PICKER_LIMIT} 台，请输入关键词缩小范围</div>` : '');
        }

        _remember(hostId) {
            const ids = (Utils.storage.get(RECENT_KEY, []) || []).filter(id => id !== hostId);
            ids.unshift(hostId);
            Utils.storage.set(RECENT_KEY, ids.slice(0, RECENT_MAX));
        }

        // ---------------- 认证 / 指纹提示 ----------------

        showPrompt(view, prompt) {
            this.dismissPrompt(view);
            if (this.visible && this.active !== view) {
                this.togglePicker(false);
                this.activate(view);
            }
            const answer = (answers) => {
                if (!this.prompts.has(view)) return;
                this.prompts.delete(view);
                if (view.sessionId) {
                    ipcRenderer.send('terminal:prompt-response', { sessionId: view.sessionId, promptId: prompt.id, answers });
                }
                view.focus();
            };

            const body = document.createElement('div');
            body.className = 'terminal-prompt';
            const target = document.createElement('div');
            target.className = 'terminal-prompt-target';
            target.textContent = view.label;
            body.appendChild(target);
            if (prompt.instructions) {
                const p = document.createElement('p');
                p.className = 'terminal-prompt-instructions';
                p.textContent = prompt.instructions;
                body.appendChild(p);
            }

            let dialog;
            if (prompt.kind === 'hostkey-changed') {
                const d = prompt.details || {};
                const table = document.createElement('div');
                table.className = 'terminal-hostkey';
                const rows = [['地址', d.address], ['原指纹', d.oldKey], ['新指纹', d.newKey], ['原记录时间', d.recordedAt ? new Date(d.recordedAt).toLocaleString('zh-CN', { hour12: false }) : '-']];
                for (const [k, v] of rows) {
                    const row = document.createElement('div');
                    row.className = 'terminal-hostkey-row';
                    const kEl = document.createElement('span');
                    kEl.textContent = k;
                    const vEl = document.createElement('code');
                    vEl.textContent = v || '-';
                    row.append(kEl, vEl);
                    table.appendChild(row);
                }
                body.appendChild(table);
                dialog = openDialog({
                    title: prompt.title || '主机指纹已变化',
                    body,
                    width: '560px',
                    buttons: [
                        { text: '断开', cls: 'btn-secondary', value: null, primary: true },
                        { text: '我已确认，更新指纹并继续', cls: 'btn-danger', value: 'accept' }
                    ]
                });
                dialog.done.then(v => answer(v === 'accept' ? [] : null));
            } else {
                const form = document.createElement('form');
                form.className = 'terminal-prompt-form';
                const inputs = (prompt.fields || []).map((f, i) => {
                    const label = document.createElement('label');
                    label.className = 'form-label';
                    label.textContent = f.label;
                    const input = document.createElement('input');
                    input.className = 'form-control';
                    input.type = f.echo ? 'text' : 'password';
                    input.autocomplete = 'off';
                    input.spellcheck = false;
                    input.dataset.idx = String(i);
                    const group = document.createElement('div');
                    group.className = 'form-group';
                    group.append(label, input);
                    form.appendChild(group);
                    return input;
                });
                body.appendChild(form);
                const collect = () => inputs.map(i => i.value);
                dialog = openDialog({
                    title: prompt.title || '身份验证',
                    body,
                    buttons: [
                        { text: '取消', cls: 'btn-secondary', value: null },
                        { text: '登录', cls: 'btn-primary', value: collect, primary: true }
                    ],
                    onOpen: ({ close }) => {
                        form.addEventListener('submit', (e) => {
                            e.preventDefault();
                            close(collect());
                        });
                        // 回车提交（多字段时最后一个字段回车提交）
                        inputs.forEach((input, i) => input.addEventListener('keydown', (e) => {
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            if (i < inputs.length - 1) inputs[i + 1].focus();
                            else close(collect());
                        }));
                        if (inputs[0]) inputs[0].focus();
                    }
                });
                dialog.done.then(v => answer(Array.isArray(v) ? v : null));
            }
            this.prompts.set(view, { id: prompt.id, close: dialog.close });
        }

        /** 主进程已不再等待该提示（会话关闭等），关闭对话框但不回应 */
        dismissPrompt(view, promptId) {
            const p = this.prompts.get(view);
            if (!p || (promptId && p.id !== promptId)) return;
            this.prompts.delete(view);
            p.close(null);
        }

        // ---------------- 粘贴确认 ----------------

        async confirmPaste(view, text, { bracketed }) {
            const multiline = /[\r\n]/.test(text);
            const risk = window.RiskAnalyzer ? window.RiskAnalyzer.analyzeRisk(text) : { level: 'normal', findings: [] };
            const needConfirm = (multiline && this.settings.confirmMultilinePaste && !bracketed) || risk.level === 'high';
            if (!needConfirm) return true;

            const lines = text.split(/\r\n|\r|\n/);
            const body = document.createElement('div');
            body.className = 'terminal-paste';
            const tip = document.createElement('p');
            tip.className = 'terminal-paste-tip';
            tip.textContent = bracketed
                ? `即将粘贴 ${lines.length} 行内容到 ${view.label}。`
                : `即将粘贴 ${lines.length} 行内容到 ${view.label}，每一行都会被远端立即执行。`;
            body.appendChild(tip);

            if (risk.findings && risk.findings.length) {
                const box = document.createElement('div');
                box.className = `terminal-paste-risk level-${risk.level}`;
                const head = document.createElement('div');
                head.className = 'terminal-paste-risk-head';
                head.innerHTML = `${Utils.icon('alert-triangle', 14)} <span></span>`;
                head.querySelector('span').textContent = risk.level === 'high' ? '检测到高危操作，请确认后再粘贴' : '检测到中危操作';
                box.appendChild(head);
                for (const f of risk.findings.slice(0, 6)) {
                    const item = document.createElement('div');
                    item.className = 'terminal-paste-risk-item';
                    item.textContent = `第 ${f.line} 行：${f.message}  ${f.snippet}`;
                    box.appendChild(item);
                }
                body.appendChild(box);
            }

            const pre = document.createElement('pre');
            pre.className = 'terminal-paste-preview';
            const previewLines = lines.slice(0, 40);
            let preview = previewLines.join('\n');
            if (preview.length > 4000) preview = preview.slice(0, 4000);
            if (lines.length > previewLines.length || preview.length < previewLines.join('\n').length) preview += '\n…';
            pre.textContent = preview;
            body.appendChild(pre);

            const { done } = openDialog({
                title: '确认粘贴',
                body,
                width: '640px',
                buttons: [
                    { text: '取消', cls: 'btn-secondary', value: false, primary: risk.level === 'high' },
                    { text: '粘贴', cls: risk.level === 'high' ? 'btn-danger' : 'btn-primary', value: true, primary: risk.level !== 'high' }
                ]
            });
            return (await done) === true;
        }

        // ---------------- 右键菜单 ----------------

        _popupMenu(x, y, items) {
            this._closeMenu();
            const menu = document.createElement('div');
            menu.className = 'terminal-menu';
            for (const it of items) {
                if (it === '-') {
                    const sep = document.createElement('div');
                    sep.className = 'terminal-menu-sep';
                    menu.appendChild(sep);
                    continue;
                }
                const el = document.createElement('div');
                el.className = `terminal-menu-item${it.disabled ? ' disabled' : ''}`;
                el.textContent = it.text;
                if (!it.disabled) {
                    el.addEventListener('click', () => {
                        this._closeMenu();
                        it.action();
                    });
                }
                menu.appendChild(el);
            }
            document.body.appendChild(menu);
            const maxX = window.innerWidth - menu.offsetWidth - 4;
            const maxY = window.innerHeight - menu.offsetHeight - 4;
            menu.style.left = `${Math.min(x, maxX)}px`;
            menu.style.top = `${Math.min(y, maxY)}px`;
            const onDown = (e) => { if (!menu.contains(e.target)) this._closeMenu(); };
            const onKey = (e) => { if (e.key === 'Escape') this._closeMenu(); };
            setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
            document.addEventListener('keydown', onKey, true);
            this._menu = { el: menu, cleanup: () => {
                document.removeEventListener('mousedown', onDown, true);
                document.removeEventListener('keydown', onKey, true);
            } };
        }

        _closeMenu() {
            if (!this._menu) return;
            this._menu.cleanup();
            this._menu.el.remove();
            this._menu = null;
        }

        showContextMenu(view, x, y) {
            const term = view.term;
            this._popupMenu(x, y, [
                { text: '复制', disabled: !term.hasSelection(), action: () => { view.copySelection(); view.focus(); } },
                { text: '粘贴', disabled: view.state !== 'ready', action: () => view.pasteText(window.TerminalView.readClipboard()) },
                { text: '全选', action: () => { term.selectAll(); view.focus(); } },
                '-',
                { text: '搜索', action: () => view.openSearch() },
                { text: '清屏', action: () => { view.clearScreen(); view.focus(); } },
                '-',
                { text: 'AI 分析选中内容', disabled: !term.hasSelection() || !this.aiPanel, action: () => view.askAiSelection() },
                { text: 'AI 分析最近输出', disabled: !this.aiPanel, action: () => this.askAi(view, { source: 'recent' }) }
            ]);
        }

        _showTabMenu(view, x, y) {
            this._popupMenu(x, y, [
                { text: '复制标签', action: () => this.open(view.host) },
                { text: '重新连接', disabled: view.state !== 'closed', action: () => { this.activate(view); view.reconnect(); } },
                '-',
                { text: '关闭', action: () => this.closeTab(view) },
                { text: '关闭其他标签', disabled: this.views.length < 2, action: () => this._closeOthers(view) }
            ]);
        }

        async _closeOthers(keep) {
            const others = this.views.filter(v => v !== keep);
            const live = others.filter(v => v.state === 'ready').length;
            if (live && this.settings.confirmCloseTab) {
                const ok = await Utils.confirm(`将断开 ${live} 个已连接的终端会话，确定关闭？`, '关闭其他标签');
                if (!ok) return;
            }
            others.forEach(v => this._remove(v));
            this.activate(keep);
        }

        // ---------------- 设置 ----------------

        openSettings() {
            const s = this.settings;
            const H = window.TerminalHighlighter;
            const hl = JSON.parse(JSON.stringify(this.highlightConfig || (H ? H.defaultConfig() : { enabled: true, builtin: {}, custom: [] })));
            const historyCount = window.TerminalAutocomplete ? window.TerminalAutocomplete.history.size : 0;

            const body = document.createElement('div');
            body.className = 'terminal-settings';
            body.innerHTML = `
                <div class="terminal-settings-tabs" role="tablist">
                    <button type="button" class="active" data-tab="basic">基本</button>
                    <button type="button" data-tab="highlight">关键词高亮</button>
                    <button type="button" data-tab="ac">自动补全</button>
                </div>
                <div class="terminal-settings-pane" data-pane="basic">
                    <div class="terminal-settings-grid">
                        <label class="form-label" for="tsFontSize">字号</label>
                        <input class="form-control" id="tsFontSize" type="number" min="10" max="28" value="${esc(s.fontSize)}">
                        <label class="form-label" for="tsScrollback">回滚行数</label>
                        <input class="form-control" id="tsScrollback" type="number" min="500" max="50000" step="500" value="${esc(s.scrollback)}">
                        <label class="form-label" for="tsCursor">光标样式</label>
                        <select class="form-control" id="tsCursor">
                            <option value="block">块状</option>
                            <option value="underline">下划线</option>
                            <option value="bar">竖线</option>
                        </select>
                        <label class="form-label" for="tsRightClick">右键行为</label>
                        <select class="form-control" id="tsRightClick">
                            <option value="copyPaste">有选区时复制，否则粘贴</option>
                            <option value="menu">弹出菜单</option>
                        </select>
                        <label class="form-label" for="tsMaxSessions">最大会话数</label>
                        <input class="form-control" id="tsMaxSessions" type="number" min="1" max="50" value="${esc(s.maxSessions)}">
                    </div>
                    <div class="terminal-settings-checks">
                        <label><input type="checkbox" id="tsCursorBlink"> 光标闪烁</label>
                        <label><input type="checkbox" id="tsCopyOnSelect"> 选中即复制</label>
                        <label><input type="checkbox" id="tsConfirmPaste"> 多行粘贴前确认</label>
                        <label><input type="checkbox" id="tsConfirmClose"> 关闭已连接的标签前确认</label>
                        <label><input type="checkbox" id="tsShowGutter"> 显示时间戳与行号</label>
                    </div>
                    <p class="terminal-settings-hint">回滚行数越大占用内存越多，修改对已打开的标签同样生效。</p>
                </div>
                <div class="terminal-settings-pane" data-pane="highlight" style="display:none">
                    <label class="terminal-settings-switch"><input type="checkbox" id="tsHlEnabled"> 启用关键词高亮</label>
                    <div class="terminal-settings-section">内置规则</div>
                    <div class="terminal-hl-builtin" id="tsHlBuiltin"></div>
                    <div class="terminal-settings-section">
                        <span>自定义规则（优先于内置规则匹配）</span>
                        <button type="button" class="btn btn-sm btn-secondary" id="tsHlAdd">添加规则</button>
                    </div>
                    <div class="terminal-hl-custom" id="tsHlCustom"></div>
                    <p class="terminal-settings-hint">只给远端未着色的文本上色；vim、top 等全屏程序运行时自动停用。正则使用 JavaScript 语法，例如 <code>\\bOOM\\b|Out of memory</code>。</p>
                </div>
                <div class="terminal-settings-pane" data-pane="ac" style="display:none">
                    <label class="terminal-settings-switch"><input type="checkbox" id="tsAcEnabled"> 启用历史命令补全</label>
                    <div class="terminal-settings-grid">
                        <label class="form-label" for="tsAcMin">触发字符数</label>
                        <input class="form-control" id="tsAcMin" type="number" min="1" max="10" value="${esc(s.autocompleteMinChars)}">
                    </div>
                    <div class="terminal-ac-stat">
                        <span>已记录 <b id="tsAcCount">${esc(historyCount)}</b> 条历史命令（所有主机共享）</span>
                        <button type="button" class="btn btn-sm btn-secondary" id="tsAcClear">清空历史</button>
                    </div>
                    <p class="terminal-settings-hint">输入时弹出候选，↑↓ 选择，Enter 填入命令行（不自动执行），Esc 关闭。以空格开头的命令、密码输入，以及含 password=、token=、mysql -p 等疑似敏感信息的命令不会被记录。</p>
                </div>
            `;
            const $ = (id) => body.querySelector(`#${id}`);
            $('tsCursor').value = s.cursorStyle;
            $('tsRightClick').value = s.rightClickAction;
            $('tsCursorBlink').checked = s.cursorBlink;
            $('tsCopyOnSelect').checked = s.copyOnSelect;
            $('tsConfirmPaste').checked = s.confirmMultilinePaste;
            $('tsConfirmClose').checked = s.confirmCloseTab;
            $('tsShowGutter').checked = s.showGutter !== false;
            $('tsHlEnabled').checked = hl.enabled !== false;
            $('tsAcEnabled').checked = s.autocompleteEnabled !== false;

            // 标签切换
            body.querySelector('.terminal-settings-tabs').addEventListener('click', (e) => {
                const btn = e.target.closest('[data-tab]');
                if (!btn) return;
                body.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === btn));
                body.querySelectorAll('[data-pane]').forEach(p => { p.style.display = p.dataset.pane === btn.dataset.tab ? '' : 'none'; });
            });

            // 内置规则
            const colorOptions = (sel) => Object.keys(H ? H.COLORS : {}).map(c =>
                `<option value="${c}"${c === sel ? ' selected' : ''}>${esc(H.COLOR_LABELS[c])}</option>`).join('');
            const builtinEl = $('tsHlBuiltin');
            (H ? H.BUILTIN_RULES : []).forEach(r => {
                const on = typeof hl.builtin[r.id] === 'boolean' ? hl.builtin[r.id] : r.enabled;
                const label = document.createElement('label');
                label.innerHTML = `<input type="checkbox" data-builtin="${esc(r.id)}"${on ? ' checked' : ''}> <span class="terminal-hl-name"></span>`;
                const name = label.querySelector('.terminal-hl-name');
                name.textContent = r.name;
                name.style.color = H.previewColor(r.color);
                if (r.bold) name.style.fontWeight = '600';
                if (r.underline) name.style.textDecoration = 'underline';
                builtinEl.appendChild(label);
            });

            // 自定义规则
            const customEl = $('tsHlCustom');
            const addCustomRow = (r) => {
                const row = document.createElement('div');
                row.className = 'terminal-hl-row';
                row.dataset.id = r.id || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                row.innerHTML = `
                    <input type="checkbox" class="hl-enabled" title="启用"${r.enabled !== false ? ' checked' : ''}>
                    <input type="text" class="form-control hl-name" placeholder="名称" maxlength="40">
                    <input type="text" class="form-control hl-pattern" placeholder="正则，如 \\bOOM\\b" spellcheck="false">
                    <select class="form-control hl-color">${colorOptions(r.color || 'yellow')}</select>
                    <label class="hl-case" title="区分大小写"><input type="checkbox" class="hl-cs"${r.caseSensitive ? ' checked' : ''}> Aa</label>
                    <button type="button" class="terminal-tabbar-btn hl-del" title="删除">×</button>
                `;
                row.querySelector('.hl-name').value = r.name || '';
                row.querySelector('.hl-pattern').value = r.pattern || '';
                const sw = () => { row.querySelector('.hl-color').style.color = H ? H.COLOR_PREVIEW[row.querySelector('.hl-color').value] : ''; };
                row.querySelector('.hl-color').addEventListener('change', sw);
                sw();
                row.querySelector('.hl-del').addEventListener('click', () => {
                    row.remove();
                    renderCustomEmpty();
                });
                customEl.appendChild(row);
                renderCustomEmpty();
                return row;
            };
            const renderCustomEmpty = () => {
                let empty = customEl.querySelector('.terminal-hl-empty');
                const hasRows = !!customEl.querySelector('.terminal-hl-row');
                if (!hasRows && !empty) {
                    empty = document.createElement('div');
                    empty.className = 'terminal-hl-empty';
                    empty.textContent = '暂无自定义规则';
                    customEl.appendChild(empty);
                } else if (hasRows && empty) {
                    empty.remove();
                }
            };
            (hl.custom || []).forEach(addCustomRow);
            renderCustomEmpty();
            $('tsHlAdd').addEventListener('click', () => {
                const row = addCustomRow({ enabled: true, color: 'yellow' });
                row.querySelector('.hl-name').focus();
            });

            // 清空历史：两次点击确认（避免在对话框上再叠一层确认框）
            const clearBtn = $('tsAcClear');
            clearBtn.disabled = historyCount === 0;
            clearBtn.addEventListener('click', async () => {
                if (!clearBtn.dataset.armed) {
                    clearBtn.dataset.armed = '1';
                    clearBtn.textContent = '再次点击确认清空';
                    clearBtn.classList.replace('btn-secondary', 'btn-danger');
                    return;
                }
                await ipcRenderer.invoke('terminal:history-clear');
                if (window.TerminalAutocomplete) window.TerminalAutocomplete.history.clear();
                this.views.forEach(v => v.ac && v.ac.hide());
                $('tsAcCount').textContent = '0';
                clearBtn.textContent = '已清空';
                clearBtn.classList.replace('btn-danger', 'btn-secondary');
                clearBtn.disabled = true;
            });

            const collectHighlight = () => {
                const builtin = {};
                builtinEl.querySelectorAll('[data-builtin]').forEach(cb => { builtin[cb.dataset.builtin] = cb.checked; });
                const custom = [];
                const errors = [];
                customEl.querySelectorAll('.terminal-hl-row').forEach((row, i) => {
                    const r = {
                        id: row.dataset.id,
                        name: row.querySelector('.hl-name').value.trim() || `规则 ${i + 1}`,
                        pattern: row.querySelector('.hl-pattern').value,
                        color: row.querySelector('.hl-color').value,
                        caseSensitive: row.querySelector('.hl-cs').checked,
                        enabled: row.querySelector('.hl-enabled').checked
                    };
                    const err = H ? H.validatePattern(r.pattern, r.caseSensitive) : null;
                    row.classList.toggle('invalid', !!err);
                    if (err) errors.push(`「${r.name}」${err}`);
                    custom.push(r);
                });
                return { config: { version: H ? H.CONFIG_VERSION : 2, enabled: $('tsHlEnabled').checked, builtin, custom }, errors };
            };

            const collect = () => {
                const hlResult = collectHighlight();
                if (hlResult.errors.length) {
                    body.querySelector('[data-tab="highlight"]').click();
                    Utils.notify.error(hlResult.errors.join('；'));
                    return KEEP_OPEN;
                }
                return {
                    settings: {
                        fontSize: $('tsFontSize').value,
                        scrollback: $('tsScrollback').value,
                        cursorStyle: $('tsCursor').value,
                        rightClickAction: $('tsRightClick').value,
                        maxSessions: $('tsMaxSessions').value,
                        cursorBlink: $('tsCursorBlink').checked,
                        copyOnSelect: $('tsCopyOnSelect').checked,
                        confirmMultilinePaste: $('tsConfirmPaste').checked,
                        confirmCloseTab: $('tsConfirmClose').checked,
                        showGutter: $('tsShowGutter').checked,
                        autocompleteEnabled: $('tsAcEnabled').checked,
                        autocompleteMinChars: $('tsAcMin').value
                    },
                    highlight: hlResult.config
                };
            };
            const { done } = openDialog({
                title: '终端设置',
                body,
                width: '680px',
                buttons: [
                    { text: '取消', cls: 'btn-secondary', value: null },
                    { text: '保存', cls: 'btn-primary', value: collect, primary: true }
                ]
            });
            done.then(async (values) => {
                if (!values) {
                    if (this.active) this.active.focus();
                    return;
                }
                const [res, hlRes] = await Promise.all([
                    ipcRenderer.invoke('terminal:save-settings', values.settings),
                    ipcRenderer.invoke('terminal:save-highlight', values.highlight)
                ]);
                if (!res || !res.success) {
                    Utils.notify.error(`保存终端设置失败：${(res && res.message) || '未知错误'}`);
                    return;
                }
                if (!hlRes || !hlRes.success) {
                    Utils.notify.error(`保存高亮规则失败：${(hlRes && hlRes.message) || '未知错误'}`);
                } else {
                    this._setHighlightConfig(hlRes.config);
                }
                this.settings = res.settings;
                this.views.forEach(v => {
                    if (!v.term) return;
                    v.applySettings(this.settings);
                    if (v.ac && !this.settings.autocompleteEnabled) v.ac.hide();
                });
                Utils.notify.success('终端设置已保存');
                this.render();
                if (this.active) this.active.focus();
            });
        }
    }

    window.TerminalPage = new TerminalPageController();
    // 供快捷命令栏等终端子模块复用
    window.TerminalPage.openDialog = openDialog;
    window.TerminalPage.KEEP_OPEN = KEEP_OPEN;
})();
