const { NodeSSH } = require('node-ssh');
const fs = require('fs');
const path = require('path');

class SSHService {
    constructor() {
        this.ssh = new NodeSSH();
    }

    /**
     * 强制清理SSH连接（防止内存泄漏）
     * 【修复：SSH连接释放不彻底】
     * 在 dispose() 之前显式移除所有事件监听器，防止闭包引用导致内存泄漏
     * @param {NodeSSH} connection - SSH连接对象
     * @param {string} context - 上下文信息（用于日志）
     */
    async forceCleanupConnection(connection, context = '未知') {
        if (!connection) {
            return;
        }

        try {
            // 步骤1: 获取底层 ssh2 连接对象
            const sshConnection = connection.connection;
            
            if (sshConnection) {
                // 移除所有事件监听器（防止闭包引用）
                try {
                    sshConnection.removeAllListeners();
                    console.log(`[清理] ${context}: 已移除所有 ssh2 事件监听器`);
                } catch (error) {
                    console.warn(`[清理] ${context}: 移除监听器失败:`, error.message);
                }
            }

            // 步骤2: 调用 node-ssh 的 dispose 方法
            await connection.dispose();
            console.log(`[清理] ${context}: SSH连接已释放`);
            
        } catch (error) {
            // 即使清理失败，也不应该抛出异常，只记录日志
            console.error(`[清理] ${context}: 强制清理连接失败:`, error.message);
        }
    }

    // 测试SSH连接
    async testConnection(hostData) {
        const startTime = Date.now();
        let connection = null;
        
        try {
            connection = new NodeSSH();
            
            const config = {
                host: hostData.ip,
                port: hostData.port || 22,
                username: hostData.username,
                keepaliveInterval: 60000,
                readyTimeout: 10000, // 10秒连接超时
                // 兼容性配置：支持老旧Linux系统
                algorithms: {
                    kex: [
                        'curve25519-sha256',
                        'curve25519-sha256@libssh.org',
                        'ecdh-sha2-nistp256',
                        'ecdh-sha2-nistp384',
                        'ecdh-sha2-nistp521',
                        'diffie-hellman-group-exchange-sha256',
                        'diffie-hellman-group14-sha256',
                        'diffie-hellman-group16-sha512',
                        'diffie-hellman-group18-sha512',
                        'diffie-hellman-group14-sha1', // 兼容老系统
                        'diffie-hellman-group1-sha1'   // 兼容老系统（不安全，但部分老系统需要）
                    ],
                    cipher: [
                        'aes128-gcm',
                        'aes128-gcm@openssh.com',
                        'aes256-gcm',
                        'aes256-gcm@openssh.com',
                        'aes128-ctr',
                        'aes192-ctr',
                        'aes256-ctr',
                        'aes128-cbc', // 兼容老系统
                        'aes192-cbc', // 兼容老系统
                        'aes256-cbc'  // 兼容老系统
                    ],
                    serverHostKey: [
                        'ssh-ed25519',
                        'ecdsa-sha2-nistp256',
                        'ecdsa-sha2-nistp384',
                        'ecdsa-sha2-nistp521',
                        'rsa-sha2-512',
                        'rsa-sha2-256',
                        'ssh-rsa', // 兼容老系统
                        'ssh-dss'  // 兼容老系统（不安全，但部分老系统需要）
                    ],
                    hmac: [
                        'hmac-sha2-256',
                        'hmac-sha2-512',
                        'hmac-sha1' // 兼容老系统
                    ]
                },
                // 禁用严格的主机密钥检查（可选，根据安全需求调整）
                // tryKeyboard: true,  // 支持键盘交互认证
            };

            // 添加认证方式
            const privateKeyPath = hostData.privateKeyPath || hostData.private_key_path;
            if (privateKeyPath && fs.existsSync(privateKeyPath)) {
                // 使用私钥认证
                config.privateKeyPath = privateKeyPath;
                console.log(`使用私钥认证: ${hostData.privateKeyPath}`);
            } else if (hostData.password) {
                // 使用密码认证
                config.password = hostData.password;
                console.log('使用密码认证');
            } else {
                throw new Error('未提供有效的认证方式（密码或私钥）');
            }

            // 建立连接
            await connection.connect(config);
            
            // 执行简单命令验证连接
            const result = await this.execCommandWithTimeout(connection, 'echo "SSH connection test successful"', { timeout: 10000 });
            
            const duration = Date.now() - startTime;
            
            await this.forceCleanupConnection(connection, `testConnection:${hostData.ip}`);
            
            return {
                success: true,
                message: '连接成功',
                duration: duration,
                timestamp: new Date().toISOString(),
                details: {
                    stdout: result.stdout,
                    stderr: result.stderr,
                    code: result.code
                }
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            if (connection) {
                try {
                    await this.forceCleanupConnection(connection, `testConnection:${hostData.ip}:error`);
                } catch (disposeError) {
                    console.error('关闭SSH连接失败:', disposeError);
                }
            }
            
            // 分析错误类型
            let errorMessage = this.parseErrorMessage(error);
            const isAuthFailed = /authentication|all configured authentication|permission denied/i.test(error.message);
            
            return {
                success: false,
                authFailed: isAuthFailed,
                message: errorMessage,
                duration: duration,
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    /**
     * 快速连接测试（优化版本）
     * - 超时缩短为5秒
     * - 跳过echo命令验证，SSH握手成功即视为连接成功
     * - 用于批量测试场景
     */
    async testConnectionFast(hostData) {
        const startTime = Date.now();
        let connection = null;
        
        try {
            connection = new NodeSSH();
            
            const config = {
                host: hostData.ip,
                port: hostData.port || 22,
                username: hostData.username,
                readyTimeout: 5000, // 5秒连接超时（快速模式）
                algorithms: this.getCompatibilityAlgorithms(),
            };

            // 添加认证方式
            const privateKeyPath = hostData.privateKeyPath || hostData.private_key_path;
            if (privateKeyPath && fs.existsSync(privateKeyPath)) {
                config.privateKeyPath = privateKeyPath;
            } else if (hostData.password) {
                config.password = hostData.password;
            } else {
                throw new Error('未提供有效的认证方式（密码或私钥）');
            }

            // 建立连接（SSH握手成功即代表连接可用）
            await connection.connect(config);
            
            const duration = Date.now() - startTime;
            
            await this.forceCleanupConnection(connection, `testFast:${hostData.ip}`);
            
            return {
                success: true,
                message: '连接成功',
                duration: duration,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            if (connection) {
                try {
                    await this.forceCleanupConnection(connection, `testFast:${hostData.ip}:error`);
                } catch (disposeError) {
                    // ignore
                }
            }
            
            let errorMessage = this.parseErrorMessage(error);
            const isAuthFailed = /authentication|all configured authentication|permission denied/i.test(error.message);
            
            return {
                success: false,
                authFailed: isAuthFailed,
                message: errorMessage,
                duration: duration,
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    /**
     * 批量并发连接测试
     * @param {Array} hostList - 主机数据数组
     * @param {number} concurrency - 并发数（默认10）
     * @param {Function} onProgress - 进度回调
     * @returns {Array} 测试结果数组
     */
    async batchTestConnection(hostList, concurrency = 10, onProgress = null) {
        const results = new Array(hostList.length);
        let completedCount = 0;
        let currentIndex = 0;
        
        const worker = async () => {
            while (currentIndex < hostList.length) {
                const index = currentIndex++;
                const hostData = hostList[index];
                
                try {
                    results[index] = await this.testConnectionFast(hostData);
                } catch (error) {
                    results[index] = {
                        success: false,
                        message: error.message,
                        duration: 0,
                        timestamp: new Date().toISOString(),
                        error: error.message
                    };
                }
                
                completedCount++;
                if (onProgress) {
                    onProgress({
                        completed: completedCount,
                        total: hostList.length,
                        index: index,
                        result: results[index]
                    });
                }
            }
        };
        
        // 启动并发worker
        const workers = [];
        const workerCount = Math.min(concurrency, hostList.length);
        for (let i = 0; i < workerCount; i++) {
            workers.push(worker());
        }
        
        await Promise.all(workers);
        return results;
    }

    // 收集主机信息
    async collectHostInfo(hostData) {
        let connection = null;
        
        try {
            connection = new NodeSSH();
            
            const config = {
                host: hostData.ip,
                port: hostData.port || 22,
                username: hostData.username,
                keepaliveInterval: 60000,
                readyTimeout: 15000,
                // 兼容性配置：支持老旧Linux系统
                algorithms: this.getCompatibilityAlgorithms(),
            };

            const privateKeyPath = hostData.privateKeyPath || hostData.private_key_path;
            if (privateKeyPath && fs.existsSync(privateKeyPath)) {
                config.privateKeyPath = privateKeyPath;
            } else if (hostData.password) {
                config.password = hostData.password;
            } else {
                throw new Error('未提供有效的认证方式');
            }

            await connection.connect(config);
            
            // 收集系统信息
            const systemInfo = await this.gatherSystemInfo(connection);
            
            await this.forceCleanupConnection(connection, `collectHostInfo:${hostData.ip}`);
            
            return {
                success: true,
                data: systemInfo,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            if (connection) {
                try {
                    await this.forceCleanupConnection(connection, `collectHostInfo:${hostData.ip}:error`);
                } catch (disposeError) {
                    console.error('关闭SSH连接失败:', disposeError);
                }
            }
            
            return {
                success: false,
                message: this.parseErrorMessage(error),
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // 收集系统信息（聚焦执行环境画像）
    async gatherSystemInfo(connection) {
        const info = {};
        const timeout = 10000; // 每个命令 10s 超时
        
        // 并发执行所有采集命令，提升速度
        const tasks = [
            {
                key: 'osArch',
                cmd: 'uname -m'
            },
            {
                key: 'cpuCores',
                cmd: 'nproc 2>/dev/null || grep -c "^processor" /proc/cpuinfo 2>/dev/null || echo 0'
            },
            {
                key: 'memTotal',
                cmd: 'free -h 2>/dev/null | awk \'/^Mem:/{print $2}\''
            },
            {
                key: 'kernelVer',
                cmd: 'uname -r'
            },
            {
                // -P 强制 POSIX 单行输出：挂载点路径过长（如 LVM 的 /dev/mapper/xxx）时 df 默认会换行，导致取不到可用空间
                key: 'diskFree',
                cmd: 'df -P -h / 2>/dev/null | awk \'NR==2{print $4}\''
            },
            {
                // 系统类型：优先读 /etc/os-release (NAME 字段)，如果不存在则读 /etc/redhat-release 第一行
                key: 'osType',
                cmd: `(
                  name=$(grep '^NAME=' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' | sed 's/ *Enterprise.*//;s/ *Linux.*//;s/ *Server.*//;s/ *release.*//i' | xargs) &&
                  [ -n "$name" ] && echo "$name" ||
                  head -1 /etc/redhat-release 2>/dev/null | sed 's/ *release.*//i;s/ *Linux.*//;s/ *Server.*//;s/ *Enterprise.*//' | xargs
                ) 2>/dev/null || echo ''`
            },
            {
                // 系统版本：优先读 VERSION_ID，如果不存在则从 /etc/redhat-release 提取版本号
                key: 'osVersion',
                cmd: `(
                  ver=$(grep '^VERSION_ID=' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' | xargs) &&
                  [ -n "$ver" ] && echo "$ver" ||
                  grep -oE '[0-9]+\\.[0-9]+' /etc/redhat-release 2>/dev/null | head -1
                ) 2>/dev/null || echo ''`
            }
        ];
        
        try {
            const results = await Promise.allSettled(
                tasks.map(task => this.execCommandWithTimeout(connection, task.cmd, { timeout }))
            );
        
            results.forEach((result, i) => {
                const key = tasks[i].key;
                if (result.status === 'fulfilled' && result.value.code === 0) {
                    const val = result.value.stdout.trim();
                    if (val) {
                        if (key === 'cpuCores') {
                            const n = parseInt(val);
                            if (!isNaN(n) && n > 0) info.cpuCores = n;
                        } else {
                            info[key] = val;
                        }
                    }
                }
            });
        
        } catch (error) {
            console.error('收集系统信息时出错:', error);
            info.error = error.message;
        }
        
        return info;
    }

    // 执行命令
    async executeCommand(hostData, command, options = {}) {
        let connection = null;
        
        try {
            connection = new NodeSSH();
            
            const config = {
                host: hostData.ip,
                port: hostData.port || 22,
                username: hostData.username,
                keepaliveInterval: 60000,
                readyTimeout: 15000,
                // 兼容性配置：支持老旧Linux系统
                algorithms: this.getCompatibilityAlgorithms(),
            };

            const privateKeyPath = hostData.privateKeyPath || hostData.private_key_path;
            if (privateKeyPath && fs.existsSync(privateKeyPath)) {
                config.privateKeyPath = privateKeyPath;
            } else if (hostData.password) {
                config.password = hostData.password;
            } else {
                throw new Error('未提供有效的认证方式');
            }

            await connection.connect(config);
            
            const result = await this.execCommandWithTimeout(connection, command, {
                ...options,
                timeout: options.timeout || 60000
            });
            
            await this.forceCleanupConnection(connection, `executeCommand:${hostData.ip}`);
            
            return {
                success: result.code === 0,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.code,
                code: result.code,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            if (connection) {
                try {
                    await this.forceCleanupConnection(connection, `executeCommand:${hostData.ip}:error`);
                } catch (disposeError) {
                    console.error('关闭SSH连接失败:', disposeError);
                }
            }
            
            return {
                success: false,
                message: this.parseErrorMessage(error),
                error: error.message,
                exitCode: -1,
                stdout: '',
                stderr: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // 检查是否为可能导致连接断开的命令
    isDisruptiveCommand(scriptContent) {
        const disruptivePatterns = [
            /\bshutdown\b/i,
            /\breboot\b/i,
            /\bpoweroff\b/i,
            /\bhalt\b/i,
            /\binit\s+[06]\b/i,
            /\bsystemctl\s+(reboot|poweroff|halt)\b/i
        ];
        
        return disruptivePatterns.some(pattern => pattern.test(scriptContent));
    }

    // 执行命令（带超时处理）
    async execCommandWithTimeout(connection, command, options = {}) {
        const timeout = options.timeout || 60000; // 默认60秒超时
        
        return Promise.race([
            connection.execCommand(command, options),
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`命令执行超时（${timeout}ms）: ${command.substring(0, 100)}...`));
                }, timeout);
            })
        ]);
    }

    // 执行脚本（先传输到远程主机，再执行）
    async executeScript(hostData, scriptContent, options = {}) {
        let connection = options.connection || null; // 支持外部传入连接
        const connectionOwner = !options.connection; // 标记是否由此函数创建连接
        
        // 统一换行符：Windows 编辑器粘贴的 CRLF 会导致远程 bash 报 '\r: command not found'
        scriptContent = String(scriptContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        try {
            // 如果没有传入连接，则创建新连接
            if (!connection) {
                connection = new NodeSSH();
            
                const config = {
                    host: hostData.ip,
                    port: hostData.port || 22,
                    username: hostData.username,
                    keepaliveInterval: 60000,
                    readyTimeout: options.timeout || 15000,
                    // 兼容性配置：支持老旧Linux系统
                    algorithms: this.getCompatibilityAlgorithms(),
                };

                const privateKeyPath = hostData.privateKeyPath || hostData.private_key_path;
            if (privateKeyPath && fs.existsSync(privateKeyPath)) {
                    config.privateKeyPath = privateKeyPath;
                } else if (hostData.password) {
                    config.password = hostData.password;
                } else {
                    throw new Error('未提供有效的认证方式');
                }

                await connection.connect(config);
            }
            
            // 检查是否为破坏性命令（可能导致连接断开）
            const isDisruptive = this.isDisruptiveCommand(scriptContent);
            if (isDisruptive) {
                console.log('检测到可能导致连接断开的命令（shutdown/reboot等），将特殊处理');
                // 立即为底层 ssh2 连接注册 error 监听器，防止主机关机/重启后
                // ECONNRESET 事件无人处理，变成 Electron 弹出的原生错误对话框
                const sshClient = connection && connection.connection;
                if (sshClient && !sshClient._disruptiveErrorHandled) {
                    sshClient._disruptiveErrorHandled = true;
                    sshClient.on('error', (err) => {
                        console.log(`[SSH] 连接断开（关机/重启命令预期行为）[${hostData && hostData.ip ? hostData.ip : ''}]: ${err.code || err.message}`);
                        // 静默吞掉，不重新抛出
                    });
                }
            }
            
            // 生成临时脚本文件名
            const timestamp = Date.now();
            const randomStr = Math.random().toString(36).substring(7);
            const remoteScriptPath = `/tmp/ssh_script_${timestamp}_${randomStr}.sh`;
            
            // 生成随机的 Heredoc 分隔符,避免与脚本内容冲突
            const crypto = require('crypto');
            const heredocDelimiter = `EOF_${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
            
            console.log('========== SSH脚本执行调试 ==========');
            console.log('目标主机:', hostData.ip);
            console.log('远程脚本路径:', remoteScriptPath);
            console.log('Heredoc分隔符:', heredocDelimiter);
            console.log('脚本内容:');
            console.log(scriptContent);
            console.log('脚本内容长度:', scriptContent?.length || 0);
            
            // 步骤1: 将脚本内容写入远程临时文件
            // 使用 cat 命令创建文件,避免特殊字符转义问题
            // 使用随机生成的分隔符,防止脚本内容包含固定分隔符导致截断
            await this.execCommandWithTimeout(connection, `cat > ${remoteScriptPath} << '${heredocDelimiter}'
${scriptContent}
${heredocDelimiter}`, { timeout: options.timeout || 15000 });
            
            console.log('脚本已传输到远程服务器');
            
            // 步骤2: 设置脚本可执行权限
            await this.execCommandWithTimeout(connection, `chmod +x ${remoteScriptPath}`, { timeout: 10000 });
            console.log('脚本权限已设置为可执行');
            
            // 步骤3: 使用 bash -x 执行脚本（显示执行过程）
            let result;
            
            if (isDisruptive) {
                // 对于破坏性命令，使用后台执行并立即返回
                console.log('以后台模式执行破坏性命令');
                try {
                    // 使用 nohup 在后台执行，并立即返回
                    result = await this.execCommandWithTimeout(connection, `nohup bash -x ${remoteScriptPath} > /tmp/shutdown.log 2>&1 &`, {
                        cwd: options.cwd || '/tmp',
                        timeout: 10000
                    });
                    
                    // 给命令一点执行时间
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // 连接可能已断开，这是正常的
                    console.log('破坏性命令已提交执行');
                } catch (execError) {
                    // 如果是连接断开错误，视为成功
                    if (execError.message.includes('ECONNRESET') || 
                        execError.message.includes('Connection reset') ||
                        execError.message.includes('Broken pipe') ||
                        execError.message.includes('EPIPE')) {
                        console.log('连接已断开（预期行为），命令已成功提交');
                        result = {
                            code: 0,
                            stdout: '命令已执行，主机正在关机/重启',
                            stderr: ''
                        };
                    } else {
                        throw execError;
                    }
                }
            } else {
                // 正常命令，标准执行
                // 根据useSudo参数决定是否使用sudo
                const executeCommand = options.useSudo 
                    ? `sudo bash -x ${remoteScriptPath}` 
                    : `bash -x ${remoteScriptPath}`;
                
                result = await this.execCommandWithTimeout(connection, executeCommand, {
                    cwd: options.cwd || '/tmp',
                    timeout: options.timeout || this.timeout || 300000
                });
            }
            
            console.log('脚本执行完成:');
            console.log('  - 退出码:', result.code);
            console.log('  - stdout 长度:', result.stdout?.length || 0);
            console.log('  - stderr 长度:', result.stderr?.length || 0);
            if (result.stdout) {
                console.log('  - stdout:', result.stdout);
            }
            if (result.stderr) {
                console.log('  - stderr (执行过程):', result.stderr);
            }
            
            // 如果执行失败但没有输出，记录警告
            if (result.code !== 0 && !result.stdout && !result.stderr) {
                console.warn('警告: 命令执行失败（退出码:', result.code, '）但未产生任何输出');
                console.warn('可能原因:');
                console.warn('  1. 命令不存在或无法执行');
                console.warn('  2. 管道命令中某个环节失败且输出被过滤');
                console.warn('  3. 权限不足或资源限制');
            }
            
            // 步骤4: 清理临时脚本文件（如果连接仍然存在）
            if (!isDisruptive) {
                try {
                    await this.execCommandWithTimeout(connection, `rm -f ${remoteScriptPath}`, { timeout: 10000 });
                    console.log('临时脚本已清理');
                } catch (cleanupError) {
                    console.warn('清理临时脚本失败（可能连接已断开）:', cleanupError.message);
                }
            } else {
                console.log('跳过清理临时脚本（连接可能已断开）');
            }
            console.log('========================================');
            
            // 关闭连接（仅当由此函数创建连接时）
            if (connectionOwner) {
                try {
                    await connection.dispose();
                } catch (disposeError) {
                    // 连接可能已经断开，忽略错误
                    console.log('关闭连接失败（可能已断开）:', disposeError.message);
                }
            }
            
            // 检测是否为过滤命令无结果的情况（grep/awk/sed等）
            const isFilterCommand = /\b(grep|egrep|fgrep|awk|sed)\b/.test(scriptContent);
            const hasExecutionTrace = result.stderr && result.stderr.trim().length > 0; // bash -x 会产生执行跟踪
            const noStdout = !result.stdout || result.stdout.trim().length === 0;
            
            // 如果是过滤命令、有执行跟踪、无标准输出、退出码为1，则认为是正常执行但无匹配结果
            let isNormalNoMatch = false;
            if (result.code === 1 && isFilterCommand && hasExecutionTrace && noStdout) {
                isNormalNoMatch = true;
                console.log('检测到过滤命令无匹配结果的情况，视为正常执行');
            }
            
            // 为常见的退出码提供提示
            let errorHint = '';
            if (result.code !== 0 && !isNormalNoMatch) {
                switch (result.code) {
                    case 1:
                        if (isFilterCommand) {
                            errorHint = '提示: 退出码 1 可能表示过滤命令无匹配结果（如 grep 未找到匹配项），也可能表示命令执行失败';
                        } else {
                            errorHint = '提示: 退出码 1 通常表示通用错误或命令执行失败';
                        }
                        break;
                    case 2:
                        errorHint = '提示: 退出码 2 通常表示命令用法错误或参数错误';
                        break;
                    case 126:
                        errorHint = '提示: 退出码 126 表示命令无法执行（权限问题）';
                        break;
                    case 127:
                        errorHint = '提示: 退出码 127 表示命令找不到';
                        break;
                    case 130:
                        errorHint = '提示: 退出码 130 表示命令被 Ctrl+C 中断';
                        break;
                    case 137:
                        errorHint = '提示: 退出码 137 表示进程被 SIGKILL 信号杀死（内存不足或被强制终止）';
                        break;
                    case 143:
                        errorHint = '提示: 退出码 143 表示进程被 SIGTERM 信号终止';
                        break;
                    default:
                        if (result.code > 128) {
                            errorHint = `提示: 退出码 ${result.code} 可能表示进程被信号 ${result.code - 128} 终止`;
                        }
                }
            } else if (isNormalNoMatch) {
                errorHint = '提示: 命令执行成功，过滤条件无匹配结果（这是正常情况）';
            }
            
            // 确定最终的执行状态
            const finalSuccess = result.code === 0 || isNormalNoMatch;
            
            return {
                success: finalSuccess,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.code,
                errorHint: errorHint,
                isNormalNoMatch: isNormalNoMatch, // 标记是否为正常的无匹配结果
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error('执行脚本失败:', error);
            
            // 检查是否为破坏性命令导致的连接断开
            const isDisruptive = this.isDisruptiveCommand(scriptContent);
            const isConnectionError = error.message.includes('ECONNRESET') || 
                                     error.message.includes('Connection reset') ||
                                     error.message.includes('Broken pipe') ||
                                     error.message.includes('EPIPE');
            
            if (isDisruptive && isConnectionError) {
                // 破坏性命令导致的连接断开是正常的
                console.log('破坏性命令导致连接断开（正常行为）');
                if (connection && connectionOwner) {
                    try {
                        await connection.dispose();
                    } catch (disposeError) {
                        console.error('关闭SSH连接失败:', disposeError);
                    }
                }
                
                return {
                    success: true,
                    stdout: '命令已执行，主机正在关机/重启，连接已断开',
                    stderr: '',
                    exitCode: 0,
                    errorHint: '提示: 这是关机/重启命令，连接断开是正常现象',
                    timestamp: new Date().toISOString()
                };
            }
            
            if (connection && connectionOwner) {
                try {
                    await connection.dispose();
                } catch (disposeError) {
                    console.error('关闭SSH连接失败:', disposeError);
                }
            }
            
            return {
                success: false,
                message: this.parseErrorMessage(error),
                error: error.message,
                stdout: '',
                stderr: error.message,
                exitCode: -1,
                timestamp: new Date().toISOString()
            };
        }
    }

    // 获取兼容性算法配置（支持老旧Linux系统）
    getCompatibilityAlgorithms() {
        return {
            kex: [
                // 现代安全算法
                'curve25519-sha256',
                'curve25519-sha256@libssh.org',
                'ecdh-sha2-nistp256',
                'ecdh-sha2-nistp384',
                'ecdh-sha2-nistp521',
                'diffie-hellman-group-exchange-sha256',
                'diffie-hellman-group14-sha256',
                'diffie-hellman-group16-sha512',
                'diffie-hellman-group18-sha512',
                // 兼容老系统（弱算法，仅用于兼容）
                'diffie-hellman-group14-sha1',
                'diffie-hellman-group1-sha1'
            ],
            cipher: [
                // 现代安全加密
                'aes128-gcm',
                'aes128-gcm@openssh.com',
                'aes256-gcm',
                'aes256-gcm@openssh.com',
                'aes128-ctr',
                'aes192-ctr',
                'aes256-ctr',
                // 兼容老系统
                'aes128-cbc',
                'aes192-cbc',
                'aes256-cbc',
                '3des-cbc' // 极老系统兼容
            ],
            serverHostKey: [
                // 现代安全密钥
                'ssh-ed25519',
                'ecdsa-sha2-nistp256',
                'ecdsa-sha2-nistp384',
                'ecdsa-sha2-nistp521',
                'rsa-sha2-512',
                'rsa-sha2-256',
                // 兼容老系统
                'ssh-rsa',
                'ssh-dss'
            ],
            hmac: [
                // 现代HMAC算法
                'hmac-sha2-256',
                'hmac-sha2-512',
                // 兼容老系统
                'hmac-sha1',
                'hmac-md5' // 极老系统兼容
            ]
        };
    }

    // 解析错误消息
    parseErrorMessage(error) {
        const message = error.message.toLowerCase();
        
        if (message.includes('timeout') || message.includes('timed out')) {
            return '连接超时：无法在指定时间内连接到主机';
        } else if (message.includes('connection refused') || message.includes('econnrefused')) {
            return '连接被拒绝：目标端口可能未开放或服务未运行';
        } else if (message.includes('host unreachable') || message.includes('ehostunreach')) {
            return '主机不可达：请检查网络连接和IP地址';
        } else if (message.includes('authentication') || message.includes('auth')) {
            return '认证失败：用户名、密码或私钥不正确';
        } else if (message.includes('no such file') && message.includes('key')) {
            return '私钥文件不存在：请检查私钥文件路径';
        } else if (message.includes('permission denied')) {
            return '权限被拒绝：请检查用户权限和认证信息';
        } else if (message.includes('network') || message.includes('enetwork')) {
            return '网络错误：请检查网络连接';
        } else if (message.includes('no matching') && (message.includes('cipher') || message.includes('kex') || message.includes('key exchange'))) {
            return 'SSH算法不匹配：目标系统SSH版本过旧，已启用兼容模式，请重试或联系管理员升级SSH版本';
        } else if (message.includes('handshake') || message.includes('protocol')) {
            return 'SSH协议握手失败：可能是SSH版本不兼容，已启用兼容算法，请重试';
        } else {
            return `连接失败：${error.message}`;
        }
    }

    // 配置公钥到目标主机
    async configurePublicKey(hostData, publicKey) {
        let connection = null;
        
        try {
            connection = new NodeSSH();
            
            const config = {
                host: hostData.ip,
                port: hostData.port || 22,
                username: hostData.username,
                keepaliveInterval: 60000,
                readyTimeout: 15000,
                // 兼容性配置：支持老旧Linux系统
                algorithms: this.getCompatibilityAlgorithms(),
            };

            const privateKeyPath = hostData.privateKeyPath || hostData.private_key_path;
            if (privateKeyPath && fs.existsSync(privateKeyPath)) {
                config.privateKeyPath = privateKeyPath;
            } else if (hostData.password) {
                config.password = hostData.password;
            } else {
                throw new Error('未提供有效的认证方式');
            }

            await connection.connect(config);
            
            const timeout = 15000; // 每个配置步骤 15s 超时

            // 步骤1: 确保.ssh目录存在
            await this.execCommandWithTimeout(connection, 'mkdir -p ~/.ssh', { timeout });
            
            // 步骤2: 设置.ssh目录权限
            await this.execCommandWithTimeout(connection, 'chmod 700 ~/.ssh', { timeout });
            
            // 步骤3: 检查authorized_keys文件是否存在
            const checkResult = await this.execCommandWithTimeout(connection, 'test -f ~/.ssh/authorized_keys && echo "exists" || echo "not_exists"', { timeout });
            
            // 步骤4: 添加公钥到authorized_keys文件
            // 先校验格式：必须为单行标准 SSH 公钥，防止引号/换行/命令替换注入 authorized_keys 写入命令
            const cleanPublicKey = String(publicKey || '').trim();
            const SSH_PUBLIC_KEY_RE = /^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/]+={0,3}(?:\s+\S{1,255})?$/;
            if (/[\r\n]/.test(cleanPublicKey) || !SSH_PUBLIC_KEY_RE.test(cleanPublicKey)) {
                throw new Error('公钥格式非法：必须是单行标准 SSH 公钥（如 ssh-rsa AAAA... comment）');
            }
            
            // 检查公钥是否已存在
            const keyCheckResult = await this.execCommandWithTimeout(connection, `grep -F "${cleanPublicKey}" ~/.ssh/authorized_keys 2>/dev/null || echo "not_found"`, { timeout });
            
            if (keyCheckResult.stdout.trim() === 'not_found') {
                // 添加公钥
                await this.execCommandWithTimeout(connection, `echo "${cleanPublicKey}" >> ~/.ssh/authorized_keys`, { timeout });
            }
            
            // 步骤5: 设置authorized_keys文件权限
            await this.execCommandWithTimeout(connection, 'chmod 600 ~/.ssh/authorized_keys', { timeout });
            
            // 步骤6: 验证配置
            const verifyResult = await this.execCommandWithTimeout(connection, 'ls -la ~/.ssh/authorized_keys', { timeout });
            
            await connection.dispose();
            
            return {
                success: true,
                message: 'SSH公钥配置成功',
                timestamp: new Date().toISOString(),
                details: {
                    keyExists: keyCheckResult.stdout.trim() !== 'not_found',
                    filePermissions: verifyResult.stdout
                }
            };
            
        } catch (error) {
            if (connection) {
                try {
                    await connection.dispose();
                } catch (disposeError) {
                    console.error('关闭SSH连接失败:', disposeError);
                }
            }
            
            return {
                success: false,
                message: `公钥配置失败: ${this.parseErrorMessage(error)}`,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // 生成SSH密钥对
    async generateKeyPair(options = {}) {
        const crypto = require('crypto');
        const { promisify } = require('util');
        const { spawn } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        try {
            const { keySize = 2048, comment = '' } = options;
            
            // 首先尝试使用ssh-keygen命令生成（推荐方式）
            try {
                const tempDir = os.tmpdir();
                const tempKeyPath = path.join(tempDir, `ssh_key_${Date.now()}`);
                
                const sshKeygenArgs = [
                    '-t', 'rsa',
                    '-b', keySize.toString(),
                    '-f', tempKeyPath,
                    '-N', '', // 无密码
                    '-q'      // 静默模式
                ];
                
                if (comment) {
                    sshKeygenArgs.push('-C', comment);
                }
                
                // 执行ssh-keygen命令
                await new Promise((resolve, reject) => {
                    const sshKeygen = spawn('ssh-keygen', sshKeygenArgs);
                    
                    sshKeygen.on('close', (code) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`ssh-keygen exited with code ${code}`));
                        }
                    });
                    
                    sshKeygen.on('error', (error) => {
                        reject(error);
                    });
                });
                
                // 读取生成的密钥
                const privateKey = fs.readFileSync(tempKeyPath, 'utf8');
                const publicKey = fs.readFileSync(tempKeyPath + '.pub', 'utf8');
                
                // 清理临时文件
                try {
                    fs.unlinkSync(tempKeyPath);
                    fs.unlinkSync(tempKeyPath + '.pub');
                } catch (cleanupError) {
                    console.warn('清理临时文件失败:', cleanupError);
                }
                
                return {
                    success: true,
                    publicKey: publicKey.trim(),
                    privateKey: privateKey.trim(),
                    keySize,
                    comment,
                    timestamp: new Date().toISOString()
                };
                
            } catch (sshKeygenError) {
                console.warn('ssh-keygen生成失败，回退到Node.js crypto模块:', sshKeygenError.message);
                
                // 回退到Node.js的crypto模块
                const generateKeyPair = promisify(crypto.generateKeyPair);
                
                const { publicKey, privateKey } = await generateKeyPair('rsa', {
                    modulusLength: keySize,
                    publicKeyEncoding: {
                        type: 'spki',
                        format: 'pem'
                    },
                    privateKeyEncoding: {
                        type: 'pkcs8',
                        format: 'pem'
                    }
                });
                
                // 将PEM格式的公钥转换为SSH格式
                const keyObject = crypto.createPublicKey(publicKey);
                const publicKeyDer = keyObject.export({
                    type: 'spki',
                    format: 'der'
                });
                
                // 构造SSH格式的公钥
                const sshPublicKey = `ssh-rsa ${Buffer.from(publicKeyDer).toString('base64')}${comment ? ' ' + comment : ''}`;
                
                return {
                    success: true,
                    publicKey: sshPublicKey,
                    privateKey: privateKey,
                    keySize,
                    comment,
                    timestamp: new Date().toISOString()
                };
            }
            
        } catch (error) {
            return {
                success: false,
                message: '生成密钥对失败',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // 文件上传方法
    async uploadFile(hostData, localPath, remotePath, options = {}) {
        let connection = null;
        
        try {
            connection = new NodeSSH();
            
            const config = {
                host: hostData.ip,
                port: hostData.port || 22,
                username: hostData.username,
                keepaliveInterval: 60000,
                readyTimeout: options.timeout || 15000,
                // 兼容性配置：支持老旧Linux系统
                algorithms: this.getCompatibilityAlgorithms(),
            };

            const privateKeyPath = hostData.privateKeyPath || hostData.private_key_path;
            if (privateKeyPath && fs.existsSync(privateKeyPath)) {
                config.privateKeyPath = privateKeyPath;
            } else if (hostData.password) {
                config.password = hostData.password;
            } else {
                throw new Error('未提供有效的认证方式');
            }

            await connection.connect(config);
            
            // 连接建立回调：允许调用方登记连接引用（用于强制断连/中止上传）
            if (options.onConnectionCreated) {
                try { options.onConnectionCreated(connection); } catch (_) {}
            }
            
            const pathModule = require('path');
            const fileName = pathModule.basename(localPath);
            const targetDir = remotePath.endsWith('/') ? remotePath : remotePath + '/';
            const fullTargetPath = targetDir + fileName;
            
           console.log(`开始上传文件: ${localPath} => ${fullTargetPath}`);
            
            // 【修复：目录路径陷阱】
            // 步骤1: 检查目标路径是否为已存在的文件（而非目录）
            // 移除末尾斜杠来检查路径是否是文件
            const pathToCheck = targetDir.endsWith('/') ? targetDir.slice(0, -1) : targetDir;
            const pathTypeCheck = await this.execCommandWithTimeout(connection, `if [ -f "${pathToCheck}" ]; then echo "file"; elif [ -d "${targetDir}" ]; then echo "dir"; else echo "not_exists"; fi`, { timeout: 15000 });
            const pathType = pathTypeCheck.stdout.trim();
            
            if (pathType === 'file') {
                // 目标路径是一个已存在的文件，不能作为上传目录
                throw new Error(`目标路径是一个文件而非目录，无法上传: ${targetDir}\n提示：请检查目标路径，确保它是一个有效的目录路径`);
            } else if (pathType === 'not_exists') {
                // 路径不存在
                if (options.pathCreateStrategy === 'auto') {
                    // 自动创建目录
                    console.log(`目录不存在，自动创建: ${targetDir}`);
                    const mkdirResult = await this.execCommandWithTimeout(connection, `mkdir -p "${targetDir}"`, { timeout: 15000 });
                    if (mkdirResult.code !== 0) {
                        throw new Error(`创建目录失败: ${mkdirResult.stderr}`);
                    }
                } else {
                    throw new Error(`目标路径不存在: ${targetDir}\n提示：请先在目标主机上创建该目录，或将路径创建策略设置为"自动创建"`);
                }
            } else if (pathType === 'dir') {
                // 目标是目录，正常情况
                console.log(`目标目录已存在: ${targetDir}`);
            }
            
            // 检查文件是否已存在
            const fileCheckResult = await this.execCommandWithTimeout(connection, `test -f "${fullTargetPath}" && echo "exists" || echo "not_exists"`, { timeout: 15000 });
            const fileExists = fileCheckResult.stdout.trim() === 'exists';
            
            let backupPath = null;
            let backupSuccess = false;
            
            if (fileExists) {
                // 文件已存在，根据策略处理
                if (options.conflictStrategy === 'skip') {
                    console.log(`文件已存在，跳过: ${fullTargetPath}`);
                    await connection.dispose();
                    return {
                        success: true,
                        skipped: true,
                        message: '文件已存在，已跳过',
                        localPath: localPath,
                        remotePath: fullTargetPath,
                        timestamp: new Date().toISOString()
                    };
                } else if (options.conflictStrategy === 'backup') {
                    // 备份现有文件
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
                    backupPath = `${fullTargetPath}.bak.${timestamp}`;
                    console.log(`备份现有文件: ${fullTargetPath} => ${backupPath}`);
                    const backupResult = await this.execCommandWithTimeout(connection, `cp "${fullTargetPath}" "${backupPath}"`, { timeout: 15000 });
                    if (backupResult.code !== 0) {
                        console.warn(`备份文件失败: ${backupResult.stderr}`);
                        backupSuccess = false;
                    } else {
                        backupSuccess = true;
                    }
                }
                // 如果是 'overwrite' 或 'backup' 策略，继续上传覆盖
            }
            
            // 执行文件上传
            const startTime = Date.now();
            
            // 使用 Promise.race 为 putFile 添加整体超时保护
            const uploadTimeout = options.timeout || 600000; // 默认10分钟，因为文件可能很大
            await Promise.race([
                connection.putFile(localPath, fullTargetPath, null, {
                    concurrency: 1,
                    onProgress: (progress) => {
                        if (options.onProgress) {
                            const percent = Math.round((progress.transferred / progress.total) * 100);
                            options.onProgress(percent, progress);
                        }
                    }
                }),
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`文件上传超时（${uploadTimeout}ms）: ${localPath}`));
                    }, uploadTimeout);
                })
            ]);
            
            const duration = Date.now() - startTime;
            
            // 验证文件是否上传成功
            const verifyResult = await this.execCommandWithTimeout(connection, `test -f "${fullTargetPath}" && echo "success" || echo "failed"`, { timeout: 15000 });
            const uploadSuccess = verifyResult.stdout.trim() === 'success';
            
            if (!uploadSuccess) {
                throw new Error('文件上传后验证失败');
            }
            
            // 获取文件大小
            const stats = fs.statSync(localPath);
            const fileSize = stats.size;
            
            console.log(`文件上传成功: ${fullTargetPath} (耗时: ${duration}ms, 大小: ${fileSize} bytes)`);
            
            await connection.dispose();
            
            return {
                success: true,
                localPath: localPath,
                remotePath: fullTargetPath,
                fileSize: fileSize,
                duration: duration,
                backupCreated: fileExists && options.conflictStrategy === 'backup' && backupSuccess,
                backupPath: backupPath,
                backupSuccess: backupSuccess,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error('文件上传失败:', error);
            
            if (connection) {
                try {
                    await connection.dispose();
                } catch (disposeError) {
                    console.error('关闭SSH连接失败:', disposeError);
                }
            }
            
            return {
                success: false,
                message: this.parseErrorMessage(error),
                error: error.message,
                localPath: localPath,
                remotePath: remotePath,
                timestamp: new Date().toISOString()
            };
        }
    }

    // 批量文件上传
    async uploadFiles(hostData, files, remotePath, options = {}) {
        const results = [];
        let cancelled = false;
        
        for (const localPath of files) {
            if (options.shouldCancel && await options.shouldCancel()) {
                cancelled = true;
                break;
            }

            const result = await this.uploadFile(hostData, localPath, remotePath, options);
            results.push(result);
            
            // 如果有失败且不继续，停止上传
            if (!result.success && !options.continueOnError) {
                break;
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failedCount = results.filter(r => !r.success).length;
        
        return {
            success: !cancelled && failedCount === 0,
            cancelled: cancelled,
            results: results,
            total: files.length,
            successCount: successCount,
            failedCount: failedCount,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { SSHService };