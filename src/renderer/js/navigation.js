// 导航管理器
class NavigationManager {
    constructor() {
        this.pages = new Map();
        this.currentPage = null;
        this.history = [];
        this.maxHistoryLength = 50;
        
        this.initPages();
    }
    
    // 初始化页面配置
    initPages() {
        this.pages.set('hosts', {
            id: 'hosts',
            title: '主机管理',
            icon: '🖥️',
            description: '管理SSH主机连接信息',
            breadcrumb: ['主机管理'],
            toolbar: true,
            onEnter: () => this.loadHostsPage(),
            onLeave: () => this.saveHostsState()
        });
        
        this.pages.set('scripts', {
            id: 'scripts',
            title: '脚本管理',
            icon: '📝',
            description: '管理和编辑执行脚本',
            breadcrumb: ['脚本管理'],
            toolbar: true,
            onEnter: () => this.loadScriptsPage(),
            onLeave: () => this.saveScriptsState()
        });
        
        this.pages.set('tasks', {
            id: 'tasks',
            title: '任务执行',
            icon: '⚡',
            description: '批量执行脚本任务',
            breadcrumb: ['任务执行'],
            toolbar: true,
            onEnter: () => this.loadTasksPage(),
            onLeave: () => this.saveTasksState()
        });
        
        this.pages.set('commands', {
            id: 'commands',
            title: '命令执行',
            icon: '⏱️',
            description: '临时命令执行',
            breadcrumb: ['命令执行'],
            toolbar: true,
            onEnter: () => this.loadCommandsPage(),
            onLeave: () => this.saveCommandsState()
        });
        
        this.pages.set('fileupload', {
            id: 'fileupload',
            title: '文件上传',
            icon: '📁',
            description: '文件上传管理',
            breadcrumb: ['文件上传'],
            toolbar: true,
            onEnter: () => this.loadFileUploadPage(),
            onLeave: () => this.saveFileUploadState()
        });
        
        this.pages.set('project-tasks', {
            id: 'project-tasks',
            title: '工程任务',
            icon: '🏗️',
            description: '工程化批量任务管理与执行',
            breadcrumb: ['工程任务'],
            toolbar: true,
            onEnter: () => this.loadProjectTasksPage(),
            onLeave: () => this.saveProjectTasksState()
        });
        
        this.pages.set('scheduled', {
            id: 'scheduled',
            title: '任务调度',
            icon: '🕒',
            description: '管理定时执行任务',
            breadcrumb: ['任务调度'],
            toolbar: true,
            onEnter: () => this.loadScheduledTasksPage(),
            onLeave: () => this.saveScheduledTasksState()
        });
        
        this.pages.set('history', {
            id: 'history',
            title: '任务记录',
            icon: '📊',
            description: '查看所有任务执行记录',
            breadcrumb: ['任务记录'],
            toolbar: false,
            onEnter: () => this.loadHistoryPage(),
            onLeave: () => this.saveHistoryState()
        });
    }
    
    // 导航到指定页面
    navigateTo(pageId, options = {}) {
        const page = this.pages.get(pageId);
        if (!page) {
            console.error(`页面不存在: ${pageId}`);
            return false;
        }
        
        // 记录历史
        if (this.currentPage && this.currentPage !== pageId) {
            this.addToHistory(this.currentPage);
        }
        
        // 离开当前页面
        if (this.currentPage) {
            const currentPageConfig = this.pages.get(this.currentPage);
            if (currentPageConfig && currentPageConfig.onLeave) {
                currentPageConfig.onLeave();
            }
        }
        
        // 切换页面
        this.switchPageDisplay(pageId);
        
        // 进入新页面
        this.currentPage = pageId;
        if (page.onEnter) {
            page.onEnter(options);
        }
        
        // 更新UI状态
        this.updateNavigationUI(page);
        
        return true;
    }
    
    // 切换页面显示
    switchPageDisplay(pageId) {
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
        }
    }
    
    // 更新导航UI
    updateNavigationUI(page) {
        // 更新导航菜单状态
        Utils.$$('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeNavItem = Utils.$(`[data-page="${page.id}"]`);
        if (activeNavItem) {
            activeNavItem.classList.add('active');
        }
        
        // 更新面包屑导航
        this.updateBreadcrumb(page.breadcrumb);
        
        // 更新页面标题
        document.title = `${page.title} - 万象匣`;
    }
    
    // 更新面包屑导航
    updateBreadcrumb(breadcrumb) {
        const breadcrumbEl = Utils.$('#breadcrumb');
        if (!breadcrumbEl) return;
        
        const items = breadcrumb.map((item, index) => {
            const isLast = index === breadcrumb.length - 1;
            if (isLast) {
                return `<div class="breadcrumb-item active">${item}</div>`;
            } else {
                return `<div class="breadcrumb-item"><a href="#" data-breadcrumb="${index}">${item}</a></div>`;
            }
        }).join('');
        
        breadcrumbEl.innerHTML = items;
    }
    
    // 添加到历史记录
    addToHistory(pageId) {
        this.history.push({
            pageId,
            timestamp: Date.now(),
            url: window.location.hash
        });
        
        // 限制历史记录长度
        if (this.history.length > this.maxHistoryLength) {
            this.history.shift();
        }
    }
    
    // 返回上一页
    goBack() {
        if (this.history.length === 0) {
            return false;
        }
        
        const lastPage = this.history.pop();
        this.navigateTo(lastPage.pageId, { fromHistory: true });
        return true;
    }
    
    // 获取当前页面配置
    getCurrentPage() {
        return this.pages.get(this.currentPage);
    }
    
    // 获取所有页面
    getAllPages() {
        return Array.from(this.pages.values());
    }
    
    // 页面加载方法
    loadHostsPage() {
        console.log('加载主机管理页面');
        // 这里可以加载主机数据，初始化表格等
        if (window.app && window.app.renderHostsTable) {
            window.app.renderHostsTable();
        }
    }
    
    loadScriptsPage() {
        console.log('加载脚本管理页面');
        // 调用ScriptManagement的init方法
        if (window.ScriptManagement && window.ScriptManagement.init) {
            window.ScriptManagement.init();
        } else {
            console.warn('ScriptManagement 未加载');
        }
    }
    
    loadTasksPage() {
        console.log('加载任务执行页面');
        // 调用TaskExecution的init方法
        if (window.TaskExecution && window.TaskExecution.init) {
            window.TaskExecution.init();
        } else {
            console.warn('TaskExecution 未加载');
        }
    }
    
    loadCommandsPage() {
        console.log('加载命令执行页面');
        // 调用CommandExecution的init方法
        if (window.CommandExecution && window.CommandExecution.init) {
            window.CommandExecution.init();
        } else {
            console.warn('CommandExecution 未加载');
        }
    }
    
    loadFileUploadPage() {
        console.log('加载文件上传页面');
        // 调用FileUploadPage的init方法
        if (window.FileUploadPage && window.FileUploadPage.init) {
            window.FileUploadPage.init();
        } else {
            console.warn('FileUploadPage 未加载');
        }
    }
    
    loadScheduledTasksPage() {
        console.log('加载任务调度页面');
        // 调用scheduledTasksModule的init方法
        if (window.scheduledTasksModule && window.scheduledTasksModule.init) {
            window.scheduledTasksModule.init();
        } else {
            console.warn('scheduledTasksModule 未加载');
        }
    }
    
    loadHistoryPage() {
        console.log('加载执行历史页面');
        // 调用TaskHistory的init方法
        if (window.TaskHistory && window.TaskHistory.init) {
            window.TaskHistory.init();
        } else {
            console.warn('TaskHistory 未加载');
        }
    }
    
    loadProjectTasksPage() {
        console.log('加载工程任务页面');
        if (window.ProjectTaskManagement && window.ProjectTaskManagement.init) {
            window.ProjectTaskManagement.init();
        } else {
            console.warn('ProjectTaskManagement 未加载');
        }
    }
    
    // 渲染脚本管理页面内容
    renderScriptsContent() {
        const scriptsPage = Utils.$('#page-scripts .page-content');
        if (!scriptsPage) return;
        
        scriptsPage.innerHTML = `
            <div class="toolbar">
                <div class="toolbar-left">
                    <button class="btn btn-primary" id="addScriptBtn">新建脚本</button>
                    <button class="btn btn-secondary" id="importScriptBtn">导入脚本</button>
                </div>
                <div class="toolbar-right">
                    <select class="form-control" id="scriptCategoryFilter">
                        <option value="">所有分类</option>
                        <option value="system">系统管理</option>
                        <option value="network">网络工具</option>
                        <option value="security">安全检查</option>
                        <option value="custom">自定义</option>
                    </select>
                </div>
            </div>
            
            <div class="scripts-grid">
                <div class="script-card">
                    <div class="script-header">
                        <h4>系统信息收集</h4>
                        <span class="script-category">系统管理</span>
                    </div>
                    <div class="script-description">
                        收集服务器基本系统信息，包括CPU、内存、磁盘等
                    </div>
                    <div class="script-footer">
                        <span class="script-language">bash</span>
                        <div class="script-actions">
                            <button class="btn btn-sm btn-secondary">编辑</button>
                            <button class="btn btn-sm btn-primary">执行</button>
                        </div>
                    </div>
                </div>
                
                <div class="script-card script-card-add">
                    <div class="add-script-content">
                        <div class="add-icon">+</div>
                        <div class="add-text">创建新脚本</div>
                    </div>
                </div>
            </div>
        `;
        
        // 添加脚本页面的样式
        this.addScriptsPageStyles();
    }
    
    // 渲染任务执行页面内容
    renderTasksContent() {
        const tasksPage = Utils.$('#page-tasks .page-content');
        if (!tasksPage) return;
        
        tasksPage.innerHTML = `
            <div class="task-wizard">
                <div class="wizard-steps">
                    <div class="step active" data-step="1">
                        <div class="step-number">1</div>
                        <div class="step-title">选择脚本</div>
                    </div>
                    <div class="step" data-step="2">
                        <div class="step-number">2</div>
                        <div class="step-title">选择主机</div>
                    </div>
                    <div class="step" data-step="3">
                        <div class="step-number">3</div>
                        <div class="step-title">配置参数</div>
                    </div>
                    <div class="step" data-step="4">
                        <div class="step-number">4</div>
                        <div class="step-title">执行任务</div>
                    </div>
                </div>
                
                <div class="wizard-content">
                    <div class="wizard-panel active" data-panel="1">
                        <h3>选择要执行的脚本</h3>
                        <div class="script-selection">
                            <div class="script-option">
                                <input type="radio" name="selectedScript" value="1" id="script1">
                                <label for="script1">
                                    <div class="script-name">系统信息收集</div>
                                    <div class="script-desc">收集服务器基本系统信息</div>
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    <div class="wizard-panel" data-panel="2">
                        <h3>选择目标主机</h3>
                        <div class="host-selection">
                            <p class="text-muted">请先在主机管理中添加主机</p>
                        </div>
                    </div>
                    
                    <div class="wizard-panel" data-panel="3">
                        <h3>配置执行参数</h3>
                        <div class="parameter-form">
                            <p class="text-muted">该脚本无需额外参数</p>
                        </div>
                    </div>
                    
                    <div class="wizard-panel" data-panel="4">
                        <h3>执行任务</h3>
                        <div class="execution-summary">
                            <p>准备执行任务，请确认以下信息：</p>
                            <ul>
                                <li>脚本：<span id="summaryScript">-</span></li>
                                <li>主机数量：<span id="summaryHosts">0</span></li>
                                <li>并发数：<span id="summaryConcurrency">5</span></li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <div class="wizard-actions">
                    <button class="btn btn-secondary" id="prevStepBtn" disabled>上一步</button>
                    <button class="btn btn-primary" id="nextStepBtn">下一步</button>
                    <button class="btn btn-success" id="executeTaskBtn" style="display: none;">开始执行</button>
                </div>
            </div>
        `;
        
        this.addTasksPageStyles();
    }
    
    // 渲染执行历史页面内容
    renderHistoryContent() {
        const historyPage = Utils.$('#page-history .page-content');
        if (!historyPage) return;
        
        historyPage.innerHTML = `
            <div class="history-filters">
                <div class="filter-group">
                    <label>时间范围：</label>
                    <select class="form-control" id="timeRangeFilter">
                        <option value="today">今天</option>
                        <option value="week">最近一周</option>
                        <option value="month">最近一月</option>
                        <option value="all">全部</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>执行状态：</label>
                    <select class="form-control" id="statusFilter">
                        <option value="">全部状态</option>
                        <option value="completed">已完成</option>
                        <option value="failed">执行失败</option>
                        <option value="running">执行中</option>
                    </select>
                </div>
            </div>
            
            <div class="history-list">
                <div class="history-item">
                    <div class="history-header">
                        <div class="task-name">系统信息收集任务</div>
                        <div class="task-status status-completed">已完成</div>
                        <div class="task-time">2025-09-23 18:30:15</div>
                    </div>
                    <div class="history-details">
                        <div class="detail-item">
                            <span class="label">脚本：</span>
                            <span class="value">系统信息收集</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">主机数量：</span>
                            <span class="value">5台</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">成功率：</span>
                            <span class="value">100%</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">耗时：</span>
                            <span class="value">2分30秒</span>
                        </div>
                    </div>
                    <div class="history-actions">
                        <button class="btn btn-sm btn-secondary">查看详情</button>
                        <button class="btn btn-sm btn-primary">重新执行</button>
                    </div>
                </div>
                
                <div class="empty-state">
                    <div class="empty-icon">${Utils.icon('file-text', 32)}</div>
                    <div class="empty-text">暂无执行历史记录</div>
                    <div class="empty-desc">执行任务后将在这里显示历史记录</div>
                </div>
            </div>
        `;
        
        this.addHistoryPageStyles();
    }
    
    // 状态保存方法（占位符）
    saveHostsState() { /* 保存主机页面状态 */ }
    saveScriptsState() { /* 保存脚本页面状态 */ }
    saveTasksState() { /* 保存任务页面状态 */ }
    saveCommandsState() { /* 保存命令执行页面状态 */ }
    saveFileUploadState() { /* 保存文件上传页面状态 */ }
    saveScheduledTasksState() { 
        /* 保存任务调度页面状态 */ 
        // 离开页面时停止自动刷新
        if (window.scheduledTasksModule && window.scheduledTasksModule.stopAutoRefresh) {
            window.scheduledTasksModule.stopAutoRefresh();
        }
    }
    saveHistoryState() { /* 保存历史页面状态 */ }
    
    saveProjectTasksState() {
        // 离开页面时取消执行事件监听
        if (window.ProjectTaskManagement) {
            try {
                const svc = new ProjectTaskService();
                svc.offAllExecutionListeners();
            } catch (_) {}
        }
    }
    
    // 添加页面样式方法
    addScriptsPageStyles() {
        if (document.querySelector('#scripts-page-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'scripts-page-styles';
        style.textContent = `
            .scripts-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 20px;
                margin-top: 20px;
            }
            
            .script-card {
                background: var(--surface-card);
                border: 1px solid var(--border-subtle);
                border-radius: 8px;
                padding: 20px;
                box-shadow: var(--shadow-card);
                transition: border-color 0.2s ease;
            }
            
            .script-card:hover {
                border-color: var(--border-default);
            }
            
            .script-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            
            .script-header h4 {
                margin: 0;
                color: var(--text-heading);
            }
            
            .script-category {
                background: var(--status-info-bg);
                color: var(--status-info-fg);
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
            }
            
            .script-description {
                color: var(--text-muted);
                font-size: 14px;
                margin-bottom: 15px;
                line-height: 1.5;
            }
            
            .script-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .script-language {
                background: var(--surface-subtle);
                color: var(--text-muted);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 12px;
                font-family: var(--font-mono);
            }
            
            .script-actions {
                display: flex;
                gap: 8px;
            }
            
            .script-card-add {
                border: 2px dashed var(--border-default);
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                min-height: 160px;
            }
            
            .script-card-add:hover {
                border-color: var(--border-focus);
                background: var(--primary-glow);
            }
            
            .add-script-content {
                text-align: center;
                color: var(--text-muted);
            }
            
            .add-icon {
                font-size: 48px;
                margin-bottom: 10px;
            }
            
            .add-text {
                font-size: 16px;
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }
    
    addTasksPageStyles() {
        if (document.querySelector('#tasks-page-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'tasks-page-styles';
        style.textContent = `
            .task-wizard {
                max-width: 800px;
                margin: 0 auto;
            }
            
            .wizard-steps {
                display: flex;
                justify-content: center;
                margin-bottom: 40px;
            }
            
            .step {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 0 20px;
                position: relative;
            }
            
            .step:not(:last-child)::after {
                content: '';
                position: absolute;
                right: -20px;
                top: 50%;
                transform: translateY(-50%);
                width: 40px;
                height: 2px;
                background: var(--border-default);
            }
            
            .step.active .step-number {
                background: var(--primary);
                color: var(--on-primary);
            }
            
            .step.active .step-title {
                color: var(--primary);
                font-weight: 600;
            }
            
            .step-number {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: var(--surface-active);
                color: var(--text-muted);
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 600;
            }
            
            .step-title {
                color: var(--text-muted);
                font-size: 14px;
            }
            
            .wizard-content {
                background: var(--surface-card);
                border: 1px solid var(--border-subtle);
                border-radius: 8px;
                padding: 30px;
                box-shadow: var(--shadow-card);
                margin-bottom: 30px;
                min-height: 300px;
            }
            
            .wizard-panel {
                display: none;
            }
            
            .wizard-panel.active {
                display: block;
            }
            
            .wizard-actions {
                display: flex;
                justify-content: center;
                gap: 15px;
            }
            
            .script-selection, .host-selection {
                margin-top: 20px;
            }
            
            .script-option {
                border: 1px solid var(--border-default);
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 15px;
                cursor: pointer;
                transition: border-color 0.2s ease, background 0.2s ease;
            }
            
            .script-option:hover {
                border-color: var(--border-focus);
                background: var(--surface-subtle);
            }
            
            .script-option input[type="radio"] {
                margin-right: 15px;
            }
            
            .script-name {
                font-weight: 600;
                color: var(--text-heading);
                margin-bottom: 5px;
            }
            
            .script-desc {
                color: var(--text-muted);
                font-size: 14px;
            }
        `;
        document.head.appendChild(style);
    }
    
    addHistoryPageStyles() {
        if (document.querySelector('#history-page-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'history-page-styles';
        style.textContent = `
            .history-filters {
                display: flex;
                gap: 20px;
                margin-bottom: 30px;
                padding: 20px;
                background: var(--surface-card);
                border: 1px solid var(--border-subtle);
                border-radius: 8px;
                box-shadow: var(--shadow-card);
            }
            
            .filter-group {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .filter-group label {
                font-weight: 500;
                color: var(--text-body);
                white-space: nowrap;
            }
            
            .history-list {
                display: flex;
                flex-direction: column;
                gap: 15px;
            }
            
            .history-item {
                background: var(--surface-card);
                border: 1px solid var(--border-subtle);
                border-radius: 8px;
                padding: 20px;
                box-shadow: var(--shadow-card);
                transition: border-color 0.2s ease;
            }
            
            .history-item:hover {
                border-color: var(--border-default);
            }
            
            .history-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
            }
            
            .task-name {
                font-weight: 600;
                font-size: 16px;
                color: var(--text-heading);
            }
            
            .task-status {
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
            }
            
            .status-completed {
                background: var(--status-healthy-bg);
                color: var(--status-healthy-fg);
            }
            
            .status-failed {
                background: var(--status-critical-bg);
                color: var(--status-critical-fg);
            }
            
            .status-running {
                background: var(--status-warning-bg);
                color: var(--status-warning-fg);
            }
            
            .task-time {
                color: var(--text-muted);
                font-size: 14px;
            }
            
            .history-details {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-bottom: 15px;
            }
            
            .detail-item {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .detail-item .label {
                color: var(--text-muted);
                font-size: 14px;
            }
            
            .detail-item .value {
                color: var(--text-body);
                font-weight: 500;
            }
            
            .history-actions {
                display: flex;
                gap: 10px;
                justify-content: flex-end;
            }
            
            .empty-state {
                text-align: center;
                padding: 60px 20px;
                color: var(--text-muted);
            }
            
            .empty-icon {
                font-size: 64px;
                margin-bottom: 20px;
            }
            
            .empty-text {
                font-size: 18px;
                font-weight: 600;
                margin-bottom: 10px;
            }
            
            .empty-desc {
                font-size: 14px;
            }
        `;
        document.head.appendChild(style);
    }
}

// 导出导航管理器
window.NavigationManager = NavigationManager;