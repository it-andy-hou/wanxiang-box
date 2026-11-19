// 远程终端：快捷命令栏（多分组、自定义，点击只粘贴不回车）
// 设计说明见 docs/requirements/远程终端模块.md 第 12.4 节
// 数据存在主数据库（terminal_command_groups / terminal_quick_commands），由主进程校验

(function () {
    const { ipcRenderer } = window.require('electron');

    const VISIBLE_KEY = 'terminal.quickBarVisible';
    const GROUP_KEY = 'terminal.quickBarGroup';
    const NAME_MAX = 50;
    const CONTENT_MAX = 10000;

    const genId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const clone = (o) => JSON.parse(JSON.stringify(o));

    class TerminalQuickBar {
        constructor(page, el) {
            this.page = page;
            this.el = el;
            this.groups = [];
            this.commands = [];
            this.groupId = null;
            this.visible = true;
        }

        async init() {
            this.visible = Utils.storage.get(VISIBLE_KEY, true) !== false;
            this.groupId = Utils.storage.get(GROUP_KEY, null);
            this.el.innerHTML = `
                <select class="terminal-qb-group" title="切换分组"></select>
                <div class="terminal-qb-list"></div>
                <button type="button" class="terminal-qb-manage" title="管理快捷命令">管理</button>
            `;
            this.groupSel = this.el.querySelector('.terminal-qb-group');
            this.listEl = this.el.querySelector('.terminal-qb-list');
            this.groupSel.addEventListener('change', () => {
                this.groupId = this.groupSel.value;
                Utils.storage.set(GROUP_KEY, this.groupId);
                this._renderButtons();
                this._refocus();
            });
            this.el.querySelector('.terminal-qb-manage').addEventListener('click', () => this.openManager());
            // 按钮不抢终端焦点，点击后焦点仍在终端
            this.listEl.addEventListener('mousedown', (e) => {
                if (e.target.closest('.terminal-qb-btn')) e.preventDefault();
            });
            this.listEl.addEventListener('click', (e) => {
                const btn = e.target.closest('.terminal-qb-btn');
                if (btn) this.send(btn.dataset.id);
            });
            // 鼠标滚轮横向滚动按钮
            this.listEl.addEventListener('wheel', (e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    this.listEl.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
            }, { passive: false });

            await this.reload();
            this._applyVisible();
        }

        async reload() {
            try {
                const res = await ipcRenderer.invoke('terminal:qc-get');
                if (res && res.success) {
                    this.groups = res.groups || [];
                    this.commands = res.commands || [];
                } else if (res && res.message) {
                    Utils.notify.error(`读取快捷命令失败：${res.message}`);
                }
            } catch (e) {
                console.error('[终端] 读取快捷命令失败:', e);
            }
            this.render();
        }

        toggle() {
            this.visible = !this.visible;
            Utils.storage.set(VISIBLE_KEY, this.visible);
            this._applyVisible();
            this._refocus();
        }

        _applyVisible() {
            this.el.style.display = this.visible ? '' : 'none';
            const btn = document.getElementById('terminalQuickBarBtn');
            if (btn) btn.classList.toggle('active', this.visible);
            // 终端区域高度变化后由 ResizeObserver 自动重新适配
        }

        _refocus() {
            const v = this.page.activeReadyView();
            if (v) v.focus();
        }

        render() {
            if (!this.groups.some(g => g.id === this.groupId)) {
                this.groupId = this.groups.length ? this.groups[0].id : null;
            }
            this.groupSel.textContent = '';
            for (const g of this.groups) {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = g.name;
                this.groupSel.appendChild(opt);
            }
            this.groupSel.style.display = this.groups.length ? '' : 'none';
            if (this.groupId) this.groupSel.value = this.groupId;
            this._renderButtons();
        }

        _renderButtons() {
            this.listEl.textContent = '';
            const list = this.commands.filter(c => c.group_id === this.groupId);
            if (!list.length) {
                const empty = document.createElement('span');
                empty.className = 'terminal-qb-empty';
                empty.textContent = this.groups.length ? '该分组暂无命令，点击右侧"管理"添加' : '暂无快捷命令，点击右侧"管理"添加';
                this.listEl.appendChild(empty);
                return;
            }
            for (const c of list) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'terminal-qb-btn';
                btn.dataset.id = c.id;
                btn.textContent = c.name;
                btn.title = (c.description ? `${c.description}\n` : '') + c.content;
                this.listEl.appendChild(btn);
            }
            this.refreshState();
        }

        /** 当前标签未连接时按钮置灰 */
        refreshState() {
            if (!this.listEl) return;
            const ready = !!this.page.activeReadyView();
            this.listEl.querySelectorAll('.terminal-qb-btn').forEach(b => { b.disabled = !ready; });
        }

        /** 粘贴到当前标签，不回车；多行与高危内容走与手动粘贴相同的确认 */
        send(id) {
            const cmd = this.commands.find(c => c.id === id);
            const view = this.page.activeReadyView();
            if (!cmd) return;
            if (!view) {
                Utils.notify.warning('当前没有已连接的终端');
                return;
            }
            view.pasteText(cmd.content);
        }

        // ---------------- 管理对话框 ----------------

        openManager() {
            const draft = {
                groups: this.groups.map(g => ({ id: g.id, name: g.name })),
                commands: this.commands.map(c => ({ id: c.id, group_id: c.group_id, name: c.name, content: c.content, description: c.description || '' }))
            };
            let selGroup = this.groupId && draft.groups.some(g => g.id === this.groupId) ? this.groupId : (draft.groups[0] && draft.groups[0].id) || null;
            let selCmd = null;

            const body = document.createElement('div');
            body.className = 'terminal-qcm';
            body.innerHTML = `
                <div class="qcm-col qcm-groups">
                    <div class="qcm-head">
                        <span>分组</span>
                        <span class="qcm-tools">
                            <button type="button" data-act="g-add" title="新增分组">＋</button>
                            <button type="button" data-act="g-up" title="上移">↑</button>
                            <button type="button" data-act="g-down" title="下移">↓</button>
                            <button type="button" data-act="g-del" title="删除分组及其命令">×</button>
                        </span>
                    </div>
                    <div class="qcm-list" data-list="groups"></div>
                    <div class="qcm-field">
                        <label class="form-label">分组名称</label>
                        <input type="text" class="form-control" data-field="g-name" maxlength="${NAME_MAX}">
                    </div>
                </div>
                <div class="qcm-col qcm-commands">
                    <div class="qcm-head">
                        <span>命令</span>
                        <span class="qcm-tools">
                            <button type="button" data-act="c-add" title="新增命令">＋</button>
                            <button type="button" data-act="c-up" title="上移">↑</button>
                            <button type="button" data-act="c-down" title="下移">↓</button>
                            <button type="button" data-act="c-del" title="删除命令">×</button>
                        </span>
                    </div>
                    <div class="qcm-list" data-list="commands"></div>
                    <div class="qcm-editor">
                        <div class="qcm-row2">
                            <div class="qcm-field">
                                <label class="form-label">按钮名称</label>
                                <input type="text" class="form-control" data-field="c-name" maxlength="${NAME_MAX}">
                            </div>
                            <div class="qcm-field">
                                <label class="form-label">所属分组</label>
                                <select class="form-control" data-field="c-group"></select>
                            </div>
                        </div>
                        <div class="qcm-field">
                            <label class="form-label">命令内容（点击按钮时粘贴到终端，不自动回车）</label>
                            <textarea class="form-control" data-field="c-content" rows="4" spellcheck="false" maxlength="${CONTENT_MAX}"></textarea>
                        </div>
                        <div class="qcm-field">
                            <label class="form-label">说明（可选，鼠标悬停时显示）</label>
                            <input type="text" class="form-control" data-field="c-desc" maxlength="200">
                        </div>
                    </div>
                </div>
            `;
            const q = (sel) => body.querySelector(sel);
            const groupList = q('[data-list="groups"]');
            const cmdList = q('[data-list="commands"]');
            const gName = q('[data-field="g-name"]');
            const cName = q('[data-field="c-name"]');
            const cGroup = q('[data-field="c-group"]');
            const cContent = q('[data-field="c-content"]');
            const cDesc = q('[data-field="c-desc"]');
            const editor = q('.qcm-editor');

            const curGroup = () => draft.groups.find(g => g.id === selGroup) || null;
            const curCmd = () => draft.commands.find(c => c.id === selCmd) || null;
            const groupCmds = () => draft.commands.filter(c => c.group_id === selGroup);

            const renderGroups = () => {
                groupList.textContent = '';
                draft.groups.forEach(g => {
                    const item = document.createElement('div');
                    item.className = `qcm-item${g.id === selGroup ? ' selected' : ''}`;
                    item.dataset.id = g.id;
                    const name = document.createElement('span');
                    name.className = 'qcm-item-name';
                    name.textContent = g.name || '（未命名）';
                    const count = document.createElement('span');
                    count.className = 'qcm-item-sub';
                    count.textContent = String(draft.commands.filter(c => c.group_id === g.id).length);
                    item.append(name, count);
                    groupList.appendChild(item);
                });
                if (!draft.groups.length) groupList.innerHTML = '<div class="qcm-empty">暂无分组</div>';
                const g = curGroup();
                gName.disabled = !g;
                gName.value = g ? g.name : '';
                cGroup.textContent = '';
                draft.groups.forEach(x => {
                    const opt = document.createElement('option');
                    opt.value = x.id;
                    opt.textContent = x.name || '（未命名）';
                    cGroup.appendChild(opt);
                });
            };

            const renderCmds = () => {
                cmdList.textContent = '';
                const list = groupCmds();
                list.forEach(c => {
                    const item = document.createElement('div');
                    item.className = `qcm-item${c.id === selCmd ? ' selected' : ''}`;
                    item.dataset.id = c.id;
                    const name = document.createElement('span');
                    name.className = 'qcm-item-name';
                    name.textContent = c.name || '（未命名）';
                    const sub = document.createElement('span');
                    sub.className = 'qcm-item-sub mono';
                    sub.textContent = (c.content || '').split('\n')[0];
                    item.append(name, sub);
                    cmdList.appendChild(item);
                });
                if (!list.length) cmdList.innerHTML = `<div class="qcm-empty">${selGroup ? '该分组暂无命令' : '请先新增分组'}</div>`;
                const c = curCmd();
                editor.classList.toggle('disabled', !c);
                [cName, cGroup, cContent, cDesc].forEach(i => { i.disabled = !c; });
                cName.value = c ? c.name : '';
                cGroup.value = c ? c.group_id : '';
                cContent.value = c ? c.content : '';
                cDesc.value = c ? c.description : '';
            };

            const renderAll = () => {
                renderGroups();
                renderCmds();
            };

            const move = (arr, item, delta, sameScope) => {
                // sameScope：只在同组命令间移动
                const scope = sameScope ? arr.filter(sameScope) : arr;
                const i = scope.indexOf(item);
                const j = i + delta;
                if (i < 0 || j < 0 || j >= scope.length) return;
                const ai = arr.indexOf(scope[i]);
                const aj = arr.indexOf(scope[j]);
                [arr[ai], arr[aj]] = [arr[aj], arr[ai]];
            };

            groupList.addEventListener('click', (e) => {
                const item = e.target.closest('.qcm-item');
                if (!item) return;
                selGroup = item.dataset.id;
                const first = groupCmds()[0];
                selCmd = first ? first.id : null;
                renderAll();
            });
            cmdList.addEventListener('click', (e) => {
                const item = e.target.closest('.qcm-item');
                if (!item) return;
                selCmd = item.dataset.id;
                renderCmds();
            });

            body.addEventListener('click', (e) => {
                const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
                if (!act) return;
                const g = curGroup();
                const c = curCmd();
                switch (act) {
                    case 'g-add': {
                        const ng = { id: genId('g'), name: `新分组 ${draft.groups.length + 1}` };
                        draft.groups.push(ng);
                        selGroup = ng.id;
                        selCmd = null;
                        renderAll();
                        gName.focus();
                        gName.select();
                        break;
                    }
                    case 'g-up': if (g) { move(draft.groups, g, -1); renderGroups(); } break;
                    case 'g-down': if (g) { move(draft.groups, g, 1); renderGroups(); } break;
                    case 'g-del':
                        if (g) {
                            const idx = draft.groups.indexOf(g);
                            draft.groups.splice(idx, 1);
                            draft.commands = draft.commands.filter(x => x.group_id !== g.id);
                            const next = draft.groups[idx] || draft.groups[idx - 1];
                            selGroup = next ? next.id : null;
                            const first = groupCmds()[0];
                            selCmd = first ? first.id : null;
                            renderAll();
                        }
                        break;
                    case 'c-add': {
                        if (!g) {
                            Utils.notify.warning('请先新增分组');
                            break;
                        }
                        const nc = { id: genId('c'), group_id: g.id, name: '新命令', content: '', description: '' };
                        draft.commands.push(nc);
                        selCmd = nc.id;
                        renderAll();
                        cName.focus();
                        cName.select();
                        break;
                    }
                    case 'c-up': if (c) { move(draft.commands, c, -1, x => x.group_id === c.group_id); renderCmds(); } break;
                    case 'c-down': if (c) { move(draft.commands, c, 1, x => x.group_id === c.group_id); renderCmds(); } break;
                    case 'c-del':
                        if (c) {
                            const list = groupCmds();
                            const idx = list.indexOf(c);
                            draft.commands.splice(draft.commands.indexOf(c), 1);
                            const rest = groupCmds();
                            const next = rest[idx] || rest[idx - 1];
                            selCmd = next ? next.id : null;
                            renderAll();
                        }
                        break;
                    default:
                        break;
                }
            });

            // 编辑框实时写回草稿
            gName.addEventListener('input', () => {
                const g = curGroup();
                if (!g) return;
                g.name = gName.value;
                const item = groupList.querySelector(`.qcm-item[data-id="${CSS.escape(g.id)}"] .qcm-item-name`);
                if (item) item.textContent = g.name || '（未命名）';
                const opt = cGroup.querySelector(`option[value="${CSS.escape(g.id)}"]`);
                if (opt) opt.textContent = g.name || '（未命名）';
            });
            const syncCmdItem = () => {
                const c = curCmd();
                if (!c) return;
                const item = cmdList.querySelector(`.qcm-item[data-id="${CSS.escape(c.id)}"]`);
                if (!item) return;
                item.querySelector('.qcm-item-name').textContent = c.name || '（未命名）';
                item.querySelector('.qcm-item-sub').textContent = (c.content || '').split('\n')[0];
            };
            cName.addEventListener('input', () => { const c = curCmd(); if (c) { c.name = cName.value; syncCmdItem(); } });
            cContent.addEventListener('input', () => { const c = curCmd(); if (c) { c.content = cContent.value; syncCmdItem(); } });
            cDesc.addEventListener('input', () => { const c = curCmd(); if (c) c.description = cDesc.value; });
            cGroup.addEventListener('change', () => {
                const c = curCmd();
                if (!c) return;
                // 移到目标分组末尾，并跟随切换到该分组
                draft.commands.splice(draft.commands.indexOf(c), 1);
                c.group_id = cGroup.value;
                draft.commands.push(c);
                selGroup = c.group_id;
                renderAll();
            });

            const first = groupCmds()[0];
            selCmd = first ? first.id : null;
            renderAll();

            const validate = () => {
                for (const g of draft.groups) {
                    if (!g.name.trim()) return { msg: '分组名称不能为空', group: g.id };
                }
                for (const c of draft.commands) {
                    if (!c.name.trim()) return { msg: '按钮名称不能为空', group: c.group_id, cmd: c.id };
                    if (!c.content.trim()) return { msg: `「${c.name}」的命令内容不能为空`, group: c.group_id, cmd: c.id };
                }
                return null;
            };

            const doExport = async () => {
                const res = await ipcRenderer.invoke('terminal:qc-export', draft);
                if (res && res.success) Utils.notify.success('快捷命令已导出');
                else if (res && !res.canceled) Utils.notify.error(`导出失败：${res.message || '未知错误'}`);
            };
            const doImport = async () => {
                const err = validate();
                if (err) {
                    Utils.notify.error(`请先修正当前内容：${err.msg}`);
                    return;
                }
                const res = await ipcRenderer.invoke('terminal:qc-import', draft);
                if (!res || res.canceled) return;
                if (!res.success) {
                    Utils.notify.error(`导入失败：${res.message || '未知错误'}`);
                    return;
                }
                draft.groups = res.groups.map(g => ({ id: g.id, name: g.name }));
                draft.commands = res.commands.map(c => ({ id: c.id, group_id: c.group_id, name: c.name, content: c.content, description: c.description || '' }));
                if (!draft.groups.some(g => g.id === selGroup)) selGroup = draft.groups[0] ? draft.groups[0].id : null;
                const f = groupCmds()[0];
                selCmd = f ? f.id : null;
                renderAll();
                const s = res.stats || {};
                Utils.notify.success(`已合并：新增分组 ${s.groups || 0} 个，新增命令 ${s.added || 0} 条，覆盖 ${s.updated || 0} 条。点击"保存"后生效`);
            };

            const KEEP = window.TerminalPage.KEEP_OPEN;
            const { done } = window.TerminalPage.openDialog({
                title: '管理快捷命令',
                body,
                width: '820px',
                buttons: [
                    { text: '导入', cls: 'btn-secondary qcm-left', value: () => { doImport(); return KEEP; } },
                    { text: '导出', cls: 'btn-secondary', value: () => { doExport(); return KEEP; } },
                    { text: '取消', cls: 'btn-secondary', value: null },
                    {
                        text: '保存', cls: 'btn-primary', primary: true, value: () => {
                            const err = validate();
                            if (err) {
                                selGroup = err.group || selGroup;
                                selCmd = err.cmd || null;
                                renderAll();
                                Utils.notify.error(err.msg);
                                return KEEP;
                            }
                            return clone(draft);
                        }
                    }
                ]
            });
            done.then(async (data) => {
                if (!data) {
                    this._refocus();
                    return;
                }
                const res = await ipcRenderer.invoke('terminal:qc-save', data);
                if (!res || !res.success) {
                    Utils.notify.error(`保存快捷命令失败：${(res && res.message) || '未知错误'}`);
                    return;
                }
                this.groups = res.groups;
                this.commands = res.commands;
                if (selGroup && this.groups.some(g => g.id === selGroup)) {
                    this.groupId = selGroup;
                    Utils.storage.set(GROUP_KEY, this.groupId);
                }
                this.render();
                Utils.notify.success('快捷命令已保存');
                this._refocus();
            });
        }
    }

    window.TerminalQuickBar = TerminalQuickBar;
})();
