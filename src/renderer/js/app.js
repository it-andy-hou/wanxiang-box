// 主应用程序逻辑

class SSHToolsApp {
    constructor() {
        this.currentPage = 'hosts';
        this.hosts = [];
        this.filteredHosts = [];
        this.isInitialized = false;
        this.sidebarCollapsed = false;
        this.isMobile = window.innerWidth <= 768;
        this.navigationManager = new NavigationManager();
        
        // 排序和搜索状态
        this.sortField = 'hostname';
        this.sortDirection = 'asc';
        this.searchKeyword = '';
        this.systemNameFilter = '';
        this.appNameFilter = '';
        this.datacenterFilter = '';
        this.environmentFilter = '';
        this.ownerFilter = '';
        this.statusFilter = '';
        
        // 分页状态
        this.paginationCurrentPage = 1;
        this.pageSize = 100; // 增加默认每页显示数量到100
        this.totalPages = 1;
        this.paginatedHosts = [];
        this.enablePagination = true; // 默认启用分页，优化大数据性能

        // 加载状态：初始为 true，数据加载完成后置为 false，用于区分“真正无数据”和“加载中”
        this.isDataLoading = true;

        // 批量IP搜索状态
        this.batchSearchMode = false;  // 是否处于批量IP精确匹配模式
        this.batchSearchIPs = [];      // 已去重的批量IP列表
        
        // 虚拟滚动配置（用于大数据量优化）
        this.virtualScrollEnabled = false; // 是否启用虚拟滚动
        this.virtualScrollBuffer = 10; // 虚拟滚动缓冲区大小
        this.visibleRowStart = 0;
        this.visibleRowEnd = 0;
        
        // 性能优化：缓存筛选器选项
        this.cachedFilterOptions = {
            systemNames: [],
            appNames: [],
            datacenters: [],
            environments: [],
            owners: []
        };
        
        // 初始化服务
        this.hostService = new HostService();
        this.scriptService = new ScriptService();
        this.connectionMonitor = new ConnectionMonitor();
        
        // 将服务暴露到全局，供组件使用
        window.hostService = this.hostService;
        window.scriptService = this.scriptService;
        window.connectionMonitor = this.connectionMonitor;
        
        this.init();
    }
    
    async init() {
        try {
            console.log('初始化万象匣应用...');
            
            // 绑定事件监听器
            this.bindEvents();
            
            // 初始化筛选框样式
            this.initFilterStyles();
            
            // 初始化页面
            this.initPages();
            
            // 加载数据
            await this.loadData();
            
            // 更新UI
            this.updateUI();
            
            // 初始化连接监控器
            this.initConnectionMonitor();
            
            // 启动连接池状态监控
            this.startConnectionPoolMonitoring();
            
            // 初始UI增强功能
            this.initUIEnhancements();
            
            // 加载全局执行设置并应用到页面
            await this.loadGlobalExecutionSettings();

            // 启动后延迟静默检查新版本（不阻塞初始化，失败不影响使用）
            setTimeout(() => this.checkForUpdate(), 3000);

            this.isInitialized = true;
            Utils.notify.success('应用初始化成功');
            this.updateStatus('就绪');
            
        } catch (error) {
            console.error('应用初始化失败:', error);
            Utils.notify.error('应用初始化失败: ' + error.message);
            this.updateStatus('初始化失败');
        }
    }
    
    bindEvents() {
        // 导航菜单事件
        Utils.$$('.nav-item').forEach(item => {
            Utils.on(item, 'click', (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                this.navigationManager.navigateTo(page);
            });
        });
        
        // 快速操作按钮事件
        Utils.on('#importCsvBtn', 'click', () => this.importExcel());
        Utils.on('#exportCsvBtn', 'click', () => this.exportExcel());
        Utils.on('#batchConnectBtn', 'click', () => this.batchConnectTestWithSelector());
        
        // 主机管理相关事件
        Utils.on('#addHostBtn', 'click', () => this.showAddHostModal());
        Utils.on('#refreshHostsBtn', 'click', () => this.refreshHosts());
        Utils.on('#clearFiltersBtn', 'click', () => this.clearFilters());
        Utils.on('#hostSearchInput', 'input', Utils.debounce((e) => {
            this.searchHosts(e.target.value);
        }, 300));
        
        // 搜索相关事件（主机管理页不再提供独立的清除搜索按钮，由「重置全部」覆盖）
        Utils.on('#batchSearchBtn', 'click', () => this.showBatchSearchDialog());
        
        // 表格排序事件
        Utils.$$('.sortable').forEach(header => {
            Utils.on(header, 'click', () => {
                const field = header.dataset.sort;
                this.sortHosts(field);
            });
        });
        
        // 全选复选框事件
        Utils.on('#selectAllHosts', 'change', (e) => {
            this.selectAllHosts(e.target.checked);
        });
        
        // 批量操作事件
        Utils.on('#copyIpsBtn', 'click', () => this.copySelectedIPs());
        Utils.on('#batchTestBtn', 'click', () => this.batchConnectTest());
        Utils.on('#batchCollectBtn', 'click', () => this.batchCollectInfo());
        Utils.on('#batchConfigKeyBtn', 'click', () => this.batchConfigureKeys());
        Utils.on('#batchDeleteBtn', 'click', () => this.batchDeleteHosts());
        
        // 批量修改下拉菜单事件
        Utils.on('#batchModifyBtn', 'click', (e) => {
            e.stopPropagation();
            const dropdown = document.querySelector('.batch-modify-dropdown');
            dropdown.classList.toggle('open');
        });
        Utils.on('#batchChangeUsername', 'click', () => {
            document.querySelector('.batch-modify-dropdown').classList.remove('open');
            this.batchModifyField('username', '用户名');
        });
        Utils.on('#batchChangePassword', 'click', () => {
            document.querySelector('.batch-modify-dropdown').classList.remove('open');
            this.batchModifyField('password', '密码');
        });
        Utils.on('#batchChangeOwner', 'click', () => {
            document.querySelector('.batch-modify-dropdown').classList.remove('open');
            this.batchModifyField('owner', '负责人');
        });
        Utils.on('#batchChangeSystemName', 'click', () => {
            document.querySelector('.batch-modify-dropdown').classList.remove('open');
            this.batchModifyField('systemName', '系统名称');
        });
        // 点击其他地方关闭下拉菜单
        document.addEventListener('click', (e) => {
            const dropdown = document.querySelector('.batch-modify-dropdown');
            if (dropdown && !dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });
        
        // 设置按钮事件
        Utils.on('#settingsBtn', 'click', () => this.showSettings());

        // GitHub 仓库入口按钮
        Utils.on('#githubBtn', 'click', () => this.openGithub());
        
        // 状态显示不再支持点击（已改为普通文本）
        // Utils.on('#statusMessage', 'click', () => this.pingAllHosts());
        
        // 侧边栏切换事件
        Utils.on('#sidebarToggle', 'click', () => this.toggleSidebar());
        
        // 窗口大小变化事件
        Utils.on(window, 'resize', Utils.debounce(() => {
            this.handleResize();
        }, 250));
        
        // 筛选事件
        Utils.on('#hostSystemNameFilter', 'change', (e) => {
            this.systemNameFilter = e.target.value;
            this.updateFilters(); // 更新其他筛选器选项
            this.filterHosts();
        });
        
        Utils.on('#hostAppNameFilter', 'change', (e) => {
            this.appNameFilter = e.target.value;
            this.updateFilters(); // 更新其他筛选器选项
            this.filterHosts();
        });
        
        Utils.on('#hostDatacenterFilter', 'change', (e) => {
            this.datacenterFilter = e.target.value;
            this.updateFilters(); // 更新其他筛选器选项
            this.filterHosts();
        });
        
        Utils.on('#hostEnvironmentFilter', 'change', (e) => {
            this.environmentFilter = e.target.value;
            this.updateFilters(); // 更新其他筛选器选项
            this.filterHosts();
        });
        
        Utils.on('#hostOwnerFilter', 'change', (e) => {
            this.ownerFilter = e.target.value;
            this.updateFilters(); // 更新其他筛选器选项
            this.filterHosts();
        });
        
        Utils.on('#hostStatusFilter', 'change', (e) => {
            this.statusFilter = e.target.value;
            this.updateFilters(); // 更新其他筛选器选项
            this.filterHosts();
        });
        
        // 分页事件
        Utils.on('#firstPageBtn', 'click', () => this.goToPage(1));
        Utils.on('#prevPageBtn', 'click', () => this.goToPage(this.paginationCurrentPage - 1));
        Utils.on('#nextPageBtn', 'click', () => this.goToPage(this.paginationCurrentPage + 1));
        Utils.on('#lastPageBtn', 'click', () => this.goToPage(this.totalPages));
        Utils.on('#pageSizeSelect', 'change', (e) => {
            this.pageSize = parseInt(e.target.value);
            this.paginationCurrentPage = 1;
            this.filterHosts();
        });
        
        // IPC事件监听
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            
            // 先移除可能存在的旧监听器，避免重复监听
            ipcRenderer.removeAllListeners('menu-import-excel');
            ipcRenderer.removeAllListeners('menu-export-excel');
            ipcRenderer.removeAllListeners('menu-about');
            
            ipcRenderer.on('menu-import-excel', () => this.importExcel());
            ipcRenderer.on('menu-export-excel', () => this.exportExcel());
            ipcRenderer.on('menu-about', () => this.showAbout());
        }
    }
    
    initPages() {
        // 显示默认页面
        this.navigationManager.navigateTo(this.currentPage);
        
        // 获取应用版本
        this.updateAppVersion();
    }
    
    // 初始化筛选框样式，强制覆盖浏览器autofill样式
    initFilterStyles() {
        const filterIds = [
            'hostSystemNameFilter',
            'hostAppNameFilter',
            'hostDatacenterFilter',
            'hostEnvironmentFilter',
            'hostOwnerFilter',
            'hostStatusFilter'
        ];
        
        filterIds.forEach(id => {
            const select = Utils.$(`#${id}`);
            if (select) {
                // 强制设置背景样式
                select.style.setProperty('background-color', 'white', 'important');
                select.style.setProperty('background-image', 'none', 'important');
                select.style.setProperty('background', 'white', 'important');
                
                // 监听change事件，确保值为空时样式正确
                select.addEventListener('change', function() {
                    if (this.value === '') {
                        this.style.setProperty('background-color', 'white', 'important');
                        this.style.setProperty('background-image', 'none', 'important');
                        this.style.setProperty('background', 'white', 'important');
                    }
                });
            }
        });
    }
    
    async loadData() {
        // 从服务层加载数据
        try {
            this.hosts = await this.hostService.loadHosts();
            await this.scriptService.loadScripts();
            console.log(`加载了 ${this.hosts.length} 台主机`);
            
            // 性能优化：构建筛选器选项缓存
            this.buildFilterOptionsCache();
            
            // 性能优化：根据数据量自动调整分页大小
            this.autoAdjustPageSize();
            
            // 更新筛选器
            this.updateFilters();

            // 数据加载完成，先置为非加载态，再重新应用当前筛选条件
            // filterHosts 内部会完成 排序 -> 分页 -> 渲染 -> 统计/分页信息/重置徽标更新
            // 从而刷新数据时保留用户的筛选/搜索状态，而不是重置为全量列表
            this.isDataLoading = false;
            this.filterHosts();
        } catch (error) {
            this.isDataLoading = false;
            console.error('加载数据失败:', error);
            Utils.notify.error('加载数据失败: ' + error.message);
        }
    }
    
    updateUI() {
        // 更新主机列表
        this.renderCurrentView();
        
        // 更新统计信息
        this.updateStats();
        
        // 更新连接状态
        this.updateConnectionStatus();
        
        // 更新选中状态
        this.updateBatchActions();
    }
    
    // 初始化连接监控器（简化版）
    initConnectionMonitor() {
        try {
            // 简化的状态显示，不再使用复杂的监控器
            this.updateConnectionStatus('ready', '就绪');
            console.log('简化连接状态初始化成功');
        } catch (error) {
            console.error('初始化连接状态失败:', error);
        }
    }
    
    // 初始化UI增强功能
    initUIEnhancements() {
        try {
            // 初始化工具提示
            this.initTooltips();
            
            // 增强表单验证
            this.enhanceFormValidation();
            
            console.log('UI增强功能初始化成功');
        } catch (error) {
            console.error('UI增强功能初始化失败:', error);
        }
    }
    
    // 主机状态变化回调
    onHostStatusChanged(host, newStatus, result) {
        console.log(`主机 ${host.hostname || host.ip} 状态变化: ${host.status} -> ${newStatus}`);
        
        // 更新UI中的主机状态
        this.updateHostStatusInUI(host, newStatus);
        
        // 更新统计信息
        this.updateStats();
        
        // 显示状态变化通知
        if (newStatus === 'offline' && host.status === 'online') {
            Utils.notify.warning(`主机 ${host.hostname || host.ip} 已断开连接`);
        } else if (newStatus === 'online' && host.status === 'offline') {
            Utils.notify.success(`主机 ${host.hostname || host.ip} 已重新连接`);
        }
    }
    
    // 在UI中更新主机状态
    updateHostStatusInUI(host, newStatus) {
        // 更新表格视图中的状态
        const hostRows = document.querySelectorAll('#hostsTable tbody tr');
        hostRows.forEach(row => {
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (checkbox && checkbox.value) {
                const hostIndex = parseInt(checkbox.value);
                if (this.hosts[hostIndex] && this.hosts[hostIndex].id === host.id) {
                    const statusCell = row.cells[8]; // 状态列
                    if (statusCell) {
                        const statusBadge = statusCell.querySelector('.status-badge');
                        if (statusBadge) {
                            statusBadge.className = `status-badge ${this.getHostStatusClass(newStatus)}`;
                            statusBadge.textContent = this.getHostStatusText(newStatus);
                        }
                    }
                }
            }
        });
    }
    
    switchPage(pageId) {
        // 隐藏所有页面
        Utils.$$('.page').forEach(page => {
            page.style.display = 'none';
        });
        
        // 显示目标页面
        // 注意：置空而非 'block'，恢复 CSS 中 .page { display: flex } 的布局，
        // 否则 inline block 会断裂 flex:1/min-height:0 高度链，导致页面级滚动失效
        const targetPage = Utils.$(`#page-${pageId}`);
        if (targetPage) {
            targetPage.style.display = '';
            this.currentPage = pageId;
            
            // 更新导航状态
            Utils.$$('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            Utils.$(`[data-page="${pageId}"]`).classList.add('active');
            
            // 移动端自动隐藏侧边栏
            if (this.isMobile) {
                this.hideSidebar();
            }
        }
    }
    
    renderHostsTable() {
        const tbody = Utils.$('#hostsTable tbody');
        if (!tbody) return;
        
        // 性能优化：使用DocumentFragment减少DOM重绘
        const fragment = document.createDocumentFragment();
        
        // 获取当前显示的主机列表（如果启用了分页则使用分页数据）
        const hostsToRender = this.enablePagination ? this.paginatedHosts : this.filteredHosts;
        
        if (hostsToRender.length === 0) {
            let emptyIcon, emptyTitle, emptyDesc;

            if (this.isDataLoading) {
                // 数据加载中
                emptyIcon = Utils.icon('hourglass', 32);
                emptyTitle = '加载中...';
                emptyDesc = '正在从数据库加载主机数据，请稍候';
            } else if (this.hosts.length === 0) {
                // 数据库中真正没有主机
                emptyIcon = Utils.icon('server', 32);
                emptyTitle = '暂无主机数据';
                emptyDesc = '点击右上角「添加主机」按鈕开始添加，或通过 Excel 批量导入';
            } else {
                // 有主机，但当前筛选条件下无匹配结果
                emptyIcon = Utils.icon('search', 32);
                emptyTitle = '未找到匹配的主机';
                emptyDesc = '当前筛选条件下无结果，请调整筛选条件或点击「重置全部」清除筛选';
            }

            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="text-center text-muted">
                        <div class="empty-state">
                            <div class="empty-state-icon">${emptyIcon}</div>
                            <div class="empty-state-title">${emptyTitle}</div>
                            <div class="empty-state-description">${emptyDesc}</div>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        // 性能优化：批量创建行，减少innerHTML的使用
        const rowsHTML = hostsToRender.map((host, index) => {
            const originalIndex = this.hosts.indexOf(host);
            return `
                <tr data-environment="${host.environment || ''}" data-status="${host.status || 'unknown'}">
                    <td><input type="checkbox" name="hostCheck" value="${originalIndex}" onchange="app.updateBatchActions()"></td>
                    <td><code class="ip-address">${host.ip || '-'}</code></td>
                    <td><span class="system-name">${host.systemName || host.system_name || '-'}</span></td>
                    <td><span class="app-name">${host.appName || host.app_name || '-'}</span></td>
                    <td><span class="badge badge-secondary">${host.port || '22'}</span></td>
                    <td><span class="username">${host.username || '-'}</span></td>
                    <td><span class="os-info-badge" title="${(host.osType || host.os_type || '') + (host.osVersion || host.os_version ? ' ' + (host.osVersion || host.os_version) : '')}">${this.formatOsInfo(host)}</span></td>
                    <td><span class="datacenter-badge">${host.datacenter || '-'}</span></td>
                    <td>
                        <span class="environment-badge ${this.getEnvironmentClass(host.environment)}">
                            ${host.environment || '-'}
                        </span>
                    </td>
                    <td><span class="owner-name">${host.owner || '-'}</span></td>
                    <td>
                        <span class="status-badge ${this.getHostStatusClass(host.status)}">
                            ${this.getHostStatusText(host.status)}
                        </span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn btn-sm btn-primary" onclick="app.connectHost(${originalIndex})" 
                                    title="连接测试" data-tooltip="测试SSH连接">
                                <span class="btn-icon">${Utils.icon('plug', 13)}</span>
                            </button>
                            <button class="btn btn-sm btn-info" onclick="app.viewHostInfo(${originalIndex})" 
                                    title="查看信息" data-tooltip="查看系统信息">
                                <span class="btn-icon">${Utils.icon('bar-chart', 13)}</span>
                            </button>
                            <button class="btn btn-sm btn-warning" onclick="app.configureSSHKey(${originalIndex})" 
                                    title="配置SSH密钥" data-tooltip="配置免密登录">
                                <span class="btn-icon">${Utils.icon('key', 13)}</span>
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="app.editHost(${originalIndex})" 
                                    title="编辑主机" data-tooltip="编辑主机信息">
                                <span class="btn-icon">${Utils.icon('edit', 13)}</span>
                            </button>
                            <button class="btn btn-sm btn-outline-primary" onclick="app.copyHost(${originalIndex})" 
                                    title="复制主机" data-tooltip="复制该主机，仅需修改机房/IP/主机名">
                                <span class="btn-icon">${Utils.icon('copy', 13)}</span>
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="app.deleteHost(${originalIndex})" 
                                    title="删除主机" data-tooltip="删除该主机">
                                <span class="btn-icon">${Utils.icon('trash-2', 13)}</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        // 性能优化：一次性设置innerHTML，避免多次DOM操作
        tbody.innerHTML = rowsHTML;
    }

    // 格式化 OS 信息展示：系统类型 + 系统版本
    formatOsInfo(host) {
        const osType    = host.osType    || host.os_type    || '';
        const osVersion = host.osVersion || host.os_version || '';
        if (!osType && !osVersion) return '-';
        const text = osVersion ? `${osType} ${osVersion}`.trim() : osType;
        return text.length > 16 ? text.slice(0, 16) + '…' : text;
    }
    
    getHostStatusClass(status) {
        switch (status) {
            case 'online': return 'success';
            case 'offline': return 'danger';
            case 'auth_failed': return 'warning';
            case 'testing': return 'warning';
            default: return 'info';
        }
    }
    
    getHostStatusText(status) {
        switch (status) {
            case 'online': return '在线';
            case 'offline': return '离线';
            case 'auth_failed': return '认证失败';
            case 'testing': return '测试中';
            default: return '未知';
        }
    }
    
    getEnvironmentClass(environment) {
        switch (environment) {
            case '生产': return 'badge-danger';
            case '测试': return 'badge-warning';
            case '灰度': return 'badge-info';
            case '开发': return 'badge-success';
            default: return 'badge-secondary';
        }
    }
    
    async updateStats() {
        // 主机统计（底部状态栏）
        const total = this.hosts.length;
        const online = this.hosts.filter(host => host.status === 'online').length;
        const offline = this.hosts.filter(host => host.status === 'offline').length;
        const unknown = this.hosts.filter(host => host.status === 'unknown').length;
        
        Utils.$('#totalHosts').textContent = total;
        Utils.$('#onlineHosts').textContent = online;
        Utils.$('#offlineHosts').textContent = offline;
        Utils.$('#unknownHosts').textContent = unknown;
        
        // 获取其他统计数据
        await this.loadExtendedStats();
    }
    
    // 加载扩展统计数据
    async loadExtendedStats() {
        try {
            const { ipcRenderer } = window.require('electron');
            const stats = await ipcRenderer.invoke('app:getDashboardStats');
            
            if (stats.success) {
                // 资源统计（底部状态栏）
                Utils.$('#totalScripts').textContent = stats.data.scripts || 0;
                Utils.$('#totalProjectTasks').textContent = stats.data.projectTasks || 0;
                Utils.$('#totalScheduledTasks').textContent = stats.data.scheduledTasks || 0;
            }
        } catch (error) {
            console.warn('加载扩展统计数据失败:', error);
            // 静默失败，不影响主功能
        }
    }
    
    // 获取主机统计信息
    getStatistics() {
        const total = this.hosts.length;
        const online = this.hosts.filter(h => h.status === 'online').length;
        const offline = this.hosts.filter(h => h.status === 'offline').length;
        const unknown = this.hosts.filter(h => h.status === 'unknown').length;
        
        return {
            total,
            online,
            offline,
            unknown
        };
    }
    
    updateConnectionStatus(status = 'ready', message = '就绪') {
        const statusEl = Utils.$('#connectionStatus');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `status-indicator status-${status}`;
            
            // 添加状态指示点击事件
            statusEl.onclick = () => this.showConnectionStatus();
            statusEl.style.cursor = 'pointer';
            statusEl.title = '点击查看连接状态和连接池统计';
        }
    }
    
    // 定期更新连接池状态
    startConnectionPoolMonitoring() {
        // 立即执行一次
        this.updateConnectionPoolStatus();
        
        // 每3秒更新一次
        this.connectionPoolTimer = setInterval(() => {
            this.updateConnectionPoolStatus();
        }, 3000);
    }
    
    // 更新连接池状态
    async updateConnectionPoolStatus() {
        try {
            if (!window.require) return;
            
            const { ipcRenderer } = window.require('electron');
            const stats = await ipcRenderer.invoke('get-connection-pool-stats');
            
            if (stats.success) {
                const statusEl = Utils.$('#connectionStatus');
                if (statusEl) {
                    const activeCount = stats.activeConnections || 0;
                    const totalCreated = stats.totalConnectionsCreated || 0;
                    
                    // 根据活跃连接数更新状态
                    if (activeCount > 0) {
                        statusEl.textContent = `活跃连接: ${activeCount}`;
                        statusEl.className = 'status-indicator status-active';
                    } else {
                        statusEl.textContent = `就绪 (总: ${totalCreated})`;
                        statusEl.className = 'status-indicator status-ready';
                    }
                    
                    // 更新tooltip
                    statusEl.title = `点击查看详情\n活跃连接: ${activeCount}\n总连接数: ${totalCreated}`;
                }
            }
        } catch (error) {
            console.error('获取连接池状态失败:', error);
        }
    }
    
    // 显示连接状态详情
    async showConnectionStatus() {
        const hostStats = this.getStatistics();
        
        // 获取连接池状态
        let poolStats = {
            activeConnections: 0,
            totalConnectionsCreated: 0,
            totalConnectionsClosed: 0,
            uptime: 0,
            lastActivityTime: 0
        };
        
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('get-connection-pool-stats');
                if (result.success) {
                    poolStats = result;
                }
            }
        } catch (error) {
            console.error('获取连接池状态失败:', error);
        }
        
        // 格式化运行时间
        const formatUptime = (ms) => {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) return `${days}天 ${hours % 24}小时`;
            if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
            if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`;
            return `${seconds}秒`;
        };
        
        // 计算最后活动时间
        const lastActivityText = poolStats.lastActivityTime > 0 
            ? new Date(poolStats.lastActivityTime).toLocaleString('zh-CN')
            : '无';
        
        const statusDialog = new Modal({
            title: '连接状态监控',
            content: `
                <div class="connection-status-dialog">
                    <!-- SSH连接池状态 -->
                    <div class="status-section">
                        <h6><i class="fas fa-network-wired"></i> SSH连接池状态</h6>
                        <div class="status-item">
                            <span class="status-label">活跃连接数:</span>
                            <span class="status-value text-primary"><strong>${poolStats.activeConnections}</strong></span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">总连接数(创建):</span>
                            <span class="status-value">${poolStats.totalConnectionsCreated}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">总连接数(关闭):</span>
                            <span class="status-value">${poolStats.totalConnectionsClosed}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">应用运行时间:</span>
                            <span class="status-value">${formatUptime(poolStats.uptime)}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">最后活动时间:</span>
                            <span class="status-value">${lastActivityText}</span>
                        </div>
                    </div>
                    
                    <!-- 主机状态 -->
                    <div class="status-section mt-3">
                        <h6><i class="fas fa-server"></i> 主机状态统计</h6>
                        <div class="status-item">
                            <span class="status-label">总主机数:</span>
                            <span class="status-value">${hostStats.total}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">在线主机:</span>
                            <span class="status-value text-success"><strong>${hostStats.online}</strong></span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">离线主机:</span>
                            <span class="status-value text-danger">${hostStats.offline}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">未知状态:</span>
                            <span class="status-value text-warning">${hostStats.unknown}</span>
                        </div>
                    </div>
                    
                    <div class="mt-3">
                        <h6>操作</h6>
                        <div class="btn-group" role="group">
                            <button type="button" class="btn btn-sm btn-primary" id="pingAllBtn">
                                <i class="fas fa-sync-alt"></i> Ping所有主机
                            </button>
                            <button type="button" class="btn btn-sm btn-info" id="refreshStatsBtn">
                                <i class="fas fa-refresh"></i> 刷新统计
                            </button>
                        </div>
                    </div>
                </div>
            `,
            width: '600px',
            onShow: () => {
                // 绑定事件
                document.getElementById('pingAllBtn').onclick = () => {
                    this.pingAllHosts();
                    statusDialog.hide();
                };
                
                document.getElementById('refreshStatsBtn').onclick = async () => {
                    statusDialog.hide();
                    await this.showConnectionStatus();
                };
            }
        });
        
        statusDialog.show();
    }
    
    // 真实的Ping所有主机操作（主进程高并发Worker池模式）
    async pingAllHosts() {
        if (this.hosts.length === 0) {
            Utils.notify.warning('没有主机可以检测');
            return;
        }
        
        this.updateStatus('正在检测主机状态...');
        const overlay = Utils.loading.show(document.body, '正在Ping所有主机...');
        
        try {
            if (window.require) {
                // Electron环境：使用主进程高并发批量Ping
                const { ipcRenderer } = window.require('electron');
                
                // 构建主机列表
                const hostList = this.hosts.map(host => ({
                    id: host.id,
                    ip: host.ip,
                    port: host.port || 22
                }));
                
                // 监听进度更新
                let lastUIUpdate = 0;
                const progressHandler = (event, progress) => {
                    // 每10个或每500ms更新一次UI，避免过于频繁
                    const now = Date.now();
                    if (progress.completed === progress.total || now - lastUIUpdate > 500) {
                        lastUIUpdate = now;
                        const pct = Math.round(progress.completed / progress.total * 100);
                        overlay.querySelector && overlay.querySelector('.loading-text') &&
                            (overlay.querySelector('.loading-text').textContent = `正在Ping主机... ${progress.completed}/${progress.total} (${pct}%)`);
                    }
                    
                    // 实时更新单台主机状态
                    if (progress.result && progress.index !== undefined) {
                        const host = this.hosts[progress.index];
                        if (host) {
                            host.status = progress.result.success ? 'online' : 'offline';
                        }
                    }
                };
                ipcRenderer.on('batch-ping-progress', progressHandler);
                
                // 调用主进程批量Ping（并发50，超时1500ms）
                let response;
                try {
                    response = await ipcRenderer.invoke('batch-ping-hosts', {
                        hostList,
                        concurrency: 50,
                        timeout: 1500
                    });
                } finally {
                    // 清理监听器（无论成功或异常都移除，避免泄漏）
                    ipcRenderer.removeListener('batch-ping-progress', progressHandler);
                }
                
                if (response.success) {
                    let onlineCount = 0;
                    let offlineCount = 0;
                    let authFailedCount = 0;
                    
                    // 更新所有主机状态
                    // 规则：TCP成功且当前不是auth_failed → online；TCP成功且当前是auth_failed → 保留auth_failed；TCP失败 → offline
                    const statusUpdates = [];
                    for (let i = 0; i < this.hosts.length; i++) {
                        const result = response.results[i];
                        const currentStatus = this.hosts[i].status;
                        let newStatus;
                        if (result && result.success) {
                            // TCP可达：保留更有价值的auth_failed状态，否则设为online
                            newStatus = (currentStatus === 'auth_failed') ? 'auth_failed' : 'online';
                        } else {
                            // TCP不可达 → offline
                            newStatus = 'offline';
                        }
                        this.hosts[i].status = newStatus;
                        if (newStatus === 'online') onlineCount++;
                        else if (newStatus === 'offline') offlineCount++;
                        else if (newStatus === 'auth_failed') authFailedCount++;
                        // 仅当状态确实发生变化时才写DB
                        if (newStatus !== currentStatus) {
                            statusUpdates.push(this.hostService.updateHostStatus(this.hosts[i].id, newStatus));
                        }
                    }
                    
                    // 异步批量更新数据库（不阻塞UI）
                    if (statusUpdates.length > 0) {
                        Promise.all(statusUpdates).catch(err => console.error('批量更新状态失败:', err));
                    }
                    
                    // 更新UI
                    this.updateStats();
                    this.updateUI();
                    
                    const authMsg = authFailedCount > 0 ? `，认证失败: ${authFailedCount}(已保留)` : '';
                    Utils.notify.success(`Ping完成！${this.hosts.length}台主机 - 在线: ${onlineCount}, 离线: ${offlineCount}${authMsg}，耗时: ${(response.totalDuration / 1000).toFixed(1)}s`);
                } else {
                    throw new Error(response.message || 'Ping失败');
                }
            } else {
                // 浏览器环境fallback：使用旧的TCP连接方式
                await this._pingAllHostsFallback();
            }
        } catch (error) {
            console.error('Ping操作失败:', error);
            Utils.notify.error('Ping操作失败: ' + error.message);
        } finally {
            this.updateStatus('就绪');
            Utils.loading.hide(overlay);
        }
    }
    
    // 浏览器环境下的Ping fallback方法
    async _pingAllHostsFallback() {
        let onlineCount = 0;
        let offlineCount = 0;
        
        const concurrencyLimit = 20;
        const hostGroups = [];
        for (let i = 0; i < this.hosts.length; i += concurrencyLimit) {
            hostGroups.push(this.hosts.slice(i, i + concurrencyLimit));
        }
        
        for (const hostGroup of hostGroups) {
            const promises = hostGroup.map(async (host) => {
                const originalIndex = this.hosts.indexOf(host);
                const isOnline = await this.testHostConnection(host.ip, host.port || 22, 1500);
                const newStatus = isOnline ? 'online' : 'offline';
                await this.hostService.updateHostStatus(host.id, newStatus);
                this.hosts[originalIndex].status = newStatus;
                if (isOnline) onlineCount++; else offlineCount++;
            });
            await Promise.all(promises);
            this.updateStats();
            this.renderCurrentView();
        }
        
        this.updateStats();
        this.updateUI();
        Utils.notify.success(`Ping完成！${this.hosts.length}台主机 - 在线: ${onlineCount}, 离线: ${offlineCount}`);
    }
    
    // 测试主机连接的辅助方法
    async testHostConnection(ip, port, timeout = 3000) {
        return new Promise((resolve) => {
            try {
                // 在浏览器环境中，我们无法直接进行TCP连接
                // 但可以尝试使用其他方法来检测网络可达性
                
                if (window.require) {
                    // 在Electron环境中，可以使用Node.js的net模块
                    const net = window.require('net');
                    
                    const socket = new net.Socket();
                    let isResolved = false;
                    
                    const timeoutId = setTimeout(() => {
                        if (!isResolved) {
                            isResolved = true;
                            socket.destroy();
                            console.log(`⏰ 连接 ${ip}:${port} 超时 (${timeout}ms)`);
                            resolve(false);
                        }
                    }, timeout);
                    
                    socket.setTimeout(timeout);
                    
                    socket.on('connect', () => {
                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeoutId);
                            socket.destroy();
                            console.log(`✅ 连接 ${ip}:${port} 成功`);
                            resolve(true);
                        }
                    });
                    
                    socket.on('timeout', () => {
                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeoutId);
                            socket.destroy();
                            console.log(`⏰ 连接 ${ip}:${port} 超时`);
                            resolve(false);
                        }
                    });
                    
                    socket.on('error', (err) => {
                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeoutId);
                            socket.destroy();
                            // 对常见错误进行分类处理
                            const errorCode = err.code || err.message;
                            if (errorCode === 'ECONNREFUSED') {
                                console.log(`❌ 连接 ${ip}:${port} 被拒绝 (端口未开放)`);
                            } else if (errorCode === 'EHOSTUNREACH') {
                                console.log(`❌ 连接 ${ip}:${port} 主机不可达`);
                            } else if (errorCode === 'ENETUNREACH') {
                                console.log(`❌ 连接 ${ip}:${port} 网络不可达`);
                            } else {
                                console.log(`❌ 连接 ${ip}:${port} 错误: ${errorCode}`);
                            }
                            resolve(false);
                        }
                    });
                    
                    // 尝试连接
                    socket.connect(port, ip);
                    
                } else {
                    // 在纯浏览器环境中，使用HTTP请求作为备用方案
                    console.log(`🌐 浏览器环境，使用HTTP方式检测 ${ip}:${port}`);
                    this.testHostViaHTTP(ip, port, timeout).then(resolve);
                }
                
            } catch (error) {
                console.error(`连接测试异常 ${ip}:${port}:`, error);
                resolve(false);
            }
        });
    }
    
    // HTTP方式测试主机可达性（备用方案）
    async testHostViaHTTP(ip, port, timeout = 3000) {
        try {
            // 对于常见的SSH端口（非HTTP端口），我们使用不同的策略
            if (port === 22 || port === 2222) {
                // SSH端口：尝试ping主机或使用telnet风格的检测
                return await this.testSSHPortViaPing(ip, timeout);
            } else if (port === 80 || port === 8080 || port === 443 || port === 8443) {
                // HTTP/HTTPS端口：直接尝试HTTP请求
                return await this.testHTTPPort(ip, port, timeout);
            } else {
                // 其他端口：尝试基本的可达性检测
                return await this.testGenericPort(ip, port, timeout);
            }
            
        } catch (error) {
            console.log(`🌐 HTTP检测 ${ip}:${port} 失败:`, error.message);
            return false;
        }
    }
    
    // 检测SSH端口的可达性
    async testSSHPortViaPing(ip, timeout = 3000) {
        try {
            // 尝试使用fetch对一个不存在的HTTP路径进行请求
            // 如果主机可达，即使返回错误也会有网络响应
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, timeout);
            
            try {
                await fetch(`http://${ip}:80/ping-test-${Date.now()}`, {
                    method: 'HEAD',
                    mode: 'no-cors',
                    signal: controller.signal,
                    cache: 'no-cache'
                });
                clearTimeout(timeoutId);
                return true;
            } catch (fetchError) {
                clearTimeout(timeoutId);
                // 分析错误类型
                if (fetchError.name === 'AbortError') {
                    console.log(`⏰ Ping ${ip} 超时`);
                    return false;
                } else if (fetchError.message.includes('Failed to fetch') || 
                          fetchError.message.includes('NetworkError')) {
                    // 网络不可达
                    console.log(`❌ Ping ${ip} 网络不可达`);
                    return false;
                } else {
                    // 其他错误可能表示主机可达但协议不匹配
                    console.log(`✅ Ping ${ip} 主机可达 (协议错误)`);
                    return true;
                }
            }
            
        } catch (error) {
            console.log(`❌ Ping ${ip} 异常:`, error.message);
            return false;
        }
    }
    
    // 检测HTTP端口
    async testHTTPPort(ip, port, timeout = 3000) {
        try {
            const protocol = (port === 443 || port === 8443) ? 'https' : 'http';
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(`${protocol}://${ip}:${port}/`, {
                method: 'HEAD',
                mode: 'no-cors',
                signal: controller.signal,
                cache: 'no-cache'
            });
            
            clearTimeout(timeoutId);
            console.log(`✅ HTTP ${ip}:${port} 可达`);
            return true;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`⏰ HTTP ${ip}:${port} 超时`);
            } else {
                console.log(`❌ HTTP ${ip}:${port} 不可达`);
            }
            return false;
        }
    }
    
    // 检测一般端口
    async testGenericPort(ip, port, timeout = 3000) {
        // 对于一般端口，我们只能做基本的网络可达性检测
        return await this.testSSHPortViaPing(ip, timeout);
    }
        
    updateStatus(message) {
        const statusEl = Utils.$('#statusMessage');
        if (statusEl) {
            statusEl.textContent = message;
            // 状态文本不需要禁用操作，只显示状态
            if (message !== '就绪') {
                statusEl.title = message;
            } else {
                statusEl.title = '应用就绪';
            }
        }
    }
    
    async updateAppVersion() {
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const version = await ipcRenderer.invoke('get-app-version');
                Utils.$('#appVersion').textContent = version;
            }
        } catch (error) {
            console.error('获取应用版本失败:', error);
        }
    }

    // 打开 GitHub 项目仓库（有新版时打开对应 Release 页）
    async openGithub() {
        if (!window.require) return;
        try {
            const { ipcRenderer } = window.require('electron');
            const url = (this._updateInfo && this._updateInfo.hasUpdate)
                ? this._updateInfo.releaseUrl
                : 'https://github.com/it-andy-hou/wanxiang-box';
            await ipcRenderer.invoke('open-external', url);
        } catch (error) {
            console.error('打开 GitHub 链接失败:', error);
        }
    }

    // 静默检查新版本：有新版时点亮 GitHub 图标红点并弹出提醒
    async checkForUpdate() {
        if (!window.require) return;
        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('check-for-update');
            if (!result || !result.success || !result.hasUpdate) return;

            this._updateInfo = result;

            const badge = Utils.$('#updateBadge');
            if (badge) badge.style.display = '';
            const githubBtn = Utils.$('#githubBtn');
            if (githubBtn) githubBtn.title = `发现新版本 v${result.latestVersion}（当前 v${result.currentVersion}），点击前往下载`;

            this.showUpdateModal(result);
        } catch (error) {
            console.warn('检查更新失败（静默忽略）:', error && error.message);
        }
    }

    // 新版本提醒弹窗
    showUpdateModal(info) {
        const existingModal = document.getElementById('updateModal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'updateModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: var(--surface-overlay); z-index: 9999;
            display: flex; align-items: center; justify-content: center;
        `;

        const notesHtml = info.releaseNotes
            ? `<div style="
                margin-top: 14px; background: var(--canvas-base); border: 1px solid var(--border-default);
                border-radius: 8px; padding: 12px 16px; font-size: 12px; color: var(--text-muted);
                max-height: 180px; overflow-y: auto; white-space: pre-wrap; line-height: 1.6;
                font-family: var(--font-ui);
              "></div>`
            : '';

        modal.innerHTML = `
            <div style="
                background: var(--surface-float); border: 1px solid var(--border-default); border-radius: 12px;
                padding: 28px 32px; max-width: 480px; width: 90%; color: var(--text-body);
                box-shadow: var(--shadow-modal); position: relative; font-family: var(--font-ui);
            ">
                <button id="updateCloseBtn" style="
                    position: absolute; top: 14px; right: 18px;
                    background: none; border: none; color: var(--text-faint);
                    font-size: 22px; cursor: pointer; line-height: 1;
                " title="关闭">&times;</button>

                <div style="font-size: 16px; font-weight: 600; color: var(--text-heading);">发现新版本</div>
                <div style="margin-top: 10px; font-size: 13px; color: var(--text-muted);">
                    当前版本 <span style="font-family: var(--font-mono); color: var(--text-body);">v${info.currentVersion}</span>
                    &nbsp;→&nbsp;
                    最新版本 <span style="font-family: var(--font-mono); color: var(--primary); font-weight: 600;">v${info.latestVersion}</span>
                </div>
                ${notesHtml}
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                    <button id="updateLaterBtn" class="btn btn-secondary">暂不提醒</button>
                    <button id="updateDownloadBtn" class="btn btn-primary">前往下载</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 发布说明使用 textContent 注入，避免 Release 备注中的 HTML 被解析
        if (info.releaseNotes) {
            const notesEl = modal.querySelector('div[style*="white-space: pre-wrap"]');
            if (notesEl) notesEl.textContent = info.releaseNotes;
        }

        const closeModal = () => modal.remove();
        modal.querySelector('#updateCloseBtn').addEventListener('click', closeModal);
        modal.querySelector('#updateLaterBtn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        modal.querySelector('#updateDownloadBtn').addEventListener('click', async () => {
            closeModal();
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('open-external', info.releaseUrl);
            }
        });
    }
    
    searchHosts(keyword) {
        const rows = Utils.$$('#hostsTable tbody tr');
        
        rows.forEach(row => {
            if (row.children.length === 1) return; // 跳过空数据行
            
            const text = row.textContent.toLowerCase();
            const match = text.includes(keyword.toLowerCase());
            row.style.display = match ? '' : 'none';
        });
    }
    
    selectAllHosts(checked) {
        Utils.$$('input[name="hostCheck"]').forEach(checkbox => {
            checkbox.checked = checked;
        });
        this.updateBatchActions();
    }
    
    getSelectedHosts() {
        const checkboxes = Utils.$$('input[name="hostCheck"]:checked');
        return Array.from(checkboxes).map(cb => parseInt(cb.value));
    }
    
    // 复制选中主机IP列表
    copySelectedIPs() {
        const selectedIndices = this.getSelectedHosts();
        
        if (selectedIndices.length === 0) {
            Utils.notify.warning('请选择要复制IP的主机');
            return;
        }
        
        // 获取选中主机的IP地址
        const ips = selectedIndices.map(index => this.hosts[index].ip).filter(ip => ip);
        
        if (ips.length === 0) {
            Utils.notify.warning('选中的主机没有IP地址');
            return;
        }
        
        // 以逗号分隔的格式
        const ipList = ips.join(',');

        // 复制成功后的重置逻辑（清空勾选、隐藏批量操作栏）
        const onCopySuccess = () => {
            Utils.notify.success(`已复制 ${ips.length} 个IP地址到剪贴板`);
            this.clearHostSelection();
        };
        
        // 复制到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ipList).then(() => {
                onCopySuccess();
            }).catch(err => {
                console.error('复制到剪贴板失败:', err);
                // 降级方案：使用 execCommand
                this.fallbackCopyToClipboard(ipList, onCopySuccess);
            });
        } else {
            // 降级方案：使用 execCommand
            this.fallbackCopyToClipboard(ipList, onCopySuccess);
        }
    }

    // 清空主机列表的勾选状态（仅重置选择，不动筛选/分页/滚动）
    clearHostSelection() {
        Utils.$$('input[name="hostCheck"]').forEach(cb => { cb.checked = false; });
        const selectAll = Utils.$('#selectAllHosts');
        if (selectAll) selectAll.checked = false;
        this.updateBatchActions();
    }
    
    // 降级的复制方法
    fallbackCopyToClipboard(text, onSuccess) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                if (typeof onSuccess === 'function') {
                    onSuccess();
                } else {
                    const count = text.split(',').length;
                    Utils.notify.success(`已复制 ${count} 个IP地址到剪贴板`);
                }
            } else {
                Utils.notify.error('复制失败，请手动复制');
            }
        } catch (err) {
            console.error('复制到剪贴板失败:', err);
            Utils.notify.error('复制失败: ' + err.message);
        } finally {
            document.body.removeChild(textArea);
        }
    }
    
    async importExcel() {
        try {
            const excelImport = new Components.ExcelImportDialog({
                onImport: (result) => {
                    this.loadData();
                    this.updateUI();
                }
            });
            excelImport.show();
        } catch (error) {
            console.error('Excel导入失败:', error);
            Utils.notify.error('Excel导入失败: ' + error.message);
        }
    }
    
    async exportExcel() {
        try {
            if (this.hosts.length === 0) {
                Utils.notify.warning('没有数据可导出');
                return;
            }
            
            // 显示导出选项对话框
            const exportDialog = new Components.ExcelExportDialog({
                hosts: this.hosts
            });
            exportDialog.show();
        } catch (error) {
            console.error('Excel导出失败:', error);
            Utils.notify.error('Excel导出失败: ' + error.message);
        }
    }
    
    async batchConnectTest() {
        const selectedIndices = this.getSelectedHosts();
        
        if (selectedIndices.length === 0) {
            Utils.notify.warning('请选择要测试的主机');
            return;
        }
        
        // 显示批量操作对话框
        this._startBatchConnectTest(selectedIndices.map(index => this.hosts[index]));
    }
    
    /**
     * 启动批量连接测试（公共执行逻辑）
     * @param {Array} hosts - 要测试的主机对象数组
     */
    _startBatchConnectTest(hosts) {
        const batchDialog = new Components.BatchOperationDialog({
            operation: 'connect_test',
            title: '批量连接测试',
            hosts: hosts,
            onComplete: (results) => {
                this.loadData();
                this.updateUI();
                // 显示测试结果摘要
                const successCount = results.filter(r => r.success).length;
                const failCount = results.length - successCount;
                Utils.notify.success(`批量测试完成！成功: ${successCount}, 失败: ${failCount}`);
            }
        });
        batchDialog.show();
    }
    
    /**
     * 带主机选择器的批量连接测试（快速操作入口）
     * 弹出主机选择对话框，支持多维筛选（含状态筛选），选择后执行批量测试
     */
    async batchConnectTestWithSelector() {
        try {
            const hosts = await this.hostService.loadHosts();
            
            if (!hosts || hosts.length === 0) {
                Utils.notify.warning('暂无主机数据，请先添加主机');
                return;
            }
            
            // 获取当前主机列表中已勾选的主机ID，用于预勾选
            const preSelectedIds = this.getSelectedHosts().map(index => this.hosts[index]?.id).filter(Boolean);
            
            this._showBatchTestHostSelector(hosts, preSelectedIds);
        } catch (error) {
            console.error('加载主机列表失败:', error);
            Utils.notify.error('加载主机列表失败: ' + error.message);
        }
    }
    
    /**
     * 显示批量测试主机选择器对话框
     */
    _showBatchTestHostSelector(hosts, preSelectedIds = []) {
        const escapeHtml = (str) => {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        };
        
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        
        // 筛选状态
        let currentFilters = {
            systemName: '',
            appName: '',
            datacenter: '',
            environment: '',
            owner: '',
            status: ''
        };
        
        // 提取唯一的筛选值
        const systemNames = [...new Set(hosts.map(h => h.systemName || h.system_name).filter(Boolean))];
        
        modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 1050px;">
                <div class="modal-header">
                    <h2>批量连接测试 - 选择目标主机 <span id="batchTestSelectedCount" style="color: var(--primary); font-size: 0.9em; margin-left: 10px;">(已选择 ${preSelectedIds.length} 台)</span></h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <!-- 快速筛选工具栏 -->
                    <div style="margin-bottom: 1rem;">
                        <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 12px;">
                            <select class="form-control" id="btFilterSystemName" style="height: 38px; padding: 7px 12px;">
                                <option value="">全部系统</option>
                                ${systemNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
                            </select>
                            <select class="form-control" id="btFilterAppName" style="height: 38px; padding: 7px 12px;">
                                <option value="">全部应用</option>
                            </select>
                            <select class="form-control" id="btFilterDatacenter" style="height: 38px; padding: 7px 12px;">
                                <option value="">全部机房</option>
                            </select>
                            <select class="form-control" id="btFilterEnvironment" style="height: 38px; padding: 7px 12px;">
                                <option value="">全部环境</option>
                            </select>
                            <select class="form-control" id="btFilterOwner" style="height: 38px; padding: 7px 12px;">
                                <option value="">全部负责人</option>
                            </select>
                            <select class="form-control" id="btFilterStatus" style="height: 38px; padding: 7px 12px;">
                                <option value="">全部状态</option>
                                <option value="online">在线</option>
                                <option value="offline">离线</option>
                                <option value="unknown">未知</option>
                            </select>
                        </div>
                        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                            <input type="text" class="form-control" placeholder="搜索IP地址或主机名..." id="btHostSearch" style="flex: 1;">
                            <button class="btn btn-sm btn-warning" id="btSelectOffline" title="快速选中所有离线主机">选择离线</button>
                            <button class="btn btn-sm btn-info" id="btSelectUnknown" title="快速选中所有未知状态主机">选择未知</button>
                            <button class="btn btn-sm btn-secondary" id="btClearSelection">清空选择</button>
                        </div>
                        <!-- IP批量输入 -->
                        <div style="width: 100%;">
                            <textarea class="form-control" id="btIpBatchInput" placeholder="批量输入IP地址（用逗号、空格或换行分隔）" style="width: 100%; min-height: 50px; resize: vertical; font-size: 0.875rem;"></textarea>
                            <div style="display: flex; gap: 10px; margin-top: 8px; align-items: center;">
                                <button class="btn btn-sm btn-primary" id="btSelectByIpBtn">识别并选中</button>
                                <button class="btn btn-sm btn-secondary" id="btClearIpInputBtn">清空</button>
                                <span id="btIpMatchResult" style="font-size: 0.875rem; color: var(--text-muted);"></span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 主机表格 -->
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th><input type="checkbox" id="btSelectAll"></th>
                                    <th>IP地址</th>
                                    <th>主机名</th>
                                    <th>系统名称</th>
                                    <th>应用名称</th>
                                    <th>机房</th>
                                    <th>环境</th>
                                    <th>负责人</th>
                                    <th>状态</th>
                                </tr>
                            </thead>
                            <tbody id="btHostTableBody">
                                ${hosts.map(host => `
                                    <tr data-host-id="${host.id}"
                                        data-system-name="${escapeHtml(host.systemName || host.system_name || '')}"
                                        data-app-name="${escapeHtml(host.appName || host.app_name || '')}"
                                        data-datacenter="${escapeHtml(host.datacenter || '')}"
                                        data-environment="${escapeHtml(host.environment || '')}"
                                        data-owner="${escapeHtml(host.owner || '')}"
                                        data-status="${host.status || 'unknown'}">
                                        <td><input type="checkbox" class="bt-host-checkbox" value="${host.id}" ${preSelectedIds.includes(host.id) ? 'checked' : ''}></td>
                                        <td><code>${escapeHtml(host.ip)}</code></td>
                                        <td>${escapeHtml(host.hostname || '-')}</td>
                                        <td>${escapeHtml(host.systemName || host.system_name || '-')}</td>
                                        <td>${escapeHtml(host.appName || host.app_name || '-')}</td>
                                        <td>${escapeHtml(host.datacenter || '-')}</td>
                                        <td>${escapeHtml(host.environment || '-')}</td>
                                        <td>${escapeHtml(host.owner || '-')}</td>
                                        <td><span class="status-badge ${this.getHostStatusClass(host.status)}">${this.getHostStatusText(host.status)}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="btCancelBtn">取消</button>
                    <button class="btn btn-primary" id="btConfirmBtn">开始测试</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modalOverlay);
        
        // ========== 事件绑定 ==========
        const closeModal = () => modalOverlay.remove();
        modalOverlay.querySelector('.modal-close').addEventListener('click', closeModal);
        modalOverlay.querySelector('#btCancelBtn').addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
        
        // 全选
        const selectAllCheckbox = modalOverlay.querySelector('#btSelectAll');
        selectAllCheckbox.addEventListener('change', (e) => {
            const visibleCheckboxes = modalOverlay.querySelectorAll('#btHostTableBody tr:not([style*="display: none"]) .bt-host-checkbox');
            visibleCheckboxes.forEach(cb => cb.checked = e.target.checked);
            updateSelectedCount();
        });
        
        // 单个复选框变化
        modalOverlay.querySelector('#btHostTableBody').addEventListener('change', (e) => {
            if (e.target.classList.contains('bt-host-checkbox')) {
                updateSelectAllState();
                updateSelectedCount();
            }
        });
        
        // 更新选中数量
        function updateSelectedCount() {
            const checkedCount = modalOverlay.querySelectorAll('.bt-host-checkbox:checked').length;
            const countEl = modalOverlay.querySelector('#batchTestSelectedCount');
            if (countEl) countEl.textContent = `(已选择 ${checkedCount} 台)`;
        }
        
        // 更新全选框状态
        function updateSelectAllState() {
            const visibleCheckboxes = modalOverlay.querySelectorAll('#btHostTableBody tr:not([style*="display: none"]) .bt-host-checkbox');
            const checkedCount = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;
            selectAllCheckbox.checked = visibleCheckboxes.length > 0 && checkedCount === visibleCheckboxes.length;
            selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
        }
        
        // 筛选逻辑
        function applyFilters() {
            const searchKeyword = modalOverlay.querySelector('#btHostSearch').value.toLowerCase();
            const rows = modalOverlay.querySelectorAll('#btHostTableBody tr');
            
            rows.forEach(row => {
                const rowText = row.textContent.toLowerCase();
                const matchSearch = !searchKeyword || rowText.includes(searchKeyword);
                const matchSystem = !currentFilters.systemName || row.dataset.systemName === currentFilters.systemName;
                const matchApp = !currentFilters.appName || row.dataset.appName === currentFilters.appName;
                const matchDC = !currentFilters.datacenter || row.dataset.datacenter === currentFilters.datacenter;
                const matchEnv = !currentFilters.environment || row.dataset.environment === currentFilters.environment;
                const matchOwner = !currentFilters.owner || row.dataset.owner === currentFilters.owner;
                const matchStatus = !currentFilters.status || row.dataset.status === currentFilters.status;
                
                row.style.display = (matchSearch && matchSystem && matchApp && matchDC && matchEnv && matchOwner && matchStatus) ? '' : 'none';
            });
            
            updateSelectAllState();
        }
        
        // 级联联动更新下拉选项
        function updateFilterOptions() {
            const filteredHosts = hosts.filter(host => {
                let match = true;
                if (currentFilters.systemName) match = match && ((host.systemName || host.system_name) === currentFilters.systemName);
                if (currentFilters.appName) match = match && ((host.appName || host.app_name) === currentFilters.appName);
                if (currentFilters.datacenter) match = match && (host.datacenter === currentFilters.datacenter);
                if (currentFilters.environment) match = match && (host.environment === currentFilters.environment);
                return match;
            });
            
            // 应用名称
            const appFilter = modalOverlay.querySelector('#btFilterAppName');
            const appNames = [...new Set(filteredHosts.map(h => h.appName || h.app_name).filter(Boolean))];
            appFilter.innerHTML = '<option value="">全部应用</option>' + appNames.map(n => `<option value="${escapeHtml(n)}" ${n === currentFilters.appName ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
            if (currentFilters.appName && !appNames.includes(currentFilters.appName)) currentFilters.appName = '';
            
            // 机房
            const dcFilter = modalOverlay.querySelector('#btFilterDatacenter');
            const dcs = [...new Set(filteredHosts.map(h => h.datacenter).filter(Boolean))];
            dcFilter.innerHTML = '<option value="">全部机房</option>' + dcs.map(n => `<option value="${escapeHtml(n)}" ${n === currentFilters.datacenter ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
            if (currentFilters.datacenter && !dcs.includes(currentFilters.datacenter)) currentFilters.datacenter = '';
            
            // 环境
            const envFilter = modalOverlay.querySelector('#btFilterEnvironment');
            const envs = [...new Set(filteredHosts.map(h => h.environment).filter(Boolean))];
            envFilter.innerHTML = '<option value="">全部环境</option>' + envs.map(n => `<option value="${escapeHtml(n)}" ${n === currentFilters.environment ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
            if (currentFilters.environment && !envs.includes(currentFilters.environment)) currentFilters.environment = '';
            
            // 负责人
            const ownerFilter = modalOverlay.querySelector('#btFilterOwner');
            const owners = [...new Set(filteredHosts.map(h => h.owner).filter(Boolean))].sort();
            ownerFilter.innerHTML = '<option value="">全部负责人</option>' + owners.map(n => `<option value="${escapeHtml(n)}" ${n === currentFilters.owner ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
            if (currentFilters.owner && !owners.includes(currentFilters.owner)) currentFilters.owner = '';
        }
        
        // 初始化级联选项
        updateFilterOptions();
        
        // 绑定筛选事件
        modalOverlay.querySelector('#btFilterSystemName').addEventListener('change', (e) => { currentFilters.systemName = e.target.value; updateFilterOptions(); applyFilters(); });
        modalOverlay.querySelector('#btFilterAppName').addEventListener('change', (e) => { currentFilters.appName = e.target.value; updateFilterOptions(); applyFilters(); });
        modalOverlay.querySelector('#btFilterDatacenter').addEventListener('change', (e) => { currentFilters.datacenter = e.target.value; updateFilterOptions(); applyFilters(); });
        modalOverlay.querySelector('#btFilterEnvironment').addEventListener('change', (e) => { currentFilters.environment = e.target.value; updateFilterOptions(); applyFilters(); });
        modalOverlay.querySelector('#btFilterOwner').addEventListener('change', (e) => { currentFilters.owner = e.target.value; updateFilterOptions(); applyFilters(); });
        modalOverlay.querySelector('#btFilterStatus').addEventListener('change', (e) => { currentFilters.status = e.target.value; applyFilters(); });
        modalOverlay.querySelector('#btHostSearch').addEventListener('input', applyFilters);
        
        // 快捷选择按钮: 选择离线
        modalOverlay.querySelector('#btSelectOffline').addEventListener('click', () => {
            modalOverlay.querySelectorAll('#btHostTableBody tr').forEach(row => {
                const cb = row.querySelector('.bt-host-checkbox');
                if (row.dataset.status === 'offline') cb.checked = true;
            });
            updateSelectAllState();
            updateSelectedCount();
        });
        
        // 快捷选择按钮: 选择未知
        modalOverlay.querySelector('#btSelectUnknown').addEventListener('click', () => {
            modalOverlay.querySelectorAll('#btHostTableBody tr').forEach(row => {
                const cb = row.querySelector('.bt-host-checkbox');
                if (row.dataset.status === 'unknown') cb.checked = true;
            });
            updateSelectAllState();
            updateSelectedCount();
        });
        
        // 清空选择
        modalOverlay.querySelector('#btClearSelection').addEventListener('click', () => {
            modalOverlay.querySelectorAll('.bt-host-checkbox').forEach(cb => cb.checked = false);
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
            updateSelectedCount();
        });
        
        // 批量IP识别
        modalOverlay.querySelector('#btSelectByIpBtn').addEventListener('click', () => {
            const ipText = modalOverlay.querySelector('#btIpBatchInput').value.trim();
            if (!ipText) return;
            
            const ips = ipText.split(/[,，\s\n]+/).map(ip => ip.trim()).filter(Boolean);
            let matchCount = 0;
            
            modalOverlay.querySelectorAll('#btHostTableBody tr').forEach(row => {
                const cb = row.querySelector('.bt-host-checkbox');
                const hostIp = row.querySelector('td:nth-child(2) code')?.textContent?.trim();
                if (hostIp && ips.includes(hostIp)) {
                    cb.checked = true;
                    matchCount++;
                }
            });
            
            const resultEl = modalOverlay.querySelector('#btIpMatchResult');
            resultEl.textContent = `已匹配 ${matchCount} 台，输入 ${ips.length} 个IP`;
            resultEl.style.color = matchCount > 0 ? 'var(--status-healthy-fg)' : 'var(--status-critical-fg)';
            updateSelectAllState();
            updateSelectedCount();
        });
        
        // 清空IP输入
        modalOverlay.querySelector('#btClearIpInputBtn').addEventListener('click', () => {
            modalOverlay.querySelector('#btIpBatchInput').value = '';
            modalOverlay.querySelector('#btIpMatchResult').textContent = '';
        });
        
        // 确认开始测试
        modalOverlay.querySelector('#btConfirmBtn').addEventListener('click', () => {
            const selectedIds = Array.from(modalOverlay.querySelectorAll('.bt-host-checkbox:checked')).map(cb => cb.value);
            
            if (selectedIds.length === 0) {
                Utils.notify.warning('请至少选择一台主机进行测试');
                return;
            }
            
            // 根据ID获取主机对象
            const selectedHosts = hosts.filter(h => selectedIds.includes(String(h.id)));
            closeModal();
            
            // 调用批量测试执行
            this._startBatchConnectTest(selectedHosts);
        });
        
        // 初始化选中数量显示
        updateSelectedCount();
    }
    
    showAddHostModal() {
        const hostForm = new Components.HostForm({
            mode: 'add',
            onSave: (host) => {
                this.loadData();
                this.updateUI();
            }
        });
        hostForm.show();
    }
    
    async refreshHosts() {
        const overlay = Utils.loading.show(Utils.$('.content'), '刷新主机列表...');
        this.isDataLoading = true;
        this.renderCurrentView(); // 立即显示“加载中”占位

        try {
            await this.loadData(); // loadData 内部会将 isDataLoading 置为 false
            this.updateUI();
            Utils.notify.success('主机列表刷新成功');
        } catch (error) {
            this.isDataLoading = false;
            console.error('刷新主机列表失败:', error);
            Utils.notify.error('刷新失败: ' + error.message);
        } finally {
            Utils.loading.hide(overlay);
        }
    }
    
    async connectHost(index) {
        const host = this.hosts[index];
        if (host) {
            try {
                const result = await this.hostService.testConnection(host.id);
                if (result.success) {
                    Utils.notify.success(`连接主机 ${host.hostname || host.ip} 成功`);
                } else {
                    Utils.notify.error(`连接主机 ${host.hostname || host.ip} 失败: ${result.message}`);
                }
                // 更新界面显示最新状态
                this.updateUI();
            } catch (error) {
                Utils.notify.error(`连接测试失败: ${error.message}`);
            }
        }
    }
    
    editHost(index) {
        const host = this.hosts[index];
        if (host) {
            const hostForm = new Components.HostForm({
                mode: 'edit',
                host: host,
                onSave: (updatedHost) => {
                    this.loadData();
                    this.updateUI();
                }
            });
            hostForm.show();
        }
    }
    
    copyHost(index) {
        const host = this.hosts[index];
        if (host) {
            // 克隆源主机数据，清空需要重新填写的字段及自动采集的执行环境信息
            const copiedHost = {
                ...host,
                id: undefined,
                hostname: '',
                ip: '',
                datacenter: '',
                osType: '', osVersion: '', kernelVersion: '',
                cpuInfo: '', memoryInfo: '',
                os_type: '', os_version: '', kernel_version: '',
                cpu_info: '', memory_info: ''
            };
            const hostForm = new Components.HostForm({
                mode: 'add',
                host: copiedHost,
                title: `复制主机 - ${host.hostname}`,
                onSave: (newHost) => {
                    this.loadData();
                    this.updateUI();
                }
            });
            hostForm.show();
        }
    }
    
    async deleteHost(index) {
        const host = this.hosts[index];
        if (host) {
            const confirmed = await Components.ConfirmDialog.show({
                title: '确认删除',
                message: `确定要删除主机 "${host.hostname || host.ip}" 吗？`,
                confirmText: '删除',
                cancelText: '取消'
            });
            
            if (confirmed) {
                try {
                    await this.hostService.deleteHost(host.id);
                    await this.loadData();
                    this.updateUI();
                    Utils.notify.success('主机删除成功');
                } catch (error) {
                    Utils.notify.error(`删除失败: ${error.message}`);
                }
            }
        }
    }
    
    viewHostInfo(index) {
        const host = this.hosts[index];
        if (host) {
            const hostInfoDialog = new Components.HostInfoDialog({
                host: host,
                onCollect: () => {
                    this.loadData();
                    this.updateUI();
                }
            });
            hostInfoDialog.show();
        }
    }
    
    configureSSHKey(index) {
        const host = this.hosts[index];
        if (host) {
            const sshKeyDialog = new Components.SSHKeyDialog({
                mode: 'configure',
                host: host,
                onComplete: () => {
                    Utils.notify.success(`${host.hostname || host.ip} SSH免密配置完成`);
                    this.loadData();
                    this.updateUI();
                }
            });
            sshKeyDialog.show();
        }
    }
    
    showSettings() {
        this.showGlobalSettings();
    }

    // 显示全局设置面板
    async showGlobalSettings() {
        // 从后端获取当前保存的执行设置
        let currentConcurrency = 1;
        let currentTimeout = 300;
        let backupSettings = { backup_enabled: true, backup_time: '02:00', backup_keep_count: 30, backup_last_at: null, dailyDir: '', beforeImportDir: '', backupRoot: '' };
        
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const settings = await ipcRenderer.invoke('get-execution-settings');
                currentConcurrency = settings.concurrency || 1;
                currentTimeout = settings.timeout || 300;
            }
        } catch (e) {
            console.error('获取执行设置失败:', e);
        }
        try {
            if (window.BackupService) {
                const r = await window.BackupService.getSettings();
                if (r && r.success) backupSettings = { ...backupSettings, ...r.data };
            }
        } catch (e) {
            console.error('获取备份设置失败:', e);
        }

        const settingsDialog = new Modal({
            title: '全局设置',
            content: `
                <div class="global-settings">
                    <div style="margin-bottom: 1.5rem;">
                        <h4 style="margin-bottom: 0.75rem; color: var(--primary); font-size: 14px;">${Utils.icon('settings', 14)} 执行参数</h4>
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label for="globalConcurrency">默认并发数</label>
                            <input type="number" class="form-control" id="globalConcurrency" 
                                   value="${currentConcurrency}" min="1" max="20" step="1">
                            <small class="form-text text-muted">
                                批量执行时同时处理的主机数量，范围 1-20，机器多时建议设为 5-10
                            </small>
                        </div>
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label for="globalTimeout">默认超时时间（秒）</label>
                            <input type="number" class="form-control" id="globalTimeout" 
                                   value="${currentTimeout}" min="10" max="3600" step="10">
                            <small class="form-text text-muted">
                                单台主机执行超时时间，最低 10 秒，最高 3600 秒（1小时）
                            </small>
                        </div>
                    </div>
                    <div style="border-top: 1px solid var(--border-default); padding-top: 1rem; margin-bottom: 1.5rem;">
                        <h4 style="margin-bottom: 0.75rem; color: var(--primary); font-size: 14px;">${Utils.icon('key', 14)} 密钥管理</h4>
                        <button class="btn btn-secondary" id="settingsManageKeysBtn" style="font-size: 13px;">
                            管理默认SSH密钥
                        </button>
                    </div>
                    <div style="border-top: 1px solid var(--border-default); padding-top: 1rem; margin-bottom: 1rem;">
                        <h4 style="margin-bottom: 0.75rem; color: var(--primary); font-size: 14px;">${Utils.icon('hard-drive', 14)} 数据备份</h4>
                        <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            <button class="btn btn-secondary" id="backupExportBtn" style="font-size: 13px;">${Utils.icon('upload', 13)} 导出全量数据</button>
                            <button class="btn btn-secondary" id="backupImportBtn" style="font-size: 13px;">${Utils.icon('download', 13)} 导入全量数据</button>
                            <button class="btn btn-secondary" id="backupOpenDirBtn" style="font-size: 13px;">${Utils.icon('folder-open', 13)} 打开备份目录</button>
                        </div>
                        <div style="background: var(--status-warning-bg); border: 1px solid var(--status-warning-border); border-radius: 6px; padding: 8px 12px; font-size: 12px; color: var(--status-warning-fg); margin-bottom: 1rem;">
                            ${Utils.icon('alert-triangle', 12)} 导出文件为明文 JSON，含主机密码、私钥等敏感信息，请妥善保管；导入将完全覆盖当前数据并重启应用。
                        </div>
                        <div style="background: var(--surface-subtle); border: 1px solid var(--border-default); border-radius: 6px; padding: 10px 12px; margin-bottom: 1rem; font-size: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <span style="color: var(--text-muted);">${Utils.icon('folder', 12)} 备份目录</span>
                                <span id="backupDirBadge" style="font-size: 11px; padding: 1px 8px; border-radius: 10px; background: var(--primary-glow); color: var(--primary);">加载中</span>
                            </div>
                            <div id="backupDirPath" style="color: var(--text-body); word-break: break-all; font-family: var(--font-mono); margin-bottom: 6px;">-</div>
                            <div id="backupDirStats" style="color: var(--text-faint); margin-bottom: 8px;">-</div>
                            <div id="backupDirFallbackTip" style="display:none; color:var(--status-critical-fg); margin-bottom: 8px; font-size: 11px;"></div>
                            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn btn-secondary" id="backupDirChangeBtn" style="font-size: 12px; padding: 3px 12px;">选择目录</button>
                                <button class="btn btn-secondary" id="backupDirResetBtn" style="font-size: 12px; padding: 3px 12px;">重置为默认</button>
                            </div>
                        </div>
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                <input type="checkbox" id="backupEnabled" ${backupSettings.backup_enabled ? 'checked' : ''}>
                                <span>启用每日自动备份</span>
                            </label>
                        </div>
                        <div style="display: flex; gap: 1rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
                            <div class="form-group" style="flex: 1; min-width: 160px;">
                                <label for="backupTime">备份时间</label>
                                <input type="time" class="form-control" id="backupTime" value="${backupSettings.backup_time || '02:00'}">
                            </div>
                            <div class="form-group" style="flex: 1; min-width: 160px;">
                                <label for="backupKeepCount">保留份数</label>
                                <input type="number" class="form-control" id="backupKeepCount" value="${backupSettings.backup_keep_count || 30}" min="1" max="365" step="1">
                            </div>
                        </div>
                        <small class="form-text text-muted" style="display: block; margin-bottom: 0.75rem;">
                            上次备份：${backupSettings.backup_last_at ? new Date(backupSettings.backup_last_at).toLocaleString('zh-CN') : '从未备份'}
                        </small>
                        <div style="margin-top: 0.75rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <span style="font-size: 13px; color: var(--text-muted);">备份历史</span>
                                <button class="btn btn-secondary" id="backupRefreshBtn" style="font-size: 12px; padding: 2px 10px;">刷新</button>
                            </div>
                            <div id="backupHistoryList" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-default); border-radius: 6px; padding: 4px;">
                                <div style="text-align: center; color: var(--text-faint); padding: 12px; font-size: 12px;">加载中...</div>
                            </div>
                        </div>
                    </div>
                    <div style="border-top: 1px solid var(--border-default); padding-top: 1rem; text-align: right;">
                        <button class="btn btn-secondary" id="settingsCancelBtn" style="margin-right: 0.5rem;">取消</button>
                        <button class="btn btn-primary" id="settingsSaveBtn">保存</button>
                    </div>
                </div>
            `,
            width: '600px'
        });
        
        settingsDialog.show();

        // 绑定按钮事件
        setTimeout(() => {
            const cancelBtn = document.getElementById('settingsCancelBtn');
            const saveBtn = document.getElementById('settingsSaveBtn');
            const manageKeysBtn = document.getElementById('settingsManageKeysBtn');

            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => settingsDialog.hide());
            }

            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    const concurrency = parseInt(document.getElementById('globalConcurrency').value);
                    const timeout = parseInt(document.getElementById('globalTimeout').value);
                    
                    // 验证
                    if (isNaN(concurrency) || concurrency < 1 || concurrency > 20) {
                        Utils.notify.error('并发数必须在 1-20 之间');
                        return;
                    }
                    if (isNaN(timeout) || timeout < 10) {
                        Utils.notify.error('超时时间不能低于 10 秒');
                        return;
                    }
                    if (timeout > 3600) {
                        Utils.notify.error('超时时间不能超过 3600 秒');
                        return;
                    }
                    
                    try {
                        if (window.require) {
                            const { ipcRenderer } = window.require('electron');
                            const result = await ipcRenderer.invoke('save-execution-settings', { concurrency, timeout });
                            if (result.success) {
                                this.applyGlobalExecutionSettings(result.concurrency, result.timeout);
                                // 一并保存备份设置
                                try {
                                    if (window.BackupService) {
                                        const enabledEl = document.getElementById('backupEnabled');
                                        const timeEl = document.getElementById('backupTime');
                                        const keepEl = document.getElementById('backupKeepCount');
                                        await window.BackupService.saveSettings({
                                            backup_enabled: !!(enabledEl && enabledEl.checked),
                                            backup_time: (timeEl && timeEl.value) || '02:00',
                                            backup_keep_count: parseInt((keepEl && keepEl.value) || '30', 10)
                                        });
                                    }
                                } catch (be) {
                                    console.error('保存备份设置失败:', be);
                                }
                                Utils.notify.success('全局设置已保存');
                                settingsDialog.hide();
                            } else {
                                Utils.notify.error('保存失败: ' + result.message);
                            }
                        }
                    } catch (e) {
                        Utils.notify.error('保存设置失败: ' + e.message);
                    }
                });
            }

            if (manageKeysBtn) {
                manageKeysBtn.addEventListener('click', () => {
                    settingsDialog.hide();
                    const defaultKeyDialog = new Components.DefaultSSHKeyDialog({
                        onComplete: () => {
                            Utils.notify.success('默认密钥管理操作完成');
                        }
                    });
                    defaultKeyDialog.show();
                });
            }

            // ──── 数据备份交互 ────
            this._bindBackupSection(settingsDialog);
        }, 100);
    }

    // 绑定「全局设置弹窗」中「💾 数据备份」分组的交互逻辑
    _bindBackupSection(settingsDialog) {
        const exportBtn = document.getElementById('backupExportBtn');
        const importBtn = document.getElementById('backupImportBtn');
        const openDirBtn = document.getElementById('backupOpenDirBtn');
        const refreshBtn = document.getElementById('backupRefreshBtn');
        const listEl = document.getElementById('backupHistoryList');

        const formatSize = (n) => {
            if (!n && n !== 0) return '-';
            if (n < 1024) return n + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
            return (n / 1024 / 1024).toFixed(1) + ' MB';
        };
        const typeBadge = (t) => t === 'daily'
            ? `<span style="color:var(--status-healthy-fg)">${Utils.icon('check-circle', 11)} 每日</span>`
            : `<span style="color:var(--status-warning-fg)">${Utils.icon('hourglass', 11)} 导入前</span>`;

        const renderList = (items) => {
            if (!listEl) return;
            if (!items || items.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;color:var(--text-faint);padding:12px;font-size:12px;">暂无备份</div>';
                return;
            }
            listEl.innerHTML = items.map((it, i) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-size:12px;">
                    <div style="flex:1;min-width:0;overflow:hidden;">
                        <div style="display:flex;gap:8px;align-items:center;">
                            ${typeBadge(it.type)}
                            <span style="color:var(--text-body);">${new Date(it.mtime).toLocaleString('zh-CN')}</span>
                            <span style="color:var(--text-faint);">${formatSize(it.size)}</span>
                        </div>
                        <div style="color:var(--text-faint);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${it.filePath}">${it.fileName}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px;">
                        <button class="btn btn-secondary" data-bk-restore="${i}" style="font-size:11px;padding:2px 8px;">恢复</button>
                        <button class="btn btn-secondary" data-bk-show="${i}" style="font-size:11px;padding:2px 8px;">打开</button>
                        <button class="btn btn-secondary" data-bk-delete="${i}" style="font-size:11px;padding:2px 8px;color:var(--status-critical-fg);">删除</button>
                    </div>
                </div>
            `).join('');
            listEl.querySelectorAll('[data-bk-restore]').forEach(b => {
                b.addEventListener('click', () => this._doImport(items[parseInt(b.dataset.bkRestore, 10)].filePath, settingsDialog));
            });
            listEl.querySelectorAll('[data-bk-show]').forEach(b => {
                b.addEventListener('click', async () => {
                    try { await window.BackupService.showInFolder(items[parseInt(b.dataset.bkShow, 10)].filePath); } catch (_) {}
                });
            });
            listEl.querySelectorAll('[data-bk-delete]').forEach(b => {
                b.addEventListener('click', async () => {
                    const it = items[parseInt(b.dataset.bkDelete, 10)];
                    if (!confirm(`确认删除备份：\n${it.fileName}\n\n此操作不可恢复。`)) return;
                    try {
                        await window.BackupService.deleteBackup(it.filePath);
                        Utils.notify.success('已删除');
                        await refreshHistory();
                    } catch (e) {
                        Utils.notify.error('删除失败: ' + e.message);
                    }
                });
            });
        };

        const refreshHistory = async () => {
            try {
                const r = await window.BackupService.listHistory();
                if (r && r.success) renderList(r.data);
                else if (listEl) listEl.innerHTML = '<div style="color:var(--status-critical-fg);padding:8px;font-size:12px;">加载失败</div>';
            } catch (e) {
                if (listEl) listEl.innerHTML = `<div style="color:var(--status-critical-fg);padding:8px;font-size:12px;">${e.message}</div>`;
            }
        };

        if (refreshBtn) refreshBtn.addEventListener('click', refreshHistory);
        if (openDirBtn) openDirBtn.addEventListener('click', async () => {
            try { await window.BackupService.showInFolder(); } catch (e) { Utils.notify.error(e.message); }
        });
        if (exportBtn) exportBtn.addEventListener('click', async () => {
            exportBtn.disabled = true; const old = exportBtn.textContent;
            exportBtn.textContent = '导出中...';
            try {
                const r = await window.BackupService.exportData();
                if (r && r.canceled) return;
                if (r && r.success) {
                    Utils.notify.success(`导出成功：${(r.data.size / 1024 / 1024).toFixed(2)} MB`);
                    await refreshHistory();
                } else {
                    Utils.notify.error('导出失败：' + (r && r.message || '未知错误'));
                }
            } catch (e) {
                Utils.notify.error('导出失败：' + e.message);
            } finally {
                exportBtn.disabled = false; exportBtn.textContent = old;
            }
        });
        if (importBtn) importBtn.addEventListener('click', async () => {
            try {
                const parsed = await window.BackupService.parseFile();
                if (parsed && parsed.canceled) return;
                if (!parsed || !parsed.success) {
                    Utils.notify.error('解析失败：' + (parsed && parsed.message || '未知错误'));
                    return;
                }
                this._doImport(parsed.data.filePath, settingsDialog, parsed.data);
            } catch (e) {
                Utils.notify.error('解析失败：' + e.message);
            }
        });

        // 初次加载历史
        refreshHistory();

        // 初次加载备份目录信息与绑定交互
        this._bindBackupDirSection(refreshHistory);
    }

    // 绑定「备份目录」子区块交互
    _bindBackupDirSection(refreshHistory) {
        const pathEl = document.getElementById('backupDirPath');
        const badgeEl = document.getElementById('backupDirBadge');
        const statsEl = document.getElementById('backupDirStats');
        const fallbackEl = document.getElementById('backupDirFallbackTip');
        const changeBtn = document.getElementById('backupDirChangeBtn');
        const resetBtn = document.getElementById('backupDirResetBtn');
        if (!pathEl || !badgeEl) return;

        const formatSize = (n) => {
            if (!n && n !== 0) return '-';
            if (n < 1024) return n + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
            return (n / 1024 / 1024).toFixed(1) + ' MB';
        };

        const refreshDirInfo = async () => {
            try {
                const r = await window.BackupService.getDirectoryInfo();
                if (!r || !r.success) {
                    pathEl.textContent = '获取失败';
                    return;
                }
                const info = r.info;
                pathEl.textContent = info.backupRoot;
                pathEl.title = info.backupRoot;
                if (info.isCustomPath) {
                    badgeEl.textContent = '自定义';
                    badgeEl.style.background = 'var(--status-warning-bg)';
                    badgeEl.style.color = 'var(--status-warning-fg)';
                } else {
                    badgeEl.textContent = '默认';
                    badgeEl.style.background = 'var(--primary-glow)';
                    badgeEl.style.color = 'var(--primary)';
                }
                statsEl.textContent = `每日备份 ${info.daily.count} 份 · 导入前备份 ${info.beforeImport.count} 份 · 占用 ${formatSize(info.totalSize)}`;
                if (info.fellbackToDefault) {
                    fallbackEl.style.display = 'block';
                    fallbackEl.innerHTML = `${Utils.icon('alert-triangle', 13)} 上次自定义路径备份连续失败，已自动回退默认路径，请检查路径可用性后重新设置。`;
                } else {
                    fallbackEl.style.display = 'none';
                }
            } catch (e) {
                pathEl.textContent = '获取失败：' + e.message;
            }
        };

        if (changeBtn) {
            changeBtn.addEventListener('click', async () => {
                try {
                    const sel = await window.BackupService.selectDirectory();
                    if (!sel || sel.canceled || !sel.success) return;
                    const targetPath = sel.path;
                    // 先探测
                    const probe = await window.BackupService.probeDirectory(targetPath);
                    if (!probe || !probe.success) {
                        Utils.notify.error('路径不可用：' + (probe && probe.message || ''));
                        return;
                    }
                    const ok = window.confirm(
                        `将备份目录切换到：\n${targetPath}\n\n是否同时迁移现有历史备份到新目录？\n点「确定」迁移，点「取消」仅切换不迁移。`
                    );
                    changeBtn.disabled = true;
                    const old = changeBtn.textContent;
                    changeBtn.textContent = '切换中...';
                    try {
                        const r = await window.BackupService.setDirectory(targetPath, ok);
                        if (!r || !r.success) {
                            Utils.notify.error('切换失败：' + (r && r.message || ''));
                            return;
                        }
                        if (r.migrateError) {
                            Utils.notify.warning(`备份目录已切换，但迁移部分失败：${r.migrateError}`);
                        } else {
                            Utils.notify.success(
                                r.changed
                                    ? `备份目录已切换${r.migrated ? `，迁移 ${r.migrated} 份备份` : ''}`
                                    : '备份目录未变化'
                            );
                        }
                        await refreshDirInfo();
                        if (typeof refreshHistory === 'function') await refreshHistory();
                    } finally {
                        changeBtn.disabled = false;
                        changeBtn.textContent = old;
                    }
                } catch (e) {
                    Utils.notify.error('切换失败：' + e.message);
                }
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                if (!window.confirm('确认重置备份目录为默认路径吗？\n点「确定」同时迁移当前历史备份。')) return;
                resetBtn.disabled = true;
                const old = resetBtn.textContent;
                resetBtn.textContent = '重置中...';
                try {
                    const r = await window.BackupService.resetDirectory(true);
                    if (!r || !r.success) {
                        Utils.notify.error('重置失败：' + (r && r.message || ''));
                        return;
                    }
                    Utils.notify.success(`已重置为默认路径${r.migrated ? `，迁移 ${r.migrated} 份备份` : ''}`);
                    await refreshDirInfo();
                    if (typeof refreshHistory === 'function') await refreshHistory();
                } catch (e) {
                    Utils.notify.error('重置失败：' + e.message);
                } finally {
                    resetBtn.disabled = false;
                    resetBtn.textContent = old;
                }
            });
        }

        refreshDirInfo();
    }

    // 执行导入/恢复（二次确认 + 导入 + 重启）
    async _doImport(filePath, settingsDialog, parsedSummary) {
        try {
            // 如果调用方没提供 summary，重新解析一下以展示数据量对比
            let summary = parsedSummary;
            if (!summary) {
                const r = await window.BackupService.parseFile(filePath);
                if (r && r.canceled) return;
                if (!r || !r.success) {
                    Utils.notify.error('解析失败：' + (r && r.message || ''));
                    return;
                }
                summary = r.data;
            }
            const cur = summary.currentStats || {};
            const next = summary.newStats || {};
            const expDate = summary.exportedAt ? new Date(summary.exportedAt).toLocaleString('zh-CN') : '未知';
            const msg =
`即将以下面备份文件完全覆盖当前数据，此操作不可撤销！

文件：${summary.filePath || filePath}
备份时间：${expDate}
来源机器：${summary.hostname || '未知'}

数据量对比：
  主机：${cur.hosts || 0} → ${next.hosts || 0}
  脚本：${cur.scripts || 0} → ${next.scripts || 0}
  执行历史：${cur.task_executions || 0} → ${next.task_executions || 0}
  工程任务：${cur.project_tasks || 0} → ${next.project_tasks || 0}

请输入「确认导入」以继续：`;
            const input = window.prompt(msg, '');
            if (input === null) return; // 取消
            if (String(input).trim() !== '确认导入') {
                Utils.notify.warning('未输入「确认导入」，已取消');
                return;
            }
            const r2 = await window.BackupService.importData(filePath);
            if (!r2 || !r2.success) {
                Utils.notify.error('导入失败：' + (r2 && r2.message || ''));
                return;
            }
            Utils.notify.success('导入成功，应用将在 3 秒后重启...');
            try { settingsDialog && settingsDialog.hide && settingsDialog.hide(); } catch (_) {}
            setTimeout(() => {
                window.BackupService.relaunchApp().catch(() => {});
            }, 1500);
        } catch (e) {
            Utils.notify.error('导入失败：' + e.message);
        }
    }

    // 将全局设置应用到页面上的执行参数默认值
    applyGlobalExecutionSettings(concurrency, timeout) {
        // 脚本执行页面
        const taskConcurrency = document.getElementById('taskConcurrency');
        const taskTimeout = document.getElementById('taskTimeout');
        if (taskConcurrency) taskConcurrency.value = concurrency;
        if (taskTimeout) taskTimeout.value = timeout;
        
        // 命令执行页面
        const cmdConcurrency = document.getElementById('commandTaskConcurrency');
        const cmdTimeout = document.getElementById('commandTaskTimeout');
        if (cmdConcurrency) cmdConcurrency.value = concurrency;
        if (cmdTimeout) cmdTimeout.value = timeout;
        
        // 文件上传页面
        const fileConcurrency = document.getElementById('fileUploadTaskConcurrency');
        const fileTimeout = document.getElementById('fileUploadTaskTimeout');
        if (fileConcurrency) fileConcurrency.value = concurrency;
        if (fileTimeout) fileTimeout.value = timeout;
    }

    // 启动时加载全局执行设置
    async loadGlobalExecutionSettings() {
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const settings = await ipcRenderer.invoke('get-execution-settings');
                this.applyGlobalExecutionSettings(settings.concurrency || 1, settings.timeout || 300);
                console.log(`全局执行设置已加载: 并发数=${settings.concurrency}, 超时=${settings.timeout}秒`);
            }
        } catch (e) {
            console.error('加载全局执行设置失败:', e);
        }
    }
    
    showAbout() {
        const existingModal = document.getElementById('aboutModal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'aboutModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: var(--surface-overlay); z-index: 9999;
            display: flex; align-items: center; justify-content: center;
        `;
        modal.innerHTML = `
            <div style="
                background: var(--surface-float); border: 1px solid var(--border-default); border-radius: 12px;
                padding: 36px 40px; max-width: 520px; width: 90%; color: var(--text-body);
                box-shadow: var(--shadow-modal); position: relative;
                font-family: var(--font-ui);
            ">
                <button id="aboutCloseBtn" style="
                    position: absolute; top: 14px; right: 18px;
                    background: none; border: none; color: var(--text-faint);
                    font-size: 22px; cursor: pointer; line-height: 1;
                " title="关闭">&times;</button>

                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 28px; font-weight: 700; color: var(--primary); letter-spacing: 2px;">万象匣</div>
                    <div style="font-size: 13px; color: var(--primary); margin-top: 4px; letter-spacing: 1px;">WanXiang Box</div>
                    <div style="font-size: 12px; color: var(--text-faint); margin-top: 8px;">运维自动化管控平台 &nbsp;·&nbsp; v1.260912.0</div>
                </div>

                <div style="
                    background: var(--canvas-base); border: 1px solid var(--border-default); border-radius: 8px;
                    padding: 20px 24px; font-size: 12.5px; line-height: 2;
                    color: var(--text-muted);
                ">
                    <div style="color: var(--primary); font-weight: 600; margin-bottom: 10px; font-size: 13px;">${Utils.icon('scale', 13)} 版权声明</div>
                    <div>Copyright &copy; 2026 &nbsp;<strong style="color:var(--text-heading);">侯金刚</strong> &nbsp;保留所有权利</div>
                    <div style="height: 1px; background: var(--border-default); margin: 12px 0;"></div>
                    <div style="color: var(--status-healthy-fg);">&#10003;&nbsp; 个人免费使用</div>
                    <div style="color: var(--status-critical-fg); margin-top: 4px;">&#10007;&nbsp; 禁止商业用途（公司、商业机构等营利性使用）</div>
                    <div style="color: var(--status-critical-fg); margin-top: 4px;">&#10007;&nbsp; 禁止二次分发、转售或安装打包带收费</div>
                    <div style="color: var(--status-critical-fg); margin-top: 4px;">&#10007;&nbsp; 禁止恶意修改、反编译或以修改版本盈利</div>
                    <div style="color: var(--status-critical-fg); margin-top: 4px;">&#10007;&nbsp; 禁止去除应用内的版权信息或作者标识</div>
                    <div style="height: 1px; background: var(--border-default); margin: 12px 0;"></div>
                    <div style="color: var(--text-faint); font-size: 11.5px;">本软件不开源，未经许可的任何使用均视为侵权行为。</div>
                </div>

                <div style="text-align: center; margin-top: 20px;">
                    <button id="aboutOkBtn" style="
                        background: var(--primary); color: var(--on-primary); border: none;
                        padding: 8px 32px; border-radius: 6px; cursor: pointer;
                        font-size: 13px; letter-spacing: 1px;
                    ">确 &nbsp;定</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.getElementById('aboutCloseBtn').addEventListener('click', () => modal.remove());
        document.getElementById('aboutOkBtn').addEventListener('click', () => modal.remove());
    }
    
    // 侧边栏切换功能
    toggleSidebar() {
        const sidebar = Utils.$('.sidebar');
        const appMain = Utils.$('.app-main');
        
        if (this.isMobile) {
            sidebar.classList.toggle('show');
        } else {
            // 桌面端直接切换sidebar的collapsed类
            sidebar.classList.toggle('collapsed');
            this.sidebarCollapsed = sidebar.classList.contains('collapsed');
            // 同步头部折叠按钮的双态图标
            const toggleBtn = Utils.$('#sidebarToggle');
            if (toggleBtn) {
                toggleBtn.classList.toggle('is-collapsed', this.sidebarCollapsed);
            }
        }
    }
    
    hideSidebar() {
        if (this.isMobile) {
            Utils.$('.sidebar').classList.remove('show');
        }
    }
    
    // 窗口大小变化处理
    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 768;
        
        if (wasMobile !== this.isMobile) {
            const sidebar = Utils.$('.sidebar');
            // 从桌面切换到移动端
            if (this.isMobile) {
                sidebar.classList.remove('collapsed');
                sidebar.classList.remove('show');
            } else {
                // 从移动端切换到桌面
                sidebar.classList.remove('show');
                if (this.sidebarCollapsed) {
                    sidebar.classList.add('collapsed');
                }
            }
        }
    }
    
    // 主机筛选功能（性能优化版）
    filterHosts() {
        // 批量IP精确匹配模式
        if (this.batchSearchMode && this.batchSearchIPs.length > 0) {
            const ipSet = new Set(this.batchSearchIPs);
            this.filteredHosts = this.hosts.filter(host => ipSet.has(host.ip));

            // 统计匹配结果中各 IP 在库中的次数（用于检测库中重复记录）
            const dbIPCount = {};
            this.filteredHosts.forEach(h => { dbIPCount[h.ip] = (dbIPCount[h.ip] || 0) + 1; });
            const dupDBCount = Object.values(dbIPCount).filter(c => c > 1).reduce((s, c) => s + (c - 1), 0);

            // 未找到的 IP
            const matchedIPSet = new Set(this.filteredHosts.map(h => h.ip));
            const notFoundIPs = this.batchSearchIPs.filter(ip => !matchedIPSet.has(ip));

            // 获取输入重复信息
            const bStats = this._pendingBatchStats || {};

            this.updateSearchStatusBar({
                totalInput: this.batchSearchIPs.length,
                matched: matchedIPSet.size,
                notFound: notFoundIPs.length,
                notFoundIPs,
                dupInputCount: bStats.dupInputCount || 0,
                dupInputIPs: bStats.dupInputIPs || [],
                dupDBCount
            });
        } else {
            // 普通模精性能优化：使用一次遍历完成所有筛选
            this.filteredHosts = this.hosts.filter(host => {
                // 搜索关键词过滤
                if (this.searchKeyword) {
                    const keyword = this.searchKeyword.toLowerCase();
                    const hostname = (host.hostname || '').toLowerCase();
                    const ip = (host.ip || '').toLowerCase();
                    const description = (host.description || '').toLowerCase();
                    const systemName = (host.systemName || host.system_name || '').toLowerCase();
                    const appName = (host.appName || host.app_name || '').toLowerCase();
                    const owner = (host.owner || '').toLowerCase();

                    if (!(hostname.includes(keyword) ||
                          ip.includes(keyword) ||
                          description.includes(keyword) ||
                          systemName.includes(keyword) ||
                          appName.includes(keyword) ||
                          owner.includes(keyword))) {
                        return false;
                    }
                }

                // 系统名称过滤
                if (this.systemNameFilter &&
                    (host.systemName !== this.systemNameFilter && host.system_name !== this.systemNameFilter)) {
                    return false;
                }

                // 应用名称过滤
                if (this.appNameFilter &&
                    (host.appName !== this.appNameFilter && host.app_name !== this.appNameFilter)) {
                    return false;
                }

                // 机房过滤
                if (this.datacenterFilter && host.datacenter !== this.datacenterFilter) {
                    return false;
                }

                // 环境过滤
                if (this.environmentFilter && host.environment !== this.environmentFilter) {
                    return false;
                }

                // 负责人过滤
                if (this.ownerFilter && host.owner !== this.ownerFilter) {
                    return false;
                }

                // 状态过滤
                if (this.statusFilter && host.status !== this.statusFilter) {
                    return false;
                }

                return true;
            });
        }

        // 应用排序
        this.applySorting();

        // 应用分页
        this.applyPagination();

        // 重新渲染当前视图
        this.renderCurrentView();

        // 更新统计信息
        this.updateStats();

        // 更新分页信息
        this.updatePaginationInfo();

        // 更新「重置全部」按钮徽标
        this.updateResetAllBadge();
    }

    // 计算当前激活的搜索/筛选条件数量，更新「重置全部」按钮徽标
    updateResetAllBadge() {
        const badge = Utils.$('#resetAllBadge');
        if (!badge) return;
        let count = 0;
        if (this.searchKeyword) count++;
        if (this.batchSearchMode && this.batchSearchIPs && this.batchSearchIPs.length > 0) count++;
        if (this.systemNameFilter) count++;
        if (this.appNameFilter) count++;
        if (this.datacenterFilter) count++;
        if (this.environmentFilter) count++;
        if (this.ownerFilter) count++;
        if (this.statusFilter) count++;
        if (count > 0) {
            badge.textContent = String(count);
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
    
    // 搜索主机
    searchHosts(keyword) {
        this.searchKeyword = keyword;
        this.filterHosts();
    }

    // 验证 IPv4 格式
    isValidIPv4(str) {
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(str) &&
            str.split('.').every(seg => parseInt(seg, 10) <= 255);
    }

    // 解析批量IP输入：切分、去重、统计
    // 返回 { uniqueIPs, dupInputCount, dupInputIPs, invalidTokens }
    parseBatchIPs(text) {
        const tokens = text.split(/[,，;\uff1b\/\s|]+/).map(s => s.trim()).filter(Boolean);
        const validIPs = [];
        const invalidTokens = [];
        tokens.forEach(t => {
            if (this.isValidIPv4(t)) validIPs.push(t);
            else invalidTokens.push(t);
        });
        // 统计输入重复
        const seen = {};
        const dupInputIPs = [];
        validIPs.forEach(ip => {
            seen[ip] = (seen[ip] || 0) + 1;
            if (seen[ip] === 2) dupInputIPs.push(ip);
        });
        const dupInputCount = validIPs.length - Object.keys(seen).length;
        const uniqueIPs = Object.keys(seen);
        return { uniqueIPs, dupInputCount, dupInputIPs, invalidTokens };
    }

    // 显示批量IP搜索弹窗
    showBatchSearchDialog() {
        const existing = document.getElementById('batchSearchModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'batchSearchModal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width: 640px; max-width: 92vw;">
                <div class="modal-header">
                    <h2 class="modal-title">批量IP搜索</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                            <span style="font-size: 12px; color: var(--text-muted);">支持的分隔符</span>
                            <span class="batch-sep-chip">, 逗号</span>
                            <span class="batch-sep-chip">; 分号</span>
                            <span class="batch-sep-chip">空格</span>
                            <span class="batch-sep-chip">换行</span>
                            <span class="batch-sep-chip">/ 斜杠</span>
                            <span class="batch-sep-chip">| 竖线</span>
                        </div>
                        <p style="font-size: 12px; color: var(--text-muted); margin: 10px 0 0; line-height: 1.5;">
                            输入内容全部为合法 IPv4 时，进入批量精确匹配模式；否则按普通关键字模糊搜索。
                        </p>
                    </div>
                    <textarea id="batchIPInput" class="form-control" rows="12"
                        placeholder="请输入或粘贴 IP 地址，例如：
192.168.1.1
192.168.1.2, 192.168.1.3
10.0.0.1; 10.0.0.2"
                        style="width: 100%; min-height: 200px; font-family: var(--font-mono); font-size: 13px; line-height: 1.7; padding: 10px 12px; resize: vertical;"></textarea>
                    <div id="batchIPStats" style="min-height: 20px; margin-top: 10px; font-size: 12px; color: var(--text-muted);"></div>
                </div>
                <div class="modal-footer" style="justify-content: space-between; align-items: center;">
                    <span style="font-size: 11px; color: var(--text-faint);">提示：Ctrl + Enter 快速搜索</span>
                    <span style="display: flex; gap: 8px;">
                        <button class="btn btn-primary" id="confirmBatchSearchBtn">搜索</button>
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
                    </span>
                </div>
            </div>
        `;
        overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector('#confirmBatchSearchBtn').addEventListener('click', () => {
            const text = overlay.querySelector('#batchIPInput').value.trim();
            if (!text) return;
            overlay.remove();
            this._applyBatchSearch(text);
        });
        // 支持 Ctrl+Enter 提交
        overlay.querySelector('#batchIPInput').addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'Enter') {
                const text = e.target.value.trim();
                if (text) { overlay.remove(); this._applyBatchSearch(text); }
            }
        });
        // 实时识别统计
        const statsEl = overlay.querySelector('#batchIPStats');
        const batchInput = overlay.querySelector('#batchIPInput');
        const updateStats = () => {
            const text = batchInput.value.trim();
            if (!text) {
                statsEl.innerHTML = '<span style="color: var(--text-faint);">粘贴或输入 IP 后，此处实时显示识别结果</span>';
                return;
            }
            const { uniqueIPs, dupInputCount, invalidTokens } = this.parseBatchIPs(text);
            if (uniqueIPs.length > 0 && invalidTokens.length === 0) {
                const dupPart = dupInputCount > 0 ? `，已自动去重 <strong style="color: var(--status-warning-fg);">${dupInputCount}</strong> 个` : '';
                statsEl.innerHTML = `<span style="color: var(--status-healthy-fg);">${Utils.icon('check', 12, 2.5)} 批量精确匹配</span><span>共识别 <strong style="font-family: var(--font-mono);">${uniqueIPs.length}</strong> 个 IP${dupPart}</span>`;
            } else if (uniqueIPs.length === 0) {
                statsEl.innerHTML = '<span>未识别到合法 IP，将按关键字模糊搜索</span>';
            } else {
                statsEl.innerHTML = `<span style="color: var(--status-warning-fg);">包含 ${invalidTokens.length} 项非 IP 内容，将按关键字模糊搜索</span>`;
            }
        };
        batchInput.addEventListener('input', updateStats);
        updateStats();
        document.body.appendChild(overlay);
        setTimeout(() => batchInput.focus(), 50);
    }

    // 解析并执行批量搜索逻辑
    _applyBatchSearch(text) {
        const { uniqueIPs, dupInputCount, dupInputIPs, invalidTokens } = this.parseBatchIPs(text);

        // 智能识别：所有 token 均是合法 IPv4 才走批量模式
        const allTokens = text.split(/[,，;\uff1b\/\s|]+/).map(s => s.trim()).filter(Boolean);
        const allAreIPs = allTokens.length > 0 && allTokens.every(t => this.isValidIPv4(t));

        if (!allAreIPs) {
            // 不全是 IPv4，退回普通模糊搜索
            this.batchSearchMode = false;
            this.batchSearchIPs = [];
            const input = Utils.$('#hostSearchInput');
            if (input) input.value = text.replace(/[\r\n]+/g, ' ').trim();
            this.searchKeyword = text.replace(/[\r\n]+/g, ' ').trim();
            this.filterHosts();
            return;
        }

        // 进入批量精确匹配模式
        this.batchSearchMode = true;
        this.batchSearchIPs = uniqueIPs;
        this.searchKeyword = ''; // 清空普通搜索框
        const input = Utils.$('#hostSearchInput');
        if (input) input.value = '';
        this._pendingBatchStats = { dupInputCount, dupInputIPs, invalidTokens };
        this.filterHosts(); // filterHosts 内会更新状态条
    }

    // 清除批量搜索
    clearBatchSearch() {
        this.batchSearchMode = false;
        this.batchSearchIPs = [];
        this._pendingBatchStats = null;
        this.updateSearchStatusBar(null);
        this.filterHosts();
    }

    // 更新搜索状态条
    updateSearchStatusBar(info) {
        const bar = Utils.$('#searchStatusBar');
        const textEl = Utils.$('#searchStatusText');
        if (!bar || !textEl) return;
        if (!info) {
            bar.style.display = 'none';
            textEl.textContent = '';
            return;
        }
        const parts = [];
        parts.push(`批量IP模式  搜索 <strong>${info.totalInput}</strong> 个`);
        parts.push(`已匹配 <strong style="color:var(--status-healthy-fg)">${info.matched}</strong> 个`);
        if (info.notFound > 0) {
            const sample = info.notFoundIPs.slice(0, 3).join('、');
            const more = info.notFoundIPs.length > 3 ? `等${info.notFoundIPs.length}个` : '';
            parts.push(`<span style="color:var(--status-critical-fg)">未找到 <strong>${info.notFound}</strong> 个：${sample}${more}</span>`);
        }
        if (info.dupInputCount > 0) {
            parts.push(`<span style="color:var(--status-warning-fg)">输入重复 <strong>${info.dupInputCount}</strong> 个，已自动去重</span>`);
        }
        if (info.dupDBCount > 0) {
            parts.push(`<span style="color:var(--status-warning-fg)">库中重复记录 <strong>${info.dupDBCount}</strong> 条</span>`);
        }
        textEl.innerHTML = parts.join('&nbsp;&nbsp;|  ');
        bar.style.display = 'flex';
        bar.style.alignItems = 'center';
    }

    // 清除搜索（仅清空搜索框与批量IP模式，不动下拉筛选）
    clearSearch() {
        const input = Utils.$('#hostSearchInput');
        if (input) input.value = '';
        this.searchKeyword = '';
        this.batchSearchMode = false;
        this.batchSearchIPs = [];
        this._pendingBatchStats = null;
        this.updateSearchStatusBar(null);
        this.filterHosts();
    }

    // 清除筛选
    clearFilters() {
        // 清除搜索关键字
        Utils.$('#hostSearchInput').value = '';
        this.searchKeyword = '';
    
        // 清除批量IP模式
        this.batchSearchMode = false;
        this.batchSearchIPs = [];
        this._pendingBatchStats = null;
        this.updateSearchStatusBar(null);
            
        const filterSelects = [
            Utils.$('#hostSystemNameFilter'),
            Utils.$('#hostAppNameFilter'),
            Utils.$('#hostDatacenterFilter'),
            Utils.$('#hostEnvironmentFilter'),
            Utils.$('#hostOwnerFilter'),
            Utils.$('#hostStatusFilter')
        ];
        
        filterSelects.forEach(select => {
            if (select) {
                select.value = '';
                // 使用setProperty强制覆盖样式
                select.style.setProperty('background-color', 'white', 'important');
                select.style.setProperty('background-image', 'none', 'important');
                select.style.setProperty('background', 'white', 'important');
                // 强制重绘以清除浏览器默认样式
                select.blur();
                // 使用setTimeout确保样式生效
                setTimeout(() => {
                    select.style.setProperty('background-color', 'white', 'important');
                    select.style.setProperty('background-image', 'none', 'important');
                }, 0);
            }
        });
        
        this.systemNameFilter = '';
        this.appNameFilter = '';
        this.datacenterFilter = '';
        this.environmentFilter = '';
        this.ownerFilter = '';
        this.statusFilter = '';
        
        // 更新筛选器选项
        this.updateFilters();
        
        // 应用筛选
        this.filterHosts();
        
        Utils.notify.success('已清除所有筛选条件');
    }
    
    // 渲染主机表格（只保留表格视图）
    renderCurrentView() {
        this.renderHostsTable();
    }
    
    // 切换环境组折叠状态
    toggleGroup(header) {
        const content = header.nextElementSibling;
        const isCollapsed = header.classList.toggle('collapsed');
        content.classList.toggle('collapsed', isCollapsed);
    }
    
    // 排序主机
    sortHosts(field) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        
        // 更新排序箭头
        Utils.$$('.sortable').forEach(th => {
            th.classList.remove('asc', 'desc');
        });
        
        const currentTh = Utils.$(`[data-sort="${field}"]`);
        if (currentTh) {
            currentTh.classList.add(this.sortDirection);
        }
        
        this.applySorting();
        this.renderCurrentView();
    }
    
    // 应用排序
    applySorting() {
        this.filteredHosts.sort((a, b) => {
            let aVal = a[this.sortField] || '';
            let bVal = b[this.sortField] || '';
            
            // 特殊字段处理
            if (this.sortField === 'status') {
                // 状态排序：online > unknown > offline
                const statusOrder = { 'online': 3, 'unknown': 2, 'offline': 1 };
                aVal = statusOrder[aVal] || 0;
                bVal = statusOrder[bVal] || 0;
            }
            
            // 字符串比较
            if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = bVal.toLowerCase();
            }
            
            let result = 0;
            if (aVal < bVal) result = -1;
            else if (aVal > bVal) result = 1;
            
            return this.sortDirection === 'desc' ? -result : result;
        });
    }
    
    // 更新筛选器（性能优化版本）
    // 双向级联：每个筛选项的可选值，由「除自己以外的所有筛选条件」计算得出
    // 这样无需清空当前选中即可切换值，且 6 个筛选项之间任意顺序都能联动
    updateFilters() {
        // 性能优化：使用缓存的筛选器选项，避免重复计算
        this.buildFilterOptionsCache();

        // 根据当前筛选条件获取可用的主机列表（用于级联筛选）
        // excludeKey 表示在计算该字段的下拉选项时，忽略该字段自身的过滤条件
        const getFilteredHostsExcept = (excludeKey) => {
            return this.hosts.filter(host => {
                if (excludeKey !== 'systemName' && this.systemNameFilter &&
                    host.systemName !== this.systemNameFilter && host.system_name !== this.systemNameFilter) {
                    return false;
                }
                if (excludeKey !== 'appName' && this.appNameFilter &&
                    host.appName !== this.appNameFilter && host.app_name !== this.appNameFilter) {
                    return false;
                }
                if (excludeKey !== 'datacenter' && this.datacenterFilter &&
                    host.datacenter !== this.datacenterFilter) {
                    return false;
                }
                if (excludeKey !== 'environment' && this.environmentFilter &&
                    host.environment !== this.environmentFilter) {
                    return false;
                }
                if (excludeKey !== 'owner' && this.ownerFilter &&
                    host.owner !== this.ownerFilter) {
                    return false;
                }
                if (excludeKey !== 'status' && this.statusFilter &&
                    host.status !== this.statusFilter) {
                    return false;
                }
                return true;
            });
        };

        // 统计各选项的主机数量（级联口径：排除该字段自身条件后的主机集合）
        const countBy = (hosts, getValue) => {
            const counts = {};
            hosts.forEach(host => {
                const val = getValue(host);
                if (val) counts[val] = (counts[val] || 0) + 1;
            });
            return counts;
        };

        // 系统：由「除系统外的其他条件」决定可选项（实现反向联动）
        const systemHosts = getFilteredHostsExcept('systemName');
        const systemCounts = countBy(systemHosts, host => host.systemName || host.system_name);
        const systemNames = Object.keys(systemCounts);
        this.updateFilterSelect('#hostSystemNameFilter', systemNames.map(name => ({ value: name, label: name, count: systemCounts[name] })), this.systemNameFilter, '全部系统');
        if (this.systemNameFilter && !systemNames.includes(this.systemNameFilter)) {
            this.systemNameFilter = '';
        }

        // 应用
        const appHosts = getFilteredHostsExcept('appName');
        const appCounts = countBy(appHosts, host => host.appName || host.app_name);
        const appNames = Object.keys(appCounts);
        this.updateFilterSelect('#hostAppNameFilter', appNames.map(name => ({ value: name, label: name, count: appCounts[name] })), this.appNameFilter, '全部应用');
        if (this.appNameFilter && !appNames.includes(this.appNameFilter)) {
            this.appNameFilter = '';
        }

        // 机房
        const dcHosts = getFilteredHostsExcept('datacenter');
        const dcCounts = countBy(dcHosts, host => host.datacenter);
        const datacenters = Object.keys(dcCounts);
        this.updateFilterSelect('#hostDatacenterFilter', datacenters.map(name => ({ value: name, label: name, count: dcCounts[name] })), this.datacenterFilter, '全部机房');
        if (this.datacenterFilter && !datacenters.includes(this.datacenterFilter)) {
            this.datacenterFilter = '';
        }

        // 环境
        const envHosts = getFilteredHostsExcept('environment');
        const envCounts = countBy(envHosts, host => host.environment);
        const environments = Object.keys(envCounts);
        this.updateFilterSelect('#hostEnvironmentFilter', environments.map(name => ({ value: name, label: name, count: envCounts[name] })), this.environmentFilter, '全部环境');
        if (this.environmentFilter && !environments.includes(this.environmentFilter)) {
            this.environmentFilter = '';
        }

        // 负责人
        const ownerHosts = getFilteredHostsExcept('owner');
        const ownerCounts = countBy(ownerHosts, host => host.owner);
        const owners = Object.keys(ownerCounts).sort();
        this.updateFilterSelect('#hostOwnerFilter', owners.map(name => ({ value: name, label: name, count: ownerCounts[name] })), this.ownerFilter, '全部负责人');
        if (this.ownerFilter && !owners.includes(this.ownerFilter)) {
            this.ownerFilter = '';
        }

        // 状态
        const statusHosts = getFilteredHostsExcept('status');
        const statusCounts = countBy(statusHosts, host => host.status);
        const statuses = Object.keys(statusCounts);
        const statusMap = {
            'online': '在线',
            'offline': '离线',
            'unknown': '未知',
            'testing': '测试中',
            'auth_failed': '认证失败'
        };
        const statusOptions = statuses.map(s => ({ value: s, label: statusMap[s] || s, count: statusCounts[s] }));
        this.updateFilterSelect('#hostStatusFilter', statusOptions, this.statusFilter, '全部状态');

        if (this.statusFilter && !statuses.includes(this.statusFilter)) {
            this.statusFilter = '';
        }
    }
    
    // 更新批量操作栏
    updateBatchActions() {
        const selectedCount = this.getSelectedHosts().length;
        const batchActions = Utils.$('#batchActions');
        const selectedCountEl = Utils.$('#selectedCount');
        
        if (selectedCount > 0) {
            batchActions.style.display = 'flex';
            selectedCountEl.textContent = `已选择 ${selectedCount} 台主机`;
        } else {
            batchActions.style.display = 'none';
        }
    }
    
    // 批量操作方法
    async batchCollectInfo() {
        const selectedIndices = this.getSelectedHosts();
        if (selectedIndices.length === 0) {
            Utils.notify.warning('请先选择要收集信息的主机');
            return;
        }
        
        const selectedHosts = selectedIndices.map(index => this.hosts[index]);
        
        const batchDialog = new Components.BatchOperationDialog({
            operation: 'collect_info',
            title: '批量收集主机信息',
            hosts: selectedHosts,
            onComplete: () => {
                this.refreshHosts();
            }
        });
        
        batchDialog.show();
    }
    
    async batchConfigureKeys() {
        const selectedIndices = this.getSelectedHosts();
        if (selectedIndices.length === 0) {
            Utils.notify.warning('请先选择要配置密钥的主机');
            return;
        }
        
        const selectedHosts = selectedIndices.map(index => this.hosts[index]);
        
        const batchDialog = new Components.BatchOperationDialog({
            operation: 'configure_keys',
            title: '批量配置SSH密钥',
            hosts: selectedHosts,
            onComplete: () => {
                Utils.notify.success('批量密钥配置完成');
            }
        });
        
        batchDialog.show();
    }
    
    async batchDeleteHosts() {
        const selectedIndices = this.getSelectedHosts();
        if (selectedIndices.length === 0) {
            Utils.notify.warning('请先选择要删除的主机');
            return;
        }
        
        const confirmed = await Utils.confirm(`确定要删除选中的 ${selectedIndices.length} 台主机吗？`);
        if (!confirmed) return;
        
        try {
            // 从后往前删除，避免索引变动
            const sortedIndices = selectedIndices.sort((a, b) => b - a);
            
            for (const index of sortedIndices) {
                await this.hostService.deleteHost(this.hosts[index].id);
                this.hosts.splice(index, 1);
            }
            
            this.filterHosts();
            this.updateUI();
            
            Utils.notify.success(`成功删除 ${selectedIndices.length} 台主机`);
        } catch (error) {
            console.error('批量删除主机失败:', error);
            Utils.notify.error('批量删除失败: ' + error.message);
        }
    }
    
    /**
     * 批量修改主机字段（通用方法）
     * @param {string} fieldKey - 字段键名（username/password/owner/systemName）
     * @param {string} fieldLabel - 字段中文名称
     */
    async batchModifyField(fieldKey, fieldLabel) {
        const selectedIndices = this.getSelectedHosts();
        if (selectedIndices.length === 0) {
            Utils.notify.warning('请先选择要修改的主机');
            return;
        }
        
        const selectedHosts = selectedIndices.map(index => this.hosts[index]);
        
        // 统计当前字段值分布
        const valueDistribution = {};
        selectedHosts.forEach(host => {
            const val = host[fieldKey] || '(空)';
            valueDistribution[val] = (valueDistribution[val] || 0) + 1;
        });
        
        // 生成分布提示文本
        const distEntries = Object.entries(valueDistribution)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        const distHtml = distEntries.map(([val, count]) => {
            const displayVal = val.length > 20 ? val.substring(0, 20) + '...' : val;
            return `<span style="display:inline-block;background:var(--surface-subtle);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 8px;margin:2px 4px 2px 0;font-size:12px;">${this._escapeHtml(displayVal)} × ${count}</span>`;
        }).join('');
        const moreText = Object.keys(valueDistribution).length > 10 ? `<span style="color:var(--text-faint);font-size:12px;"> 等共${Object.keys(valueDistribution).length}种值...</span>` : '';
        
        // 显示批量修改对话框
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay active';
        modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 500px;">
                <div class="modal-header">
                    <h2>批量修改${fieldLabel}</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <p style="margin-bottom: 8px; color: var(--text-body);">将对 <strong>${selectedHosts.length}</strong> 台主机统一修改${fieldLabel}。</p>
                        <div style="margin-bottom: 12px;">
                            <label style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; display: block;">当前值分布：</label>
                            <div style="max-height: 80px; overflow-y: auto; padding: 4px 0;">${distHtml}${moreText}</div>
                        </div>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 6px; font-weight: 500;">新${fieldLabel}：</label>
                        <input type="text" class="form-control" id="batchModifyInput" placeholder="请输入新的${fieldLabel}" style="width: 100%;" autocomplete="off">
                        <p id="batchModifyError" style="color: var(--status-critical-fg); font-size: 12px; margin-top: 4px; display: none;"></p>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 10px; padding: 16px 20px; border-top: 1px solid var(--border-subtle);">
                    <button class="btn btn-secondary" id="batchModifyCancelBtn">取消</button>
                    <button class="btn btn-primary" id="batchModifyConfirmBtn">确认修改</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalOverlay);
        
        // 自动聚焦输入框
        setTimeout(() => document.getElementById('batchModifyInput')?.focus(), 100);
        
        // 事件绑定
        const closeModal = () => {
            modalOverlay.classList.remove('active');
            setTimeout(() => modalOverlay.remove(), 200);
        };
        
        modalOverlay.querySelector('.modal-close').addEventListener('click', closeModal);
        modalOverlay.querySelector('#batchModifyCancelBtn').addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
        
        modalOverlay.querySelector('#batchModifyConfirmBtn').addEventListener('click', async () => {
            const newValue = document.getElementById('batchModifyInput').value.trim();
            const errorEl = document.getElementById('batchModifyError');
            
            // 禁止空值提交
            if (!newValue) {
                errorEl.textContent = `${fieldLabel}不能为空，请输入有效值`;
                errorEl.style.display = 'block';
                return;
            }
            errorEl.style.display = 'none';
            
            // 二次确认
            const confirmMsg = `确认将 ${selectedHosts.length} 台主机的${fieldLabel}统一修改为：\n\n「${newValue}」\n\n此操作不可撤销，确认继续？`;
            if (!confirm(confirmMsg)) {
                return;
            }
            
            closeModal();
            
            // 执行批量修改
            await this._executeBatchModify(selectedHosts, fieldKey, fieldLabel, newValue);
        });
        
        // 回车确认
        document.getElementById('batchModifyInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                modalOverlay.querySelector('#batchModifyConfirmBtn').click();
            }
        });
    }
    
    /**
     * 执行批量修改操作
     */
    async _executeBatchModify(hosts, fieldKey, fieldLabel, newValue) {
        const overlay = Utils.loading.show(document.body, `正在批量修改${fieldLabel}...`);
        let successCount = 0;
        let failCount = 0;
        const failedHosts = [];
        
        try {
            for (const host of hosts) {
                try {
                    const updates = {};
                    updates[fieldKey] = newValue;
                    await this.hostService.updateHost(host.id, updates);
                    successCount++;
                } catch (error) {
                    failCount++;
                    failedHosts.push(host.hostname || host.ip);
                    console.error(`修改主机 ${host.hostname || host.ip} 的${fieldLabel}失败:`, error);
                }
            }
            
            // 刷新数据
            await this.loadData();
            this.updateUI();
            
            // 显示结果
            if (failCount === 0) {
                Utils.notify.success(`批量修改${fieldLabel}完成！成功修改 ${successCount} 台主机`);
            } else {
                Utils.notify.warning(`批量修改${fieldLabel}完成：成功 ${successCount} 台，失败 ${failCount} 台\n失败主机: ${failedHosts.join(', ')}`);
            }
        } catch (error) {
            console.error(`批量修改${fieldLabel}失败:`, error);
            Utils.notify.error(`批量修改${fieldLabel}失败: ` + error.message);
        } finally {
            Utils.loading.hide(overlay);
        }
    }
    
    /**
     * HTML转义工具方法
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    // 刷新所有主机状态
    async refreshAllHostsStatus() {
        const overlay = Utils.loading.show(document.body, '正在刷新所有主机状态...');
        
        try {
            const hosts = this.hosts.filter(host => host.ip && host.username);
            let checkedCount = 0;
            
            for (const host of hosts) {
                try {
                    await this.connectionMonitor.checkHostNow(host.id);
                    checkedCount++;
                } catch (error) {
                    console.error(`刷新主机 ${host.hostname || host.ip} 状态失败:`, error);
                }
                
                await Utils.sleep(100);
            }
            
            await this.loadData();
            this.updateUI();
            
            Utils.notify.success(`状态刷新完成！共检查 ${checkedCount} 台主机`);
            
        } catch (error) {
            console.error('刷新主机状态失败:', error);
            Utils.notify.error('刷新状态失败: ' + error.message);
        } finally {
            Utils.loading.hide(overlay);
        }
    }
    
    // 切换连接监控
    toggleConnectionMonitoring() {
        const stats = this.connectionMonitor.getMonitoringStats();
        
        if (stats.isMonitoring) {
            this.connectionMonitor.stopMonitoring();
            this.updateConnectionStatus('stopped', '已停止');
            Utils.notify.info('连接监控已停止');
        } else {
            this.connectionMonitor.startMonitoring();
            this.updateConnectionStatus('monitoring', '监控中');
            Utils.notify.info('连接监控已开始');
        }
    }
    
    // 显示监控设置
    showMonitoringSettings() {
        const currentInterval = this.connectionMonitor.monitoringInterval / 1000;
        
        const settingsDialog = new Modal({
            title: '监控设置',
            content: `
                <div class="monitoring-settings">
                    <div class="form-group">
                        <label for="monitorInterval">监控间隔（秒）</label>
                        <input type="number" class="form-control" id="monitorInterval" 
                               value="${currentInterval}" min="10" max="300" step="5">
                        <small class="form-text text-muted">
                            建议设置在10-300秒之间，过短可能影响性能
                        </small>
                    </div>
                    <div style="text-align: right; margin-top: 1.5rem;">
                        <button class="btn btn-secondary" id="monitorCancelBtn" style="margin-right: 0.5rem;">取消</button>
                        <button class="btn btn-primary" id="monitorSaveBtn">保存</button>
                    </div>
                </div>
            `,
            width: '500px'
        });
        
        settingsDialog.show();

        setTimeout(() => {
            const cancelBtn = document.getElementById('monitorCancelBtn');
            const saveBtn = document.getElementById('monitorSaveBtn');
            if (cancelBtn) cancelBtn.addEventListener('click', () => settingsDialog.hide());
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    const newInterval = parseInt(document.getElementById('monitorInterval').value) * 1000;
                    if (newInterval >= 10000 && newInterval <= 300000) {
                        this.connectionMonitor.setMonitoringInterval(newInterval);
                        Utils.notify.success('监控设置已更新');
                        settingsDialog.hide();
                    } else {
                        Utils.notify.error('请输入10-300秒之间的数值');
                    }
                });
            }
        }, 100);
    }
    
    // 格式化相对时间
    formatRelativeTime(timestamp) {
        if (!timestamp) return '从未连接';
        
        const now = new Date();
        const time = new Date(timestamp);
        const diff = now - time;
        
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}天前`;
        } else if (hours > 0) {
            return `${hours}小时前`;
        } else if (minutes > 0) {
            return `${minutes}分钟前`;
        } else if (seconds > 10) {
            return `${seconds}秒前`;
        } else {
            return '刚刚';
        }
    }
    
    // 初始化工具提示
    initTooltips() {
        try {
            // 初始化所有工具提示
            if (Utils.tooltip && Utils.tooltip.initAll) {
                Utils.tooltip.initAll();
            }
            
            // 为状态指示器添加交互式工具提示
            const statusIndicator = Utils.$('#connectionStatus');
            if (statusIndicator && Utils.tooltip && Utils.tooltip.create) {
                Utils.tooltip.create(statusIndicator, '点击查看连接状态详情', {
                    placement: 'bottom',
                    trigger: 'hover'
                });
            }
        } catch (error) {
            console.error('初始化工具提示失败:', error);
        }
    }
    
    // 数据验证增强
    enhanceFormValidation() {
        try {
            // 实时验证表单输入
            document.addEventListener('input', (e) => {
                if (e.target && e.target.classList.contains('form-control')) {
                    this.validateFieldRealtime(e.target);
                }
            });
        } catch (error) {
            console.error('增强表单验证失败:', error);
        }
    }
    
    validateFieldRealtime(field) {
        try {
            // 基本验证逻辑
            let isValid = true;
            let errorMessage = '';
            
            const value = field.value ? field.value.trim() : '';
            const fieldName = field.name || field.id;
            
            switch (fieldName) {
                case 'ip':
                    if (value && Utils.validators && Utils.validators.isIP && !Utils.validators.isIP(value)) {
                        isValid = false;
                        errorMessage = 'IP地址格式不正确';
                    }
                    break;
                case 'port':
                    if (value && Utils.validators && Utils.validators.isPort && !Utils.validators.isPort(parseInt(value))) {
                        isValid = false;
                        errorMessage = '端口号必须在1-65535之间';
                    }
                    break;
                case 'hostname':
                case 'username':
                    if (field.required && !value) {
                        isValid = false;
                        errorMessage = '该字段不能为空';
                    }
                    break;
            }
            
            // 更新视觉状态
            if (isValid) {
                field.classList.remove('is-invalid');
                field.classList.add('is-valid');
            } else {
                field.classList.remove('is-valid');
                field.classList.add('is-invalid');
            }
            
            return isValid;
        } catch (error) {
            console.error('字段验证错误:', error);
            return true; // 遇到错误时返回true，避免阻塞
        }
    }
    
    // ==================== 分页相关方法 ====================
    
    // 应用分页（性能优化版）
    applyPagination() {
        if (!this.enablePagination) {
            this.paginatedHosts = this.filteredHosts;
            this.totalPages = 1;
            return;
        }
        
        // 计算总页数（始终计算，确保分页控件正确显示）
        this.totalPages = Math.max(1, Math.ceil(this.filteredHosts.length / this.pageSize));
        
        // 确保当前页码在有效范围内
        if (this.paginationCurrentPage > this.totalPages) {
            this.paginationCurrentPage = Math.max(1, this.totalPages);
        }
        
        // 计算当前页显示的数据
        const startIndex = (this.paginationCurrentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        this.paginatedHosts = this.filteredHosts.slice(startIndex, endIndex);
    }
    
    // 性能优化：构建筛选器选项缓存
    buildFilterOptionsCache() {
        // 只在主机数据变化时重新构建缓存
        this.cachedFilterOptions.systemNames = [...new Set(this.hosts.map(host => host.systemName || host.system_name).filter(Boolean))];
        this.cachedFilterOptions.appNames = [...new Set(this.hosts.map(host => host.appName || host.app_name).filter(Boolean))];
        this.cachedFilterOptions.datacenters = [...new Set(this.hosts.map(host => host.datacenter).filter(Boolean))];
        this.cachedFilterOptions.environments = [...new Set(this.hosts.map(host => host.environment).filter(Boolean))];
        this.cachedFilterOptions.owners = [...new Set(this.hosts.map(host => host.owner).filter(Boolean))].sort();
    }
    
    // 性能优化：批量更新筛选器选项
    // options 支持两种格式：纯字符串，或 { value, label, count }（count 用于显示主机数量）
    updateFilterSelect(selector, options, selectedValue, defaultLabel) {
        const selectElement = Utils.$(selector);
        if (!selectElement) return;
        
        // 统一归一化为 { value, label, count } 结构
        const normalized = options.map(opt =>
            typeof opt === 'string' ? { value: opt, label: opt } : opt
        );
        
        // 使用innerHTML批量设置，避免多次DOM操作
        const optionsHTML = [
            `<option value="">${defaultLabel}</option>`,
            ...normalized.map(opt => `<option value="${opt.value}" ${opt.value === selectedValue ? 'selected' : ''}>${opt.label}${opt.count != null ? ` (${opt.count})` : ''}</option>`)
        ].join('');
        
        selectElement.innerHTML = optionsHTML;
        
        // 如果当前值为空，强制覆盖浏览器autocomplete样式
        if (!selectedValue) {
            selectElement.style.setProperty('background-color', 'white', 'important');
            selectElement.style.setProperty('background-image', 'none', 'important');
            selectElement.style.setProperty('background', 'white', 'important');
        }
    }
    
    // 性能优化：智能调整分页大小
    autoAdjustPageSize() {
        const totalHosts = this.hosts.length; // 使用总主机数而不是筛选后的数量
        
        // 根据总数据量自动调整每页显示数量
        if (totalHosts > 2000) {
            this.pageSize = 100;
        } else if (totalHosts > 1000) {
            this.pageSize = 100;
        } else if (totalHosts > 500) {
            this.pageSize = 100;
        } else {
            this.pageSize = 100; // 默认100条
        }
        
        // 更新UI中的选择器
        const pageSizeSelect = Utils.$('#pageSizeSelect');
        if (pageSizeSelect) {
            pageSizeSelect.value = this.pageSize;
        }
    }
    
    // 跳转到指定页面
    goToPage(pageNumber) {
        if (pageNumber < 1 || pageNumber > this.totalPages) {
            return;
        }
        
        this.paginationCurrentPage = pageNumber;
        this.applyPagination();
        this.renderCurrentView();
        this.updatePaginationInfo();
    }
    
    // 更新分页信息显示（性能优化版）
    updatePaginationInfo() {
        const paginationElement = Utils.$('#pagination');
        if (!paginationElement) return;
        
        // 只在没有数据或未启用分页时隐藏
        if (!this.enablePagination || this.filteredHosts.length === 0) {
            paginationElement.style.display = 'none';
            return;
        }
        
        // 始终显示分页控件（即使只有一页）
        paginationElement.style.display = 'flex';
        
        // 更新分页信息文本
        const infoElement = Utils.$('#paginationInfo');
        if (infoElement) {
            const start = Math.min((this.paginationCurrentPage - 1) * this.pageSize + 1, this.filteredHosts.length);
            const end = Math.min(this.paginationCurrentPage * this.pageSize, this.filteredHosts.length);
            infoElement.textContent = `显示 ${start}-${end} 共 ${this.filteredHosts.length} 条记录`;
        }
        
        // 更新分页按钮状态
        const firstBtn = Utils.$('#firstPageBtn');
        const prevBtn = Utils.$('#prevPageBtn');
        const nextBtn = Utils.$('#nextPageBtn');
        const lastBtn = Utils.$('#lastPageBtn');
        
        if (firstBtn) firstBtn.disabled = this.paginationCurrentPage === 1;
        if (prevBtn) prevBtn.disabled = this.paginationCurrentPage === 1;
        if (nextBtn) nextBtn.disabled = this.paginationCurrentPage === this.totalPages;
        if (lastBtn) lastBtn.disabled = this.paginationCurrentPage === this.totalPages;
        
        // 更新页码按钮
        this.updatePaginationNumbers();
    }
    
    // 更新页码按钮
    updatePaginationNumbers() {
        const numbersContainer = Utils.$('#paginationNumbers');
        if (!numbersContainer) return;
        
        numbersContainer.innerHTML = '';
        
        // 计算显示的页码范围
        const maxVisible = 5;
        let startPage = Math.max(1, this.paginationCurrentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(this.totalPages, startPage + maxVisible - 1);
        
        // 调整起始页码，确保显示足够的页码
        if (endPage - startPage + 1 < maxVisible) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }
        
        // 如果起始页码大于1，显示第一页和省略号
        if (startPage > 1) {
            const firstPageBtn = document.createElement('button');
            firstPageBtn.className = 'pagination-btn';
            firstPageBtn.textContent = '1';
            firstPageBtn.onclick = () => this.goToPage(1);
            numbersContainer.appendChild(firstPageBtn);
            
            if (startPage > 2) {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'pagination-ellipsis';
                ellipsis.textContent = '...';
                ellipsis.style.padding = '8px 4px';
                ellipsis.style.color = 'var(--text-muted)';
                numbersContainer.appendChild(ellipsis);
            }
        }
        
        // 显示页码按钮
        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.className = `pagination-btn ${i === this.paginationCurrentPage ? 'active' : ''}`;
            pageBtn.textContent = i;
            pageBtn.onclick = () => this.goToPage(i);
            numbersContainer.appendChild(pageBtn);
        }
        
        // 如果结束页码小于总页数，显示省略号和最后一页
        if (endPage < this.totalPages) {
            if (endPage < this.totalPages - 1) {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'pagination-ellipsis';
                ellipsis.textContent = '...';
                ellipsis.style.padding = '8px 4px';
                ellipsis.style.color = 'var(--text-muted)';
                numbersContainer.appendChild(ellipsis);
            }
            
            const lastPageBtn = document.createElement('button');
            lastPageBtn.className = 'pagination-btn';
            lastPageBtn.textContent = this.totalPages;
            lastPageBtn.onclick = () => this.goToPage(this.totalPages);
            numbersContainer.appendChild(lastPageBtn);
        }
    }
    
    // 切换分页模式
    togglePagination(enable) {
        this.enablePagination = enable;
        if (enable) {
            this.paginationCurrentPage = 1;
        }
        this.filterHosts();
    }
}

// 当DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    try {
        // 添加全局错误处理
        window.addEventListener('error', (e) => {
            console.error('全局错误:', e.error);
            // 不阻止默认错误处理
            return false;
        });
        
        window.addEventListener('unhandledrejection', (e) => {
            console.error('未处理的Promise拒绝:', e.reason);
        });
        
        // 等待Utils初始化完成后再初始化应用
        const initApp = () => {
            if (typeof window.Utils !== 'undefined') {
                window.app = new SSHToolsApp();
                console.log('应用程序已初始化');
            } else {
                // 如果Utils还没有定义，等待50ms后再试
                setTimeout(initApp, 50);
            }
        };
        
        initApp();
    } catch (error) {
        console.error('应用程序初始化失败:', error);
        // 显示用户友好的错误信息
        document.body.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: var(--status-critical-fg); background: var(--status-critical-bg);">
                <h2>应用程序初始化失败</h2>
                <p>请刷新页面重试，或联系技术支持。</p>
                <details style="margin-top: 1rem; text-align: left;">
                    <summary>错误详情</summary>
                    <pre style="background: var(--surface-card); color: var(--text-body); padding: 1rem; border-radius: 4px; margin-top: 0.5rem;">${error.stack || error.message}</pre>
                </details>
            </div>
        `;
    }
});