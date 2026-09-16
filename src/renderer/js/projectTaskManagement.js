/**
 * 工程任务管理模块
 * 负责工程任务列表展示、新建/编辑工程、步骤配置
 */
const ProjectTaskManagement = (() => {
    let svc = null;
    let allHosts = [];
    let allScripts = [];
    let currentTaskId = null;   // 正在编辑的工程 ID（null 表示新建）
    let currentSteps = [];      // 编辑中的步骤列表
    let editingStepIdx = null;  // 正在编辑的步骤下标
    let stepSelectedHosts = []; // 当前步骤弹窗中已选中的主机 ID 列表

    // 内部工具函数
    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try { return new Date(dateStr).toLocaleString(); } catch (_) { return dateStr; }
    }

    function showSuccess(msg) {
        if (window.Utils && window.Utils.notify) window.Utils.notify.success(msg);
        else alert(msg);
    }

    function showError(msg) {
        if (window.Utils && window.Utils.notify) window.Utils.notify.error(msg);
        else alert('错误: ' + msg);
    }

    // ========== 初始化 ==========
    async function init() {
        if (!svc) svc = new ProjectTaskService();
        injectEditStyles(); // 尽早注入样式，确保执行弹窗展示正常
        await loadSupportData();
        await renderList();
        bindListEvents();
    }

    async function loadSupportData() {
        try {
            const ipcRenderer = require('electron').ipcRenderer;
            allHosts = await ipcRenderer.invoke('host-find-all') || [];
            allScripts = await ipcRenderer.invoke('script:findAll') || [];
        } catch (e) {
            console.error('加载支持数据失败:', e);
        }
    }

    // ========== 列表视图 ==========
    let allTasks = []; // 全量任务缓存，用于客户端搜索过滤

    async function renderList() {
        const container = document.getElementById('projectTaskManagementContent');
        if (!container) return;

        try {
            // 后端已过滤模板数据，直接获取
            allTasks = await svc.getAllProjectTasks() || [];
        } catch (e) {
            console.error('加载工程任务失败:', e);
            allTasks = [];
        }

        renderTaskTable(allTasks);
        bindTableEvents();
    }

    function getFilteredTasks() {
        const keyword = (document.getElementById('projectTaskSearchInput')?.value || '').trim().toLowerCase();
        const statusFilter = document.getElementById('projectTaskStatusFilter')?.value || '';
        return allTasks.filter(t => {
            const matchKw = !keyword ||
                (t.name || '').toLowerCase().includes(keyword) ||
                (t.description || '').toLowerCase().includes(keyword);
            const matchStatus = !statusFilter || (t.last_status || 'idle') === statusFilter;
            return matchKw && matchStatus;
        });
    }

    function renderTaskTable(tasks) {
        const container = document.getElementById('projectTaskManagementContent');
        if (!container) return;

        if (tasks.length === 0) {
            container.innerHTML = `
                <div class="table-container">
                    <div style="padding:80px 20px;text-align:center;color:var(--text-muted);">
                        <div style="margin-bottom:16px;color:var(--text-faint);">${Utils.icon('construction', 32)}</div>
                        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">暂无工程任务</div>
                        <div style="font-size:13px;margin-bottom:16px;">点击「新建工程」创建第一个工程任务</div>
                        <button class="btn btn-primary" onclick="ProjectTaskManagement.showCreateForm()">新建工程</button>
                    </div>
                </div>`;
            return;
        }

        const statusMap = {
            idle:      { label: '就绪',   cls: 'status-idle' },
            running:   { label: '执行中', cls: 'status-running' },
            completed: { label: '已完成', cls: 'status-success' },
            failed:    { label: '失败',   cls: 'status-failed' }
        };

        container.innerHTML = `
            <div class="table-container" id="ptTableContainer">
                <table class="table" id="projectTasksTable">
                    <thead>
                        <tr>
                            <th style="min-width:180px;">工程名称</th>
                            <th>描述</th>
                            <th style="width:70px;text-align:center;">步骤数</th>
                            <th style="width:90px;text-align:center;">状态</th>
                            <th style="width:80px;text-align:center;">通知</th>
                            <th style="width:165px;">创建时间</th>
                            <th style="width:260px;text-align:center;">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tasks.map(task => {
                            const s = statusMap[task.last_status] || statusMap.idle;
                            return `
                            <tr data-task-id="${task.id}">
                                <td style="font-weight:600;color:var(--text-heading);">${escapeHtml(task.name)}</td>
                                <td style="color:var(--text-muted);font-size:13px;">${escapeHtml(task.description || '-')}</td>
                                <td style="text-align:center;">${task._stepsCount || 0}</td>
                                <td style="text-align:center;"><span class="task-badge ${s.cls}">${s.label}</span></td>
                                <td style="text-align:center;">${task.notify_webhook ? '<span title="已配置企业微信通知">' + Utils.icon('bell', 13) + '</span>' : '<span style="color:var(--text-faint);">-</span>'}</td>
                                <td style="font-size:13px;color:var(--text-muted);">${formatDate(task.created_at)}</td>
                                <td style="text-align:center;">
                                    <button class="btn btn-primary btn-sm" data-action="execute" data-id="${task.id}">执行</button>
                                    <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${task.id}">编辑</button>
                                    <button class="btn btn-secondary btn-sm" data-action="history" data-id="${task.id}">历史</button>
                                    <button class="btn btn-info btn-sm" data-action="copy" data-id="${task.id}" title="复制工程">复制</button>
                                    <button class="btn btn-danger btn-sm" data-action="delete" data-id="${task.id}">删除</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    function bindListEvents() {
        const createBtn = document.getElementById('createProjectTaskBtn');
        if (createBtn) createBtn.onclick = () => showCreateForm();

        const refreshBtn = document.getElementById('refreshProjectTasksBtn');
        if (refreshBtn) refreshBtn.onclick = () => renderList();

        // 搜索和状态筛选（实时过滤）
        const searchInput = document.getElementById('projectTaskSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => renderTaskTable(getFilteredTasks()));
        }
        const clearBtn = document.getElementById('clearProjectTaskSearchBtn');
        if (clearBtn) {
            clearBtn.onclick = () => {
                const inp = document.getElementById('projectTaskSearchInput');
                if (inp) { inp.value = ''; }
                renderTaskTable(getFilteredTasks());
            };
        }
        const statusFilter = document.getElementById('projectTaskStatusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => renderTaskTable(getFilteredTasks()));
        }
    }

    function bindTableEvents() {
        const container = document.getElementById('projectTaskManagementContent');
        if (!container) return;
        // 使用 onclick 避免 addEventListener 重复累加
        container.onclick = async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id);
            switch (action) {
                case 'execute': showExecuteModal(id); break;
                case 'edit': showEditForm(id); break;
                case 'history': ProjectTaskExecution && ProjectTaskExecution.showHistory(id); break;
                case 'copy': await handleDuplicate(id); break;
                case 'delete': await handleDelete(id); break;
            }
        };
    }

    // ========== 工程编辑视图 ==========
    function showCreateForm() {
        currentTaskId = null;
        currentSteps = [];
        renderEditForm({
            name: '',
            description: '',
            notify_webhook: '',
            notify_on_success: 1,
            notify_on_failure: 1,
            notify_on_interrupt: 1
        });
    }

    async function showEditForm(taskId) {
        try {
            const task = await svc.getProjectTaskById(taskId);
            if (!task) return showError('工程任务不存在');
            currentTaskId = taskId;
            currentSteps = task.steps || [];
            renderEditForm(task);
        } catch (e) {
            showError('加载工程失败: ' + e.message);
        }
    }

    function renderEditForm(task) {
        const container = document.getElementById('projectTaskManagementContent');
        if (!container) return;

        container.innerHTML = `
            <div class="pt-edit-layout">
                <!-- 左侧编辑区域 -->
                <div class="pt-edit-left">
                    <div class="pt-edit-form">
                        <div class="pt-edit-header">
                            <button class="btn btn-secondary btn-sm" id="ptBackBtn">← 返回列表</button>
                            <h3>${currentTaskId ? '编辑工程' : '新建工程'}</h3>
                            <button class="btn btn-primary" id="ptSaveBtn">保存工程</button>
                        </div>

                        <!-- 基本信息 -->
                        <div class="form-section">
                            <h4>基本信息</h4>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>工程名称 <span class="required">*</span></label>
                                    <input type="text" class="form-control" id="ptName" value="${escapeHtml(task.name || '')}" placeholder="输入工程名称">
                                </div>
                                <div class="form-group">
                                    <label>工程描述</label>
                                    <input type="text" class="form-control" id="ptDesc" value="${escapeHtml(task.description || '')}" placeholder="选填">
                                </div>
                            </div>
                        </div>

                        <!-- 步骤列表 -->
                        <div class="form-section">
                            <div class="section-header">
                                <h4>执行步骤</h4>
                                <button class="btn btn-primary btn-sm" id="ptAddStepBtn">+ 添加步骤</button>
                            </div>
                            <div id="ptStepList" class="pt-step-list">
                                ${renderStepList()}
                            </div>
                        </div>

                        <!-- 通知配置 -->
                        <div class="form-section">
                            <h4>企业微信通知</h4>
                            <div class="form-group">
                                <label>Webhook URL</label>
                                <div style="display:flex;gap:8px;">
                                    <input type="text" class="form-control" id="ptWebhook" value="${escapeHtml(task.notify_webhook || '')}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...">
                                    <button class="btn btn-secondary btn-sm" id="ptTestWebhookBtn">测试</button>
                                </div>
                            </div>
                            <div class="form-row" style="gap:20px;margin-top:10px;">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="ptNotifySuccess" ${task.notify_on_success ? 'checked' : ''}> 执行成功时通知
                                </label>
                                <label class="checkbox-label">
                                    <input type="checkbox" id="ptNotifyFail" ${task.notify_on_failure ? 'checked' : ''}> 执行失败时通知
                                </label>
                                <label class="checkbox-label">
                                    <input type="checkbox" id="ptNotifyInterrupt" ${task.notify_on_interrupt ? 'checked' : ''}> 中断时通知
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 右侧流程图区域 -->
                <div class="pt-edit-right">
                    <div class="pt-flowchart-panel">
                        <div class="pt-flowchart-header">
                            <h4>流程图预览</h4>
                            <span class="pt-flowchart-tip">实时显示步骤依赖关系</span>
                        </div>
                        <div class="pt-flowchart-content">
                            <div id="ptFlowchart" class="mermaid">
                                ${generateMermaidDiagram()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        injectEditStyles();
        bindEditFormEvents();
        renderMermaidDiagram();
    }

    function renderStepList() {
        if (currentSteps.length === 0) {
            return `<div class="pt-no-steps">暂无步骤，点击「添加步骤」开始配置</div>`;
        }
        return currentSteps.map((step, idx) => renderStepItem(step, idx)).join('');
    }

    // ========== 流程图功能 ==========
    function generateMermaidDiagram() {
        if (currentSteps.length === 0) {
            return 'flowchart TD\n    empty[暂无步骤]:::empty';
        }

        // Mermaid 节点标签无法渲染 SVG，用文字标记 + classDef 颜色区分类型
        const typeIcons = { upload: '[上传]', command: '[命令]', script: '[脚本]' };

        let diagram = 'flowchart TD\n';

        // 定义节点
        currentSteps.forEach((step, idx) => {
            const stepId = `step${idx}`;
            const icon = typeIcons[step.step_type] || '[?]';
            const shortName = step.step_name.length > 12 
                ? step.step_name.substring(0, 12) + '...' 
                : step.step_name;
            const displayText = `${icon} ${shortName}`;

            diagram += `    ${stepId}["${displayText}"]:::${step.step_type}\n`;
        });

        // 定义连接关系
        currentSteps.forEach((step, idx) => {
            const stepId = `step${idx}`;
            const deps = step.depends_on || [];

            if (deps.length === 0) {
                // 起始步骤，连接到开始节点
                diagram += `    startNode((开始)) --> ${stepId}\n`;
            } else {
                // 有依赖的步骤
                deps.forEach(depId => {
                    const depIdx = currentSteps.findIndex(s => s._tempId === depId || s.id === depId);
                    if (depIdx >= 0) {
                        diagram += `    step${depIdx} --> ${stepId}\n`;
                    }
                });
            }
        });

        // 所有步骤连接到结束
        const lastSteps = currentSteps
            .map((s, i) => ({ idx: i, step: s }))
            .filter(({ step }) => {
                // 找出没有被其他步骤依赖的步骤（即最后执行的步骤）
                const stepId = step._tempId || step.id;
                return !currentSteps.some(s => (s.depends_on || []).includes(stepId));
            });

        if (lastSteps.length > 0) {
            lastSteps.forEach(({ idx }) => {
                diagram += `    step${idx} --> endNode((结束))\n`;
            });
        }

        // 定义样式类
        diagram += `\n    classDef command fill:#fff7ed,stroke:#f59e0b,stroke-width:2px,color:#b45309\n`;
        diagram += `    classDef script fill:#f0fdf4,stroke:#16a34a,stroke-width:2px,color:#15803d\n`;
        diagram += `    classDef upload fill:#f0f9ff,stroke:#0284c7,stroke-width:2px,color:#0369a1\n`;
        diagram += `    classDef empty fill:#f4f4f5,stroke:#a1a1aa,stroke-width:1px,stroke-dasharray: 5 5,color:#71717a\n`;
        diagram += `    classDef startend fill:#ffffff,stroke:#71717a,stroke-width:2px,color:#3f3f46\n`;
        diagram += `    class startNode,endNode startend\n`;

        return diagram;
    }

    async function renderMermaidDiagram() {
        const container = document.getElementById('ptFlowchart');
        if (!container) return;

        // 初始化 Mermaid
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                flowchart: {
                    useMaxWidth: true,
                    htmlLabels: true,
                    curve: 'basis'
                }
            });

            try {
                const diagram = generateMermaidDiagram();
                const { svg } = await mermaid.render('mermaid-svg', diagram);
                container.innerHTML = svg;

                // 添加节点点击事件
                addFlowchartInteractions();
            } catch (e) {
                console.error('流程图渲染失败:', e);
                container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;">流程图渲染失败</div>';
            }
        }
    }

    function addFlowchartInteractions() {
        // 为流程图节点添加点击事件，点击后高亮左侧对应的步骤
        const nodes = document.querySelectorAll('#ptFlowchart .node');
        nodes.forEach(node => {
            node.style.cursor = 'pointer';
            node.addEventListener('click', () => {
                const nodeId = node.id;
                if (nodeId && nodeId.startsWith('flowchart-step')) {
                    const stepIdx = parseInt(nodeId.replace('flowchart-step', ''));
                    if (!isNaN(stepIdx) && stepIdx < currentSteps.length) {
                        highlightStepItem(stepIdx);
                    }
                }
            });

            // 添加悬停效果
            node.addEventListener('mouseenter', () => {
                node.style.filter = 'brightness(1.1)';
            });
            node.addEventListener('mouseleave', () => {
                node.style.filter = 'none';
            });
        });
    }

    function highlightStepItem(idx) {
        // 移除之前的高亮
        document.querySelectorAll('.pt-step-item').forEach(item => {
            item.classList.remove('step-highlight');
        });

        // 高亮当前步骤
        const stepItem = document.querySelector(`.pt-step-item[data-step-idx="${idx}"]`);
        if (stepItem) {
            stepItem.classList.add('step-highlight');
            stepItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 3秒后移除高亮
            setTimeout(() => {
                stepItem.classList.remove('step-highlight');
            }, 3000);
        }
    }

    function refreshFlowchart() {
        // 步骤变更时刷新流程图
        renderMermaidDiagram();
    }

    function renderStepItem(step, idx) {
        const typeIcons = { upload: Utils.icon('upload', 14), command: Utils.icon('zap', 14), script: Utils.icon('file-text', 14) };
        const typeLabels = { upload: '文件上传', command: '命令执行', script: '脚本执行' };
        const icon = typeIcons[step.step_type] || Utils.icon('help-circle', 14);
        const label = typeLabels[step.step_type] || step.step_type;
        const depsText = step.depends_on && step.depends_on.length > 0
            ? `依赖: 步骤${step.depends_on.map(d => {
                const depIdx = currentSteps.findIndex(s => s._tempId === d || s.id === d);
                return depIdx >= 0 ? depIdx + 1 : '?';
            }).join(',')}`
            : '无依赖（起始步骤）';

        return `
            <div class="pt-step-item" data-step-idx="${idx}">
                <div class="step-drag-handle">${Utils.icon('grip-vertical', 14)}</div>
                <div class="step-number">${idx + 1}</div>
                <div class="step-icon">${icon}</div>
                <div class="step-info">
                    <div class="step-name">${escapeHtml(step.step_name)}</div>
                    <div class="step-meta">${label} · ${depsText}</div>
                </div>
                <div class="step-item-actions">
                    <button class="btn btn-secondary btn-sm" data-step-action="edit" data-idx="${idx}">编辑</button>
                    <button class="btn btn-danger btn-sm" data-step-action="delete" data-idx="${idx}">删除</button>
                </div>
            </div>`;
    }

    function bindEditFormEvents() {
        document.getElementById('ptBackBtn').onclick = () => renderList();
        document.getElementById('ptSaveBtn').onclick = () => handleSave();
        document.getElementById('ptAddStepBtn').onclick = () => showStepModal(null);
        document.getElementById('ptTestWebhookBtn').onclick = () => handleTestWebhook();

        document.getElementById('ptStepList').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-step-action]');
            if (!btn) return;
            const action = btn.dataset.stepAction;
            const idx = parseInt(btn.dataset.idx);
            if (action === 'edit') showStepModal(idx);
            if (action === 'delete') handleDeleteStep(idx);
        });
    }

    async function handleSave() {
        const name = document.getElementById('ptName').value.trim();
        if (!name) return showError('请输入工程名称');

        // 防重复点击：禁用保存按钮
        const saveBtn = document.getElementById('ptSaveBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中...'; }

        const data = {
            id: currentTaskId,  // 传递ID用于区分新建/更新
            name,
            description: document.getElementById('ptDesc').value.trim(),
            notify_webhook: document.getElementById('ptWebhook').value.trim(),
            notify_on_success: document.getElementById('ptNotifySuccess').checked ? 1 : 0,
            notify_on_failure: document.getElementById('ptNotifyFail').checked ? 1 : 0,
            notify_on_interrupt: document.getElementById('ptNotifyInterrupt').checked ? 1 : 0,
            steps: currentSteps
        };

        try {
            // 使用原子化批量保存（性能优化）
            await svc.saveAll(data);
            showSuccess(currentTaskId ? '工程更新成功' : '工程创建成功');
            await renderList();
        } catch (e) {
            showError('保存失败: ' + e.message);
            // 保存失败时恢复按钮
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存工程'; }
        }
    }

    async function handleDelete(taskId) {
        if (!confirm('确认删除该工程任务？此操作不可恢复。')) return;
        try {
            await svc.deleteProjectTask(taskId);
            showSuccess('删除成功');
            await renderList();
        } catch (e) {
            showError('删除失败: ' + e.message);
        }
    }

    async function handleDuplicate(taskId) {
        try {
            const newTask = await svc.duplicate(taskId);
            showSuccess(`工程已复制为「${newTask.name}」`);
            await renderList();
        } catch (e) {
            showError('复制失败: ' + e.message);
        }
    }

    async function handleTestWebhook() {
        const url = document.getElementById('ptWebhook').value.trim();
        if (!url) return showError('请先输入 Webhook URL');
        try {
            const result = await svc.testWebhook(url);
            if (result.success) showSuccess('Webhook 测试成功');
            else showError('Webhook 测试失败: ' + (result.error || '未知错误'));
        } catch (e) {
            showError('测试失败: ' + e.message);
        }
    }

    // ========== 步骤配置弹窗 ==========
    function showStepModal(editIdx) {
        editingStepIdx = editIdx;
        const step = editIdx !== null ? { ...currentSteps[editIdx] } : {
            step_name: '', step_type: 'command', host_ids: [], config: {}, depends_on: [], timeout: 300
        };

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'stepModal';
        modal.innerHTML = `
            <div class="modal-dialog" style="max-width:640px;">
                <div class="modal-header">
                    <h3>${editIdx !== null ? '编辑步骤' : '添加步骤'}</h3>
                    <button class="modal-close" id="stepModalClose">${Utils.icon('x', 14)}</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>步骤名称 <span class="required">*</span></label>
                        <input type="text" class="form-control" id="stepName" value="${escapeHtml(step.step_name || '')}" placeholder="步骤名称">
                    </div>
                    <div class="form-group">
                        <label>步骤类型 <span class="required">*</span></label>
                        <select class="form-control" id="stepType">
                            <option value="command" ${step.step_type === 'command' ? 'selected' : ''}>命令执行</option>
                            <option value="script" ${step.step_type === 'script' ? 'selected' : ''}>脚本执行</option>
                            <option value="upload" ${step.step_type === 'upload' ? 'selected' : ''}>文件上传</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>目标主机 <span class="required">*</span></label>
                        <div style="margin-top:0.3rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            <button class="btn btn-secondary btn-sm" id="stepSelectHostsBtn" type="button">从主机管理选择</button>
                            <button class="btn btn-secondary btn-sm" id="stepClearHostsBtn" type="button">清空选择</button>
                            <span id="stepSelectedHostsCount" style="font-weight:600;color:var(--primary);"></span>
                        </div>
                        <div id="stepSelectedHostsList" style="margin-top:0.5rem;padding:0.5rem;background:var(--surface-subtle);border-radius:6px;min-height:40px;max-height:120px;overflow-y:auto;border:1px solid var(--border-subtle);">
                            <span style="color:var(--text-muted);font-size:13px;">未选择主机</span>
                        </div>
                    </div>
                    <div id="stepTypeConfig">${renderStepTypeConfig(step)}</div>
                    <div class="form-group">
                        <label>依赖步骤（依赖完成后才执行此步骤）</label>
                        <div class="depends-checklist" id="stepDepsList">
                            ${currentSteps.filter((_, i) => i !== editIdx).map((s, i) => {
                                const origIdx = currentSteps.indexOf(s);
                                const depId = s._tempId || s.id;
                                const checked = (step.depends_on || []).includes(depId);
                                return `<label class="checkbox-label">
                                    <input type="checkbox" name="stepDep" value="${depId}" ${checked ? 'checked' : ''}>
                                    步骤${origIdx + 1}: ${escapeHtml(s.step_name)}
                                </label>`;
                            }).join('')}
                            ${currentSteps.length <= 1 ? '<span style="color:var(--text-muted);font-size:14px;">暂无可选依赖步骤</span>' : ''}
                        </div>
                    </div>
                    <div class="form-group">
                        <label>超时时间（秒）</label>
                        <input type="number" class="form-control" id="stepTimeout" value="${step.timeout || 300}" min="10" max="7200">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="stepModalCancel">取消</button>
                    <button class="btn btn-primary" id="stepModalConfirm">确定</button>
                </div>
            </div>`;

        document.getElementById('modalContainer').appendChild(modal);

        // 初始化步骤主机选择状态
        stepSelectedHosts = [...(step.host_ids || [])]; 
        refreshStepHostsDisplay();

        document.getElementById('stepModalClose').onclick = closeStepModal;
        document.getElementById('stepModalCancel').onclick = closeStepModal;
        document.getElementById('stepModalConfirm').onclick = confirmStep;
        document.getElementById('stepType').onchange = (e) => {
            document.getElementById('stepTypeConfig').innerHTML = renderStepTypeConfig({ step_type: e.target.value, config: {} });
            // 绑定文件上传类型的事件
            if (e.target.value === 'upload') {
                bindUploadFileEvents();
            }
        };
        document.getElementById('stepSelectHostsBtn').onclick = () => showStepHostSelector();
        document.getElementById('stepClearHostsBtn').onclick = () => {
            stepSelectedHosts = [];
            refreshStepHostsDisplay();
        };
        
        // 如果是文件上传类型，绑定文件选择事件
        if (step.step_type === 'upload') {
            bindUploadFileEvents();
        }
        
        modal.addEventListener('click', (e) => { if (e.target === modal) closeStepModal(); });
    }
    
    // 绑定文件上传类型的事件
    function bindUploadFileEvents() {
        const selectBtn = document.getElementById('cfgSelectFilesBtn');
        const clearBtn = document.getElementById('cfgClearFilesBtn');
        
        if (selectBtn) {
            selectBtn.onclick = async () => {
                try {
                    const { ipcRenderer } = require('electron');
                    const result = await ipcRenderer.invoke('show-open-dialog', {
                        properties: ['openFile', 'multiSelections'],
                        title: '选择要上传的文件'
                    });
                    
                    if (!result.canceled && result.filePaths.length > 0) {
                        const currentFiles = document.getElementById('cfgFiles').value 
                            ? document.getElementById('cfgFiles').value.split('|').filter(f => f) 
                            : [];
                        const newFiles = [...new Set([...currentFiles, ...result.filePaths])];
                        
                        // 更新隐藏字段
                        document.getElementById('cfgFiles').value = newFiles.join('|');
                        
                        // 更新显示列表
                        const filesListEl = document.getElementById('cfgFilesList');
                        filesListEl.innerHTML = newFiles.map(f => `<div style="font-size:13px;padding:3px 0;">${escapeHtml(f)}</div>`).join('');
                    }
                } catch (e) {
                    console.error('选择文件失败:', e);
                    showError('选择文件失败: ' + e.message);
                }
            };
        }
        
        if (clearBtn) {
            clearBtn.onclick = () => {
                document.getElementById('cfgFiles').value = '';
                document.getElementById('cfgFilesList').innerHTML = '<span style="color:var(--text-muted);font-size:13px;">未选择文件</span>';
            };
        }
    }

    function renderStepTypeConfig(step) {
        const cfg = step.config || {};
        switch (step.step_type) {
            case 'command':
                return `
                    <div class="form-group">
                        <label>执行命令 <span class="required">*</span></label>
                        <textarea class="form-control" id="cfgCommand" rows="3" placeholder="输入要执行的命令">${escapeHtml(cfg.command || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="cfgUseSudo" ${cfg.useSudo ? 'checked' : ''}> 使用 sudo 执行
                        </label>
                    </div>`;
            case 'script':
                return `
                    <div class="form-group">
                        <label>选择脚本</label>
                        <select class="form-control" id="cfgScriptId">
                            <option value="">-- 选择已有脚本 --</option>
                            ${allScripts.map(s => `<option value="${s.id}" ${cfg.scriptId == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>或直接输入脚本内容</label>
                        <textarea class="form-control" id="cfgScriptContent" rows="5" placeholder="直接输入脚本内容（优先使用上面选择的脚本）">${escapeHtml(cfg.scriptContent || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="cfgUseSudo" ${cfg.useSudo ? 'checked' : ''}> 使用 sudo 执行
                        </label>
                    </div>`;
            case 'upload':
                return `
                    <div class="form-group">
                        <label>本地文件 <span class="required">*</span></label>
                        <div style="display:flex;gap:8px;margin-bottom:8px;">
                            <button type="button" class="btn btn-secondary btn-sm" id="cfgSelectFilesBtn">选择文件</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="cfgClearFilesBtn">清空</button>
                        </div>
                        <div id="cfgFilesList" style="padding:10px;background:var(--surface-subtle);border-radius:6px;border:1px solid var(--border-subtle);min-height:60px;max-height:150px;overflow-y:auto;">
                            ${(cfg.files || []).length > 0 
                                ? (cfg.files || []).map(f => `<div style="font-size:13px;padding:3px 0;">${escapeHtml(f)}</div>`).join('') 
                                : '<span style="color:var(--text-muted);font-size:13px;">未选择文件</span>'}
                        </div>
                        <input type="hidden" id="cfgFiles" value="${escapeHtml((cfg.files || []).join('|'))}">
                    </div>
                    <div class="form-group">
                        <label>远程目标路径 <span class="required">*</span></label>
                        <input type="text" class="form-control" id="cfgTargetPath" value="${escapeHtml(cfg.targetPath || '')}" placeholder="/opt/deploy/">
                    </div>
                    <div class="form-row" style="gap:15px;">
                        <div class="form-group">
                            <label>冲突策略</label>
                            <select class="form-control" id="cfgConflict">
                                <option value="backup" ${cfg.conflictStrategy === 'backup' ? 'selected' : ''}>备份后覆盖</option>
                                <option value="overwrite" ${cfg.conflictStrategy === 'overwrite' ? 'selected' : ''}>直接覆盖</option>
                                <option value="skip" ${cfg.conflictStrategy === 'skip' ? 'selected' : ''}>跳过</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>目录不存在时</label>
                            <select class="form-control" id="cfgPathCreate">
                                <option value="error" ${cfg.pathCreateStrategy === 'error' ? 'selected' : ''}>报错</option>
                                <option value="create" ${cfg.pathCreateStrategy === 'create' ? 'selected' : ''}>自动创建</option>
                            </select>
                        </div>
                    </div>`;
            default:
                return '';
        }
    }

    function gatherStepConfig(stepType) {
        switch (stepType) {
            case 'command':
                return {
                    command: document.getElementById('cfgCommand')?.value.trim() || '',
                    useSudo: document.getElementById('cfgUseSudo')?.checked || false
                };
            case 'script':
                return {
                    scriptId: document.getElementById('cfgScriptId')?.value || '',
                    scriptContent: document.getElementById('cfgScriptContent')?.value.trim() || '',
                    useSudo: document.getElementById('cfgUseSudo')?.checked || false
                };
            case 'upload':
                const filesRaw = document.getElementById('cfgFiles')?.value.trim() || '';
                return {
                    files: filesRaw.split('|').map(f => f.trim()).filter(Boolean),
                    targetPath: document.getElementById('cfgTargetPath')?.value.trim() || '',
                    conflictStrategy: document.getElementById('cfgConflict')?.value || 'backup',
                    pathCreateStrategy: document.getElementById('cfgPathCreate')?.value || 'error'
                };
            default:
                return {};
        }
    }

    function confirmStep() {
        const name = document.getElementById('stepName').value.trim();
        if (!name) return showError('请输入步骤名称');

        const stepType = document.getElementById('stepType').value;
        const hostIds = [...stepSelectedHosts];
        if (hostIds.length === 0) return showError('请选择至少一台目标主机');

        const config = gatherStepConfig(stepType);
        if (stepType === 'command' && !config.command) return showError('请输入执行命令');
        if (stepType === 'upload' && (!config.files.length || !config.targetPath)) return showError('请填写文件路径和目标路径');

        const dependsOn = Array.from(document.querySelectorAll('input[name="stepDep"]:checked')).map(el => {
            const val = parseInt(el.value);
            return isNaN(val) ? el.value : val;
        });

        const step = {
            step_name: name,
            step_type: stepType,
            host_ids: hostIds,
            config,
            depends_on: dependsOn,
            timeout: parseInt(document.getElementById('stepTimeout').value) || 300,
            _tempId: editingStepIdx !== null ? (currentSteps[editingStepIdx]._tempId || Date.now()) : Date.now()
        };

        if (editingStepIdx !== null) {
            currentSteps[editingStepIdx] = step;
        } else {
            currentSteps.push(step);
        }

        // 重新渲染步骤列表
        const stepList = document.getElementById('ptStepList');
        if (stepList) stepList.innerHTML = renderStepList();

        // 刷新流程图
        refreshFlowchart();

        closeStepModal();
    }

    function handleDeleteStep(idx) {
        if (!confirm(`确认删除步骤 "${currentSteps[idx].step_name}"？`)) return;
        currentSteps.splice(idx, 1);
        const stepList = document.getElementById('ptStepList');
        if (stepList) stepList.innerHTML = renderStepList();
        // 刷新流程图
        refreshFlowchart();
    }

    function closeStepModal() {
        const modal = document.getElementById('stepModal');
        if (modal) modal.remove();
        editingStepIdx = null;
        stepSelectedHosts = [];
    }

    // ========== 步骤弹窗主机选择器 ==========
    function refreshStepHostsDisplay() {
        const countEl = document.getElementById('stepSelectedHostsCount');
        const listEl = document.getElementById('stepSelectedHostsList');
        if (!countEl || !listEl) return;

        if (stepSelectedHosts.length === 0) {
            countEl.textContent = '';
            listEl.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">未选择主机</span>';
            return;
        }
        countEl.textContent = `已选择 ${stepSelectedHosts.length} 台`;
        const selectedData = allHosts.filter(h => stepSelectedHosts.includes(h.id));
        listEl.innerHTML = selectedData.map(h =>
            `<span class="badge" style="margin:2px;padding:3px 8px;background:var(--surface-active);border-radius:12px;font-size:12px;">${escapeHtml(h.ip)}${h.hostname ? ' (' + escapeHtml(h.hostname) + ')' : ''}</span>`
        ).join('');
    }

    function showStepHostSelector() {
        const hosts = allHosts;
        if (!hosts || hosts.length === 0) {
            showError('暂无可用主机，请先在主机管理中添加主机');
            return;
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.style.zIndex = '10000';

        let currentFilters = { systemName: '', appName: '', datacenter: '', environment: '', owner: '' };
        const systemNames = [...new Set(hosts.map(h => h.systemName || h.system_name).filter(Boolean))];

        modalOverlay.innerHTML = `
            <div class="modal" style="max-width:1000px;background:var(--surface-float);border-radius:12px;box-shadow:var(--shadow-modal);width:100%;max-height:85vh;overflow-y:auto;">
                <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid var(--border-subtle);">
                    <h2 style="margin:0;font-size:16px;">选择目标主机 <span id="stepModalSelCount" style="color:var(--primary);font-size:0.9em;margin-left:10px;">(已选择 ${stepSelectedHosts.length} 台)</span></h2>
                    <button class="modal-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted);">&times;</button>
                </div>
                <div class="modal-body" style="padding:20px 24px;">
                    <div style="margin-bottom:1rem;">
                        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px;">
                            <select class="form-control" id="shFilterSystem" style="height:38px;">
                                <option value="">全部系统</option>
                                ${systemNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
                            </select>
                            <select class="form-control" id="shFilterApp" style="height:38px;"><option value="">全部应用</option></select>
                            <select class="form-control" id="shFilterDc" style="height:38px;"><option value="">全部机房</option></select>
                            <select class="form-control" id="shFilterEnv" style="height:38px;"><option value="">全部环境</option></select>
                            <select class="form-control" id="shFilterOwner" style="height:38px;"><option value="">全部负责人</option></select>
                        </div>
                        <div style="margin-bottom:10px;">
                            <input type="text" class="form-control" placeholder="搜索IP地址或主机名..." id="shSearch" style="width:100%;">
                        </div>
                        <div>
                            <textarea class="form-control" id="shIpBatch" placeholder="批量输入IP地址（用逗号分隔，例如：192.168.1.1, 192.168.1.2）" style="width:100%;min-height:55px;resize:vertical;font-size:0.875rem;"></textarea>
                            <div style="display:flex;gap:10px;margin-top:8px;align-items:center;">
                                <button class="btn btn-sm btn-primary" id="shSelectByIp">识别并选中</button>
                                <button class="btn btn-sm btn-secondary" id="shClearIp">清空</button>
                                <span id="shIpResult" style="font-size:0.875rem;color:var(--text-muted);"></span>
                            </div>
                        </div>
                    </div>
                    <div style="max-height:380px;overflow-y:auto;">
                        <table class="table">
                            <thead><tr>
                                <th><input type="checkbox" id="shSelectAll"></th>
                                <th>IP地址</th><th>主机名</th><th>系统名称</th><th>应用名称</th><th>机房</th><th>环境</th><th>负责人</th>
                            </tr></thead>
                            <tbody id="shTableBody">
                                ${hosts.map(host => `
                                    <tr data-system-name="${escapeHtml(host.systemName || host.system_name || '')}" 
                                        data-app-name="${escapeHtml(host.appName || host.app_name || '')}" 
                                        data-datacenter="${escapeHtml(host.datacenter || '')}" 
                                        data-environment="${escapeHtml(host.environment || '')}" 
                                        data-owner="${escapeHtml(host.owner || '')}">
                                        <td><input type="checkbox" class="sh-host-cb" value="${host.id}" ${stepSelectedHosts.includes(host.id) ? 'checked' : ''}></td>
                                        <td>${escapeHtml(host.ip)}</td>
                                        <td>${escapeHtml(host.hostname || '-')}</td>
                                        <td>${escapeHtml(host.systemName || host.system_name || '-')}</td>
                                        <td>${escapeHtml(host.appName || host.app_name || '-')}</td>
                                        <td>${escapeHtml(host.datacenter || '-')}</td>
                                        <td>${escapeHtml(host.environment || '-')}</td>
                                        <td>${escapeHtml(host.owner || '-')}</td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;padding:16px 24px;border-top:1px solid var(--border-subtle);">
                    <button class="btn btn-secondary" id="shCancel">取消</button>
                    <button class="btn btn-primary" id="shConfirm">确定</button>
                </div>
            </div>`;

        document.body.appendChild(modalOverlay);

        const getEl = (id) => modalOverlay.querySelector('#' + id);

        function updateSelCount() {
            const allCbs = modalOverlay.querySelectorAll('.sh-host-cb');
            const checkedCount = Array.from(allCbs).filter(cb => cb.checked).length;
            const selCountEl = getEl('stepModalSelCount');
            if (selCountEl) selCountEl.textContent = `(已选择 ${checkedCount} 台)`;
            const visibleCbs = modalOverlay.querySelectorAll('#shTableBody tr:not([style*="display: none"]) .sh-host-cb');
            const visibleChecked = Array.from(visibleCbs).filter(cb => cb.checked).length;
            const selectAll = getEl('shSelectAll');
            selectAll.checked = visibleCbs.length > 0 && visibleChecked === visibleCbs.length;
            selectAll.indeterminate = visibleChecked > 0 && visibleChecked < visibleCbs.length;
        }

        function updateFilterOptions() {
            const filtered = hosts.filter(h => {
                if (currentFilters.systemName && (h.systemName || h.system_name) !== currentFilters.systemName) return false;
                if (currentFilters.appName && (h.appName || h.app_name) !== currentFilters.appName) return false;
                if (currentFilters.datacenter && h.datacenter !== currentFilters.datacenter) return false;
                if (currentFilters.environment && h.environment !== currentFilters.environment) return false;
                return true;
            });
            function rebuildSelect(id, key, label) {
                const sel = getEl(id);
                const cur = currentFilters[key];
                const vals = [...new Set(filtered.map(h => h[key] || (key === 'appName' ? h.app_name : key === 'systemName' ? h.system_name : '')).filter(Boolean))];
                sel.innerHTML = `<option value="">${label}</option>` + vals.map(v => `<option value="${escapeHtml(v)}" ${v === cur ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
                if (cur && !vals.includes(cur)) { currentFilters[key] = ''; sel.value = ''; }
            }
            rebuildSelect('shFilterApp', 'appName', '全部应用');
            rebuildSelect('shFilterDc', 'datacenter', '全部机房');
            rebuildSelect('shFilterEnv', 'environment', '全部环境');
            // owner
            const ownerSel = getEl('shFilterOwner');
            const owners = [...new Set(filtered.map(h => h.owner).filter(Boolean))].sort();
            ownerSel.innerHTML = '<option value="">全部负责人</option>' + owners.map(o => `<option value="${escapeHtml(o)}" ${o === currentFilters.owner ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
            if (currentFilters.owner && !owners.includes(currentFilters.owner)) { currentFilters.owner = ''; ownerSel.value = ''; }
        }
        updateFilterOptions();

        function applyFilters() {
            const kw = getEl('shSearch').value.toLowerCase();
            modalOverlay.querySelectorAll('#shTableBody tr').forEach(row => {
                const match =
                    (!kw || row.textContent.toLowerCase().includes(kw)) &&
                    (!currentFilters.systemName || row.dataset.systemName === currentFilters.systemName) &&
                    (!currentFilters.appName || row.dataset.appName === currentFilters.appName) &&
                    (!currentFilters.datacenter || row.dataset.datacenter === currentFilters.datacenter) &&
                    (!currentFilters.environment || row.dataset.environment === currentFilters.environment) &&
                    (!currentFilters.owner || row.dataset.owner === currentFilters.owner);
                row.style.display = match ? '' : 'none';
            });
            updateSelCount();
        }

        getEl('shSearch').addEventListener('input', applyFilters);
        ['shFilterSystem', 'shFilterApp', 'shFilterDc', 'shFilterEnv', 'shFilterOwner'].forEach(id => {
            const keyMap = { shFilterSystem: 'systemName', shFilterApp: 'appName', shFilterDc: 'datacenter', shFilterEnv: 'environment', shFilterOwner: 'owner' };
            getEl(id).addEventListener('change', (e) => {
                currentFilters[keyMap[id]] = e.target.value;
                updateFilterOptions();
                applyFilters();
            });
        });

        getEl('shSelectAll').addEventListener('change', (e) => {
            const visibleCbs = modalOverlay.querySelectorAll('#shTableBody tr:not([style*="display: none"]) .sh-host-cb');
            visibleCbs.forEach(cb => cb.checked = e.target.checked);
            updateSelCount();
        });
        modalOverlay.querySelectorAll('.sh-host-cb').forEach(cb => cb.addEventListener('change', updateSelCount));

        // IP批量输入
        getEl('shSelectByIp').addEventListener('click', () => {
            const ipInput = getEl('shIpBatch').value.trim();
            const resultEl = getEl('shIpResult');
            if (!ipInput) { resultEl.textContent = '请输入IP地址'; resultEl.style.color = 'var(--status-critical-fg)'; return; }
            const inputIps = ipInput.split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean);
            const ipMap = new Map(hosts.map(h => [h.ip, h.id]));
            const matched = [], notFound = [], matchedIds = [];
            inputIps.forEach(ip => {
                if (ipMap.has(ip)) { matched.push(ip); matchedIds.push(ipMap.get(ip)); }
                else notFound.push(ip);
            });
            if (matchedIds.length > 0) {
                modalOverlay.querySelectorAll('.sh-host-cb').forEach(cb => {
                    if (matchedIds.includes(parseInt(cb.value))) cb.checked = true;
                });
                updateSelCount();
            }
            let msg = matched.length > 0 ? `已选中 ${matched.length} 台主机` : '';
            if (notFound.length > 0) { if (msg) msg += '；'; msg += `未找到 ${notFound.length} 个IP: ${notFound.join(', ')}`; resultEl.style.color = 'var(--status-critical-fg)'; }
            else resultEl.style.color = 'var(--status-healthy-fg)';
            resultEl.textContent = msg;
        });
        getEl('shClearIp').addEventListener('click', () => { getEl('shIpBatch').value = ''; getEl('shIpResult').textContent = ''; });
        getEl('shIpBatch').addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter') getEl('shSelectByIp').click(); });

        // 关闭
        modalOverlay.querySelector('.modal-close').addEventListener('click', () => modalOverlay.remove());
        getEl('shCancel').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.remove(); });

        // 确定
        getEl('shConfirm').addEventListener('click', () => {
            stepSelectedHosts = Array.from(modalOverlay.querySelectorAll('.sh-host-cb:checked')).map(cb => parseInt(cb.value));
            refreshStepHostsDisplay();
            modalOverlay.remove();
        });
    }

    // ========== 执行弹窗（含定时执行） ==========
    function showExecuteModal(taskId) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'executeModal';
        modal.innerHTML = `
            <div class="modal-dialog" style="max-width:480px;">
                <div class="modal-header">
                    <h3>执行工程</h3>
                    <button class="modal-close" id="execModalClose">${Utils.icon('x', 14)}</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>执行方式</label>
                        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
                            <label class="radio-label">
                                <input type="radio" name="execType" value="now" checked> 立即执行
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="execType" value="scheduled"> 定时执行
                            </label>
                        </div>
                    </div>
                    <div class="form-group" id="scheduleTimeGroup" style="display:none;">
                        <label>执行时间</label>
                        <input type="datetime-local" class="form-control" id="scheduleTime">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="execModalCancel">取消</button>
                    <button class="btn btn-primary" id="execModalConfirm">确认</button>
                </div>
            </div>`;

        document.getElementById('modalContainer').appendChild(modal);

        document.querySelectorAll('input[name="execType"]').forEach(r => {
            r.onchange = () => {
                const isScheduled = document.querySelector('input[name="execType"]:checked')?.value === 'scheduled';
                document.getElementById('scheduleTimeGroup').style.display = isScheduled ? 'block' : 'none';
            };
        });

        document.getElementById('execModalClose').onclick = () => modal.remove();
        document.getElementById('execModalCancel').onclick = () => modal.remove();
        document.getElementById('execModalConfirm').onclick = async () => {
            const execType = document.querySelector('input[name="execType"]:checked')?.value;
            if (execType === 'scheduled') {
                const timeVal = document.getElementById('scheduleTime')?.value;
                if (!timeVal) return showError('请选择执行时间');
                modal.remove();
                try {
                    await svc.scheduleExecution(taskId, new Date(timeVal).toISOString());
                    showSuccess('已创建定时执行计划');
                } catch (e) {
                    showError('创建定时计划失败: ' + e.message);
                }
            } else {
                modal.remove();
                // 后台执行：将执行启动后直接跳转历史页
                try {
                    // 先启动执行（不等待完成）
                    svc.execute(taskId).catch(err => console.error('工程执行异常:', err));
                    showSuccess('工程已开始执行，可在历史中查看进度');
                    // 稍延后跳转历史页（给后端一点初始化时间）
                    setTimeout(() => {
                        ProjectTaskExecution && ProjectTaskExecution.showHistory(taskId);
                    }, 800);
                } catch (e) {
                    showError('启动执行失败: ' + e.message);
                }
            }
        };
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }

    // ========== 样式注入 ==========
    function injectEditStyles() {
        if (document.getElementById('pt-edit-styles')) return;
        const style = document.createElement('style');
        style.id = 'pt-edit-styles';
        style.textContent = `
            /* 列表页表格样式 */
            #page-project-tasks .page-content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
            #ptTableContainer { flex: 1; min-height: 0; overflow-y: auto; margin: 0 30px 20px; margin-top: 10px; }
            #projectTasksTable { min-width: 900px; }
            #projectTasksTable tbody tr:hover { background: var(--surface-subtle); }
            .task-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
            .status-idle { background: var(--status-neutral-bg); color: var(--status-neutral-fg); }
            .status-running { background: var(--status-warning-bg); color: var(--status-warning-fg); }
            .status-success { background: var(--status-healthy-bg); color: var(--status-healthy-fg); }
            .status-failed { background: var(--status-critical-bg); color: var(--status-critical-fg); }

            /* 编辑页面布局 */
            .pt-edit-layout { display: flex; gap: 20px; height: calc(100vh - 180px); overflow: hidden; }
            .pt-edit-left { flex: 1; min-width: 0; overflow-y: auto; padding: 20px; }
            .pt-edit-right { width: 400px; flex-shrink: 0; padding: 20px 20px 20px 0; }

            /* 编辑表单样式 */
            .pt-edit-form { max-width: 100%; }
            #page-project-tasks .page-content { overflow-y: auto; }
            .pt-edit-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
            .pt-edit-header h3 { margin: 0; flex: 1; font-size: 18px; }
            .form-section { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 10px; box-shadow: var(--shadow-card); padding: 20px 24px; margin-bottom: 18px; }
            .form-section h4 { margin: 0 0 16px; font-size: 15px; color: var(--text-heading); border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px; }
            .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
            .section-header h4 { margin: 0; font-size: 15px; color: var(--text-heading); }
            .form-row { display: flex; gap: 16px; }
            .form-row .form-group { flex: 1; }
            .form-group { margin-bottom: 14px; }
            .form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-body); margin-bottom: 5px; }
            .form-group select.form-control { height: 40px; padding: 8px 28px 8px 12px; -webkit-appearance: menulist; appearance: menulist; }
            .required { color: var(--status-critical-fg); }
            .checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
            .radio-label { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }

            /* 步骤配置样式 */
            .pt-step-list { display: flex; flex-direction: column; gap: 10px; min-height: 50px; }
            .pt-no-steps { padding: 30px 20px; text-align: center; color: var(--text-muted); border: 2px dashed var(--border-default); border-radius: 8px; font-size: 14px; }
            .pt-step-item { display: flex; align-items: center; gap: 12px; background: var(--surface-subtle); border-radius: 8px; padding: 12px 16px; border: 1px solid var(--border-subtle); transition: all 0.3s ease; }
            .pt-step-item:hover { background: var(--surface-active); }
            .pt-step-item.step-highlight { background: var(--primary-glow); border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-glow); }
            .step-drag-handle { color: var(--text-faint); cursor: grab; font-size: 16px; }
            .step-number { width: 24px; height: 24px; border-radius: 50%; background: var(--primary); color: var(--on-primary); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
            .step-icon { font-size: 18px; flex-shrink: 0; }
            .step-info { flex: 1; min-width: 0; }
            .step-name { font-weight: 600; font-size: 14px; color: var(--text-heading); }
            .step-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
            .step-item-actions { display: flex; gap: 6px; flex-shrink: 0; }

            .host-checklist, .depends-checklist { display: flex; flex-wrap: wrap; gap: 10px; padding: 10px; background: var(--surface-subtle); border-radius: 6px; border: 1px solid var(--border-subtle); max-height: 120px; overflow-y: auto; }

            /* 流程图面板样式 */
            .pt-flowchart-panel { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 10px; box-shadow: var(--shadow-card); height: 100%; display: flex; flex-direction: column; }
            .pt-flowchart-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border-subtle); }
            .pt-flowchart-header h4 { margin: 0; font-size: 15px; color: var(--text-heading); }
            .pt-flowchart-tip { font-size: 12px; color: var(--text-muted); }
            .pt-flowchart-content { flex: 1; overflow: auto; padding: 20px; display: flex; align-items: center; justify-content: center; background: var(--canvas-base); border-radius: 0 0 10px 10px; }
            .pt-flowchart-content .mermaid { width: 100%; }
            .pt-flowchart-content svg { max-width: 100%; height: auto; }

            /* 弹窗样式 */
            .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--surface-overlay); display: flex; align-items: center; justify-content: center; z-index: 9999; }
            .modal-dialog { background: var(--surface-float); border: 1px solid var(--border-default); border-radius: 12px; box-shadow: var(--shadow-modal); width: 100%; max-height: 85vh; overflow-y: auto; }
            .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid var(--border-subtle); }
            .modal-header h3 { margin: 0; font-size: 16px; }
            .modal-close { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-muted); }
            .modal-body { padding: 20px 24px; }
            .modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--border-subtle); }
        `;
        document.head.appendChild(style);
    }

    // ========== 公开 API ==========
    return { init, showCreateForm, showEditForm, showExecuteModal };
})();

window.ProjectTaskManagement = ProjectTaskManagement;
