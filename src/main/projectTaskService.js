const {
    ProjectTaskModel,
    ProjectStepModel,
    ProjectExecutionModel,
    ProjectStepExecutionModel
} = require('../database/models');
const { getDatabase } = require('../database/simple-db');

/**
 * 工程任务服务 - 负责 CRUD 和模板管理
 */
class ProjectTaskService {

    // ==================== 工程任务 CRUD ====================

    async getAllProjectTasks(options = {}) {
        return await ProjectTaskModel.findAll(options);
    }

    async getProjectTaskById(id) {
        const task = await ProjectTaskModel.findById(id);
        if (!task) return null;
        // 同时返回步骤
        task.steps = await ProjectStepModel.findByProjectTaskId(id);
        return task;
    }

    async createProjectTask(data) {
        const task = await ProjectTaskModel.create(data);
        // 如果包含步骤则一并创建，并建立 _tempId → 真实 step.id 映射
        if (data.steps && data.steps.length > 0) {
            // 第一轮：创建所有步骤，收集映射表
            const tempIdToRealId = new Map();
            const createdSteps = [];
            for (let i = 0; i < data.steps.length; i++) {
                const stepData = { ...data.steps[i], project_task_id: task.id, step_order: i, depends_on: [] };
                const created = await ProjectStepModel.create(stepData);
                createdSteps.push({ created, original: data.steps[i] });
                // 将前端 _tempId 映射到真实数据库 ID
                if (data.steps[i]._tempId) {
                    tempIdToRealId.set(String(data.steps[i]._tempId), created.id);
                }
                // 旧工程编辑时属步骤有真实 id，也建立映射
                if (data.steps[i].id) {
                    tempIdToRealId.set(String(data.steps[i].id), created.id);
                }
            }
            // 第二轮：用真实 ID 更新每个步骤的 depends_on
            for (const { created, original } of createdSteps) {
                const rawDeps = original.depends_on || [];
                if (rawDeps.length > 0) {
                    const resolvedDeps = rawDeps.map(d => {
                        const realId = tempIdToRealId.get(String(d));
                        return realId !== undefined ? realId : parseInt(d);
                    }).filter(d => !isNaN(d));
                    await ProjectStepModel.update(created.id, { depends_on: resolvedDeps });
                }
            }
        }
        return this.getProjectTaskById(task.id);
    }

    async updateProjectTask(id, data) {
        await ProjectTaskModel.update(id, data);
        // 如果包含步骤则同步更新：先删除旧步骤再重建
        if (data.steps !== undefined) {
            const db_steps = await ProjectStepModel.findByProjectTaskId(id);
            for (const s of db_steps) {
                await ProjectStepModel.delete(s.id);
            }
            // 第一轮：创建步骤
            const tempIdToRealId = new Map();
            const createdSteps = [];
            for (let i = 0; i < data.steps.length; i++) {
                const stepData = { ...data.steps[i], project_task_id: parseInt(id), step_order: i, depends_on: [] };
                const created = await ProjectStepModel.create(stepData);
                createdSteps.push({ created, original: data.steps[i] });
                if (data.steps[i]._tempId) {
                    tempIdToRealId.set(String(data.steps[i]._tempId), created.id);
                }
                if (data.steps[i].id) {
                    tempIdToRealId.set(String(data.steps[i].id), created.id);
                }
            }
            // 第二轮：更新 depends_on
            for (const { created, original } of createdSteps) {
                const rawDeps = original.depends_on || [];
                if (rawDeps.length > 0) {
                    const resolvedDeps = rawDeps.map(d => {
                        const realId = tempIdToRealId.get(String(d));
                        return realId !== undefined ? realId : parseInt(d);
                    }).filter(d => !isNaN(d));
                    await ProjectStepModel.update(created.id, { depends_on: resolvedDeps });
                }
            }
        }
        return this.getProjectTaskById(id);
    }

    async deleteProjectTask(id) {
        return await ProjectTaskModel.delete(id);
    }

    async duplicateProjectTask(id) {
        const task = await this.getProjectTaskById(id);
        if (!task) throw new Error('工程任务不存在');
        const newData = {
            name: `${task.name} (副本)`,
            description: task.description,
            is_template: 0,
            notify_webhook: task.notify_webhook,
            notify_on_success: task.notify_on_success,
            notify_on_failure: task.notify_on_failure,
            notify_on_interrupt: task.notify_on_interrupt,
            steps: (task.steps || []).map(s => ({
                id: s.id,
                step_name: s.step_name,
                step_type: s.step_type,
                host_ids: s.host_ids,
                config: s.config,
                depends_on: s.depends_on,
                timeout: s.timeout,
                step_order: s.step_order
            }))
        };
        return await this.createProjectTask(newData);
    }

    // ==================== 步骤管理 ====================

    async addStep(projectTaskId, stepData) {
        // 自动计算排序序号
        const existing = await ProjectStepModel.findByProjectTaskId(projectTaskId);
        const maxOrder = existing.reduce((max, s) => Math.max(max, s.step_order), -1);
        const data = { ...stepData, project_task_id: projectTaskId, step_order: maxOrder + 1 };
        return await ProjectStepModel.create(data);
    }

    async updateStep(stepId, stepData) {
        return await ProjectStepModel.update(stepId, stepData);
    }

    async deleteStep(stepId) {
        return await ProjectStepModel.delete(stepId);
    }

    async reorderSteps(projectTaskId, stepOrders) {
        return await ProjectStepModel.reorder(projectTaskId, stepOrders);
    }

    // ==================== 执行记录 ====================

    async getExecutionHistory(projectTaskId) {
        const executions = await ProjectExecutionModel.findByProjectTaskId(projectTaskId);
        return executions;
    }

    async getExecutionDetails(executionId) {
        const execution = await ProjectExecutionModel.findById(executionId);
        if (!execution) return null;
        const stepExecs = await ProjectStepExecutionModel.findByExecutionId(executionId);
        // 关联查询步骤名称和类型
        const allSteps = await ProjectStepModel.findByProjectTaskId(execution.project_task_id);
        const stepMap = new Map(allSteps.map(s => [s.id, s]));
        execution.step_executions = stepExecs.map(se => ({
            ...se,
            step_name: stepMap.get(se.step_id)?.step_name || `步骤 #${se.step_id}`,
            step_type: stepMap.get(se.step_id)?.step_type || ''
        }));
        return execution;
    }

    async scheduleExecution(projectTaskId, scheduledTime) {
        const task = await ProjectTaskModel.findById(projectTaskId);
        if (!task) throw new Error('工程任务不存在');

        const steps = await ProjectStepModel.findByProjectTaskId(projectTaskId);
        const execution = await ProjectExecutionModel.create({
            project_task_id: projectTaskId,
            status: 'scheduled',
            execution_type: 'scheduled',
            scheduled_time: scheduledTime,
            total_steps: steps.length
        });
        return execution;
    }

    async cancelSchedule(executionId) {
        return await ProjectExecutionModel.update(executionId, { status: 'cancelled' });
    }

    async getScheduledExecutions() {
        const executions = await ProjectExecutionModel.findScheduled();
        // 关联查询工程任务名称
        for (const exec of executions) {
            const task = await ProjectTaskModel.findById(exec.project_task_id);
            exec.project_name = task ? task.name : `工程 #${exec.project_task_id}`;
        }
        return executions;
    }

    // 获取最后一次执行信息（用于列表展示）
    async getLastExecution(projectTaskId) {
        const executions = await ProjectExecutionModel.findByProjectTaskId(projectTaskId);
        return executions.length > 0 ? executions[0] : null;
    }

    // ==================== 原子化批量保存（性能优化） ====================

    /**
     * 原子化保存工程任务及其所有步骤
     * 使用批量操作模式，只触发一次磁盘写入，大幅提升性能
     * @param {Object} data - 包含工程任务数据和步骤数组
     * @param {number|null} id - 工程任务ID（null表示新建）
     * @returns {Promise<Object>} 保存后的工程任务对象
     */
    async saveProjectTaskAtomic(data, id = null) {
        const db = getDatabase();
        const startTime = Date.now();
        
        // 进入批量操作模式
        db.beginBatch();
        
        try {
            let taskId;
            
            // 1. 保存工程任务基本信息
            if (id) {
                // 更新现有工程
                await ProjectTaskModel.update(id, data);
                taskId = parseInt(id);
                
                // 删除旧步骤（批量模式下不触发保存）
                const oldSteps = await ProjectStepModel.findByProjectTaskId(taskId);
                for (const step of oldSteps) {
                    const index = db.getTable('project_steps').findIndex(s => s.id === step.id);
                    if (index !== -1) {
                        db.getTable('project_steps').splice(index, 1);
                    }
                }
            } else {
                // 创建新工程
                const newTask = await ProjectTaskModel.create(data);
                taskId = newTask.id;
            }
            
            // 2. 批量创建步骤
            if (data.steps && data.steps.length > 0) {
                const tempIdToRealId = new Map();
                const createdSteps = [];
                
                // 第一轮：创建所有步骤（无依赖关系）
                for (let i = 0; i < data.steps.length; i++) {
                    const stepData = {
                        ...data.steps[i],
                        project_task_id: taskId,
                        step_order: i,
                        depends_on: []
                    };
                    
                    // 直接使用 db.insert 但利用批量模式避免重复保存
                    const created = await ProjectStepModel.create(stepData);
                    createdSteps.push({ created, original: data.steps[i] });
                    
                    // 建立 ID 映射
                    if (data.steps[i]._tempId) {
                        tempIdToRealId.set(String(data.steps[i]._tempId), created.id);
                    }
                    if (data.steps[i].id) {
                        tempIdToRealId.set(String(data.steps[i].id), created.id);
                    }
                }
                
                // 第二轮：更新依赖关系
                for (const { created, original } of createdSteps) {
                    const rawDeps = original.depends_on || [];
                    if (rawDeps.length > 0) {
                        const resolvedDeps = rawDeps.map(d => {
                            const realId = tempIdToRealId.get(String(d));
                            return realId !== undefined ? realId : parseInt(d);
                        }).filter(d => !isNaN(d));
                        
                        if (resolvedDeps.length > 0) {
                            await ProjectStepModel.update(created.id, { depends_on: resolvedDeps });
                        }
                    }
                }
            }
            
            // 3. 一次性提交所有更改
            await db.commit();
            
            console.log(`工程任务原子保存完成，耗时: ${Date.now() - startTime}ms`);
            
            // 返回完整的工程任务数据
            return await this.getProjectTaskById(taskId);
            
        } catch (error) {
            // 出错时回滚
            console.error('工程任务原子保存失败，执行回滚:', error);
            db.rollback();
            throw error;
        }
    }
}

module.exports = { ProjectTaskService };
