const { SSHService } = require('./sshService');
const { TaskModel, TaskResultModel, HostModel, ScriptModel } = require('../database/models');
const EventEmitter = require('events');

/**
 * 任务执行器 - 负责批量执行SSH任务
 */
class TaskExecutor extends EventEmitter {
    constructor(options = {}) {
        super();
        this.maxConcurrency = options.maxConcurrency || 10; // 最大并发数
        this.timeout = options.timeout || 300000; // 超时时间（毫秒），默认5分钟
        this.retryTimes = options.retryTimes || 3; // 重试次数
        this.running = new Map(); // 正在运行的任务
        this.queue = []; // 任务队列
        this.sshService = new SSHService();
        this.stopFlags = new Map(); // 停止标志
        this.activeConnections = new Map(); // 活跃的SSH连接映射: taskId -> Map(hostId -> connection)
    }

    /**
     * 执行任务
     * @param {number} taskId - 任务ID
     * @param {Object} options - 执行选项
     */
    async executeTask(taskId, options = {}) {
        try {
            console.log(`开始执行任务 ${taskId}`);
            
            // 获取任务信息
            console.log('开始执行任务', taskId, '类型:', typeof taskId);
            const task = await TaskModel.findById(taskId);
            if (!task) {
                throw new Error('任务不存在');
            }
            console.log('查询到的任务: ID=', task.id, 'script_id=', task.script_id, 'name=', task.task_name);

            // 获取脚本内容
            console.log('===== 任务执行调试信息 =====');
            console.log('任务ID:', task.id);
            console.log('任务script_id:', task.script_id, '类型:', typeof task.script_id);
            console.log('是否临时命令:', task.is_temporary_command);
            console.log('临时命令内容长度:', task.script_content?.length || 0);
            console.log('任务名称:', task.task_name);
            
            let scriptContent = '';
            
            // 检查是否为临时命令
            if (task.is_temporary_command) {
                // 临时命令：使用 task.script_content
                if (!task.script_content) {
                    console.error('错误：临时命令内容为空');
                    throw new Error('临时命令内容为空');
                }
                scriptContent = task.script_content;
                console.log('使用临时命令内容，长度:', scriptContent.length);
            } else {
                // 保存的脚本：从脚本表查询
                if (!task.script_id) {
                    console.error('错误：任务中未指定脚本ID');
                    throw new Error('任务中未指定脚本ID');
                }
                
                // 先输出数据库中所有脚本
                const allScripts = await ScriptModel.findAll();
                console.log('数据库中的脚本数量:', allScripts.length);
                if (allScripts.length > 0) {
                    console.log('脚本列表:');
                    allScripts.forEach(s => {
                        console.log(`  - ID: "${s.id}" (${typeof s.id}), Name: "${s.name}"`);
                    });
                } else {
                    console.log('数据库中没有任何脚本！');
                }
                
                console.log(`开始查找脚本，ID="${task.script_id}"`);
                const script = await ScriptModel.findById(task.script_id);
                console.log('查找脚本结果:', script ? `找到: ${script.name} (ID: ${script.id})` : 'null - 脚本不存在！');
                
                if (!script) {
                    throw new Error(`脚本不存在 (ID: ${task.script_id})`);
                }
                
                scriptContent = script.content;
                console.log('使用保存的脚本内容，长度:', scriptContent.length);
            }
            console.log('==============================')

            // 获取主机列表
            const hostIds = task.host_ids;
            if (!hostIds || hostIds.length === 0) {
                throw new Error('没有选择目标主机');
            }

            const hosts = [];
            for (const hostId of hostIds) {
                const host = await HostModel.findById(hostId);
                if (host) {
                    hosts.push(host);
                }
            }

            if (hosts.length === 0) {
                throw new Error('没有有效的目标主机');
            }

            // 更新任务状态为运行中
            await TaskModel.update(taskId, {
                status: 'running',
                start_time: new Date().toISOString()
            });

            // 初始化停止标志和连接映射
            this.stopFlags.set(taskId, false);
            this.activeConnections.set(taskId, new Map());

            // 创建任务结果记录
            const resultPromises = hosts.map(async (host) => {
                return await TaskResultModel.create({
                    task_execution_id: taskId,
                    host_id: host.id,
                    status: 'pending'
                });
            });
            await Promise.all(resultPromises);

            // 执行任务
            const results = await this.executeBatch(taskId, hosts, scriptContent, options);

            // 统计结果
            const successCount = results.filter(r => r.status === 'success').length;
            const failedCount = results.filter(r => r.status === 'failed' || r.status === 'timeout').length;

            // 更新任务状态
            const taskStatus = this.stopFlags.get(taskId)
                ? 'cancelled'
                : (failedCount === hosts.length && hosts.length > 0 ? 'failed' : 'completed');
            await TaskModel.update(taskId, {
                status: taskStatus,
                end_time: new Date().toISOString(),
                success_hosts: successCount,
                failed_hosts: failedCount
            });

            // 清理停止标志和连接映射
            this.stopFlags.delete(taskId);
            this.activeConnections.delete(taskId);

            // 发送完成事件
            this.emit('taskComplete', {
                taskId,
                status: taskStatus,
                successCount,
                failedCount,
                totalCount: hosts.length
            });

            console.log(`任务 ${taskId} 执行完成: 成功=${successCount}, 失败=${failedCount}`);

            return {
                success: true,
                taskId,
                status: taskStatus,
                successCount,
                failedCount,
                totalCount: hosts.length
            };

        } catch (error) {
            console.error(`任务 ${taskId} 执行失败:`, error);
            
            // 更新任务状态为失败
            await TaskModel.update(taskId, {
                status: 'failed',
                end_time: new Date().toISOString()
            });

            // 清理停止标志和连接映射，避免失败任务残留导致 Map 泄漏
            this.stopFlags.delete(taskId);
            this.activeConnections.delete(taskId);

            this.emit('taskError', {
                taskId,
                error: error.message
            });

            throw error;
        }
    }

    /**
     * 批量执行
     * @param {number} taskId - 任务ID
     * @param {Array} hosts - 主机列表
     * @param {string} scriptContent - 脚本内容
     * @param {Object} options - 执行选项
     */
    async executeBatch(taskId, hosts, scriptContent, options = {}) {
        const results = [];
        const executing = new Set();
        const maxConcurrency = Math.max(1, parseInt(options.concurrency, 10) || this.maxConcurrency || 10);
        
        // 获取任务结果记录
        const taskResults = await TaskResultModel.findByTaskId(taskId);
        const resultMap = new Map();
        taskResults.forEach(result => {
            resultMap.set(result.host_id, result);
        });

        let completedCount = 0; // 已完成的任务数量

        const executeOne = async (host) => {
            try {
                // 检查是否需要停止
                if (this.stopFlags.get(taskId)) {
                    // 即使取消也要增加计数，确保进度条正确
                    completedCount++;
                    this.emit('progress', {
                        taskId,
                        hostId: host.id,
                        hostIp: host.ip,
                        status: 'cancelled',
                        total: hosts.length,
                        current: completedCount
                    });
                    return { status: 'cancelled', host_id: host.id };
                }

                const resultRecord = resultMap.get(host.id);
                if (!resultRecord) {
                    console.error(`找不到主机 ${host.id} 的结果记录`);
                    completedCount++;
                    this.emit('progress', {
                        taskId,
                        hostId: host.id,
                        hostIp: host.ip,
                        status: 'failed',
                        error: '找不到结果记录',
                        total: hosts.length,
                        current: completedCount
                    });
                    return { status: 'failed', host_id: host.id, error: '找不到结果记录' };
                }

                // 更新状态为运行中
                await TaskResultModel.update(resultRecord.id, {
                    status: 'running',
                    start_time: new Date().toISOString()
                });

                // 发送进度更新（开始执行时不更新计数）
                this.emit('progress', {
                    taskId,
                    hostId: host.id,
                    hostIp: host.ip,
                    status: 'running',
                    total: hosts.length,
                    current: completedCount
                });

                const startTime = Date.now();
                let result;
                let lastError = null;
                let retryCount = 0;
                const maxRetries = this.retryTimes || 3;

                // 重试循环
                while (retryCount <= maxRetries) {
                    try {
                        // 检查是否被取消
                        if (this.stopFlags.get(taskId)) {
                            throw new Error('任务已取消');
                        }

                        // 如果是重试，添加延迟（指数退避）
                        if (retryCount > 0) {
                            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // 最大10秒
                            console.log(`主机 ${host.ip} 第 ${retryCount} 次重试，延迟 ${delay}ms`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }

                        // 执行脚本
                        result = await this.executeOnHost(taskId, host, scriptContent, options);
                        
                        // 如果执行成功，跳出重试循环
                        if (result.success) {
                            break;
                        }
                        
                        // 执行失败，记录错误并准备重试
                        lastError = result.error || `执行失败 (exitCode: ${result.exitCode})`;
                        console.log(`主机 ${host.ip} 执行失败: ${lastError}, 已重试 ${retryCount}/${maxRetries} 次`);
                        
                        retryCount++;
                        
                        // 如果已达到最大重试次数，跳出循环
                        if (retryCount > maxRetries) {
                            break;
                        }

                    } catch (error) {
                        lastError = error.message;
                        if (this.stopFlags.get(taskId)) {
                            result = {
                                success: false,
                                cancelled: true,
                                error: 'Task cancelled',
                                stdout: '',
                                stderr: 'Task cancelled',
                                exitCode: -1
                            };
                            break;
                        }
                        console.error(`Host ${host.ip} execution error: ${lastError}, retry ${retryCount}/${maxRetries}`);
                        
                        retryCount++;
                        
                        // 如果已达到最大重试次数，跳出循环
                        if (retryCount > maxRetries) {
                            // 使用错误结果
                            result = {
                                success: false,
                                error: lastError,
                                stdout: '',
                                stderr: lastError,
                                exitCode: -1
                            };
                            break;
                        }
                    }
                }

                const duration = Date.now() - startTime;
                const resultStatus = (result.cancelled || this.stopFlags.get(taskId)) ? 'cancelled' : (result.success ? 'success' : 'failed');

                // 更新结果（包含重试信息）
                const errorMessage = result.success ? '' : 
                    (retryCount > 0 ? `${result.error || lastError} (重试 ${retryCount} 次后失败)` : (result.error || ''));
                
                await TaskResultModel.update(resultRecord.id, {
                    status: resultStatus,
                    stdout: result.stdout || '',
                    stderr: result.stderr || '',
                    exit_code: result.exitCode,
                    end_time: new Date().toISOString(),
                    duration,
                    error_message: errorMessage
                });

                // 任务完成，增加计数
                completedCount++;
                
                // 发送进度更新（包含重试信息）
                this.emit('progress', {
                    taskId,
                    hostId: host.id,
                    hostIp: host.ip,
                    status: resultStatus,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exitCode: result.exitCode,
                    errorHint: result.errorHint,
                    retryCount: retryCount,
                    duration,
                    total: hosts.length,
                    current: completedCount
                });

                return {
                    status: resultStatus,
                    host_id: host.id,
                    retryCount: retryCount,
                    ...result
                };
            } catch (error) {
                console.error(`主机 ${host.ip} 执行过程发生严重错误:`, error);
                completedCount++;
                return {
                    status: 'failed',
                    host_id: host.id,
                    success: false,
                    error: error.message,
                    stdout: '',
                    stderr: error.message,
                    exitCode: -1
                };
            }
        };

        // 并发控制
        for (const host of hosts) {
            // 检查是否需要停止
            if (this.stopFlags.get(taskId)) {
                break;
            }

            const promise = executeOne(host).then(result => {
                executing.delete(promise);
                results.push(result);
            });

            executing.add(promise);

            // 控制并发数
            if (executing.size >= maxConcurrency) {
                await Promise.race(executing);
            }
        }

        // 等待所有任务完成
        await Promise.all(executing);

        return results;
    }

    /**
     * 在单个主机上执行脚本
     * @param {number} taskId - 任务ID
     * @param {Object} host - 主机信息
     * @param {string} scriptContent - 脚本内容
     * @param {Object} options - 执行选项
     */
    async executeOnHost(taskId, host, scriptContent, options = {}) {
        const { NodeSSH } = require('node-ssh');
        let connection = null;
        
        try {
            console.log('========== executeOnHost 调试 ==========');
            console.log('主机IP:', host.ip);
            console.log('脚本内容:', scriptContent);
            console.log('脚本内容长度:', scriptContent?.length || 0);
            console.log('=====================================');
            
            // 创建SSH连接
            connection = new NodeSSH();
            const config = {
                host: host.ip,
                port: host.port || 22,
                username: host.username,
                keepaliveInterval: 60000,
                readyTimeout: options.timeout || this.timeout,
                algorithms: this.sshService.getCompatibilityAlgorithms(),
            };

            const fs = require('fs');
            const privateKeyPath = host.privateKeyPath || host.private_key_path;
            if (privateKeyPath && fs.existsSync(privateKeyPath)) {
                config.privateKeyPath = privateKeyPath;
            } else if (host.password) {
                config.password = host.password;
            } else {
                throw new Error('未提供有效的认证方式');
            }

            await connection.connect(config);
            
            // 若为破坏性命令（shutdown/reboot 等），提前在底层 ssh2 连接上注册 error 监听器。
            // 原因：nohup & 提交后远程主机即将关机，TCP 连接被强制重置（ECONNRESET），
            //       ssh2 向 Client 对象发出 error 事件。若此时已无监听器，
            //       Node.js 将其转为未捕获异常，触发 Electron 弹出原生错误对话框。
            const isDisruptive = this.sshService.isDisruptiveCommand(scriptContent);
            if (isDisruptive && connection.connection) {
                connection.connection.on('error', (err) => {
                    console.log(`[SSH] 主机 ${host.ip} 连接断开（关机/重启命令预期行为）:`, err.code || err.message);
                    // 静默处理，不重新抛出
                });
            }
            
            // 注册连接到活跃连接映射
            const taskConnections = this.activeConnections.get(taskId);
            if (taskConnections) {
                taskConnections.set(host.id, connection);
            }
            
            // 执行脚本（传入连接）
            const result = await this.sshService.executeScript(host, scriptContent, {
                timeout: options.timeout || this.timeout,
                connection: connection, // 传入连接，由executeOnHost管理生命周期
                useSudo: options.useSudo || false // 传递sudo选项
            });
            
            console.log('========== executeOnHost 结果 ==========');
            console.log('成功:', result.success);
            console.log('stdout:', result.stdout);
            console.log('stderr:', result.stderr);
            console.log('exitCode:', result.exitCode);
            console.log('=====================================');

            return result;

        } catch (error) {
            console.error(`在主机 ${host.ip} 上执行脚本失败:`, error);
            return {
                success: false,
                error: error.message,
                stdout: '',
                stderr: error.message,
                exitCode: -1
            };
        } finally {
            // 清理连接
            if (connection) {
                const taskConnections = this.activeConnections.get(taskId);
                if (taskConnections) {
                    taskConnections.delete(host.id);
                }
                
                try {
                    await connection.dispose();
                } catch (disposeError) {
                    console.error('关闭连接失败:', disposeError);
                }
            }
        }
    }

    /**
     * 停止任务执行
     * @param {number} taskId - 任务ID
     */
    async stopTask(taskId) {
        console.log(`停止任务 ${taskId}`);
        
        // 设置停止标志，阻止新任务开始
        this.stopFlags.set(taskId, true);
        
        // 主动断开所有正在运行的SSH连接
        const taskConnections = this.activeConnections.get(taskId);
        if (taskConnections && taskConnections.size > 0) {
            console.log(`正在关闭 ${taskConnections.size} 个活跃SSH连接...`);
            
            const closePromises = [];
            for (const [hostId, connection] of taskConnections.entries()) {
                console.log(`关闭主机 ${hostId} 的SSH连接...`);
                closePromises.push(
                    connection.dispose()
                        .then(() => {
                            console.log(`主机 ${hostId} 的SSH连接已关闭`);
                        })
                        .catch(error => {
                            console.error(`关闭主机 ${hostId} 的SSH连接失败:`, error.message);
                        })
                );
            }
            
            // 等待所有连接关闭（最长等待5秒）
            await Promise.race([
                Promise.all(closePromises),
                new Promise(resolve => setTimeout(resolve, 5000))
            ]);
            
            // 清空连接映射
            taskConnections.clear();
            console.log(`任务 ${taskId} 的所有SSH连接已关闭`);
        }
        
        // 更新任务状态
        const taskResultsToCancel = await TaskResultModel.findByTaskId(taskId);
        await Promise.all(taskResultsToCancel
            .filter(result => result.status === 'pending' || result.status === 'running')
            .map(result => TaskResultModel.update(result.id, {
                status: 'cancelled',
                end_time: new Date().toISOString(),
                error_message: 'Task cancelled'
            })));
        
        await TaskModel.update(taskId, {
            status: 'cancelled',
            end_time: new Date().toISOString()
        });

        return true;
    }

    /**
     * 设置最大并发数
     * @param {number} concurrency - 并发数
     */
    setMaxConcurrency(concurrency) {
        this.maxConcurrency = concurrency;
    }

    /**
     * 设置超时时间
     * @param {number} timeout - 超时时间（毫秒）
     */
    setTimeout(timeout) {
        this.timeout = timeout;
    }

    /**
     * 设置重试次数
     * @param {number} retryTimes - 重试次数
     */
    setRetryTimes(retryTimes) {
        this.retryTimes = retryTimes;
    }
}

module.exports = { TaskExecutor };
