/**
 * 工程任务执行监控模块
 * 负责实时执行日志、步骤状态跟踪、历史记录查看
 */
const ProjectTaskExecution = (() => {
    let svc = null;
    let currentExecutionId = null;
    let currentTaskId = null;
    let logLines = [];
    let historyClickListener = null; // 事件监听器引用

    // 结果视图状态
    let ptResultViewMode = 'result'; // 'result' | 'log'
    let ptStepFilter = 'all';        // 'all' | 'completed' | 'failed'
    let ptStepSearch = '';

    function getSvc() {
        if (!svc) svc = new ProjectTaskService();
        return svc;
    }

    /**
     * 清理函数：在切换页面或组件销毁时调用
     */
    function cleanup() {
        // 移除事件监听器
        if (historyClickListener) {
            const container = document.getElementById('projectTaskManagementContent');
            if (container) {
                container.removeEventListener('click', historyClickListener);
            }
            historyClickListener = null;
        }
        // 清理其他状态
        currentExecutionId = null;
        currentTaskId = null;
        logLines = [];
    }

    // ========== 启动执行 ==========
    async function startExecution(projectTaskId) {
        currentTaskId = projectTaskId;
        logLines = [];

        // 切换到工程任务页面
        if (window.navigationManager) {
            window.navigationManager.navigateTo('project-tasks');
        }

        // 在管理页内容区显示执行面板
        showExecutionPanel(projectTaskId);

        try {
            const result = await getSvc().execute(projectTaskId);
            currentExecutionId = result.executionId;
            appendLog('info', `工程执行已启动，执行ID: ${currentExecutionId}`);
        } catch (e) {
            appendLog('error', `启动执行失败: ${e.message}`);
        }
    }

    // ========== 执行面板 ==========
    function showExecutionPanel(taskId) {
        const container = document.getElementById('projectTaskManagementContent');
        if (!container) return;

        // 重置视图状态
        ptResultViewMode = 'result';
        ptStepFilter = 'all';
        ptStepSearch = '';

        container.innerHTML = `
            <div class="pt-execution-panel">
                <div class="pt-exec-header">
                    <button class="btn btn-secondary btn-sm" id="ptExecBackBtn">← 返回列表</button>
                    <h3 id="ptExecTitle">执行中...</h3>
                    <div class="pt-exec-header-actions">
                        <span class="exec-status-badge running" id="ptExecStatusBadge">执行中</span>
                        <button class="btn btn-danger btn-sm" id="ptStopExecBtn">停止执行</button>
                    </div>
                </div>

                <!-- 步骤进度条 -->
                <div class="pt-steps-progress" id="ptStepsProgress">
                    <div class="progress-bar-wrap">
                        <div class="progress-bar" id="ptProgressBar" style="width:0%"></div>
                    </div>
                    <span id="ptProgressText">0 / 0 步骤</span>
                </div>

                <!-- 步骤状态列表 -->
                <div class="pt-steps-status" id="ptStepsStatus">
                    <div style="color:var(--text-muted);font-size:13px;">等待执行...</div>
                </div>

                <!-- 视图切换工具栏 -->
                <div class="result-view-toolbar" id="ptViewToolbar">
                    <div class="view-toggle">
                        <button class="view-toggle-btn active" id="ptViewResultBtn">${Utils.icon('bar-chart', 13)} 结果模式</button>
                        <button class="view-toggle-btn" id="ptViewLogBtn">${Utils.icon('file-text', 13)} 日志模式</button>
                    </div>
                    <div class="filter-group" id="ptFilterGroup">
                        <button class="filter-btn active" data-pt-filter="all">全部</button>
                        <button class="filter-btn filter-success" data-pt-filter="completed">${Utils.icon('check', 12, 2.5)} 成功</button>
                        <button class="filter-btn filter-failed" data-pt-filter="failed">${Utils.icon('x', 12, 2.5)} 失败</button>
                    </div>
                    <input type="text" class="search-input" id="ptStepSearch" placeholder="搜索步骤名称..." style="display:none;">
                </div>

                <!-- 结果模式容器 -->
                <div id="ptResultView">
                    <div class="pt-result-container" id="ptResultContainer">
                        <div class="result-empty-tip">等待步骤执行完成...</div>
                    </div>
                </div>

                <!-- 日志模式容器 -->
                <div id="ptLogView" style="display:none;">
                    <div class="pt-log-panel">
                        <div class="pt-log-header">
                            <span>执行日志</span>
                            <button class="btn btn-secondary btn-sm" id="ptClearLogBtn">清除</button>
                        </div>
                        <div class="pt-log-content" id="ptLogContent"></div>
                    </div>
                </div>
            </div>
        `;

        injectExecutionStyles();

        document.getElementById('ptExecBackBtn').onclick = () => {
            getSvc().offAllExecutionListeners();
            ProjectTaskManagement.init();
        };
        document.getElementById('ptStopExecBtn').onclick = () => handleStopExecution();
        document.getElementById('ptClearLogBtn').onclick = () => {
            logLines = [];
            document.getElementById('ptLogContent').innerHTML = '';
        };

        // 视图切换按鈕
        document.getElementById('ptViewResultBtn').onclick = () => switchPtView('result');
        document.getElementById('ptViewLogBtn').onclick = () => switchPtView('log');

        // 筛选按鈕
        document.getElementById('ptFilterGroup').querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('ptFilterGroup').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                ptStepFilter = btn.dataset.ptFilter;
                applyPtResultFilter();
            });
        });

        // 搜索框
        const searchInput = document.getElementById('ptStepSearch');
        if (searchInput) {
            let searchTimer = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    ptStepSearch = searchInput.value.trim().toLowerCase();
                    applyPtResultFilter();
                }, 300);
            });
        }

        // 注册执行事件监听
        getSvc().onExecutionProgress((data) => {
            if (data.executionId !== currentExecutionId && currentExecutionId !== null) return;
            appendLog(data.type || 'info', data.message);
        });

        getSvc().onStepComplete((data) => {
            if (data.executionId !== currentExecutionId && currentExecutionId !== null) return;
            updateStepStatus(data);
            updateProgress(data.completedCount, data.totalSteps);
            addStepResultCard(data);
        });

        getSvc().onExecutionComplete((data) => {
            if (data.executionId !== currentExecutionId && currentExecutionId !== null) return;
            handleExecutionComplete(data);
        });

        getSvc().onExecutionStopped((data) => {
            if (data.executionId !== currentExecutionId && currentExecutionId !== null) return;
            handleExecutionStopped(data);
        });
    }

    function appendLog(type, message) {
        const logContent = document.getElementById('ptLogContent');
        if (!logContent) return;

        const timeStr = new Date().toLocaleTimeString();
        const typeClsMap = {
            info: 'log-info', success: 'log-success', error: 'log-error',
            warn: 'log-warn', start: 'log-info'
        };
        const cls = typeClsMap[type] || 'log-info';

        const line = `<div class="log-line ${cls}"><span class="log-time">${timeStr}</span>${escapeHtml(message)}</div>`;
        logContent.insertAdjacentHTML('beforeend', line);
        logLines.push({ type, message, time: timeStr });

        // 自动滚动到底部
        logContent.scrollTop = logContent.scrollHeight;
    }

    function updateStepStatus(data) {
        const container = document.getElementById('ptStepsStatus');
        if (!container) return;

        let item = container.querySelector(`[data-step-id="${data.stepId}"]`);
        if (!item) {
            item = document.createElement('div');
            item.className = 'step-status-item';
            item.dataset.stepId = data.stepId;
            container.appendChild(item);
        }

        const iconMap = { completed: Utils.icon('check-circle', 14), failed: Utils.icon('x-circle', 14), running: Utils.icon('hourglass', 14), pending: Utils.icon('pause', 14), skipped: Utils.icon('skip-forward', 14) };
        const icon = iconMap[data.status] || Utils.icon('help-circle', 14);
        item.innerHTML = `
            <span class="step-status-icon">${icon}</span>
            <span class="step-status-name">${escapeHtml(data.stepName)}</span>
            <span class="step-status-text step-${data.status}">${data.status === 'failed' ? `失败: ${escapeHtml(data.error || '')}` : data.status}</span>
        `;
    }

    function updateProgress(completed, total) {
        const bar = document.getElementById('ptProgressBar');
        const text = document.getElementById('ptProgressText');
        if (bar && total > 0) bar.style.width = `${Math.round((completed / total) * 100)}%`;
        if (text) text.textContent = `${completed} / ${total} 步骤`;
    }

    // ========== 视图切换 ==========
    function switchPtView(mode) {
        ptResultViewMode = mode;
        const logView = document.getElementById('ptLogView');
        const resultView = document.getElementById('ptResultView');
        const logBtn = document.getElementById('ptViewLogBtn');
        const resultBtn = document.getElementById('ptViewResultBtn');
        const filterGroup = document.getElementById('ptFilterGroup');
        const searchInput = document.getElementById('ptStepSearch');

        if (mode === 'log') {
            if (logView) logView.style.display = '';
            if (resultView) resultView.style.display = 'none';
            if (logBtn) logBtn.classList.add('active');
            if (resultBtn) resultBtn.classList.remove('active');
            if (filterGroup) filterGroup.style.display = 'none';
            if (searchInput) searchInput.style.display = 'none';
        } else {
            if (logView) logView.style.display = 'none';
            if (resultView) resultView.style.display = '';
            if (logBtn) logBtn.classList.remove('active');
            if (resultBtn) resultBtn.classList.add('active');
            if (filterGroup) filterGroup.style.display = '';
            // 搜索框暂不开放（待功能尚需时可展开）
        }
    }

    // ========== 结果卡片逻辑 ==========

    function addStepResultCard(data) {
        const container = document.getElementById('ptResultContainer');
        if (!container) return;

        // 清除空提示
        const emptyTip = container.querySelector('.result-empty-tip');
        if (emptyTip) emptyTip.remove();

        // 检查是否已有该步骤卡片
        const existing = container.querySelector(`[data-step-id="${data.stepId}"]`);
        if (existing) {
            if (data.status === 'running') return;
            updateStepCard(existing, data);
            applyPtFilterToCard(existing);
            return;
        }

        const card = createStepCardElement(data);
        container.appendChild(card);
        applyPtFilterToCard(card);
    }

    function createStepCardElement(data) {
        const card = document.createElement('div');
        const statusCls = data.status === 'completed' ? 'success' : data.status === 'failed' ? 'failed' : 'running';
        card.className = `pt-step-card pt-step-card-${statusCls}`;
        card.dataset.stepId = data.stepId;
        card.dataset.status = statusCls;
        card.dataset.stepName = (data.stepName || '').toLowerCase();

        card.innerHTML = buildStepCardHTML(data);

        // 头部点击展开/折叠
        card.querySelector('.pt-step-card-header').addEventListener('click', (e) => {
            if (e.target.closest('.pt-copy-btn')) return;
            card.classList.toggle('expanded');
        });

        return card;
    }

    function buildStepCardHTML(data) {
        const hostResults = data.hostResults || data.host_results || [];
        const successCount = hostResults.filter(r => r.status === 'success').length;
        const failedCount = hostResults.filter(r => r.status === 'failed' || r.status === 'error').length;
        const totalCount = hostResults.length;
        const statusCls = data.status === 'completed' ? 'success' : data.status === 'failed' ? 'failed' : 'running';
        const statusIcon = data.status === 'completed' ? Utils.icon('check', 13, 2.5) : data.status === 'failed' ? Utils.icon('x', 13, 2.5) : '<span style="font-size:10px;">●</span>';
        const typeLabels = { command: '命令', script: '脚本', upload: '上传' };
        const typeColors = { command: 'var(--primary)', script: 'var(--status-healthy-fg)', upload: 'var(--chart-5)' };
        const stepType = data.stepType || '';
        const typeLabel = typeLabels[stepType] || stepType;
        const typeColor = typeColors[stepType] || 'var(--text-muted)';
        const summaryText = totalCount > 0
            ? `${successCount}台成功${failedCount > 0 ? ', ' + failedCount + '台失败' : ''}`
            : '无主机执行记录';

        const hostsHTML = hostResults.map(r => buildHostRowHTML(r, stepType)).join('');

        return `
            <div class="pt-step-card-header">
                <span class="pt-step-status-icon status-${statusCls}">${statusIcon}</span>
                <span class="pt-step-type-tag" style="background:${typeColor}20;color:${typeColor};border-color:${typeColor}40;">${typeLabel}</span>
                <span class="pt-step-name">${escapeHtml(data.stepName || '')}</span>
                <span class="pt-step-summary">${escapeHtml(summaryText)}</span>
                ${totalCount > 0 ? `<span class="pt-step-rate ${failedCount > 0 ? 'rate-failed' : 'rate-success'}">${successCount}/${totalCount}</span>` : ''}
                <span class="expand-icon">${Utils.icon('play', 9)}</span>
            </div>
            <div class="pt-step-card-body">
                ${data.error ? `<div class="pt-step-error">错误: ${escapeHtml(data.error)}</div>` : ''}
                ${hostsHTML ? `<div class="pt-host-list">${hostsHTML}</div>` : '<div style="font-size:12px;color:var(--text-faint);padding:6px 0;">无主机执行记录</div>'}
            </div>
        `;
    }

    function buildHostRowHTML(r, stepType) {
        const isSuccess = r.status === 'success';
        const icon = isSuccess ? Utils.icon('check-circle', 13) : Utils.icon('x-circle', 13);
        const duration = r.duration ? `${r.duration}ms` : '';
        const isUpload = stepType === 'upload';

        let outputHTML = '';
        if (!isUpload) {
            if (r.stdout && r.stdout.trim()) {
                outputHTML += `<div class="pt-host-output">
                    <span class="pt-output-label">输出</span>
                    <pre class="pt-output-pre output-stdout">${escapeHtml(r.stdout.trim())}</pre>
                </div>`;
            }
            if (r.stderr && r.stderr.trim() && !isSuccess) {
                outputHTML += `<div class="pt-host-output">
                    <span class="pt-output-label">错误输出</span>
                    <pre class="pt-output-pre output-error">${escapeHtml(r.stderr.trim())}</pre>
                </div>`;
            }
        } else {
            if (r.stdout && r.stdout.trim()) {
                outputHTML += `<div class="pt-host-output"><span class="pt-output-label">上传结果</span><pre class="pt-output-pre output-stdout">${escapeHtml(r.stdout.trim())}</pre></div>`;
            }
        }

        return `
            <div class="pt-host-row">
                <div class="pt-host-row-main">
                    <span class="pt-host-ip">${escapeHtml(r.hostIp || '')}</span>
                    <span class="pt-host-status-icon">${icon}</span>
                    ${duration ? `<span class="pt-host-duration">${duration}</span>` : ''}
                    ${r.errorMessage ? `<span class="pt-host-error-msg">${escapeHtml(r.errorMessage)}</span>` : ''}
                </div>
                ${outputHTML}
            </div>`;
    }

    function updateStepCard(card, data) {
        const statusCls = data.status === 'completed' ? 'success' : data.status === 'failed' ? 'failed' : 'running';
        card.className = `pt-step-card pt-step-card-${statusCls}`;
        card.dataset.status = statusCls;
        card.innerHTML = buildStepCardHTML(data);
        card.querySelector('.pt-step-card-header').addEventListener('click', (e) => {
            if (e.target.closest('.pt-copy-btn')) return;
            card.classList.toggle('expanded');
        });
    }

    function applyPtResultFilter() {
        const container = document.getElementById('ptResultContainer');
        if (!container) return;
        container.querySelectorAll('.pt-step-card').forEach(card => {
            applyPtFilterToCard(card);
        });
    }

    function applyPtFilterToCard(card) {
        let visible = true;
        if (ptStepFilter !== 'all' && card.dataset.status !== ptStepFilter) visible = false;
        if (visible && ptStepSearch) {
            const name = card.dataset.stepName || '';
            if (!name.includes(ptStepSearch)) visible = false;
        }
        card.style.display = visible ? '' : 'none';
    }

    function handleExecutionComplete(data) {
        const badge = document.getElementById('ptExecStatusBadge');
        const stopBtn = document.getElementById('ptStopExecBtn');
        if (stopBtn) stopBtn.disabled = true;

        if (data.status === 'completed') {
            if (badge) { badge.textContent = '执行成功'; badge.className = 'exec-status-badge success'; }
            appendLog('success', `${Utils.icon('check-circle', 13)} 工程执行成功！共完成 ${data.completedSteps}/${data.totalSteps} 个步骤`);
        } else {
            if (badge) { badge.textContent = '执行失败'; badge.className = 'exec-status-badge failed'; }
            appendLog('error', `${Utils.icon('x-circle', 13)} 工程执行失败！已完成 ${data.completedSteps} 步骤，失败 ${data.failedSteps} 步骤。${data.errorMessage ? '原因: ' + data.errorMessage : ''}`);
        }

        getSvc().offAllExecutionListeners();
    }

    function handleExecutionStopped(data) {
        const badge = document.getElementById('ptExecStatusBadge');
        if (badge) { badge.textContent = '已停止'; badge.className = 'exec-status-badge interrupted'; }
        appendLog('warn', `${Utils.icon('alert-triangle', 13)} 工程执行已被中止`);
        getSvc().offAllExecutionListeners();
    }

    async function handleStopExecution() {
        if (!currentExecutionId) return;
        if (!confirm('确认停止当前执行？')) return;
        try {
            await getSvc().stopExecution(currentExecutionId);
            appendLog('warn', '停止指令已发送...');
        } catch (e) {
            appendLog('error', '停止失败: ' + e.message);
        }
    }

    // ========== 执行历史 ==========
    async function showHistory(taskId) {
        currentTaskId = taskId;

        const container = document.getElementById('projectTaskManagementContent');
        if (!container) return;

        // 移除之前的事件监听器，防止重复绑定
        if (historyClickListener) {
            container.removeEventListener('click', historyClickListener);
            historyClickListener = null;
        }

        let executions = [];
        try {
            executions = await getSvc().getExecutionHistory(taskId) || [];
        } catch (e) {
            console.error('加载执行历史失败:', e);
        }

        container.innerHTML = `
            <div class="pt-history-panel">
                <div class="pt-history-header">
                    <button class="btn btn-secondary btn-sm" id="ptHistBackBtn">← 返回列表</button>
                    <h3>执行历史</h3>
                    <button class="btn btn-secondary btn-sm" id="ptHistRefreshBtn">${Utils.icon('refresh-cw', 12)} 刷新</button>
                </div>
                <div class="pt-history-list">
                    ${executions.length === 0
                        ? '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-muted);">暂无执行记录</div>'
                        : executions.map(renderHistoryItem).join('')
                    }
                </div>
            </div>`;

        injectExecutionStyles();
        document.getElementById('ptHistBackBtn').onclick = () => ProjectTaskManagement.init();
        document.getElementById('ptHistRefreshBtn').onclick = () => showHistory(taskId);

        // 定义事件监听器函数并保存引用
        historyClickListener = async (e) => {
            const btn = e.target.closest('[data-hist-action]');
            if (!btn) return;
            const action = btn.dataset.histAction;
            const execId = parseInt(btn.dataset.execId);
            if (action === 'detail') showExecutionDetail(execId);
        };
        container.addEventListener('click', historyClickListener);
    }

    function renderHistoryItem(exec) {
        const statusMap = {
            completed: { label: '成功', cls: 'success' },
            failed: { label: '失败', cls: 'failed' },
            interrupted: { label: '中断', cls: 'interrupted' },
            running: { label: '运行中', cls: 'running' },
            scheduled: { label: '待执行', cls: 'running' },
            missed: { label: '已错过', cls: 'failed' },
            pending: { label: '等待中', cls: 'running' }
        };
        const s = statusMap[exec.status] || { label: exec.status, cls: 'idle' };

        const duration = exec.started_at && exec.completed_at
            ? formatDuration(new Date(exec.completed_at) - new Date(exec.started_at))
            : '-';
        const execTypeMap = { manual: '手动', scheduled: '定时' };

        return `
            <div class="pt-history-item">
                <div class="hist-main">
                    <span class="exec-status-badge ${s.cls}" style="margin-right:10px;">${s.label}</span>
                    <span style="font-size:13px;color:var(--text-body);">${exec.started_at ? new Date(exec.started_at).toLocaleString() : '未执行'}</span>
                    <span style="font-size:13px;color:var(--text-muted);margin-left:12px;">类型: ${execTypeMap[exec.execution_type] || exec.execution_type}</span>
                    <span style="font-size:13px;color:var(--text-muted);margin-left:12px;">耗时: ${duration}</span>
                    <span style="font-size:13px;color:var(--text-muted);margin-left:12px;">步骤: ${exec.completed_steps || 0}/${exec.total_steps || 0}</span>
                    ${exec.error_message ? `<span style="font-size:12px;color:var(--status-critical-fg);margin-left:12px;" title="${escapeHtml(exec.error_message)}">${Utils.icon('alert-triangle', 11)} ${escapeHtml(exec.error_message.substring(0, 40))}${exec.error_message.length > 40 ? '...' : ''}</span>` : ''}
                </div>
                <button class="btn btn-secondary btn-sm" data-hist-action="detail" data-exec-id="${exec.id}">详情</button>
            </div>`;
    }

    async function showExecutionDetail(executionId) {
        let detail = {};
        try {
            detail = await getSvc().getExecutionDetails(executionId) || {};
        } catch (e) {
            Utils.showError('加载详情失败: ' + e.message);
            return;
        }

        // 后端返回字段为 step_executions
        const steps = detail.step_executions || [];
        const typeLabels = { command: '命令执行', script: '脚本执行', upload: '文件上传' };
        const statusLabelMap = {
            completed: { label: '成功', cls: 'success' },
            failed:    { label: '失败', cls: 'failed' },
            skipped:   { label: '跳过', cls: 'idle' },
            running:   { label: '执行中', cls: 'running' },
            pending:   { label: '等待中', cls: 'idle' }
        };

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';

        // 构建日志模式内容（原有展示逻辑）
        const logModeHTML = steps.length === 0
            ? '<p style="color:var(--text-muted);text-align:center;padding:20px;">暂无步骤执行记录</p>'
            : steps.map(step => {
                const s = statusLabelMap[step.status] || { label: step.status, cls: 'idle' };
                const duration = step.started_at && step.completed_at
                    ? Math.round((new Date(step.completed_at) - new Date(step.started_at)) / 1000) + '秒'
                    : '-';
                return `
                <div class="step-detail-item">
                    <div class="step-detail-header">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:13px;color:var(--text-muted);">${typeLabels[step.step_type] || step.step_type}</span>
                            <strong style="font-size:14px;color:var(--text-heading);">${escapeHtml(step.step_name)}</strong>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span style="font-size:12px;color:var(--text-muted);">耗时: ${duration}</span>
                            <span class="exec-status-badge ${s.cls}">${s.label}</span>
                        </div>
                    </div>
                    ${step.error_message ? `<div style="color:var(--status-critical-fg);font-size:13px;margin-top:6px;padding:6px 8px;background:var(--status-critical-bg);border-radius:4px;">错误: ${escapeHtml(step.error_message)}</div>` : ''}
                    ${step.host_results && step.host_results.length > 0 ? `
                        <div class="host-results">
                            ${step.host_results.map(r => `
                                <div class="host-result-item" style="flex-direction:column;align-items:flex-start;">
                                    <div style="display:flex;align-items:center;gap:10px;width:100%;">
                                        <span class="host-ip">${escapeHtml(r.hostIp || '')}</span>
                                        <span class="${r.status === 'success' ? 'text-success' : 'text-danger'}">${r.status === 'success' ? Utils.icon('check-circle', 12) : Utils.icon('x-circle', 12)} ${r.status === 'success' ? '成功' : '失败'}</span>
                                        ${r.duration ? `<span style="font-size:12px;color:var(--text-muted);">耗时: ${r.duration}ms</span>` : ''}
                                        ${r.errorMessage ? `<span style="color:var(--status-critical-fg);font-size:12px;">${escapeHtml(r.errorMessage)}</span>` : ''}
                                    </div>
                                    ${r.stdout ? `<div style="margin-top:6px;width:100%;"><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">输出:</div><pre style="background:var(--canvas-base);color:var(--text-body);padding:8px 10px;border-radius:4px;font-size:11px;max-height:150px;overflow-y:auto;margin:0;white-space:pre-wrap;word-break:break-all;">${escapeHtml(r.stdout)}</pre></div>` : ''}
                                    ${r.stderr ? `<div style="margin-top:4px;width:100%;"><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">执行过程:</div><pre style="background:var(--canvas-base);color:var(--status-warning-fg);padding:8px 10px;border-radius:4px;font-size:11px;max-height:100px;overflow-y:auto;margin:0;white-space:pre-wrap;word-break:break-all;">${escapeHtml(r.stderr)}</pre></div>` : ''}
                                </div>`).join('')}
                        </div>` : '<div style="font-size:12px;color:var(--text-faint);margin-top:6px;">无主机执行记录</div>'}
                </div>`;
            }).join('');

        // 构建结果模式内容（步骤卡片）
        const resultModeHTML = steps.length === 0
            ? '<div class="result-empty-tip">暂无步骤执行记录</div>'
            : steps.map(step => {
                const hostResults = step.host_results || [];
                const successCount = hostResults.filter(r => r.status === 'success').length;
                const failedCount = hostResults.filter(r => r.status === 'failed' || r.status === 'error').length;
                const statusCls = step.status === 'completed' ? 'success' : step.status === 'failed' ? 'failed' : 'idle';
                const statusIcon = step.status === 'completed' ? Utils.icon('check', 13, 2.5) : step.status === 'failed' ? Utils.icon('x', 13, 2.5) : '<span style="font-size:10px;">○</span>';
                const stepType = step.step_type || '';
                const typeLabelsShort = { command: '命令', script: '脚本', upload: '上传' };
                const typeColors = { command: 'var(--primary)', script: 'var(--status-healthy-fg)', upload: 'var(--chart-5)' };
                const typeLabel = typeLabelsShort[stepType] || stepType;
                const typeColor = typeColors[stepType] || 'var(--text-muted)';
                const summaryText = hostResults.length > 0
                    ? `${successCount}台成功${failedCount > 0 ? ', ' + failedCount + '台失败' : ''}`
                    : '无主机执行记录';
                const cardId = `detail-step-${step.step_id || step.id}`;

                const hostsInnerHTML = hostResults.map(r => buildHostRowHTML(r, stepType)).join('');

                return `
                <div class="pt-step-card pt-step-card-${statusCls}" id="${cardId}" data-step-id="${step.step_id || step.id}">
                    <div class="pt-step-card-header" onclick="this.closest('.pt-step-card').classList.toggle('expanded')">
                        <span class="pt-step-status-icon status-${statusCls}">${statusIcon}</span>
                        <span class="pt-step-type-tag" style="background:${typeColor}20;color:${typeColor};border-color:${typeColor}40;">${typeLabel}</span>
                        <span class="pt-step-name">${escapeHtml(step.step_name)}</span>
                        <span class="pt-step-summary">${escapeHtml(summaryText)}</span>
                        ${hostResults.length > 0 ? `<span class="pt-step-rate ${failedCount > 0 ? 'rate-failed' : 'rate-success'}">${successCount}/${hostResults.length}</span>` : ''}
                        <span class="expand-icon">${Utils.icon('play', 9)}</span>
                    </div>
                    <div class="pt-step-card-body">
                        ${step.error_message ? `<div class="pt-step-error">错误: ${escapeHtml(step.error_message)}</div>` : ''}
                        ${hostsInnerHTML ? `<div class="pt-host-list">${hostsInnerHTML}</div>` : '<div style="font-size:12px;color:var(--text-faint);padding:6px 0;">无主机执行记录</div>'}
                    </div>
                </div>`;
            }).join('');

        modal.innerHTML = `
            <div class="modal-dialog" style="max-width:860px;">
                <div class="modal-header">
                    <h3>执行详情 #${executionId}</h3>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div class="view-toggle" id="detailViewToggle">
                            <button class="view-toggle-btn active" id="detailResultBtn">${Utils.icon('bar-chart', 13)} 结果模式</button>
                            <button class="view-toggle-btn" id="detailLogBtn">${Utils.icon('file-text', 13)} 日志模式</button>
                        </div>
                        <button class="modal-close" id="execDetailClose">${Utils.icon('x', 14)}</button>
                    </div>
                </div>
                <div class="modal-body" style="max-height:70vh;overflow-y:auto;">
                    <!-- 结果模式 -->
                    <div id="detailResultView">
                        <div class="pt-result-container" style="height:auto;max-height:none;background:transparent;padding:0;">
                            ${resultModeHTML}
                        </div>
                    </div>
                    <!-- 日志模式 -->
                    <div id="detailLogView" style="display:none;">
                        ${logModeHTML}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="execDetailOk">关闭</button>
                </div>
            </div>`;

        document.getElementById('modalContainer').appendChild(modal);

        // 关闭按鈕
        modal.querySelector('#execDetailClose').onclick = () => modal.remove();
        modal.querySelector('#execDetailOk').onclick = () => modal.remove();
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        // 详情弹窗内的视图切换
        modal.querySelector('#detailResultBtn').onclick = () => {
            modal.querySelector('#detailResultView').style.display = '';
            modal.querySelector('#detailLogView').style.display = 'none';
            modal.querySelector('#detailResultBtn').classList.add('active');
            modal.querySelector('#detailLogBtn').classList.remove('active');
        };
        modal.querySelector('#detailLogBtn').onclick = () => {
            modal.querySelector('#detailResultView').style.display = 'none';
            modal.querySelector('#detailLogView').style.display = '';
            modal.querySelector('#detailResultBtn').classList.remove('active');
            modal.querySelector('#detailLogBtn').classList.add('active');
        };
    }

    // ========== 工具函数 ==========
    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDuration(ms) {
        if (ms < 0 || isNaN(ms)) return '-';
        const secs = Math.floor(ms / 1000);
        if (secs < 60) return `${secs}秒`;
        const mins = Math.floor(secs / 60);
        const rem = secs % 60;
        return `${mins}分${rem}秒`;
    }

    // ========== 样式注入 ==========
    function injectExecutionStyles() {
        if (document.getElementById('pt-exec-styles')) return;
        const style = document.createElement('style');
        style.id = 'pt-exec-styles';
        style.textContent = `
            .pt-execution-panel { display: flex; flex-direction: column; gap: 16px; }
            .pt-exec-header { display: flex; align-items: center; gap: 14px; }
            .pt-exec-header h3 { margin: 0; flex: 1; font-size: 18px; }
            .pt-exec-header-actions { display: flex; align-items: center; gap: 10px; }

            .exec-status-badge { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; display: inline-block; }
            .exec-status-badge.running { background: var(--status-warning-bg); color: var(--status-warning-fg); }
            .exec-status-badge.success { background: var(--status-healthy-bg); color: var(--status-healthy-fg); }
            .exec-status-badge.failed { background: var(--status-critical-bg); color: var(--status-critical-fg); }
            .exec-status-badge.interrupted { background: var(--status-neutral-bg); color: var(--status-neutral-fg); }
            .exec-status-badge.idle { background: var(--surface-subtle); color: var(--text-muted); }

            .pt-steps-progress { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 14px 18px; box-shadow: var(--shadow-card); display: flex; align-items: center; gap: 14px; }
            .progress-bar-wrap { flex: 1; height: 8px; background: var(--surface-active); border-radius: 4px; overflow: hidden; }
            .progress-bar { height: 100%; background: var(--primary); border-radius: 4px; transition: width .3s ease; }

            .pt-steps-status { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 14px 18px; box-shadow: var(--shadow-card); min-height: 60px; }
            .step-status-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
            .step-status-item:last-child { border-bottom: none; }
            .step-status-icon { font-size: 16px; }
            .step-status-name { flex: 1; font-weight: 500; color: var(--text-heading); }
            .step-status-text { font-size: 12px; }
            .step-completed { color: var(--status-healthy-fg); }
            .step-failed { color: var(--status-critical-fg); }
            .step-running { color: var(--status-warning-fg); }
            .step-skipped { color: var(--text-muted); }
            .step-pending { color: var(--text-faint); }

            .pt-log-panel { background: var(--canvas-base); border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; flex: 1; min-height: 200px; display: flex; flex-direction: column; }
            .pt-log-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; background: var(--surface-subtle); }
            .pt-log-header span { color: var(--text-muted); font-size: 13px; font-weight: 500; }
            .pt-log-content { flex: 1; overflow-y: auto; padding: 10px 16px; font-family: var(--font-mono); font-size: 12px; line-height: 1.7; max-height: 300px; }
            .log-line { display: block; word-break: break-all; }
            .log-time { color: var(--text-faint); margin-right: 8px; }
            .log-info { color: var(--text-muted); }
            .log-success { color: var(--status-healthy-fg); }
            .log-error { color: var(--status-critical-fg); }
            .log-warn { color: var(--status-warning-fg); }

            .pt-history-panel { display: flex; flex-direction: column; gap: 16px; padding: 20px 30px; }
            .pt-history-header { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
            .pt-history-header h3 { margin: 0; font-size: 18px; flex: 1; }
            .pt-history-list { display: flex; flex-direction: column; gap: 10px; }
            .pt-history-item { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 14px 18px; box-shadow: var(--shadow-card); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
            .hist-main { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; flex: 1; }

            .step-detail-item { background: var(--surface-subtle); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 14px; margin-bottom: 12px; }
            .step-detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .host-results { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
            .host-result-item { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 4px 0; }
            .host-ip { font-family: var(--font-mono); color: var(--text-body); min-width: 130px; }
            .text-success { color: var(--status-healthy-fg); }
            .text-danger { color: var(--status-critical-fg); }
        `;
        document.head.appendChild(style);
    }

    return { startExecution, showHistory, showExecutionDetail, cleanup };
})();

window.ProjectTaskExecution = ProjectTaskExecution;
