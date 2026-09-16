const EventEmitter = require('events');
const {
    ProjectExecutionModel,
    ProjectStepExecutionModel,
    ProjectTaskModel,
    ProjectStepModel,
    HostModel,
    ScriptModel
} = require('../database/models');
const { SSHService } = require('./sshService');
const { NodeSSH } = require('node-ssh');

/**
 * 工程任务执行引擎
 * 支持步骤依赖关系、严格模式（失败即停）、串并行执行
 */
class ProjectTaskExecutor extends EventEmitter {
    constructor(options = {}) {
        super();
        this.sshService = options.sshService || new SSHService();
        this.stopFlags = new Map();     // executionId -> boolean
        this.activeExecutions = new Map(); // executionId -> { stepPromises }
        this.activeConnections = new Map(); // executionId -> Map(hostId, connection)
    }

    /**
     * 执行工程任务（手动触发）
     */
    async execute(projectTaskId, options = {}) {
        const task = await ProjectTaskModel.findById(parseInt(projectTaskId));
        if (!task) throw new Error(`工程任务不存在: ${projectTaskId}`);

        const steps = await ProjectStepModel.findByProjectTaskId(parseInt(projectTaskId));
        if (steps.length === 0) throw new Error('工程任务没有配置步骤');

        // 创建执行记录
        const execution = await ProjectExecutionModel.create({
            project_task_id: parseInt(projectTaskId),
            status: 'pending',
            execution_type: options.execution_type || 'manual',
            scheduled_time: options.scheduled_time || null,
            total_steps: steps.length
        });

        // 异步执行（不阻塞 IPC 返回）
        this._runExecution(execution.id, task, steps).catch(err => {
            console.error(`工程执行 ${execution.id} 发生未捕获错误:`, err);
        });

        return { executionId: execution.id, status: 'started' };
    }

    /**
     * 执行已创建的定时工程记录
     */
    async executeScheduled(executionId) {
        const execution = await ProjectExecutionModel.findById(parseInt(executionId));
        if (!execution) throw new Error(`执行记录不存在: ${executionId}`);

        const task = await ProjectTaskModel.findById(execution.project_task_id);
        if (!task) throw new Error(`工程任务不存在: ${execution.project_task_id}`);

        const steps = await ProjectStepModel.findByProjectTaskId(execution.project_task_id);

        await ProjectExecutionModel.update(executionId, {
            status: 'pending',
            total_steps: steps.length
        });

        this._runExecution(executionId, task, steps).catch(err => {
            console.error(`定时工程执行 ${executionId} 发生未捕获错误:`, err);
        });
    }

    /**
     * 停止执行
     */
    async stopExecution(executionId) {
        const execId = parseInt(executionId);
        this.stopFlags.set(execId, true);
        
        // 强制关闭所有活动连接
        const connections = this.activeConnections.get(execId);
        if (connections) {
            for (const [hostId, connection] of connections) {
                try {
                    if (connection) await connection.dispose();
                } catch (e) {
                    console.warn(`停止执行时关闭连接失败 [host:${hostId}]:`, e.message);
                }
            }
            this.activeConnections.delete(execId);
        }
        
        await ProjectExecutionModel.update(executionId, {
            status: 'interrupted',
            completed_at: new Date().toISOString(),
            error_message: '用户手动中止'
        });
        this.emit('execution:stopped', { executionId });
        return true;
    }

    // ==================== 内部执行逻辑 ====================

    async _runExecution(executionId, task, steps) {
        executionId = parseInt(executionId);
        if (!this.stopFlags.get(executionId)) {
            this.stopFlags.set(executionId, false);
        }

        // 更新状态为运行中
        await ProjectExecutionModel.update(executionId, {
            status: 'running',
            started_at: new Date().toISOString()
        });

        this.emit('execution:progress', {
            executionId,
            type: 'start',
            message: `工程 [${task.name}] 开始执行，共 ${steps.length} 个步骤`
        });

        // 构建依赖图: stepId -> [依赖的stepId列表]
        // 注意：确保所有ID都是数字类型进行匹配
        const validStepIds = new Set(steps.map(s => parseInt(s.id)));
        const stepIdMap = new Map(steps.map(s => [parseInt(s.id), s]));
        const dependencyGraph = new Map();
        for (const step of steps) {
            const stepId = parseInt(step.id);
            const rawDeps = step.depends_on || [];
            const validDeps = rawDeps
                .map(d => parseInt(d))
                .filter(d => !isNaN(d) && validStepIds.has(d) && d !== stepId);
            dependencyGraph.set(stepId, validDeps);
        }

        // 初始化步骤执行记录 - 统一使用数字类型的stepId
        const stepExecMap = new Map(); // stepId (number) -> stepExecRecord
        for (const step of steps) {
            const stepIdNum = parseInt(step.id);
            const stepExec = await ProjectStepExecutionModel.create({
                project_execution_id: executionId,
                step_id: stepIdNum,
                status: 'pending'
            });
            stepExecMap.set(stepIdNum, stepExec);
        }

        const completedSteps = new Set();  // 成功完成的步骤 (存储数字ID)
        const failedSteps = new Set();     // 失败的步骤 (存储数字ID)
        const skippedSteps = new Set();    // 跳过的步骤 (存储数字ID) - 新增
        const runningSteps = new Map();    // stepId (number) -> promise

        let completedCount = 0;
        let overallStatus = 'completed';
        let errorMessage = '';

        try {
            // 执行循环：直到所有步骤都处理完
            while (completedSteps.size + failedSteps.size + skippedSteps.size < steps.length) {
                // 检查停止标志
                if (this.stopFlags.get(executionId)) {
                    overallStatus = 'interrupted';
                    errorMessage = '用户手动中止';
                    // 标记所有 pending 步骤为 skipped
                    for (const step of steps) {
                        const stepIdNum = parseInt(step.id);
                        if (!completedSteps.has(stepIdNum) && !failedSteps.has(stepIdNum) && 
                            !runningSteps.has(stepIdNum) && !skippedSteps.has(stepIdNum)) {
                            const stepExec = stepExecMap.get(stepIdNum);
                            if (stepExec) {
                                await ProjectStepExecutionModel.update(stepExec.id, { status: 'skipped' });
                                skippedSteps.add(stepIdNum);
                            }
                        }
                    }
                    break;
                }

                // 严格模式：有步骤失败则停止
                if (failedSteps.size > 0 && runningSteps.size === 0) {
                    overallStatus = 'failed';
                    // 标记剩余 pending 步骤为 skipped
                    for (const step of steps) {
                        const stepIdNum = parseInt(step.id);
                        if (!completedSteps.has(stepIdNum) && !failedSteps.has(stepIdNum) && !skippedSteps.has(stepIdNum)) {
                            const stepExec = stepExecMap.get(stepIdNum);
                            if (stepExec) {
                                await ProjectStepExecutionModel.update(stepExec.id, { status: 'skipped' });
                                skippedSteps.add(stepIdNum);
                            }
                        }
                    }
                    break;
                }

                // 获取当前可以执行的步骤
                const executableSteps = this._getExecutableSteps(
                    steps, dependencyGraph, completedSteps, failedSteps, runningSteps, skippedSteps
                );

                if (executableSteps.length === 0 && runningSteps.size === 0) {
                    // 没有可执行步骤也没有运行中的步骤 → 可能存在循环依赖
                    console.error('工程执行: 无可执行步骤，可能存在循环依赖');
                    overallStatus = 'failed';
                    errorMessage = '步骤依赖关系存在循环，执行中止';
                    break;
                }

                // 启动所有可执行步骤（并行）
                for (const step of executableSteps) {
                    const stepIdNum = parseInt(step.id);
                    if (runningSteps.has(stepIdNum)) continue;

                    const stepExec = stepExecMap.get(stepIdNum);
                    if (!stepExec) {
                        console.error(`步骤 ${stepIdNum} 的执行记录不存在`);
                        continue;
                    }

                    const promise = this._executeStep(executionId, step, stepExec)
                        .then(result => {
                            runningSteps.delete(stepIdNum);
                            completedSteps.add(stepIdNum);
                            completedCount++;
                            this.emit('execution:stepComplete', {
                                executionId,
                                stepId: stepIdNum,
                                stepName: step.step_name,
                                stepType: step.step_type,
                                status: 'completed',
                                completedCount,
                                totalSteps: steps.length,
                                hostResults: result || []
                            });
                        })
                        .catch(async err => {
                            runningSteps.delete(stepIdNum);
                            failedSteps.add(stepIdNum);
                            errorMessage = err.message;
                            this.emit('execution:stepComplete', {
                                executionId,
                                stepId: stepIdNum,
                                stepName: step.step_name,
                                stepType: step.step_type,
                                status: 'failed',
                                error: err.message,
                                completedCount,
                                totalSteps: steps.length,
                                hostResults: err.hostResults || []
                            });

                            // 严格模式：立即停止其他运行中的步骤标记
                            if (runningSteps.size > 0) {
                                this.emit('execution:progress', {
                                    executionId,
                                    type: 'warn',
                                    message: `步骤 [${step.step_name}] 失败，正在等待其他并行步骤停止...`
                                });
                            }
                        });

                    runningSteps.set(stepIdNum, promise);
                }

                // 等待任意一个步骤结束
                if (runningSteps.size > 0) {
                    await Promise.race(runningSteps.values()).catch(() => {});
                }
            }

            // 等待所有运行中的步骤结束（严格模式下也需要等待清理）
            if (runningSteps.size > 0) {
                await Promise.allSettled(runningSteps.values());
            }

        } catch (err) {
            overallStatus = 'failed';
            errorMessage = err.message;
            console.error(`工程执行 ${executionId} 异常:`, err);
        }

        // 更新执行记录最终状态
        const finalStatus = this.stopFlags.get(executionId) ? 'interrupted' : overallStatus;

        await ProjectExecutionModel.update(executionId, {
            status: finalStatus,
            completed_at: new Date().toISOString(),
            completed_steps: completedSteps.size,
            failed_steps: failedSteps.size,
            error_message: errorMessage
        });

        this.stopFlags.delete(executionId);
        // 兜底清理连接总表（正常路径下各步骤已自行移除条目）
        this.activeConnections.delete(executionId);

        this.emit('execution:complete', {
            executionId,
            status: finalStatus,
            completedSteps: completedSteps.size,
            failedSteps: failedSteps.size,
            totalSteps: steps.length,
            errorMessage
        });

        // 发送企业微信通知
        await this._sendNotification(task, executionId, finalStatus, errorMessage, steps.length, completedSteps.size);

        console.log(`工程执行 ${executionId} 完成，状态: ${finalStatus}`);
    }

    /**
     * 获取（或懒创建）execution 级总连接表
     * 所有并行步骤共享同一张表，以 `${stepId}:${hostId}` 为 key，
     * 避免并行步骤互相覆盖/提前删除导致 stopExecution 无法断开全部连接
     */
    _getExecutionConnections(executionId) {
        if (!this.activeConnections.has(executionId)) {
            this.activeConnections.set(executionId, new Map());
        }
        return this.activeConnections.get(executionId);
    }

    /**
     * 获取当前可执行的步骤（所有依赖都已完成且未运行的步骤）
     */
    _getExecutableSteps(steps, dependencyGraph, completedSteps, failedSteps, runningSteps, skippedSteps) {
        return steps.filter(step => {
            const stepIdNum = parseInt(step.id);
            if (completedSteps.has(stepIdNum)) return false;
            if (failedSteps.has(stepIdNum)) return false;
            if (runningSteps.has(stepIdNum)) return false;
            if (skippedSteps && skippedSteps.has(stepIdNum)) return false;

            const deps = dependencyGraph.get(stepIdNum) || [];
            // 所有依赖都必须已成功完成
            return deps.every(depId => completedSteps.has(depId));
        });
    }

    /**
     * 执行单个步骤
     */
    async _executeStep(executionId, step, stepExec) {
        await ProjectStepExecutionModel.update(stepExec.id, {
            status: 'running',
            started_at: new Date().toISOString()
        });

        this.emit('execution:progress', {
            executionId,
            type: 'info',
            stepId: step.id,
            message: `开始执行步骤 [${step.step_name}]（${this._stepTypeName(step.step_type)}）`
        });

        try {
            // 获取目标主机
            const hosts = [];
            for (const hostId of step.host_ids) {
                const host = await HostModel.findById(parseInt(hostId));
                if (host) hosts.push(host);
            }

            if (hosts.length === 0) throw new Error(`步骤 [${step.step_name}] 没有有效的目标主机`);

            let hostResults = [];

            // 根据步骤类型执行
            switch (step.step_type) {
                case 'upload':
                    hostResults = await this._executeUploadStep(executionId, step, hosts);
                    break;
                case 'command':
                    hostResults = await this._executeCommandStep(executionId, step, hosts);
                    break;
                case 'script':
                    hostResults = await this._executeScriptStep(executionId, step, hosts);
                    break;
                default:
                    throw new Error(`未知步骤类型: ${step.step_type}`);
            }

            // 严格模式：检查是否有主机失败
            const failedHosts = hostResults.filter(r => r.status === 'failed');
            if (failedHosts.length > 0) {
                const failedIps = failedHosts.map(r => r.hostIp).join(', ');
                const stepErr = new Error(`${failedHosts.length} 台主机执行失败: ${failedIps}`);
                stepErr.hostResults = hostResults; // 携带完整主机结果供前端展示
                throw stepErr;
            }

            // 更新步骤执行记录为完成
            await ProjectStepExecutionModel.update(stepExec.id, {
                status: 'completed',
                completed_at: new Date().toISOString(),
                host_results: hostResults
            });

            this.emit('execution:progress', {
                executionId,
                type: 'success',
                stepId: step.id,
                message: `步骤 [${step.step_name}] 执行成功（${hosts.length} 台主机）`
            });

            return hostResults; // 返回主机结果供 stepComplete 事件使用

        } catch (err) {
            const failUpdate = {
                status: 'failed',
                completed_at: new Date().toISOString(),
                error_message: err.message
            };
            // 如果异常携带了主机执行结果（如部分主机失败），一并保存，避免详情页显示无主机执行记录
            if (err.hostResults && err.hostResults.length > 0) {
                failUpdate.host_results = err.hostResults;
            }
            await ProjectStepExecutionModel.update(stepExec.id, failUpdate);

            this.emit('execution:progress', {
                executionId,
                type: 'error',
                stepId: step.id,
                message: `步骤 [${step.step_name}] 执行失败: ${err.message}`
            });

            throw err;
        }
    }

    /**
     * 执行文件上传步骤（并行上传，收集所有结果）
     */
    async _executeUploadStep(executionId, step, hosts) {
        const { files, targetPath, conflictStrategy, pathCreateStrategy } = step.config;
        const maxConcurrency = Math.max(1, parseInt(step.config.concurrency, 10) || 10);
        const executing = new Set();
        const hostResults = [];
        // 注册到 execution 级总连接表（复合 key，避免并行步骤互相覆盖）
        const execConnections = this._getExecutionConnections(executionId);

        const uploadToHost = async (host) => {
            if (this.stopFlags.get(executionId)) {
                return { hostId: host.id, hostIp: host.ip, status: 'skipped', errorMessage: '工程已中止' };
            }

            this.emit('execution:progress', {
                executionId, type: 'info',
                message: `[${host.ip}] 开始上传 ${files.length} 个文件到 ${targetPath}`
            });

            // 登记当前传输中的连接，便于 stopExecution 强制断开
            const connKey = `${step.id}:${host.id}`;
            try {
                const result = await this.sshService.uploadFiles(host, files, targetPath, {
                    conflictStrategy: conflictStrategy || 'backup',
                    pathCreateStrategy: pathCreateStrategy || 'error',
                    timeout: (step.timeout || 300) * 1000,
                    // 文件间取消检查：中止后不再开始下一个文件
                    shouldCancel: () => !!this.stopFlags.get(executionId),
                    // 连接建立回调：把传输中的连接登记到总表，支持强制断连
                    onConnectionCreated: (conn) => { execConnections.set(connKey, conn); }
                });

                const status = result.success ? 'success' : 'failed';
                const errorMessage = result.success 
                    ? '' 
                    : (result.results?.filter(r => !r.success).map(r => r.error).join('; ') || '上传失败');

                this.emit('execution:progress', {
                    executionId, type: result.success ? 'success' : 'error',
                    message: `[${host.ip}] ${result.success ? `✓ 上传成功` : `✗ 上传失败`}`
                });

                return {
                    hostId: host.id, hostIp: host.ip, status,
                    stdout: result.success ? `上传成功: ${result.successCount} 个文件` : '',
                    errorMessage
                };
            } catch (err) {
                this.emit('execution:progress', {
                    executionId, type: 'error',
                    message: `[${host.ip}] ✗ 上传失败: ${err.message}`
                });
                return { hostId: host.id, hostIp: host.ip, status: 'failed', errorMessage: err.message };
            } finally {
                execConnections.delete(connKey);
            }
        };

        // 并发控制：并行上传
        for (const host of hosts) {
            if (this.stopFlags.get(executionId)) break;

            const promise = uploadToHost(host).then(result => {
                executing.delete(promise);
                hostResults.push(result);
            });
            executing.add(promise);

            if (executing.size >= maxConcurrency) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);

        // 统计结果
        const successCount = hostResults.filter(r => r.status === 'success').length;
        const failedCount = hostResults.filter(r => r.status === 'failed').length;
        const skippedCount = hostResults.filter(r => r.status === 'skipped').length;

        this.emit('execution:progress', {
            executionId, type: 'info',
            message: `上传完成: ${successCount} 成功, ${failedCount} 失败, ${skippedCount} 跳过`
        });

        return hostResults;
    }

    /**
     * 执行命令步骤
     */
    async _executeCommandStep(executionId, step, hosts) {
        const { command, useSudo } = step.config;
        const scriptContent = useSudo ? `sudo bash -c '${command.replace(/'/g, "'\\''")}'` : command;
        return await this._executeBatchScript(executionId, step, hosts, scriptContent);
    }

    /**
     * 执行脚本步骤
     */
    async _executeScriptStep(executionId, step, hosts) {
        let scriptContent = '';
        if (step.config.scriptId) {
            const script = await ScriptModel.findById(step.config.scriptId);
            if (!script) throw new Error(`脚本不存在: ${step.config.scriptId}`);
            scriptContent = script.content;
        } else if (step.config.scriptContent) {
            scriptContent = step.config.scriptContent;
        } else {
            throw new Error('步骤未配置脚本内容');
        }
        return await this._executeBatchScript(executionId, step, hosts, scriptContent, { useSudo: step.config.useSudo });
    }

    /**
     * 批量在多台主机上执行脚本（主机间并行，使用现有SSH服务）
     */
    async _executeBatchScript(executionId, step, hosts, scriptContent, options = {}) {
        const hostResults = [];
        const executing = new Set();
        const maxConcurrency = Math.max(1, parseInt(step.config.concurrency, 10) || 10);

        // 注册到 execution 级总连接表（复合 key，避免并行步骤互相覆盖）
        const execConnections = this._getExecutionConnections(executionId);

        const executeOnHost = async (host) => {
            if (this.stopFlags.get(executionId)) {
                return { hostId: host.id, hostIp: host.ip, status: 'skipped', errorMessage: '工程已中止' };
            }

            this.emit('execution:progress', {
                executionId, type: 'info',
                message: `[${host.ip}] 开始执行...`
            });

            let connection = null;
            const connKey = `${step.id}:${host.id}`;
            try {
                connection = new NodeSSH();
                // 将连接加入活动连接映射，便于紧急清理
                execConnections.set(connKey, connection);

                const config = {
                    host: host.ip,
                    port: host.port || 22,
                    username: host.username,
                    keepaliveInterval: 60000,
                    readyTimeout: (step.timeout || 300) * 1000,
                    algorithms: this.sshService.getCompatibilityAlgorithms()
                };
                const fs = require('fs');
                if (host.private_key_path && fs.existsSync(host.private_key_path)) {
                    config.privateKeyPath = host.private_key_path;
                } else if (host.privateKeyPath && fs.existsSync(host.privateKeyPath)) {
                    config.privateKeyPath = host.privateKeyPath;
                } else if (host.password) {
                    config.password = host.password;
                } else {
                    throw new Error('未提供有效的认证方式');
                }

                await connection.connect(config);
                const result = await this.sshService.executeScript(host, scriptContent, {
                    timeout: (step.timeout || 300) * 1000,
                    connection,
                    useSudo: options.useSudo || false
                });

                const status = result.success ? 'success' : 'failed';
                this.emit('execution:progress', {
                    executionId,
                    type: result.success ? 'success' : 'error',
                    message: `[${host.ip}] ${result.success ? '✓ 执行成功' : `✗ 执行失败 (退出码: ${result.exitCode})`}`
                });

                return {
                    hostId: host.id, hostIp: host.ip, status,
                    stdout: result.stdout || '',
                    stderr: result.stderr || '',
                    exitCode: result.exitCode,
                    errorMessage: result.success ? '' : (result.error || '')
                };
            } catch (err) {
                this.emit('execution:progress', {
                    executionId, type: 'error',
                    message: `[${host.ip}] ✗ 执行失败: ${err.message}`
                });
                return { hostId: host.id, hostIp: host.ip, status: 'failed', errorMessage: err.message };
            } finally {
                execConnections.delete(connKey);
                if (connection) {
                    try { 
                        await connection.dispose(); 
                    } catch (e) {
                        // 忽略清理错误，但记录日志
                        console.warn(`[${host.ip}] SSH连接清理失败:`, e.message);
                    }
                }
            }
        };

        // 并发控制
        for (const host of hosts) {
            if (this.stopFlags.get(executionId)) break;

            const promise = executeOnHost(host).then(result => {
                executing.delete(promise);
                hostResults.push(result);
            });
            executing.add(promise);

            if (executing.size >= maxConcurrency) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);

        return hostResults;
    }

    _stepTypeName(type) {
        return { upload: '文件上传', command: '命令执行', script: '脚本执行' }[type] || type;
    }

    /**
     * 发送企业微信通知
     */
    async _sendNotification(task, executionId, status, errorMessage, totalSteps, completedSteps) {
        try {
            if (!task.notify_webhook) return;
            if (status === 'completed' && !task.notify_on_success) return;
            if (status === 'failed' && !task.notify_on_failure) return;
            if (status === 'interrupted' && !task.notify_on_interrupt) return;

            const { WechatNotifier } = require('./wechatNotifier');
            const notifier = new WechatNotifier();
            const execution = await ProjectExecutionModel.findById(executionId);

            await notifier.sendProjectTaskNotification(task, execution, status, errorMessage);

            await ProjectExecutionModel.update(executionId, { notify_sent: 1 });
        } catch (err) {
            console.error('发送企业微信通知失败:', err);
        }
    }
}

module.exports = { ProjectTaskExecutor };
