const { TaskModel, ProjectExecutionModel } = require('../database/models');
const { TaskExecutor } = require('./taskExecutor');

/**
 * 任务调度器
 * 负责定时检查和自动执行scheduled状态的任务（包含工程任务）
 */
class TaskScheduler {
    constructor() {
        this.checkInterval = 60 * 1000; // 每分钟检查一次
        this.timer = null;
        this.taskExecutor = null;
        this.projectTaskExecutor = null;
        this.isRunning = false;
        this.missedTaskThreshold = 60 * 60 * 1000; // 错过任务的时间阈值（1小时）
        this.executedTasks = new Set(); // 记录已执行的任务ID，防止重复执行
        this.executedProjectExecutions = new Set(); // 记录已触发的工程execution ID
    }

    /**
     * 启动调度器
     * @param {TaskExecutor} taskExecutor - 任务执行器实例
     * @param {ProjectTaskExecutor} [projectTaskExecutor] - 工程任务执行器实例（可选）
     */
    start(taskExecutor, projectTaskExecutor) {
        if (this.isRunning) {
            console.log('任务调度器已在运行中');
            return;
        }

        this.taskExecutor = taskExecutor;
        this.projectTaskExecutor = projectTaskExecutor || null;
        this.isRunning = true;
        
        console.log('任务调度器已启动，检查间隔:', this.checkInterval / 1000, '秒');
        
        // 立即执行一次检查
        this.checkScheduledTasks();
        this.checkScheduledProjectExecutions();
        
        // 设置定时器
        this.timer = setInterval(() => {
            this.checkScheduledTasks();
            this.checkScheduledProjectExecutions();
        }, this.checkInterval);
    }

    /**
     * 停止调度器
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.isRunning = false;
        console.log('任务调度器已停止');
    }

    /**
     * 检查并执行到期的定时任务
     */
    async checkScheduledTasks() {
        try {
            // 获取所有scheduled状态的任务
            const allTasks = await TaskModel.findAll();
            const scheduledTasks = allTasks.filter(task => task.status === 'scheduled');
            
            if (scheduledTasks.length === 0) {
                return;
            }

            console.log(`发现 ${scheduledTasks.length} 个待执行的定时任务`);

            const now = new Date();
            
            for (const task of scheduledTasks) {
                // 检查是否到达执行时间
                const executeDecision = this.shouldExecute(task, now);
                
                if (executeDecision.shouldExecute) {
                    console.log(`定时任务 ${task.id} (${task.task_name}) 已到达执行时间，开始执行...`);
                    await this.executeScheduledTask(task);
                } else if (executeDecision.isMissed) {
                    console.warn(`定时任务 ${task.id} (${task.task_name}) 已过期 (计划时间: ${task.scheduled_time})，标记为错过`);
                    await this.markTaskAsMissed(task, executeDecision.delayMinutes);
                }
            }
        } catch (error) {
            console.error('检查定时任务失败:', error);
        }
    }

    /**
     * 判断任务是否应该执行
     * @param {Object} task - 任务对象
     * @param {Date} now - 当前时间
     * @returns {Object} { shouldExecute: boolean, isMissed: boolean, delayMinutes: number }
     */
    shouldExecute(task, now) {
        if (!task.scheduled_time) {
            return { shouldExecute: false, isMissed: false, delayMinutes: 0 };
        }

        // 检查是否已经执行过（防止重复执行）
        if (this.executedTasks.has(task.id)) {
            console.log(`任务 ${task.id} 已经执行过，跳过`);
            return { shouldExecute: false, isMissed: false, delayMinutes: 0 };
        }

        const scheduledTime = new Date(task.scheduled_time);
        const delayMs = now - scheduledTime; // 延迟时间（毫秒）
        const delayMinutes = Math.floor(delayMs / (60 * 1000)); // 延迟时间（分钟）
        
        // 还没到执行时间
        if (scheduledTime > now) {
            return { shouldExecute: false, isMissed: false, delayMinutes: 0 };
        }
        
        // 已经到达执行时间，但检查是否过期
        if (delayMs > this.missedTaskThreshold) {
            // 超过阈值，标记为错过
            return { shouldExecute: false, isMissed: true, delayMinutes };
        }
        
        // 在允许的时间窗口内，可以执行
        if (delayMinutes > 0) {
            console.log(`任务 ${task.id} 已延迟 ${delayMinutes} 分钟，但仍在允许范围内，将执行`);
        }
        
        return { shouldExecute: true, isMissed: false, delayMinutes };
    }

    /**
     * 执行定时任务
     * @param {Object} task - 任务对象
     */
    async executeScheduledTask(task) {
        try {
            if (!this.taskExecutor) {
                throw new Error('任务执行器未初始化');
            }

            // 标记为已执行（防止重复执行）
            this.executedTasks.add(task.id);

            // 解析参数
            const parameters = task.parameters || {};
            const concurrency = parameters.concurrency || 1;
            const timeout = parameters.timeout || 300000;
            const useSudo = parameters.useSudo || false;

            // 更新任务状态为running
            await TaskModel.update(task.id, { 
                status: 'running',
                start_time: new Date().toISOString()
            });

            // 执行任务
            const result = await this.taskExecutor.executeTask(task.id, {
                concurrency,
                timeout,
                useSudo
            });

            console.log(`定时任务 ${task.id} 执行完成:`, result);
            
            // 执行完成后从已执行集合中移除（允许再次调度）
            // 注意：如果是一次性任务，不应该移除
            // 这里保留以防止同一调度周期内重复执行
            
        } catch (error) {
            console.error(`定时任务 ${task.id} 执行失败:`, error);
            
            // 更新任务状态为failed
            await TaskModel.update(task.id, { 
                status: 'failed',
                end_time: new Date().toISOString()
            });
        }
    }

    /**
     * 检查并执行到期的定时工程任务
     */
    async checkScheduledProjectExecutions() {
        if (!this.projectTaskExecutor) return;
        try {
            const scheduled = await ProjectExecutionModel.findScheduled();
            if (scheduled.length === 0) return;

            console.log(`发现 ${scheduled.length} 个待执行的定时工程`);
            const now = new Date();

            for (const execution of scheduled) {
                if (this.executedProjectExecutions.has(execution.id)) continue;
                if (!execution.scheduled_time) continue;

                const scheduledTime = new Date(execution.scheduled_time);
                const delayMs = now - scheduledTime;

                if (scheduledTime > now) continue; // 未到时间

                if (delayMs > this.missedTaskThreshold) {
                    // 超时，标记为 missed
                    this.executedProjectExecutions.add(execution.id);
                    await ProjectExecutionModel.update(execution.id, {
                        status: 'missed',
                        end_time: new Date().toISOString()
                    });
                    console.warn(`工程执行 ${execution.id} 已超时，标记为 missed`);
                    continue;
                }

                // 触发执行
                this.executedProjectExecutions.add(execution.id);
                console.log(`定时工程执行 ${execution.id} 已到时间，开始执行...`);
                this.projectTaskExecutor.executeScheduled(execution.id).catch(err => {
                    console.error(`定时工程执行 ${execution.id} 失败:`, err);
                });
            }
        } catch (error) {
            console.error('检查定时工程执行失败:', error);
        }
    }

    /**
     * 标记任务为错过
     * @param {Object} task - 任务对象
     * @param {number} delayMinutes - 延迟的分钟数
     */
    async markTaskAsMissed(task, delayMinutes) {
        try {
            // 标记为已执行（防止重复检查）
            this.executedTasks.add(task.id);
            
            // 更新任务状态为 missed
            await TaskModel.update(task.id, {
                status: 'missed',
                end_time: new Date().toISOString()
            });
            
            console.log(`任务 ${task.id} 已标记为错过（延迟 ${delayMinutes} 分钟，超过阈值 ${this.missedTaskThreshold / 60000} 分钟）`);
        } catch (error) {
            console.error(`标记任务 ${task.id} 为错过失败:`, error);
        }
    }

    /**
     * 获取调度器状态
     * @returns {Object}
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            checkInterval: this.checkInterval,
            missedTaskThreshold: this.missedTaskThreshold,
            executedTasksCount: this.executedTasks.size
        };
    }

    /**
     * 设置检查间隔
     * @param {number} interval - 间隔时间（毫秒）
     */
    setCheckInterval(interval) {
        if (interval < 1000) {
            throw new Error('检查间隔不能小于1秒');
        }

        this.checkInterval = interval;
        
        // 如果正在运行，重新启动以应用新的间隔
        // 注意：必须同时传回 projectTaskExecutor，否则定时工程将永久停止检查
        if (this.isRunning) {
            this.stop();
            this.start(this.taskExecutor, this.projectTaskExecutor);
        }
    }

    /**
     * 设置错过任务的时间阈值
     * @param {number} thresholdMinutes - 阈值（分钟）
     */
    setMissedTaskThreshold(thresholdMinutes) {
        if (thresholdMinutes < 1) {
            throw new Error('阈值不能小于1分钟');
        }
        this.missedTaskThreshold = thresholdMinutes * 60 * 1000;
        console.log(`错过任务阈值已设置为 ${thresholdMinutes} 分钟`);
    }

    /**
     * 清理已执行任务记录
     */
    clearExecutedTasks() {
        const count = this.executedTasks.size;
        this.executedTasks.clear();
        console.log(`已清理 ${count} 条已执行任务记录`);
    }
}

module.exports = { TaskScheduler };
