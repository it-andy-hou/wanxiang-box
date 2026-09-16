// 任务记录页面逻辑（合并普通任务和工程任务执行记录）
(function() {
    'use strict';

    let taskService;
    let projectTaskService;
    let currentTasks = [];        // 普通任务
    let currentProjectExecutions = []; // 工程任务执行记录
    let filteredTasks = [];       // 合并后的筛选结果

    // 初始化
    async function init() {
        console.log('初始化任务记录页面...');
        
        // 创建服务实例
        taskService = new window.TaskService();
        if (window.ProjectTaskService) {
            projectTaskService = new window.ProjectTaskService();
        }
        
        // 绑定事件
        bindEvents();
        
        // 加载任务记录
        await loadHistory();
    }

    // 绑定事件
    function bindEvents() {
        console.log('绑定执行历史事件...');
        
        // 刷新按钮
        const refreshBtn = document.getElementById('refreshHistoryBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadHistory);
        }

        // 搜索功能
        const searchInput = document.getElementById('historySearchInput');
        const searchBtn = document.getElementById('searchHistoryBtn');

        if (searchInput) {
            searchInput.addEventListener('input', debounce(handleSearch, 300));
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    handleSearch();
                }
            });
        }

        if (searchBtn) {
            searchBtn.addEventListener('click', handleSearch);
        }

        // 状态筛选
        const statusFilter = document.getElementById('historyStatusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', handleSearch);
        }

        // 任务类型筛选
        const taskTypeFilter = document.getElementById('historyTaskTypeFilter');
        if (taskTypeFilter) {
            taskTypeFilter.addEventListener('change', handleSearch);
        }
        
        // 任务来源筛选
        const sourceFilter = document.getElementById('historySourceFilter');
        if (sourceFilter) {
            sourceFilter.addEventListener('change', handleSearch);
        }
    }

    // 加载任务记录（普通任务 + 工程任务）
    async function loadHistory() {
        try {
            console.log('加载任务记录...');
            
            // 并行加载普通任务和工程任务执行记录
            const [regularTasks, projectExecutions] = await Promise.all([
                taskService.getTasks(),
                loadProjectExecutions()
            ]);
            
            currentTasks = regularTasks || [];
            currentProjectExecutions = projectExecutions || [];
            
            // 合并所有记录
            const allRecords = [...currentTasks, ...currentProjectExecutions];
            filteredTasks = allRecords;
            
            console.log(`加载了 ${currentTasks.length} 条普通任务, ${currentProjectExecutions.length} 条工程任务`);
            renderHistory();
        } catch (error) {
            console.error('加载任务记录失败:', error);
            showMessage('加载任务记录失败: ' + error.message, 'error');
        }
    }
    
    // 加载工程任务执行记录
    async function loadProjectExecutions() {
        try {
            if (!projectTaskService) return [];
            // 获取所有工程任务
            const projects = await projectTaskService.getAllProjectTasks();
            const allExecutions = [];
            
            // 遍历每个工程任务获取执行历史
            for (const project of projects) {
                const executions = await projectTaskService.getExecutionHistory(project.id);
                // 为每个执行记录添加工程名称和来源标记
                executions.forEach(exec => {
                    exec._source = 'project';
                    exec._projectName = project.name;
                    exec._projectId = project.id;
                });
                allExecutions.push(...executions);
            }
            
            return allExecutions;
        } catch (error) {
            console.warn('加载工程任务执行记录失败:', error);
            return [];
        }
    }

    // 搜索处理
    function handleSearch() {
        const searchInput = document.getElementById('historySearchInput');
        const statusFilter = document.getElementById('historyStatusFilter');
        const taskTypeFilter = document.getElementById('historyTaskTypeFilter');
        const sourceFilter = document.getElementById('historySourceFilter');
        
        const keyword = searchInput ? searchInput.value.trim() : '';
        const status = statusFilter ? statusFilter.value : '';
        const taskType = taskTypeFilter ? taskTypeFilter.value : '';
        const source = sourceFilter ? sourceFilter.value : '';
        
        applyFilters(keyword, status, taskType, source);
    }

    // 应用筛选
    function applyFilters(keyword = '', status = '', taskType = '', source = '') {
        // 合并所有记录
        const allRecords = [...currentTasks, ...currentProjectExecutions];
        
        filteredTasks = allRecords.filter(task => {
            // 来源筛选
            if (source) {
                const taskSource = task._source === 'project' ? 'project' : 'regular';
                if (taskSource !== source) {
                    return false;
                }
            }
            
            // 关键词筛选
            if (keyword) {
                const lowerKeyword = keyword.toLowerCase();
                const taskName = task.task_name || task._projectName || '';
                const matchName = taskName.toLowerCase().includes(lowerKeyword);
                // 临时命令支持搜索命令内容
                const matchCommand = task.is_temporary_command && task.script_content
                    && task.script_content.toLowerCase().includes(lowerKeyword);
                if (!matchName && !matchCommand) {
                    return false;
                }
            }

            // 状态筛选
            if (status && task.status !== status) {
                return false;
            }

            // 任务类型筛选
            if (taskType) {
                // 工程任务
                if (taskType === 'project') {
                    return task._source === 'project';
                }
                // 普通任务类型筛选
                if (task._source !== 'project') {
                    if (taskType === 'file' && !task.is_file_upload) {
                        return false;
                    }
                    if (taskType === 'command' && !task.is_temporary_command) {
                        return false;
                    }
                    if (taskType === 'script' && (task.is_file_upload || task.is_temporary_command)) {
                        return false;
                    }
                } else {
                    // 工程任务不匹配普通类型筛选
                    return false;
                }
            }

            return true;
        });

        console.log(`筛选后剩余 ${filteredTasks.length} 条记录`);
        renderHistory();
    }

    // 渲染执行历史
    function renderHistory() {
        const tbody = document.querySelector('#historyTable tbody');
        if (!tbody) return;

        if (filteredTasks.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                        <p style="font-size: 1.125rem; margin-bottom: 0.5rem;">暂无任务记录</p>
                    </td>
                </tr>
            `;
            return;
        }

        // 按创建时间倒序排序
        const sortedTasks = [...filteredTasks].sort((a, b) => {
            const dateA = new Date(a.created_at || 0);
            const dateB = new Date(b.created_at || 0);
            return dateB - dateA;
        });

        tbody.innerHTML = sortedTasks.map(task => createHistoryRow(task)).join('');

        // 绑定事件
        bindHistoryRowEvents();
    }

    // 创建历史记录行
    function createHistoryRow(task) {
        const isProject = task._source === 'project';
        
        // 工程任务和普通任务使用不同的字段
        const taskId = task.id;
        let taskName = isProject ? (task._projectName || '未命名工程') : (task.task_name || '未命名任务');
        // 临时命令：用实际命令内容替换占位标题，便于一眼识别
        let taskNameTitle = taskName;
        if (!isProject && task.is_temporary_command && task.script_content) {
            const cmdRaw = String(task.script_content).replace(/\s+/g, ' ').trim();
            taskNameTitle = String(task.script_content);
            taskName = cmdRaw.length > 60 ? cmdRaw.slice(0, 60) + '…' : cmdRaw;
        }
        const createdAt = formatDateTime(task.created_at);
        const completedAt = isProject 
            ? formatDateTime(task.completed_at) 
            : formatDateTime(task.end_time);
        
        // 任务来源
        const sourceInfo = isProject 
            ? '<span class="task-source-badge project">工程任务</span>'
            : '<span class="task-source-badge regular">普通任务</span>';
        
        // 任务类型
        let taskTypeInfo = '';
        if (isProject) {
            taskTypeInfo = '<span class="task-type-badge project">工程</span>';
        } else if (task.is_file_upload) {
            taskTypeInfo = '<span class="task-type-badge file">文件上传</span>';
        } else if (task.is_temporary_command) {
            taskTypeInfo = '<span class="task-type-badge command">临时命令</span>';
        } else {
            taskTypeInfo = '<span class="task-type-badge script">脚本</span>';
        }
        
        // 主机数量
        const hostCount = isProject 
            ? (task.total_steps || 0) 
            : (task.total_hosts || 0);
        
        // 成功/失败统计
        const successCount = isProject 
            ? (task.completed_steps || 0) 
            : (task.success_hosts || 0);
        const failedCount = isProject 
            ? (task.failed_steps || 0) 
            : (task.failed_hosts || 0);
        
        // 状态
        const status = task.status || 'unknown';
        
        // 操作按钮
        const actionButtons = isProject
            ? `<button class="btn btn-sm btn-primary btn-view-project" data-project-id="${task._projectId}" data-exec-id="${taskId}">详情</button>`
            : `<button class="btn btn-sm btn-primary btn-view-detail" data-task-id="${taskId}">详情</button>
               <button class="btn btn-sm btn-danger btn-delete" data-task-id="${taskId}">删除</button>`;

        return `
            <tr data-task-id="${taskId}" data-source="${isProject ? 'project' : 'regular'}">
                <td>${taskId}</td>
                <td><strong title="${escapeHtml(taskNameTitle)}">${escapeHtml(taskName)}</strong></td>
                <td>${sourceInfo}</td>
                <td>${taskTypeInfo}</td>
                <td>${hostCount}</td>
                <td>
                    <span style="color: var(--status-healthy-fg);">${successCount}</span> /
                    <span style="color: var(--status-critical-fg);">${failedCount}</span>
                </td>
                <td><span class="status-badge status-${status}">${getStatusText(status)}</span></td>
                <td>${createdAt}</td>
                <td>${completedAt}</td>
                <td>${actionButtons}</td>
            </tr>
        `;
    }

    // 绑定历史记录行事件
    function bindHistoryRowEvents() {
        // 查看普通任务详情按钮
        document.querySelectorAll('.btn-view-detail').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const taskId = parseInt(e.currentTarget.dataset.taskId);
                await viewTaskDetail(taskId);
            });
        });

        // 查看工程任务详情按钮
        document.querySelectorAll('.btn-view-project').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const projectId = parseInt(e.currentTarget.dataset.projectId);
                const execId = parseInt(e.currentTarget.dataset.execId);
                await viewProjectExecutionDetail(projectId, execId);
            });
        });

        // 删除按钮
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const taskId = parseInt(e.currentTarget.dataset.taskId);
                await deleteTask(taskId);
            });
        });
    }
    
    // 查看工程任务执行详情
    async function viewProjectExecutionDetail(projectId, execId) {
        try {
            if (window.ProjectTaskExecution && window.ProjectTaskExecution.showExecutionDetail) {
                await window.ProjectTaskExecution.showExecutionDetail(execId);
            } else {
                // 降级方案：跳转到工程任务页面查看历史
                showMessage('请前往工程任务页面查看执行详情', 'info');
                if (window.Navigation) {
                    window.Navigation.navigateTo('project-tasks');
                }
            }
        } catch (error) {
            console.error('查看工程任务详情失败:', error);
            showMessage('查看详情失败: ' + error.message, 'error');
        }
    }

    // 查看任务详情
    async function viewTaskDetail(taskId) {
        try {
            const task = await taskService.getTask(taskId);
            const results = await taskService.getTaskResults(taskId);
            
            const modal = createDetailDialog(task, results);
            document.body.appendChild(modal);
        } catch (error) {
            console.error('查看任务详情失败:', error);
            showMessage('查看任务详情失败: ' + error.message, 'error');
        }
    }

    // 创建详情对话框
    function createDetailDialog(task, results) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        
        // 计算统计信息
        const successResults = results.filter(r => r.status === 'success');
        const failedResults = results.filter(r => r.status === 'failed' || r.status === 'timeout');
        const avgDuration = results.length > 0 
            ? Math.round(results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length)
            : 0;

        modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 1200px; max-height: 90vh;">
                <div class="modal-header">
                    <h2>任务详情 - ${escapeHtml(task.task_name)}</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body" style="overflow-y: auto; max-height: calc(90vh - 140px);">
                    <!-- 任务概览 -->
                    <div class="card" style="margin-bottom: 1.5rem;">
                        <div class="card-header">
                            <h3>任务概览</h3>
                        </div>
                        <div class="card-body">
                            ${task.is_temporary_command && task.script_content ? `
                            <div style="margin-bottom: 1rem; padding: 1rem; background: var(--status-warning-bg); border-radius: 6px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                    <div style="font-weight: bold; color: var(--status-warning-fg);">${Utils.icon('info', 13)} 临时命令内容：</div>
                                    <button class="btn btn-sm btn-success" id="copyCommandBtn" title="复制命令到剪贴板">${Utils.icon('copy', 12)} 复制命令</button>
                                </div>
                                <pre id="commandContent" style="background: var(--canvas-base); color: var(--text-body); padding: 1rem; border-radius: 6px; max-height: 150px; overflow: auto; font-family: var(--font-mono); font-size: 0.875rem; margin: 0;">${escapeHtml(task.script_content)}</pre>
                            </div>
                            ` : ''}
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5rem;">
                                <div>
                                    <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem;">任务状态</div>
                                    <div><span class="status-badge status-${task.status}">${getStatusText(task.status)}</span></div>
                                </div>
                                <div>
                                    <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem;">总主机数</div>
                                    <div style="font-size: 1.5rem; font-weight: bold;">${task.total_hosts || 0}</div>
                                </div>
                                <div>
                                    <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem;">成功/失败</div>
                                    <div style="font-size: 1.5rem; font-weight: bold;">
                                        <span style="color: var(--status-healthy-fg);">${task.success_hosts || 0}</span> / 
                                        <span style="color: var(--status-critical-fg);">${task.failed_hosts || 0}</span>
                                    </div>
                                </div>
                                <div>
                                    <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem;">平均耗时</div>
                                    <div style="font-size: 1.5rem; font-weight: bold;">${avgDuration}ms</div>
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-subtle);">
                                <div>
                                    <div style="font-size: 0.875rem; color: var(--text-muted);">创建时间</div>
                                    <div>${formatDateTime(task.created_at)}</div>
                                </div>
                                <div>
                                    <div style="font-size: 0.875rem; color: var(--text-muted);">开始时间</div>
                                    <div>${task.start_time ? formatDateTime(task.start_time) : '-'}</div>
                                </div>
                                <div>
                                    <div style="font-size: 0.875rem; color: var(--text-muted);">完成时间</div>
                                    <div>${task.end_time ? formatDateTime(task.end_time) : '-'}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 执行结果 -->
                    <div class="card">
                        <div class="card-header">
                            <h3>执行结果</h3>
                        </div>
                        <div class="card-body">
                            <div style="max-height: 400px; overflow-y: auto;">
                                <table class="table">
                                    <thead>
                                        <tr>
                                            <th>主机ID</th>
                                            <th>IP地址</th>
                                            <th>状态</th>
                                            <th>退出码</th>
                                            <th>耗时(ms)</th>
                                            <th>开始时间</th>
                                            <th>完成时间</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${results.map(result => `
                                            <tr>
                                                <td>${result.host_id}</td>
                                                <td>${escapeHtml(result.host_ip || '-')}</td>
                                                <td><span class="status-badge status-${result.status}">${result.status}</span></td>
                                                <td>${result.exit_code !== null ? result.exit_code : '-'}</td>
                                                <td>${result.duration || '-'}</td>
                                                <td>${result.start_time ? formatTime(result.start_time) : '-'}</td>
                                                <td>${result.end_time ? formatTime(result.end_time) : '-'}</td>
                                                <td>
                                                    <button class="btn btn-sm btn-info btn-view-output" data-result='${JSON.stringify(result).replace(/'/g, "&#39;")}'>查看输出</button>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            </div>
        `;

        // 绑定关闭事件
        modalOverlay.querySelector('.modal-close').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) modalOverlay.remove();
        });

        // 查看输出按钮
        modalOverlay.querySelectorAll('.btn-view-output').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const result = JSON.parse(e.currentTarget.dataset.result);
                showOutputDialog(result);
            });
        });
        
        // 绑定复制命令按钮事件
        if (task.is_temporary_command && task.script_content) {
            const copyCommandBtn = modalOverlay.querySelector('#copyCommandBtn');
            if (copyCommandBtn) {
                copyCommandBtn.addEventListener('click', () => {
                    copyCommandToClipboard(task.script_content);
                });
            }
        }

        return modalOverlay;
    }

    // 显示输出对话框
    function showOutputDialog(result) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        const hostInfo = result.host_ip ? `${result.host_ip} (ID: ${result.host_id})` : `主机 ${result.host_id}`;
        modal.innerHTML = `
            <div class="modal" style="max-width: 900px;">
                <div class="modal-header">
                    <h2>执行输出 - ${hostInfo}</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 1.5rem;">
                        <div style="margin-bottom: 0.5rem;">
                            <strong>状态:</strong> <span class="status-badge status-${result.status}">${result.status}</span>
                            <strong style="margin-left: 2rem;">退出码:</strong> ${result.exit_code !== null ? result.exit_code : '-'}
                            <strong style="margin-left: 2rem;">耗时:</strong> ${result.duration || '-'}ms
                        </div>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <strong>标准输出:</strong>
                        <pre style="background: var(--canvas-base); color: var(--text-body); padding: 1rem; border-radius: 6px; max-height: 300px; overflow: auto; font-family: var(--font-mono); font-size: 0.875rem;">${escapeHtml(result.stdout || '(无输出)')}</pre>
                    </div>
                    <div>
                        <strong>错误输出:</strong>
                        <pre style="background: var(--canvas-base); color: var(--status-critical-fg); padding: 1rem; border-radius: 6px; max-height: 300px; overflow: auto; font-family: var(--font-mono); font-size: 0.875rem;">${escapeHtml(result.stderr || result.error_message || '(无错误)')}</pre>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            </div>
        `;

        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);
    }

    // 删除任务
    async function deleteTask(taskId) {
        const task = currentTasks.find(t => t.id === taskId);
        if (!task) {
            showMessage('任务不存在', 'error');
            return;
        }

        // 使用自定义确认对话框替代原生confirm，避免焦点被锁定
        const confirmed = await Components.ConfirmDialog.show({
            title: '确认删除任务',
            message: `确定要删除任务“${task.task_name}”吗？此操作将删除任务及其所有执行结果。`,
            confirmText: '删除',
            cancelText: '取消'
        });
                
        if (!confirmed) {
            return;
        }

        try {
            await taskService.deleteTask(taskId);
            showMessage('任务删除成功', 'success');
            await loadHistory();
        } catch (error) {
            console.error('删除任务失败:', error);
            showMessage('删除任务失败: ' + error.message, 'error');
        }
    }

    // 工具函数：HTML转义
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 工具函数：防抖
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 格式化日期时间
    function formatDateTime(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleString('zh-CN');
    }

    // 格式化时间
    function formatTime(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleTimeString('zh-CN', { hour12: false });
    }

    // 获取状态文本
    function getStatusText(status) {
        const statusMap = {
            'pending': '等待中',
            'running': '运行中',
            'completed': '已完成',
            'failed': '失败',
            'cancelled': '已取消',
            'success': '成功',
            'timeout': '超时'
        };
        return statusMap[status] || status;
    }

    // 显示消息
    function showMessage(message, type = 'info') {
        if (window.Utils && window.Utils.showMessage) {
            window.Utils.showMessage(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }
    
    // 复制命令到剪贴板
    async function copyCommandToClipboard(commandText) {
        try {
            // 优先使用现代 Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(commandText);
                showMessage('命令已复制到剪贴板', 'success');
            } else {
                // 降级方案：使用 textarea 和 execCommand
                const textarea = document.createElement('textarea');
                textarea.value = commandText;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                
                const successful = document.execCommand('copy');
                document.body.removeChild(textarea);
                
                if (successful) {
                    showMessage('命令已复制到剪贴板', 'success');
                } else {
                    throw new Error('复制失败');
                }
            }
        } catch (error) {
            console.error('复制命令失败:', error);
            showMessage('复制命令失败: ' + error.message, 'error');
        }
    }

    // 导出到全局
    window.TaskHistory = {
        init: function() {
            if (!this._initialized) {
                this._initialized = true;
                console.log('TaskHistory 初始化');
                init();
            } else {
                console.log('TaskHistory 重新加载数据');
                loadHistory();
            }
        },
        _initialized: false
    };

})();
