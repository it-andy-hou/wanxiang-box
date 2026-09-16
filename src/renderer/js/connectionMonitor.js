// 连接状态监控管理器
class ConnectionMonitor {
    constructor() {
        this.monitoringInterval = 30000; // 30秒检查一次
        this.monitoringTimer = null;
        this.isMonitoring = false;
        this.hostService = null;
        this.statusCallbacks = new Map();
        this.retryQueue = new Set();
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5秒重试延迟
    }
    
    // 初始化监控器
    init(hostService) {
        this.hostService = hostService;
        this.startMonitoring();
        console.log('连接状态监控器已启动');
    }
    
    // 开始监控
    startMonitoring() {
        if (this.isMonitoring) return;
        
        this.isMonitoring = true;
        this.scheduleNextCheck();
        
        // 立即执行一次检查
        this.performStatusCheck();
    }
    
    // 停止监控
    stopMonitoring() {
        this.isMonitoring = false;
        if (this.monitoringTimer) {
            clearTimeout(this.monitoringTimer);
            this.monitoringTimer = null;
        }
        console.log('连接状态监控器已停止');
    }
    
    // 安排下次检查
    scheduleNextCheck() {
        if (!this.isMonitoring) return;
        
        this.monitoringTimer = setTimeout(() => {
            this.performStatusCheck();
            this.scheduleNextCheck();
        }, this.monitoringInterval);
    }
    
    // 执行状态检查
    async performStatusCheck() {
        if (!this.hostService) return;
        
        try {
            const hosts = await this.hostService.getAllHosts();
            const activeHosts = hosts.filter(host => 
                this.shouldMonitorHost(host)
            );
            
            console.log(`开始监控 ${activeHosts.length} 台主机的连接状态`);
            
            // 批量检查状态
            await this.batchCheckStatus(activeHosts);
            
        } catch (error) {
            console.error('连接状态检查失败:', error);
        }
    }
    
    // 判断是否应该监控该主机
    shouldMonitorHost(host) {
        // 只监控标记为在线或最近连接过的主机
        return host.status === 'online' || 
               host.status === 'testing' ||
               (host.lastConnected && 
                Date.now() - new Date(host.lastConnected).getTime() < 3600000); // 1小时内连接过
    }
    
    // 批量检查状态
    async batchCheckStatus(hosts) {
        const batchSize = 5; // 并发检查5台主机
        const batches = this.createBatches(hosts, batchSize);
        
        for (const batch of batches) {
            const promises = batch.map(host => this.checkSingleHostStatus(host));
            
            try {
                await Promise.allSettled(promises);
                // 批次之间稍作延迟，避免网络拥塞
                await Utils.sleep(1000);
            } catch (error) {
                console.error('批量状态检查失败:', error);
            }
        }
    }
    
    // 创建批次
    createBatches(array, batchSize) {
        const batches = [];
        for (let i = 0; i < array.length; i += batchSize) {
            batches.push(array.slice(i, i + batchSize));
        }
        return batches;
    }
    
    // 检查单个主机状态
    async checkSingleHostStatus(host) {
        try {
            const result = await this.hostService.testConnectionDirect({
                hostname: host.hostname,
                ip: host.ip,
                port: host.port || 22,
                username: host.username,
                password: host.password,
                privateKeyPath: host.privateKeyPath || host.private_key_path
            });
            
            const newStatus = result.success ? 'online' : 'offline';
            
            // 只在状态变化时更新
            if (host.status !== newStatus) {
                await this.updateHostStatus(host, newStatus, result);
            }
            
            // 从重试队列中移除成功的主机
            if (result.success && this.retryQueue.has(host.id)) {
                this.retryQueue.delete(host.id);
            }
            
        } catch (error) {
            console.error(`检查主机 ${host.hostname || host.ip} 状态失败:`, error);
            
            // 添加到重试队列
            if (!this.retryQueue.has(host.id)) {
                this.retryQueue.add(host.id);
                this.scheduleRetry(host);
            }
        }
    }
    
    // 更新主机状态
    async updateHostStatus(host, newStatus, result) {
        try {
            // 更新数据库状态
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('host-update-status', host.id, newStatus);
            }
            
            // 更新本地状态
            host.status = newStatus;
            host.lastConnected = newStatus === 'online' ? new Date().toISOString() : host.lastConnected;
            
            // 触发状态变化回调
            this.notifyStatusChange(host, newStatus, result);
            
            console.log(`主机 ${host.hostname || host.ip} 状态更新为: ${newStatus}`);
            
        } catch (error) {
            console.error('更新主机状态失败:', error);
        }
    }
    
    // 安排重试
    scheduleRetry(host) {
        setTimeout(async () => {
            if (this.retryQueue.has(host.id)) {
                await this.checkSingleHostStatus(host);
            }
        }, this.retryDelay);
    }
    
    // 注册状态变化回调
    onStatusChange(callback) {
        const id = Date.now() + Math.random();
        this.statusCallbacks.set(id, callback);
        return id; // 返回回调ID，用于取消注册
    }
    
    // 取消状态变化回调
    offStatusChange(callbackId) {
        this.statusCallbacks.delete(callbackId);
    }
    
    // 通知状态变化
    notifyStatusChange(host, newStatus, result) {
        this.statusCallbacks.forEach(callback => {
            try {
                callback(host, newStatus, result);
            } catch (error) {
                console.error('状态变化回调执行失败:', error);
            }
        });
    }
    
    // 手动触发单个主机状态检查
    async checkHostNow(hostId) {
        if (!this.hostService) return null;
        
        try {
            const host = await this.hostService.getHostById(hostId);
            if (!host) return null;
            
            await this.checkSingleHostStatus(host);
            return host;
        } catch (error) {
            console.error('手动检查主机状态失败:', error);
            return null;
        }
    }
    
    // 设置监控间隔
    setMonitoringInterval(interval) {
        this.monitoringInterval = interval;
        
        // 如果正在监控，重新安排
        if (this.isMonitoring) {
            this.stopMonitoring();
            this.startMonitoring();
        }
        
        console.log(`监控间隔已更新为 ${interval}ms`);
    }
    
    // 获取监控统计信息
    getMonitoringStats() {
        return {
            isMonitoring: this.isMonitoring,
            monitoringInterval: this.monitoringInterval,
            retryQueueSize: this.retryQueue.size,
            callbackCount: this.statusCallbacks.size
        };
    }
    
    // 清理资源
    destroy() {
        this.stopMonitoring();
        this.statusCallbacks.clear();
        this.retryQueue.clear();
        this.hostService = null;
    }
}

// 导出连接监控器
window.ConnectionMonitor = ConnectionMonitor;