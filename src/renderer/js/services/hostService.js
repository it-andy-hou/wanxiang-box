// 主机管理服务
class HostService {
    constructor() {
        this.hosts = [];
        this.loadHosts();
    }
    
    // 加载主机数据
    async loadHosts() {
        try {
            // 优先从数据库加载
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const rawHosts = await ipcRenderer.invoke('host-find-all');
                
                // 转换数据库格式为前端格式
                this.hosts = rawHosts.map(host => {
                    const convertedHost = {
                        id: host.id,
                        hostname: host.hostname,
                        systemName: host.system_name,
                        appName: host.app_name,
                        ip: host.ip,
                        port: host.port,
                        username: host.username,
                        password: host.password,
                        privateKeyPath: host.private_key_path,
                        publicKeyPath: host.public_key_path,
                        description: host.description,
                        tags: Array.isArray(host.tags) ? host.tags : (typeof host.tags === 'string' ? JSON.parse(host.tags || '[]') : []),
                        status: host.status,
                        
                        // 硬件信息字段
                        cpuInfo: host.cpu_info || '',
                        memoryInfo: host.memory_info || '',
                        diskInfo: host.disk_info || '',
                        osInfo: host.os_info || '',
                        kernelVersion: host.kernel_version || host.kernelVersion || '',
                        osType: host.os_type || host.osType || '',
                        osVersion: host.os_version || host.osVersion || '',
                        
                        // 环境和位置信息
                        datacenter: host.datacenter || '',
                        environment: host.environment || '',
                        owner: host.owner || '',
                        
                        // 系统信息收集相关
                        lastInfoCollectedAt: host.last_info_collected_at,
                        systemInfo: null, // 先设为null，下面解析
                        
                        lastConnected: host.last_connected_at,
                        createdAt: host.created_at,
                        updatedAt: host.updated_at
                    };
                    
                    // 解析 system_info_json 字段
                    if (host.system_info_json) {
                        try {
                            convertedHost.systemInfo = JSON.parse(host.system_info_json);
                        } catch (e) {
                            console.warn(`解析主机 ${host.hostname} 的系统信息失败:`, e);
                            convertedHost.systemInfo = {};
                        }
                    } else {
                        convertedHost.systemInfo = {};
                    }

                    // 采集时间持久化在独立字段中，回填到 systemInfo 供界面展示
                    if (!convertedHost.systemInfo.lastCollected && host.last_info_collected_at) {
                        convertedHost.systemInfo.lastCollected = host.last_info_collected_at;
                    }
                    
                    return convertedHost;
                });
            } else {
                // 如果不在Electron环境，使用localStorage
                this.hosts = Utils.storage.get('hosts', []);
            }
            console.log(`加载了 ${this.hosts.length} 台主机`);
            return this.hosts;
        } catch (error) {
            console.error('加载主机数据失败:', error);
            // 降级到localStorage
            this.hosts = Utils.storage.get('hosts', []);
            return this.hosts;
        }
    }
    
    // 保存主机数据（同步到数据库和localStorage）
    async saveHosts() {
        try {
            // 同步到localStorage（作为备份）
            Utils.storage.set('hosts', this.hosts);
            console.log('主机数据保存成功');
            return true;
        } catch (error) {
            console.error('保存主机数据失败:', error);
            return false;
        }
    }
    
    // 获取所有主机
    getAllHosts() {
        return [...this.hosts];
    }
    
    // 根据ID获取主机
    getHostById(id) {
        return this.hosts.find(host => host.id === id);
    }
    
    // 添加主机
    async addHost(hostData) {
        try {
            // 验证主机数据
            const validation = this.validateHost(hostData);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            
            let host;
            
            if (window.require) {
                // 使用数据库保存
                const { ipcRenderer } = window.require('electron');
                host = await ipcRenderer.invoke('host-create', {
                    hostname: hostData.hostname,
                    system_name: hostData.systemName || '',      // 系统名称
                    app_name: hostData.appName || '',            // 应用名称
                    ip: hostData.ip,
                    port: hostData.port || 22,
                    username: hostData.username,
                    password: hostData.password || '',
                    private_key_path: hostData.privateKeyPath || '',
                    public_key_path: hostData.publicKeyPath || '',
                    description: hostData.description || '',
                    tags: hostData.tags || [],
                    
                    // 硬件信息字段
                    cpu_info: hostData.cpuInfo || '',
                    memory_info: hostData.memoryInfo || '',
                    kernel_version: hostData.kernelVersion || '',
                    os_type: hostData.osType || '',
                    os_version: hostData.osVersion || '',
                    
                    // 环境和位置信息
                    datacenter: hostData.datacenter || '',
                    environment: hostData.environment || '',
                    owner: hostData.owner || ''
                });
            } else {
                // 使用localStorage
                host = {
                    id: this.generateId(),
                    hostname: hostData.hostname,
                    systemName: hostData.systemName || '',      // 系统名称
                    appName: hostData.appName || '',            // 应用名称
                    ip: hostData.ip,
                    port: hostData.port || 22,
                    username: hostData.username,
                    password: hostData.password || '',
                    privateKeyPath: hostData.privateKeyPath || '',
                    publicKeyPath: hostData.publicKeyPath || '',
                    description: hostData.description || '',
                    tags: hostData.tags || [],
                    
                    // 硬件信息字段
                    cpuInfo: hostData.cpuInfo || '',
                    memoryInfo: hostData.memoryInfo || '',
                    diskInfo: hostData.diskInfo || '',
                    osInfo: hostData.osInfo || '',
                    
                    // 环境和位置信息
                    datacenter: hostData.datacenter || '',
                    environment: hostData.environment || '',
                    owner: hostData.owner || '',
                    
                    // 系统信息收集相关
                    lastInfoCollectedAt: null,
                    systemInfoJson: '',
                    
                    status: 'unknown',
                    lastConnected: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.hosts.push(host);
                await this.saveHosts();
            }
            
            // 更新本地缓存
            await this.loadHosts();
            
            console.log(`主机 ${host.hostname} 添加成功`);
            return host;
        } catch (error) {
            console.error('添加主机失败:', error);
            throw error;
        }
    }
    
    // 批量录入主机：共享配置字段 + IP 列表，一次提交创建多台
    // 主机名规则：前缀为空 → hostname = ip；有前缀 → `${前缀}-${ip}`
    async batchAddHosts(fields, ips) {
        const results = { added: 0, updated: 0, skipped: [], errors: [] };
        
        try {
            const prefix = (fields.hostnamePrefix || '').trim();
            const records = ips.map(ip => ({
                hostname: prefix ? `${prefix}-${ip}` : ip,
                system_name: fields.systemName || '',
                app_name: fields.appName || '',
                ip: ip,
                port: fields.port || 22,
                username: fields.username,
                password: fields.password || '',
                private_key_path: fields.privateKeyPath || '',
                description: fields.description || '',
                tags: fields.tags || [],
                datacenter: fields.datacenter || '',
                environment: fields.environment || '',
                owner: fields.owner || ''
            }));
            
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const importResults = await ipcRenderer.invoke('host-batch-import', {
                    records,
                    skipExisting: true
                });
                results.added = importResults.added || 0;
                results.updated = importResults.updated || 0;
                results.skipped = importResults.skipped || [];
                results.errors = importResults.errors || [];
            } else {
                // 非 Electron 环境（localStorage）逐条添加兑底
                for (const record of records) {
                    try {
                        await this.addHost({
                            hostname: record.hostname,
                            systemName: record.system_name,
                            appName: record.app_name,
                            ip: record.ip,
                            port: record.port,
                            username: record.username,
                            password: record.password,
                            privateKeyPath: record.private_key_path,
                            description: record.description,
                            tags: record.tags,
                            datacenter: record.datacenter,
                            environment: record.environment,
                            owner: record.owner
                        });
                        results.added++;
                    } catch (error) {
                        if (error.message && error.message.includes('已存在')) {
                            results.skipped.push({ ip: record.ip, reason: '主机已存在' });
                        } else {
                            results.errors.push(`${record.ip}: ${error.message}`);
                        }
                    }
                }
            }
            
            // 刷新本地缓存
            await this.loadHosts();
            
            console.log(`批量录入完成: 新增${results.added}, 跳过${results.skipped.length}, 失败${results.errors.length}`);
            return results;
        } catch (error) {
            console.error('批量录入主机失败:', error);
            throw error;
        }
    }
    
    // 更新主机
    async updateHost(id, updates) {
        try {
            // 获取原有主机数据
            const existingHost = this.getHostById(id);
            if (!existingHost) {
                throw new Error('主机不存在');
            }
            
            let updatedHost;
            
            if (window.require) {
                // 使用数据库更新
                const { ipcRenderer } = window.require('electron');
                const success = await ipcRenderer.invoke('host-update', id, {
                    hostname: updates.hostname !== undefined ? updates.hostname : existingHost.hostname,
                    system_name: updates.systemName !== undefined ? updates.systemName : existingHost.systemName,
                    app_name: updates.appName !== undefined ? updates.appName : existingHost.appName,
                    ip: updates.ip !== undefined ? updates.ip : existingHost.ip,
                    port: updates.port !== undefined ? updates.port : existingHost.port,
                    username: updates.username !== undefined ? updates.username : existingHost.username,
                    password: updates.password !== undefined ? updates.password : existingHost.password,
                    private_key_path: updates.privateKeyPath !== undefined ? updates.privateKeyPath : (existingHost.privateKeyPath || existingHost.private_key_path),
                    public_key_path: updates.publicKeyPath !== undefined ? updates.publicKeyPath : (existingHost.publicKeyPath || existingHost.public_key_path),
                    description: updates.description !== undefined ? updates.description : existingHost.description,
                    tags: updates.tags !== undefined ? updates.tags : existingHost.tags,
                    
                    // 硬件信息字段（保留原有值）
                    cpu_info: updates.cpuInfo !== undefined ? updates.cpuInfo : existingHost.cpuInfo,
                    memory_info: updates.memoryInfo !== undefined ? updates.memoryInfo : existingHost.memoryInfo,
                    kernel_version: updates.kernelVersion !== undefined ? updates.kernelVersion : (existingHost.kernelVersion || existingHost.kernel_version),
                    os_type: updates.osType !== undefined ? updates.osType : (existingHost.osType || existingHost.os_type),
                    os_version: updates.osVersion !== undefined ? updates.osVersion : (existingHost.osVersion || existingHost.os_version),
                    
                    // 环境和位置信息
                    datacenter: updates.datacenter !== undefined ? updates.datacenter : existingHost.datacenter,
                    environment: updates.environment !== undefined ? updates.environment : existingHost.environment,
                    owner: updates.owner !== undefined ? updates.owner : existingHost.owner
                });
                
                if (!success) {
                    throw new Error('主机不存在');
                }
                
                updatedHost = await ipcRenderer.invoke('host-find-by-id', id);
            } else {
                // 使用localStorage更新
                const index = this.hosts.findIndex(host => host.id === id);
                if (index === -1) {
                    throw new Error('主机不存在');
                }
                
                // 合并更新：只更新提供的字段，保留其他字段
                updatedHost = {
                    ...this.hosts[index],
                    hostname: updates.hostname !== undefined ? updates.hostname : this.hosts[index].hostname,
                    systemName: updates.systemName !== undefined ? updates.systemName : this.hosts[index].systemName,
                    appName: updates.appName !== undefined ? updates.appName : this.hosts[index].appName,
                    ip: updates.ip !== undefined ? updates.ip : this.hosts[index].ip,
                    port: updates.port !== undefined ? updates.port : this.hosts[index].port,
                    username: updates.username !== undefined ? updates.username : this.hosts[index].username,
                    password: updates.password !== undefined ? updates.password : this.hosts[index].password,
                    privateKeyPath: updates.privateKeyPath !== undefined ? updates.privateKeyPath : this.hosts[index].privateKeyPath,
                    description: updates.description !== undefined ? updates.description : this.hosts[index].description,
                    tags: updates.tags !== undefined ? updates.tags : (this.hosts[index].tags || []),
                    
                    // 硬件信息字段（保留原有值）
                    cpuInfo: updates.cpuInfo !== undefined ? updates.cpuInfo : this.hosts[index].cpuInfo,
                    memoryInfo: updates.memoryInfo !== undefined ? updates.memoryInfo : this.hosts[index].memoryInfo,
                    diskInfo: updates.diskInfo !== undefined ? updates.diskInfo : this.hosts[index].diskInfo,
                    osInfo: updates.osInfo !== undefined ? updates.osInfo : this.hosts[index].osInfo,
                    
                    // 环境和位置信息
                    datacenter: updates.datacenter !== undefined ? updates.datacenter : this.hosts[index].datacenter,
                    environment: updates.environment !== undefined ? updates.environment : this.hosts[index].environment,
                    owner: updates.owner !== undefined ? updates.owner : this.hosts[index].owner,
                    
                    updatedAt: new Date().toISOString()
                };
                
                // 验证更新的数据
                const validation = this.validateHost(updatedHost);
                if (!validation.isValid) {
                    throw new Error(validation.errors.join(', '));
                }
                
                this.hosts[index] = updatedHost;
                await this.saveHosts();
            }
            
            // 更新本地缓存
            await this.loadHosts();
            
            console.log(`主机 ${updatedHost.hostname} 更新成功`);
            return updatedHost;
        } catch (error) {
            console.error('更新主机失败:', error);
            throw error;
        }
    }
    
    // 删除主机
    async deleteHost(id) {
        try {
            if (window.require) {
                // 使用数据库删除
                const { ipcRenderer } = window.require('electron');
                const success = await ipcRenderer.invoke('host-delete', id);
                
                if (!success) {
                    throw new Error('主机不存在');
                }
            } else {
                // 使用localStorage删除
                const index = this.hosts.findIndex(host => host.id === id);
                if (index === -1) {
                    throw new Error('主机不存在');
                }
                
                const host = this.hosts[index];
                this.hosts.splice(index, 1);
                await this.saveHosts();
            }
            
            // 更新本地缓存
            await this.loadHosts();
            
            console.log('主机删除成功');
            return true;
        } catch (error) {
            console.error('删除主机失败:', error);
            throw error;
        }
    }
    
    // 批量删除主机
    async deleteHosts(ids) {
        try {
            const deletedHosts = [];
            for (const id of ids) {
                const index = this.hosts.findIndex(host => host.id === id);
                if (index !== -1) {
                    deletedHosts.push(this.hosts.splice(index, 1)[0]);
                }
            }
            
            await this.saveHosts();
            console.log(`批量删除了 ${deletedHosts.length} 台主机`);
            return deletedHosts;
        } catch (error) {
            console.error('批量删除主机失败:', error);
            throw error;
        }
    }
    
    // 更新主机状态
    async updateHostStatus(id, status) {
        try {
            const host = this.getHostById(id);
            if (!host) {
                throw new Error('主机不存在');
            }
            
            if (window.require) {
                // 使用数据库更新
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('host-update-status', id, status);
            }
            
            // 更新本地缓存状态
            host.status = status;
            host.lastConnected = status === 'online' ? new Date().toISOString() : host.lastConnected;
            host.updatedAt = new Date().toISOString();
            
            if (!window.require) {
                await this.saveHosts();
            }
            
            return host;
        } catch (error) {
            console.error('更新主机状态失败:', error);
            throw error;
        }
    }
    
    // 搜索主机
    searchHosts(keyword) {
        if (!keyword) return this.hosts;
        
        const lowerKeyword = keyword.toLowerCase();
        return this.hosts.filter(host => 
            host.hostname.toLowerCase().includes(lowerKeyword) ||
            host.ip.toLowerCase().includes(lowerKeyword) ||
            host.description.toLowerCase().includes(lowerKeyword) ||
            host.tags.some(tag => tag.toLowerCase().includes(lowerKeyword))
        );
    }
    
    // 按环境过滤主机
    filterByEnvironment(environment) {
        if (!environment) return this.hosts;
        return this.hosts.filter(host => host.environment === environment);
    }
    
    // 按状态过滤主机
    filterByStatus(status) {
        if (!status) return this.hosts;
        return this.hosts.filter(host => host.status === status);
    }
    
    // 获取统计信息
    getStatistics() {
        const total = this.hosts.length;
        const online = this.hosts.filter(h => h.status === 'online').length;
        const offline = this.hosts.filter(h => h.status === 'offline').length;
        const unknown = this.hosts.filter(h => h.status === 'unknown').length;
        
        const environments = {};
        this.hosts.forEach(host => {
            const env = host.environment || '未设置环境';
            environments[env] = (environments[env] || 0) + 1;
        });
        
        return {
            total,
            online,
            offline,
            unknown,
            environments
        };
    }
    
    // 导入Excel数据（支持新增和更新）
    async importFromExcel(excelData) {
        try {
            // 构建批量导入数据（转换为数据库字段格式）
            const records = [];
            const validationErrors = [];
                
            for (let i = 0; i < excelData.length; i++) {
                const row = excelData[i];
                const ip = (row.ip || '').trim();
                const username = (row.username || '').trim();
                    
                if (!ip || !username) {
                    validationErrors.push(`第${i + 1}行: 缺少必填字段（IP地址、用户名）`);
                    continue;
                }
                    
                const record = {
                    ip: ip,
                    username: username,
                    hostname: ip,
                    port: parseInt(row.port) || 22
                };
                    
                // 可选字段
                if (row.password !== undefined && row.password !== null && row.password !== '') {
                    record.password = String(row.password).trim();
                }
                if (row.description && row.description.trim()) {
                    record.description = row.description.trim();
                }
                if (row.environment && row.environment.trim()) {
                    record.environment = row.environment.trim();
                }
                if (row.systemName && row.systemName.trim()) {
                    record.system_name = row.systemName.trim();
                }
                if (row.appName && row.appName.trim()) {
                    record.app_name = row.appName.trim();
                }
                if (row.datacenter && row.datacenter.trim()) {
                    record.datacenter = row.datacenter.trim();
                }
                if (row.owner && row.owner.trim()) {
                    record.owner = row.owner.trim();
                }
                if (row.privateKeyPath && row.privateKeyPath.trim()) {
                    record.private_key_path = row.privateKeyPath.trim();
                }
                    
                records.push(record);
            }
                
            // 一次性发送到主进程批量处理
            let importResults;
            if (window.require && records.length > 0) {
                const { ipcRenderer } = window.require('electron');
                importResults = await ipcRenderer.invoke('host-batch-import', { records });
            } else {
                importResults = { added: 0, updated: 0, errors: [] };
            }
                
            // 合并验证错误
            importResults.errors = [...validationErrors, ...importResults.errors];
                
            // 导入完成后一次性刷新本地缓存
            await this.loadHosts();
                
            return importResults;
        } catch (error) {
            console.error('Excel导入失败:', error);
            throw error;
        }
    }
    
    // 验证主机数据
    validateHost(host) {
        const errors = [];
        
        if (!host.hostname) {
            errors.push('主机名不能为空');
        }
        
        if (!host.ip) {
            errors.push('IP地址不能为空');
        } else if (!Utils.validators.isIP(host.ip)) {
            errors.push('IP地址格式不正确');
        }
        
        if (!host.username) {
            errors.push('用户名不能为空');
        }
        
        if (host.port && !Utils.validators.isPort(host.port)) {
            errors.push('端口号必须在1-65535之间');
        }
        
        // 检查重复（相同IP、端口和用户名的主机配置）
        const duplicate = this.hosts.find(h => 
            h.id !== host.id && h.ip === host.ip && h.port === host.port && h.username === host.username
        );
        if (duplicate) {
            errors.push('该主机配置已存在');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    // 生成唯一ID
    generateId() {
        return 'host_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    // Ping测试
    async pingHost(ip) {
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                return await ipcRenderer.invoke('ping-host', ip);
            } else {
                // 浏览器环境模拟
                return new Promise((resolve) => {
                    setTimeout(() => {
                        const success = Math.random() > 0.2;
                        resolve({
                            success,
                            message: success ? '在线 (延迟: 45ms)' : '网络不可达 (Ping失败)',
                            latency: success ? 45 : 0
                        });
                    }, 500);
                });
            }
        } catch (error) {
            console.error('Ping测试失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // 测试连接
    async testConnection(id) {
        const host = this.getHostById(id);
        if (!host) {
            throw new Error('主机不存在');
        }
        
        try {
            const result = await this.testConnectionDirect({
                hostname: host.hostname,
                ip: host.ip,
                port: host.port,
                username: host.username,
                password: host.password,
                privateKeyPath: host.privateKeyPath || host.private_key_path
            });
            
            // 更新主机状态
            const newStatus = result.success ? 'online' : 'offline';
            await this.updateHostStatus(id, newStatus);
            
            return {
                ...result,
                host
            };
        } catch (error) {
            console.error('连接测试失败:', error);
            await this.updateHostStatus(id, 'offline');
            throw error;
        }
    }
    async testConnectionDirect(hostData) {
        try {
            if (window.require) {
                // 使用Electron的SSH连接测试
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('ssh-test-connection', {
                    hostname: hostData.hostname,
                    ip: hostData.ip,
                    port: hostData.port || 22,
                    username: hostData.username,
                    password: hostData.password,
                    privateKeyPath: hostData.privateKeyPath
                });
                
                return result;
            } else {
                // 浏览器环境模拟测试
                return new Promise((resolve) => {
                    setTimeout(() => {
                        const success = Math.random() > 0.3; // 70%成功率
                        resolve({
                            success,
                            message: success ? '连接成功' : '连接失败：网络不可达或凭据错误',
                            host: hostData
                        });
                    }, 1000 + Math.random() * 2000);
                });
            }
        } catch (error) {
            console.error('连接测试失败:', error);
            return {
                success: false,
                message: error.message,
                host: hostData
            };
        }
    }
    
    // 收集主机信息
    // options.reload: 是否在写入后刷新本地缓存，批量场景传 false，由调用方统一刷新
    async collectHostInfo(id, options = {}) {
        const host = this.getHostById(id);
        if (!host) {
            throw new Error('主机不存在');
        }
        
        try {
            if (window.require) {
                // 使用Electron的SSH服务收集信息
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('ssh-collect-host-info', {
                    hostname: host.hostname,
                    ip: host.ip,
                    port: host.port,
                    username: host.username,
                    password: host.password,
                    privateKeyPath: host.privateKeyPath || host.private_key_path
                });
                
                if (result.success) {
                    // 更新主机信息
                    await this.updateHostInfo(id, result.data, options);
                }
                
                return result;
            } else {
                // 浏览器环境模拟
                return {
                    success: false,
                    message: '主机信息收集功能需要在Electron环境中使用'
                };
            }
        } catch (error) {
            console.error('收集主机信息失败:', error);
            throw error;
        }
    }
    
    // 更新主机信息（保存收集到的系统信息）
    // options.reload: 是否在写入后刷新本地缓存，批量场景传 false，由调用方统一刷新
    async updateHostInfo(id, systemInfo, options = {}) {
        try {
            const host = this.getHostById(id);
            if (!host) {
                throw new Error('主机不存在');
            }

            // 解析系统信息 JSON
            let parsedInfo = {};
            if (typeof systemInfo === 'string') {
                try {
                    parsedInfo = JSON.parse(systemInfo);
                } catch (e) {
                    console.warn('系统信息解析失败，使用原始数据');
                    parsedInfo = { rawData: systemInfo };
                }
            } else {
                parsedInfo = systemInfo;
            }

            // 提取结构化执行环境信息
            const structuredInfo = this.parseSystemInfo(parsedInfo);

            // 合并系统信息到主机数据
            const updatedData = {
                ...host,
                cpuInfo: structuredInfo.cpu || host.cpuInfo || '',
                memoryInfo: structuredInfo.memory || host.memoryInfo || '',
                kernelVersion: structuredInfo.kernelVer || host.kernelVersion || '',
                osType: structuredInfo.osType || host.osType || '',
                osVersion: structuredInfo.osVersion || host.osVersion || '',
                systemInfo: {
                    ...host.systemInfo,
                    ...parsedInfo,
                    lastCollected: new Date().toISOString()
                },
                lastInfoCollectedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('host-update', id, {
                    hostname: updatedData.hostname,
                    system_name: updatedData.systemName,
                    app_name: updatedData.appName,
                    ip: updatedData.ip,
                    port: updatedData.port,
                    username: updatedData.username,
                    password: updatedData.password,
                    private_key_path: updatedData.privateKeyPath,
                    description: updatedData.description,
                    tags: updatedData.tags,
                    // cpu_info: "N核"，memory_info: 内存总量，kernel_version/os_type/os_version 三字段
                    cpu_info: structuredInfo.cpu || '',
                    memory_info: structuredInfo.memory || '',
                    kernel_version: structuredInfo.kernelVer || '',
                    os_type: structuredInfo.osType || '',
                    os_version: structuredInfo.osVersion || '',
                    datacenter: updatedData.datacenter || '',
                    environment: updatedData.environment || '',
                    system_info_json: JSON.stringify({ ...parsedInfo, lastCollected: updatedData.lastInfoCollectedAt }),
                    last_info_collected_at: updatedData.lastInfoCollectedAt
                });
            } else {
                const index = this.hosts.findIndex(h => h.id === id);
                if (index !== -1) {
                    this.hosts[index] = updatedData;
                    await this.saveHosts();
                }
            }

            // 更新本地缓存（批量场景跳过，由调用方在全部完成后统一刷新）
            if (options.reload !== false) {
                await this.loadHosts();
            }

            return updatedData;
        } catch (error) {
            console.error('更新主机信息失败:', error);
            throw error;
        }
    }
    async batchTestConnection(ids) {
        const results = [];
        
        for (const id of ids) {
            try {
                const result = await this.testConnection(id);
                results.push(result);
            } catch (error) {
                results.push({
                    success: false,
                    message: error.message,
                    host: this.getHostById(id)
                });
            }
        }
        
        return results;
    }

    /**
     * 批量并发连接测试（性能优化版）
     * 在主进程侧并发执行，大幅提升批量测试速度
     * @param {Array} hosts - 主机对象数组
     * @param {number} concurrency - 并发数（默认10）
     * @param {Function} onProgress - 进度回调 ({completed, total, index, result})
     * @returns {Array} 测试结果数组
     */
    async batchTestConnectionConcurrent(hosts, concurrency = 10, onProgress = null) {
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                
                // 监听进度更新事件
                let progressHandler = null;
                if (onProgress) {
                    progressHandler = (event, progress) => {
                        onProgress(progress);
                    };
                    ipcRenderer.on('batch-test-progress', progressHandler);
                }
                
                // 构建主机数据列表
                const hostList = hosts.map(host => ({
                    id: host.id,
                    hostname: host.hostname,
                    ip: host.ip,
                    port: host.port || 22,
                    username: host.username,
                    password: host.password,
                    privateKeyPath: host.privateKeyPath || host.private_key_path
                }));
                
                // 调用批量测试IPC
                let response;
                try {
                    response = await ipcRenderer.invoke('ssh-batch-test-connection', {
                        hostList,
                        concurrency
                    });
                } finally {
                    // 清理进度监听器（无论成功或异常都移除，避免泄漏）
                    if (progressHandler) {
                        ipcRenderer.removeListener('batch-test-progress', progressHandler);
                    }
                }
                
                if (response.success) {
                    // 异步更新所有主机的在线状态（不阻塞结果返回）
                    const statusUpdates = hosts.map((host, i) => {
                        const result = response.results[i];
                        // SSH成功 → online；SSH认证失败 → auth_failed；连接失败 → offline
                        const newStatus = result.success ? 'online'
                            : (result.authFailed ? 'auth_failed' : 'offline');
                        return this.updateHostStatus(host.id, newStatus);
                    });
                    // 后台执行状态更新，不等待完成
                    Promise.all(statusUpdates).catch(err => {
                        console.warn('批量更新主机状态失败:', err);
                    });
                    
                    // 结果中添加host信息
                    return response.results.map((result, i) => ({
                        ...result,
                        host: hosts[i]
                    }));
                } else {
                    throw new Error(response.message || '批量测试失败');
                }
            } else {
                // 浏览器环境回退到串行模式
                return await this.batchTestConnection(hosts.map(h => h.id));
            }
        } catch (error) {
            console.error('批量并发连接测试失败:', error);
            throw error;
        }
    }
    
    // 解析系统信息，提取关键字段
    parseSystemInfo(systemInfo) {
        const result = {
            cpu: '',         // CPU核数，如 "8核"
            memory: '',      // 内存总量，如 "16Gi"
            osArch: '',      // CPU架构，如 "x86_64"
            kernelVer: '',   // 内核版本
            osType: '',      // 系统类型，如 "Red Hat"
            osVersion: '',   // 系统版本，如 "6.8"
            diskFree: ''     // 根分区可用空间
        };

        try {
            // 新格式字段（gatherSystemInfo 返回）
            if (systemInfo.cpuCores) {
                result.cpu = `${systemInfo.cpuCores}核`;
            }
            if (systemInfo.memTotal) {
                result.memory = systemInfo.memTotal;
            }
            if (systemInfo.osArch) {
                result.osArch = systemInfo.osArch;
            }
            if (systemInfo.kernelVer) {
                result.kernelVer = systemInfo.kernelVer;
            }
            if (systemInfo.osType) {
                result.osType = systemInfo.osType;
            }
            if (systemInfo.osVersion) {
                result.osVersion = systemInfo.osVersion;
            }
            if (systemInfo.diskFree) {
                result.diskFree = systemInfo.diskFree;
            }

            // 兼容旧格式字段（向后兼容）
            if (!result.cpu && systemInfo.cpu) {
                result.cpu = systemInfo.cpu;
            }
            if (!result.cpu && systemInfo.cpuCores) {
                result.cpu = `${systemInfo.cpuCores}核`;
            }
            if (!result.memory && systemInfo.totalMemory) {
                result.memory = systemInfo.totalMemory;
            }
            // 旧版本只有 osName，尝试迁移到 osType
            if (!result.osType && systemInfo.osName) {
                // 简化 PRETTY_NAME 只保留发行版名
                result.osType = systemInfo.osName.replace(/\s+\d+.*$/, '').trim();
            }
            if (!result.osType && systemInfo.distribution) {
                result.osType = systemInfo.distribution;
            }

        } catch (error) {
            console.error('解析系统信息失败:', error);
        }

        return result;
    }
}

// 导出服务
window.HostService = HostService;