// 任务执行服务
class TaskService {
    constructor() {
        // 由于contextIsolation: false，直接使用require
        try {
            const { ipcRenderer } = require('electron');
            this.ipc = ipcRenderer;
        } catch (error) {
            console.warn('IPC不可用:', error);
            this.ipc = null;
        }
    }

    /**
     * 创建新任务
     * @param {Object} taskData - 任务数据
     * @returns {Promise<Object>} 创建的任务
     */
    async createTask(taskData) {
        if (this.ipc) {
            return await this.ipc.invoke('task:create', taskData);
        }
        throw new Error('IPC不可用');
    }

    /**
     * 执行任务
     * @param {number} taskId - 任务ID
     * @param {Object} options - 执行选项
     * @returns {Promise<Object>} 执行结果
     */
    async executeTask(taskId, options = {}) {
        if (this.ipc) {
            return await this.ipc.invoke('task:execute', taskId, options);
        }
        throw new Error('IPC不可用');
    }

    /**
     * 获取任务列表
     * @returns {Promise<Array>} 任务列表
     */
    async getTasks() {
        if (this.ipc) {
            return await this.ipc.invoke('task:getAll');
        }
        return [];
    }

    /**
     * 获取任务详情
     * @param {number} taskId - 任务ID
     * @returns {Promise<Object>} 任务详情
     */
    async getTask(taskId) {
        if (this.ipc) {
            return await this.ipc.invoke('task:getById', taskId);
        }
        throw new Error('IPC不可用');
    }

    /**
     * 获取任务执行结果
     * @param {number} taskId - 任务ID
     * @returns {Promise<Array>} 任务执行结果列表
     */
    async getTaskResults(taskId) {
        if (this.ipc) {
            return await this.ipc.invoke('task:getResults', taskId);
        }
        return [];
    }

    /**
     * 停止任务执行
     * @param {number} taskId - 任务ID
     * @returns {Promise<boolean>} 是否停止成功
     */
    async stopTask(taskId) {
        if (this.ipc) {
            return await this.ipc.invoke('task:stop', taskId);
        }
        throw new Error('IPC不可用');
    }

    /**
     * 删除任务
     * @param {number} taskId - 任务ID
     * @returns {Promise<boolean>} 是否删除成功
     */
    async deleteTask(taskId) {
        if (this.ipc) {
            return await this.ipc.invoke('task:delete', taskId);
        }
        throw new Error('IPC不可用');
    }

    /**
     * 导出任务结果
     * @param {number} taskId - 任务ID
     * @param {string} format - 导出格式 (csv/json/excel)
     * @returns {Promise<string>} 导出文件路径
     */
    async exportResults(taskId, format = 'csv') {
        if (this.ipc) {
            return await this.ipc.invoke('task:exportResults', taskId, format);
        }
        throw new Error('IPC不可用');
    }

    /**
     * 监听任务执行进度
     * @param {number} taskId - 任务ID
     * @param {Function} callback - 进度回调函数
     */
    onTaskProgress(taskId, callback) {
        if (this.ipc) {
            // 先移除已有的监听器，避免重复监听
            this.ipc.removeAllListeners(`task:progress:${taskId}`);
            this.ipc.on(`task:progress:${taskId}`, (event, data) => {
                callback(data);
            });
        }
    }

    /**
     * 移除任务进度监听
     * @param {number} taskId - 任务ID
     */
    offTaskProgress(taskId) {
        if (this.ipc) {
            this.ipc.removeAllListeners(`task:progress:${taskId}`);
        }
    }

    /**
     * 监听任务状态变化
     * @param {Function} callback - 状态变化回调函数
     */
    onTaskStatusChange(callback) {
        if (this.ipc) {
            // 先移除已有的监听器，避免重复监听
            this.ipc.removeAllListeners('task:statusChange');
            this.ipc.on('task:statusChange', (event, data) => {
                callback(data);
            });
        }
    }

    /**
     * 移除任务状态监听
     */
    offTaskStatusChange() {
        if (this.ipc) {
            this.ipc.removeAllListeners('task:statusChange');
        }
    }

    /**
     * 获取定时任务列表
     * @returns {Promise<Array>} 定时任务列表
     */
    async getScheduledTasks() {
        if (this.ipc) {
            return await this.ipc.invoke('task:getScheduled');
        }
        return [];
    }

    /**
     * 更新定时任务
     * @param {number} taskId - 任务ID
     * @param {Object} taskData - 任务数据
     * @returns {Promise<Object>} 更新后的任务
     */
    async updateScheduledTask(taskId, taskData) {
        if (this.ipc) {
            return await this.ipc.invoke('task:updateScheduled', taskId, taskData);
        }
        throw new Error('IPC不可用');
    }

    /**
     * 调整定时任务执行时间
     * @param {number} taskId - 任务ID
     * @param {string} scheduledTime - 新的执行时间 (ISO 8601格式)
     * @returns {Promise<Object>} 更新后的任务
     */
    async updateScheduledTime(taskId, scheduledTime) {
        if (this.ipc) {
            return await this.ipc.invoke('task:updateScheduledTime', taskId, scheduledTime);
        }
        throw new Error('IPC不可用');
    }

    /**
     * 立即执行定时任务
     * @param {number} taskId - 任务ID
     * @returns {Promise<Object>} 执行结果
     */
    async executeScheduledTaskNow(taskId) {
        if (this.ipc) {
            return await this.ipc.invoke('task:executeScheduledNow', taskId);
        }
        throw new Error('IPC不可用');
    }
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.TaskService = TaskService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaskService;
}
