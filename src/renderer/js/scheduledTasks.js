/**
 * 任务调度模块
 * 显示和管理所有待执行的定时任务（包括普通任务和工程任务）
 */
const ScheduledTasksModule = (() => {
    let taskService = null;
    let projectTaskService = null;
    let autoRefreshTimer = null;
    let currentTasks = [];
    let currentProjectExecutions = [];

    // 初始化
    async function init() {
        console.log('初始化任务调度模块');
        
        // 初始化服务
        if (!taskService) {
            taskService = new TaskService();
        }
        if (!projectTaskService && window.ProjectTaskService) {
            projectTaskService = new ProjectTaskService();
        }

        // 绑定刷新按钮
        const refreshBtn = document.getElementById('refreshScheduledTasksBtn');
        if (refreshBtn) {
            refreshBtn.onclick = () => loadScheduledTasks();
        }

        // 加载数据
        await loadScheduledTasks();
        
        // 启动自动刷新
        startAutoRefresh();
    }

    // 加载定时任务列表
    async function loadScheduledTasks() {
        try {
            console.log('加载定时任务列表...');
            
            // 并行加载普通任务和工程任务
            const [regularTasks, projectExecutions] = await Promise.all([
                loadRegularScheduledTasks(),
                loadProjectScheduledExecutions()
            ]);
            
            currentTasks = regularTasks || [];
            currentProjectExecutions = projectExecutions || [];
            
            // 合并并渲染
            renderScheduledTasks();
        } catch (error) {
            console.error('加载定时任务失败:', error);
            showError('加载定时任务失败: ' + error.message);
        }
    }

    // 加载普通定时任务（脚本/命令执行）
    async function loadRegularScheduledTasks() {
        try {
            if (taskService && taskService.getScheduledTasks) {
                return await taskService.getScheduledTasks();
            }
            return [];
        } catch (error) {
            console.warn('加载普通定时任务失败:', error);
            return [];
        }
    }

    // 加载工程定时任务
    async function loadProjectScheduledExecutions() {
        try {
            if (projectTaskService && projectTaskService.getScheduledExecutions) {
                return await projectTaskService.getScheduledExecutions();
            }
            return [];
        } catch (error) {
            console.warn('加载工程定时任务失败:', error);
            return [];
        }
    }

    // 渲染定时任务列表
    function renderScheduledTasks() {
        const tbody = document.querySelector('#scheduledTasksTable tbody');
        if (!tbody) return;

        // 清空现有内容
        tbody.innerHTML = '';

        // 合并所有定时任务
        const allScheduledItems = [];

        // 添加普通任务
        currentTasks.forEach(task => {
            // 判断任务类型
            let taskType = 'script';
            if (task.is_temporary_command) {
                taskType = 'command';
            } else if (task.is_file_upload) {
                taskType = 'file';
            }
            
            allScheduledItems.push({
                type: 'regular',
                id: task.id,
                name: task.task_name || '未命名任务',
                taskType: taskType,
                hostCount: task.host_ids ? task.host_ids.length : 0,
                scheduledTime: task.scheduled_time,
                createdAt: task.created_at,
                raw: task
            });
        });

        // 添加工程任务
        currentProjectExecutions.forEach(exec => {
            allScheduledItems.push({
                type: 'project',
                id: exec.id,
                name: exec.project_name || `工程执行 #${exec.id}`,
                taskType: 'project',
                hostCount: exec.total_steps || 0,
                scheduledTime: exec.scheduled_time,
                createdAt: exec.created_at,
                raw: exec
            });
        });

        // 按计划执行时间排序
        allScheduledItems.sort((a, b) => {
            return new Date(a.scheduledTime) - new Date(b.scheduledTime);
        });

        // 如果没有任务，显示空状态
        if (allScheduledItems.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
                        <div style="margin-bottom: 16px; color: var(--text-faint);">${Utils.icon('calendar', 32)}</div>
                        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">暂无定时任务</div>
                        <div style="font-size: 13px;">在脚本执行或命令执行页面设置定时任务后将显示在这里</div>
                    </td>
                </tr>
            `;
            return;
        }

        // 渲染任务列表
        allScheduledItems.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = renderTaskRow(item);
            tbody.appendChild(row);
        });

        // 绑定操作按钮事件
        bindActionButtons();
    }

    // 渲染单行任务
    function renderTaskRow(item) {
        const taskTypeLabels = {
            script: '脚本执行',
            command: '命令执行',
            file: '文件上传',
            project: '工程任务'
        };

        const taskTypeLabel = taskTypeLabels[item.taskType] || item.taskType;
        const remainingTime = calculateRemainingTime(item.scheduledTime);
        
        return `
            <td>${item.id}</td>
            <td>${escapeHtml(item.name)}</td>
            <td><span class="task-type-badge ${item.taskType}">${taskTypeLabel}</span></td>
            <td style="text-align: center;">${item.hostCount}</td>
            <td>${formatDateTime(item.scheduledTime)}</td>
            <td>${remainingTime}</td>
            <td>${formatDateTime(item.createdAt)}</td>
            <td>
                <button class="btn btn-primary btn-sm" data-action="execute" data-type="${item.type}" data-id="${item.id}">立即执行</button>
                <button class="btn btn-secondary btn-sm" data-action="edit" data-type="${item.type}" data-id="${item.id}">调整时间</button>
                <button class="btn btn-danger btn-sm" data-action="cancel" data-type="${item.type}" data-id="${item.id}">取消</button>
            </td>
        `;
    }

    // 计算剩余时间
    function calculateRemainingTime(scheduledTime) {
        if (!scheduledTime) return '-';
        
        const now = new Date();
        const scheduled = new Date(scheduledTime);
        const diff = scheduled - now;
        
        if (diff <= 0) return '即将执行';
        
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
            return `还剩 ${hours}小时${minutes}分钟`;
        } else if (minutes > 0) {
            return `还剩 ${minutes}分钟`;
        } else {
            return '即将执行';
        }
    }

    // 格式化日期时间
    function formatDateTime(dateStr) {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
            return date.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return dateStr;
        }
    }

    // HTML转义
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 绑定操作按钮事件
    function bindActionButtons() {
        const tbody = document.querySelector('#scheduledTasksTable tbody');
        if (!tbody) return;

        tbody.onclick = async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const type = btn.dataset.type;
            const id = parseInt(btn.dataset.id);

            switch (action) {
                case 'execute':
                    await handleExecuteNow(type, id);
                    break;
                case 'edit':
                    await handleEditTime(type, id);
                    break;
                case 'cancel':
                    await handleCancel(type, id);
                    break;
            }
        };
    }

    // 立即执行
    async function handleExecuteNow(type, id) {
        if (!confirm('确定要立即执行此任务吗？')) return;

        try {
            if (type === 'regular') {
                if (taskService && taskService.executeScheduledTaskNow) {
                    await taskService.executeScheduledTaskNow(id);
                }
            } else if (type === 'project') {
                // 工程任务：先取消定时状态，然后立即执行
                if (projectTaskService && projectTaskService.execute) {
                    // 获取执行记录对应的工程任务ID
                    const exec = currentProjectExecutions.find(e => e.id === id);
                    if (exec) {
                        // 取消原定时计划
                        await projectTaskService.cancelSchedule(id);
                        // 立即执行工程任务
                        await projectTaskService.execute(exec.project_task_id);
                    }
                }
            }
            showSuccess('任务已开始执行');
            await loadScheduledTasks();
        } catch (error) {
            console.error('立即执行任务失败:', error);
            showError('立即执行失败: ' + error.message);
        }
    }

    // 调整执行时间
    async function handleEditTime(type, id) {
        // 获取当前任务
        let item;
        let displayName = '';
        let scheduledTime = '';
        
        if (type === 'regular') {
            item = currentTasks.find(t => t.id === id);
            if (item) {
                displayName = item.task_name || '未命名任务';
                scheduledTime = item.scheduled_time;
            }
        } else {
            item = currentProjectExecutions.find(e => e.id === id);
            if (item) {
                displayName = item.project_name || `工程 #${item.project_task_id}`;
                scheduledTime = item.scheduled_time;
            }
        }

        if (!item) {
            showError('任务不存在');
            return;
        }

        // 创建时间选择弹窗
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-dialog" style="max-width: 400px;">
                <div class="modal-header">
                    <h3>调整执行时间</h3>
                    <button class="modal-close" id="editTimeModalClose">${Utils.icon('x', 14)}</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>任务名称</label>
                        <input type="text" class="form-control" value="${escapeHtml(displayName)}" readonly>
                    </div>
                    <div class="form-group">
                        <label>执行时间 <span class="required">*</span></label>
                        <input type="datetime-local" class="form-control" id="newScheduledTime" 
                            value="${formatDateTimeLocal(scheduledTime)}">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="editTimeModalCancel">取消</button>
                    <button class="btn btn-primary" id="editTimeModalConfirm">确认</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 绑定事件
        document.getElementById('editTimeModalClose').onclick = () => modal.remove();
        document.getElementById('editTimeModalCancel').onclick = () => modal.remove();
        document.getElementById('editTimeModalConfirm').onclick = async () => {
            const newTime = document.getElementById('newScheduledTime').value;
            if (!newTime) {
                showError('请选择执行时间');
                return;
            }

            // 验证时间不能是过去
            const selectedTime = new Date(newTime);
            const currentTime = new Date();
            if (selectedTime <= currentTime) {
                showError('执行时间必须晚于当前时间');
                return;
            }

            try {
                if (type === 'regular') {
                    if (taskService && taskService.updateScheduledTime) {
                        await taskService.updateScheduledTime(id, new Date(newTime).toISOString());
                    }
                } else if (type === 'project') {
                    // 工程任务暂不支持调整时间，可以通过取消后重新创建
                    showError('工程任务暂不支持调整时间，请取消后重新设置');
                    modal.remove();
                    return;
                }
                showSuccess('执行时间已更新');
                modal.remove();
                await loadScheduledTasks();
            } catch (error) {
                console.error('更新执行时间失败:', error);
                showError('更新失败: ' + error.message);
            }
        };

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    // 格式化为 datetime-local 格式
    function formatDateTimeLocal(dateStr) {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        } catch (e) {
            return '';
        }
    }

    // 取消任务
    async function handleCancel(type, id) {
        if (!confirm('确定要取消此定时任务吗？')) return;

        try {
            if (type === 'regular') {
                if (taskService && taskService.deleteTask) {
                    await taskService.deleteTask(id);
                }
            } else if (type === 'project') {
                if (projectTaskService && projectTaskService.cancelSchedule) {
                    await projectTaskService.cancelSchedule(id);
                }
            }
            showSuccess('任务已取消');
            await loadScheduledTasks();
        } catch (error) {
            console.error('取消任务失败:', error);
            showError('取消失败: ' + error.message);
        }
    }

    // 启动自动刷新
    function startAutoRefresh() {
        stopAutoRefresh();
        autoRefreshTimer = setInterval(() => {
            // 只在任务调度页面可见时刷新
            const page = document.getElementById('page-scheduled');
            if (page && page.style.display !== 'none') {
                loadScheduledTasks();
            }
        }, 30000); // 每30秒刷新一次
    }

    // 停止自动刷新
    function stopAutoRefresh() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }

    // 显示成功消息
    function showSuccess(msg) {
        if (window.Utils && window.Utils.notify) {
            window.Utils.notify.success(msg);
        } else {
            alert(msg);
        }
    }

    // 显示错误消息
    function showError(msg) {
        if (window.Utils && window.Utils.notify) {
            window.Utils.notify.error(msg);
        } else {
            alert('错误: ' + msg);
        }
    }

    // 公共API
    return {
        init,
        loadScheduledTasks,
        startAutoRefresh,
        stopAutoRefresh
    };
})();

// 导出到全局
if (typeof window !== 'undefined') {
    window.scheduledTasksModule = ScheduledTasksModule;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScheduledTasksModule;
}
