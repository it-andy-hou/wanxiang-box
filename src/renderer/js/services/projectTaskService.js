/**
 * 工程任务渲染层服务
 * 封装所有工程任务相关的 IPC 调用
 */
class ProjectTaskService {
    constructor() {
        try {
            const { ipcRenderer } = require('electron');
            this.ipc = ipcRenderer;
        } catch (e) {
            console.warn('IPC不可用:', e);
            this.ipc = null;
        }
    }

    // ==================== 工程任务 CRUD ====================

    async createProjectTask(data) {
        return await this.ipc.invoke('project-task:create', data);
    }

    async updateProjectTask(id, data) {
        return await this.ipc.invoke('project-task:update', id, data);
    }

    /**
     * 原子化保存工程任务（性能优化版本）
     * 一次性提交工程任务和所有步骤，只触发一次磁盘写入
     * @param {Object} data - 包含 id（可选）和工程任务数据
     * @returns {Promise<Object>} 保存后的工程任务
     */
    async saveAll(data) {
        return await this.ipc.invoke('project-task:save-all', data);
    }

    async deleteProjectTask(id) {
        return await this.ipc.invoke('project-task:delete', id);
    }

    async getProjectTaskById(id) {
        return await this.ipc.invoke('project-task:getById', id);
    }

    async getAllProjectTasks(options = {}) {
        return await this.ipc.invoke('project-task:getAll', options);
    }

    // ==================== 复制工程 ====================

    async duplicate(projectTaskId) {
        return await this.ipc.invoke('project-task:duplicate', projectTaskId);
    }

    // ==================== 步骤管理 ====================

    async addStep(projectTaskId, stepData) {
        return await this.ipc.invoke('project-step:add', projectTaskId, stepData);
    }

    async updateStep(stepId, stepData) {
        return await this.ipc.invoke('project-step:update', stepId, stepData);
    }

    async deleteStep(stepId) {
        return await this.ipc.invoke('project-step:delete', stepId);
    }

    async reorderSteps(projectTaskId, stepOrders) {
        return await this.ipc.invoke('project-step:reorder', projectTaskId, stepOrders);
    }

    // ==================== 执行控制 ====================

    async execute(projectTaskId, options = {}) {
        return await this.ipc.invoke('project-execution:execute', projectTaskId, options);
    }

    async stopExecution(executionId) {
        return await this.ipc.invoke('project-execution:stop', executionId);
    }

    async getExecutionHistory(projectTaskId) {
        return await this.ipc.invoke('project-execution:getHistory', projectTaskId);
    }

    async getExecutionDetails(executionId) {
        return await this.ipc.invoke('project-execution:getDetails', executionId);
    }

    // ==================== 定时执行 ====================

    async scheduleExecution(projectTaskId, scheduledTime) {
        return await this.ipc.invoke('project-execution:schedule', projectTaskId, scheduledTime);
    }

    async cancelSchedule(executionId) {
        return await this.ipc.invoke('project-execution:cancelSchedule', executionId);
    }

    async getScheduledExecutions() {
        return await this.ipc.invoke('project-execution:getScheduled');
    }

    // ==================== Webhook 测试 ====================

    async testWebhook(webhookUrl) {
        return await this.ipc.invoke('project-task:testWebhook', webhookUrl);
    }

    // ==================== 事件监听 ====================

    /**
     * 监听执行进度推送
     * @param {Function} callback
     */
    onExecutionProgress(callback) {
        if (this.ipc) {
            this.ipc.removeAllListeners('project-execution:progress');
            this.ipc.on('project-execution:progress', (event, data) => callback(data));
        }
    }

    /**
     * 监听步骤完成事件
     * @param {Function} callback
     */
    onStepComplete(callback) {
        if (this.ipc) {
            this.ipc.removeAllListeners('project-execution:stepComplete');
            this.ipc.on('project-execution:stepComplete', (event, data) => callback(data));
        }
    }

    /**
     * 监听工程执行完成事件
     * @param {Function} callback
     */
    onExecutionComplete(callback) {
        if (this.ipc) {
            this.ipc.removeAllListeners('project-execution:complete');
            this.ipc.on('project-execution:complete', (event, data) => callback(data));
        }
    }

    /**
     * 监听工程执行停止事件
     * @param {Function} callback
     */
    onExecutionStopped(callback) {
        if (this.ipc) {
            this.ipc.removeAllListeners('project-execution:stopped');
            this.ipc.on('project-execution:stopped', (event, data) => callback(data));
        }
    }

    /**
     * 移除所有工程执行事件监听
     */
    offAllExecutionListeners() {
        if (this.ipc) {
            this.ipc.removeAllListeners('project-execution:progress');
            this.ipc.removeAllListeners('project-execution:stepComplete');
            this.ipc.removeAllListeners('project-execution:complete');
            this.ipc.removeAllListeners('project-execution:stopped');
        }
    }
}

if (typeof window !== 'undefined') {
    window.ProjectTaskService = ProjectTaskService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProjectTaskService;
}
