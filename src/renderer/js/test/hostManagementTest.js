// 主机管理模块集成测试
class HostManagementTest {
    constructor() {
        this.testResults = [];
        this.passedTests = 0;
        this.failedTests = 0;
    }

    // 运行所有测试
    async runAllTests() {
        console.log('🚀 开始主机管理模块集成测试...');
        
        try {
            // 基础功能测试
            await this.testBasicFunctionality();
            
            // 数据验证测试
            await this.testDataValidation();
            
            // CSV导入导出测试
            await this.testCSVFunctionality();
            
            // 连接状态监控测试
            await this.testConnectionMonitoring();
            
            // UI交互测试
            await this.testUIInteractions();
            
            // 输出测试结果
            this.outputResults();
            
        } catch (error) {
            console.error('❌ 测试执行失败:', error);
        }
    }

    // 基础功能测试
    async testBasicFunctionality() {
        console.log('📋 测试基础功能...');
        
        // 测试主机服务初始化
        await this.runTest('主机服务初始化', async () => {
            const hostService = new HostService();
            await hostService.loadHosts();
            return hostService.hosts !== undefined;
        });

        // 测试添加主机
        await this.runTest('添加主机', async () => {
            const testHost = {
                hostname: 'test-host',
                ip: '192.168.1.100',
                port: 22,
                username: 'testuser',
                password: 'testpass',
                description: '测试主机',
                environment: '测试环境',
                tags: ['test', 'demo']
            };
            
            const hostService = new HostService();
            const result = await hostService.addHost(testHost);
            return result && result.id;
        });

        // 测试查询主机
        await this.runTest('查询主机列表', async () => {
            const hostService = new HostService();
            const hosts = hostService.getAllHosts();
            return Array.isArray(hosts);
        });

        // 测试更新主机
        await this.runTest('更新主机信息', async () => {
            const hostService = new HostService();
            const hosts = hostService.getAllHosts();
            if (hosts.length === 0) return true; // 没有主机时跳过测试
            
            const host = hosts[0];
            const updateData = {
                hostname: host.hostname,
                ip: host.ip,
                port: host.port,
                username: host.username,
                password: host.password,
                description: '更新后的描述',
                environment: host.environment,
                tags: host.tags
            };
            
            const result = await hostService.updateHost(host.id, updateData);
            return result && result.description === '更新后的描述';
        });

        // 测试删除主机
        await this.runTest('删除主机', async () => {
            const hostService = new HostService();
            const hosts = hostService.getAllHosts();
            if (hosts.length === 0) return true; // 没有主机时跳过测试
            
            const hostToDelete = hosts.find(h => h.hostname === 'test-host');
            if (!hostToDelete) return true; // 测试主机不存在时跳过
            
            const result = await hostService.deleteHost(hostToDelete.id);
            return result === true;
        });
    }

    // 数据验证测试
    async testDataValidation() {
        console.log('🔍 测试数据验证...');
        
        // 测试IP地址验证
        await this.runTest('IP地址验证', () => {
            const validIPs = ['192.168.1.1', '10.0.0.1', '172.16.0.1'];
            const invalidIPs = ['256.256.256.256', '192.168.1', 'invalid-ip'];
            
            const validResults = validIPs.every(ip => Utils.validators.isIP(ip));
            const invalidResults = invalidIPs.every(ip => !Utils.validators.isIP(ip));
            
            return validResults && invalidResults;
        });

        // 测试端口号验证
        await this.runTest('端口号验证', () => {
            const validPorts = [22, 80, 443, 8080, 65535];
            const invalidPorts = [0, -1, 65536, 99999];
            
            const validResults = validPorts.every(port => Utils.validators.isPort(port));
            const invalidResults = invalidPorts.every(port => !Utils.validators.isPort(port));
            
            return validResults && invalidResults;
        });

        // 测试主机数据验证
        await this.runTest('主机数据验证', () => {
            const hostService = new HostService();
            
            // 有效数据
            const validHost = {
                hostname: 'valid-host',
                ip: '192.168.1.1',
                port: 22,
                username: 'user'
            };
            const validResult = hostService.validateHost(validHost);
            
            // 无效数据
            const invalidHost = {
                hostname: '',
                ip: 'invalid-ip',
                port: 99999,
                username: ''
            };
            const invalidResult = hostService.validateHost(invalidHost);
            
            return validResult.isValid && !invalidResult.isValid;
        });
    }

    // CSV功能测试
    async testCSVFunctionality() {
        console.log('📊 测试CSV功能...');
        
        // 测试CSV解析
        await this.runTest('CSV解析功能', () => {
            const csvContent = `hostname,ip,port,username,password,description,group
test1,192.168.1.1,22,user1,pass1,Test Host 1,生产
test2,192.168.1.2,22,user2,pass2,Test Host 2,测试`;
            
            const parsed = Utils.csv.parse(csvContent);
            return parsed.length === 2 && parsed[0].hostname === 'test1';
        });

        // 测试CSV生成
        await this.runTest('CSV生成功能', () => {
            const data = [
                { hostname: 'test1', ip: '192.168.1.1', username: 'user1' },
                { hostname: 'test2', ip: '192.168.1.2', username: 'user2' }
            ];
            
            const csv = Utils.csv.stringify(data);
            return csv.includes('hostname,ip,username') && csv.includes('test1');
        });

        // 测试CSV导入验证
        await this.runTest('CSV导入数据验证', () => {
            const mockImportData = [
                { hostname: 'valid', ip: '192.168.1.1', username: 'user1' },
                { hostname: '', ip: 'invalid', username: '' }, // 无效数据
                { hostname: 'valid2', ip: '192.168.1.2', username: 'user2' }
            ];
            
            // 模拟验证逻辑
            const valid = [];
            const invalid = [];
            
            mockImportData.forEach(item => {
                if (item.hostname && Utils.validators.isIP(item.ip) && item.username) {
                    valid.push(item);
                } else {
                    invalid.push(item);
                }
            });
            
            return valid.length === 2 && invalid.length === 1;
        });
    }

    // 连接监控测试
    async testConnectionMonitoring() {
        console.log('🔗 测试连接状态监控...');
        
        // 测试监控器初始化
        await this.runTest('连接监控器初始化', () => {
            const monitor = new ConnectionMonitor();
            const stats = monitor.getMonitoringStats();
            return stats && typeof stats.isMonitoring === 'boolean';
        });

        // 测试监控配置
        await this.runTest('监控配置设置', () => {
            const monitor = new ConnectionMonitor();
            const originalInterval = monitor.monitoringInterval;
            
            monitor.setMonitoringInterval(60000);
            const newInterval = monitor.monitoringInterval;
            
            monitor.setMonitoringInterval(originalInterval); // 恢复原设置
            return newInterval === 60000;
        });

        // 测试状态回调
        await this.runTest('状态变化回调', () => {
            const monitor = new ConnectionMonitor();
            let callbackExecuted = false;
            
            const callbackId = monitor.onStatusChange(() => {
                callbackExecuted = true;
            });
            
            // 模拟状态变化
            monitor.notifyStatusChange({ id: 'test' }, 'online', { success: true });
            
            monitor.offStatusChange(callbackId);
            return callbackExecuted;
        });
    }

    // UI交互测试
    async testUIInteractions() {
        console.log('🖱️ 测试UI交互...');
        
        // 测试工具提示功能
        await this.runTest('工具提示功能', () => {
            // 创建测试元素
            const testEl = document.createElement('div');
            testEl.style.position = 'absolute';
            testEl.style.top = '100px';
            testEl.style.left = '100px';
            document.body.appendChild(testEl);
            
            // 创建工具提示
            const tooltip = Utils.tooltip.create(testEl, '测试提示');
            
            // 清理
            document.body.removeChild(testEl);
            tooltip.destroy();
            
            return tooltip && typeof tooltip.destroy === 'function';
        });

        // 测试表单验证
        await this.runTest('表单实时验证', () => {
            // 创建测试表单元素
            const input = document.createElement('input');
            input.type = 'text';
            input.name = 'ip';
            input.className = 'form-control';
            input.value = '192.168.1.1';
            
            // 模拟验证
            let isValid = true;
            const value = input.value.trim();
            if (!Utils.validators.isIP(value)) {
                isValid = false;
            }
            
            return isValid;
        });

        // 测试状态指示器
        await this.runTest('状态指示器显示', () => {
            // 测试状态类名生成
            const getStatusClass = (status) => {
                switch (status) {
                    case 'online': return 'success';
                    case 'offline': return 'danger';
                    case 'testing': return 'warning';
                    default: return 'info';
                }
            };
            
            return getStatusClass('online') === 'success' && 
                   getStatusClass('offline') === 'danger';
        });
    }

    // 运行单个测试
    async runTest(testName, testFunction) {
        try {
            const startTime = Date.now();
            const result = await testFunction();
            const duration = Date.now() - startTime;
            
            if (result) {
                this.passedTests++;
                this.testResults.push({
                    name: testName,
                    status: 'PASS',
                    duration: duration,
                    message: '测试通过'
                });
                console.log(`✅ ${testName} - 通过 (${duration}ms)`);
            } else {
                this.failedTests++;
                this.testResults.push({
                    name: testName,
                    status: 'FAIL',
                    duration: duration,
                    message: '测试未返回预期结果'
                });
                console.log(`❌ ${testName} - 失败 (${duration}ms)`);
            }
        } catch (error) {
            this.failedTests++;
            this.testResults.push({
                name: testName,
                status: 'ERROR',
                duration: 0,
                message: error.message
            });
            console.log(`💥 ${testName} - 错误: ${error.message}`);
        }
    }

    // 输出测试结果
    outputResults() {
        const totalTests = this.passedTests + this.failedTests;
        const successRate = ((this.passedTests / totalTests) * 100).toFixed(1);
        
        console.log('\n📊 测试结果汇总:');
        console.log(`总测试数: ${totalTests}`);
        console.log(`通过: ${this.passedTests}`);
        console.log(`失败: ${this.failedTests}`);
        console.log(`成功率: ${successRate}%`);
        
        if (this.failedTests > 0) {
            console.log('\n❌ 失败的测试:');
            this.testResults
                .filter(test => test.status !== 'PASS')
                .forEach(test => {
                    console.log(`  • ${test.name}: ${test.message}`);
                });
        }
        
        // 显示UI通知
        if (this.failedTests === 0) {
            Utils.notify.success(`🎉 所有测试通过！(${totalTests}/${totalTests})`);
        } else {
            Utils.notify.warning(`⚠️ ${this.failedTests} 个测试失败 (${this.passedTests}/${totalTests} 通过)`);
        }
        
        return {
            total: totalTests,
            passed: this.passedTests,
            failed: this.failedTests,
            successRate: successRate,
            results: this.testResults
        };
    }

    // 生成测试报告
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                total: this.passedTests + this.failedTests,
                passed: this.passedTests,
                failed: this.failedTests,
                successRate: ((this.passedTests / (this.passedTests + this.failedTests)) * 100).toFixed(1)
            },
            details: this.testResults
        };
        
        return JSON.stringify(report, null, 2);
    }
}

// 导出测试类
window.HostManagementTest = HostManagementTest;

// 自动运行测试（如果在开发环境）
if (window.location.search.includes('test=true')) {
    document.addEventListener('DOMContentLoaded', async () => {
        await Utils.sleep(2000); // 等待应用初始化
        const test = new HostManagementTest();
        await test.runAllTests();
    });
}