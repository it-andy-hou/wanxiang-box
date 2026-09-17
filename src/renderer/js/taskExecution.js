// 任务执行页面逻辑
(function() {
    'use strict';

    let taskService;
    let hostService;
    let scriptService;
    let categoryService;
    let selectedHosts = [];
    let currentTaskId = null;
    let executionStartTime = null;
    let executionTimer = null;
    let currentTaskResults = []; // 存储当前任务的执行结果
    let allScripts = [];          // 全量脚本缓存，用于客户端过滤
    let categoryMap = new Map();  // 目录 id → 名称映射，用于分组展示
    let recentScriptIds = [];     // 最近使用的脚本 id（取前5）
    let activeTagFilter = '';     // 当前激活的标签过滤值
    let pickerHighlightIndex = -1; // 键盘导航高亮索引

    // 分组折叠状态（groupId -> true），localStorage 持久化
    const GROUP_COLLAPSE_KEY = 'te_script_group_collapsed';
    let collapsedGroups = loadCollapsedGroups();

    function loadCollapsedGroups() {
        try {
            const raw = localStorage.getItem(GROUP_COLLAPSE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveCollapsedGroups() {
        try {
            localStorage.setItem(GROUP_COLLAPSE_KEY, JSON.stringify(collapsedGroups));
        } catch (e) { /* 存储失败不影响交互 */ }
    }

    // 切换分组折叠状态
    function toggleGroupCollapse(groupId) {
        if (collapsedGroups[groupId]) {
            delete collapsedGroups[groupId];
        } else {
            collapsedGroups[groupId] = true;
        }
        saveCollapsedGroups();
    }

    // 重置执行参数为全局设置值
    function resetExecutionParamsToGlobal(concurrencyEl, timeoutEl) {
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.invoke('get-execution-settings').then(settings => {
                    if (concurrencyEl) concurrencyEl.value = settings.concurrency || 1;
                    if (timeoutEl) timeoutEl.value = settings.timeout || 300;
                });
            } else {
                if (concurrencyEl) concurrencyEl.value = '1';
                if (timeoutEl) timeoutEl.value = '300';
            }
        } catch (e) {
            if (concurrencyEl) concurrencyEl.value = '1';
            if (timeoutEl) timeoutEl.value = '300';
        }
    }

    // 初始化
    async function init() {
        console.log('初始化任务执行页面...');
        
        // 创建服务实例
        taskService = new window.TaskService();
        hostService = new window.HostService();
        scriptService = new window.ScriptService();
        categoryService = new window.CategoryService();
        
        // 绑定事件
        bindEvents();
        
        // 加载任务历史
        await loadTaskHistory();
        
        // 并行加载脚本列表和目录
        await Promise.all([loadScripts(), loadScriptCategories()]);
    }

    // 绑定事件
    function bindEvents() {
        console.log('绑定任务执行事件...');
        
        // 创建任务按钮
        const createTaskBtn = document.getElementById('createTaskBtn');
        if (createTaskBtn) {
            createTaskBtn.addEventListener('click', showTaskConfig);
        }

        // ===== 脚本搜索式选择面板事件 =====
        const searchInput = document.getElementById('teScriptSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', renderScriptPicker);
            searchInput.addEventListener('keydown', handleScriptSearchKeydown);
        }

        const searchClearBtn = document.getElementById('teScriptSearchClear');
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', clearScriptFilters);
        }

        // 脚本列表点击（事件委托：标签 chip 过滤 / 行选中）
        const scriptList = document.getElementById('teScriptList');
        if (scriptList) {
            scriptList.addEventListener('click', handleScriptListClick);
        }

        // 选中摘要条「更换」按钮
        const selectedBar = document.getElementById('teScriptSelected');
        if (selectedBar) {
            selectedBar.addEventListener('click', (e) => {
                if (e.target.closest('#teScriptChangeBtn')) {
                    clearSelectedScript();
                    const input = document.getElementById('teScriptSearchInput');
                    if (input) input.focus();
                }
            });
        }

        // 查看脚本内容按钮
        const viewScriptBtn = document.getElementById('viewScriptBtn');
        if (viewScriptBtn) {
            viewScriptBtn.addEventListener('click', handleViewScript);
        }

        // 定时执行复选框事件
        const scheduleEnabled = document.getElementById('taskScheduleEnabled');
        if (scheduleEnabled) {
            scheduleEnabled.addEventListener('change', handleScheduleToggle);
        }

        // 选择主机按钮
        const selectHostsBtn = document.getElementById('selectHostsBtn');
        if (selectHostsBtn) {
            selectHostsBtn.addEventListener('click', showHostSelector);
        }

        // 已选主机列表：单独移除（事件委托）
        const selectedHostsList = document.getElementById('selectedHostsList');
        if (selectedHostsList) {
            selectedHostsList.addEventListener('click', handleSelectedHostsListClick);
        }

        // 清空选择按钮
        const clearHostsBtn = document.getElementById('clearHostsBtn');
        if (clearHostsBtn) {
            clearHostsBtn.addEventListener('click', clearHostSelection);
        }

        // 开始执行按钮
        const startExecutionBtn = document.getElementById('startExecutionBtn');
        if (startExecutionBtn) {
            startExecutionBtn.addEventListener('click', startExecution);
        }

        // 停止执行按钮
        const stopExecutionBtn = document.getElementById('stopExecutionBtn');
        if (stopExecutionBtn) {
            stopExecutionBtn.addEventListener('click', stopExecution);
        }

        // 取消任务按钮
        const cancelTaskBtn = document.getElementById('cancelTaskBtn');
        if (cancelTaskBtn) {
            cancelTaskBtn.addEventListener('click', cancelTask);
        }

        // 清空日志按钮
        const clearLogBtn = document.getElementById('clearLogBtn');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', clearLog);
        }

        // 下载日志按钮
        const downloadLogBtn = document.getElementById('downloadLogBtn');
        if (downloadLogBtn) {
            downloadLogBtn.addEventListener('click', downloadLog);
        }

        // 复制日志按钮
        const copyLogBtn = document.getElementById('copyLogBtn');
        if (copyLogBtn) {
            copyLogBtn.addEventListener('click', copyLog);
        }

        // 导出结果按鈕
        const exportResultBtn = document.getElementById('exportResultBtn');
        if (exportResultBtn) {
            exportResultBtn.addEventListener('click', exportResults);
        }
    
    }

    // 日期格式化函数
    function formatDate(date, format) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        
        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }

    // 处理查看脚本内容
    async function handleViewScript() {
        const scriptSelect = document.getElementById('taskScriptSelect');
        const scriptId = scriptSelect ? scriptSelect.value : '';
        
        if (!scriptId) {
            showMessage('请先选择脚本', 'warning');
            return;
        }

        try {
            // 加载所有脚本并查找当前选中的脚本
            const allScripts = await scriptService.loadScripts();
            const script = allScripts.find(s => s.id == scriptId);
            
            if (!script) {
                showMessage('脚本不存在', 'error');
                return;
            }

            // 显示查看对话框
            const modal = createViewScriptDialog(script);
            document.body.appendChild(modal);
        } catch (error) {
            console.error('查看脚本失败:', error);
            showMessage('查看脚本失败: ' + error.message, 'error');
        }
    }

    // 创建查看脚本对话框
    function createViewScriptDialog(script) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        
        modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 900px;">
                <div class="modal-header">
                    <h2>${escapeHtml(script.name)}</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 1rem;">
                        <strong>描述：</strong>
                        <p>${escapeHtml(script.description || '无描述')}</p>
                    </div>
                    ${script.tags && script.tags.length > 0 ? `
                        <div style="margin-bottom: 1rem;">
                            <strong>标签：</strong>
                            <span>${script.tags.map(tag => `<span class="badge" style="margin-right: 5px;">${escapeHtml((tag && typeof tag === 'object') ? (tag.value || '') : tag)}</span>`).join('')}</span>
                        </div>
                    ` : ''}
                    ${script.usage_notes ? `
                        <div style="margin-bottom: 1rem;">
                            <strong>使用说明：</strong>
                            <p style="white-space: pre-wrap;">${escapeHtml(script.usage_notes)}</p>
                        </div>
                    ` : ''}
                    <div style="margin-bottom: 1rem;">
                        <strong>脚本内容：</strong>
                        <pre style="margin: 0.5rem 0; border-radius: 8px; overflow: hidden;"><code class="language-bash" style="display: block; padding: 1.25rem; font-size: 14px; line-height: 1.6; max-height: 500px; overflow-y: auto;">${escapeHtml(script.content)}</code></pre>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.875rem; color: var(--text-muted);">
                        <span>创建时间：${formatDateTime(script.created_at)}</span>
                        <span>更新时间：${formatDateTime(script.updated_at)}</span>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            </div>
        `;

        // 绑定关闭事件
        modalOverlay.querySelector('.modal-close').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) modalOverlay.remove();
        });
        
        // 应用语法高亮
        setTimeout(() => {
            const codeBlock = modalOverlay.querySelector('code');
            if (codeBlock && window.hljs) {
                window.hljs.highlightElement(codeBlock);
            }
        }, 100);

        return modalOverlay;
    }

    // 显示任务配置界面
    async function showTaskConfig() {
        const configSection = document.getElementById('taskConfigSection');
        const historySection = document.getElementById('taskHistorySection');
        
        if (configSection && historySection) {
            configSection.style.display = 'block';
            historySection.style.display = 'none';
            
            // 重置表单
            resetTaskForm();
            
            if (allScripts.length > 0) {
                // 有缓存：同步立即渲染面板（UI 显示前就已就绪）
                renderScriptPicker();
                // 后台静默刷新，不阻塞用户操作
                loadScripts();
            } else {
                // 首次进入且无缓存：等待加载完成再展示
                await loadScripts();
            }
        }
    }

    // 重置任务表单
    function resetTaskForm() {
        selectedHosts = [];
        currentTaskId = null;
        updateSelectedHostsList();
        
        const taskName = document.getElementById('taskName');
        const taskConcurrency = document.getElementById('taskConcurrency');
        const taskTimeout = document.getElementById('taskTimeout');
        
        if (taskName) taskName.value = '';
        
        // 重置脚本选择面板：清空选中、搜索词与标签过滤
        const hiddenScript = document.getElementById('taskScriptSelect');
        if (hiddenScript) hiddenScript.value = '';
        const searchInput = document.getElementById('teScriptSearchInput');
        if (searchInput) searchInput.value = '';
        activeTagFilter = '';
        pickerHighlightIndex = -1;
        renderScriptPicker();
        const viewScriptBtn = document.getElementById('viewScriptBtn');
        if (viewScriptBtn) {
            viewScriptBtn.disabled = true;
            viewScriptBtn.title = '请先选择脚本';
        }
        
        // 重置为全局设置的默认值
        resetExecutionParamsToGlobal(taskConcurrency, taskTimeout);
        
        // 隐藏监控区域
        const monitorSection = document.getElementById('taskMonitorSection');
        if (monitorSection) {
            monitorSection.style.display = 'none';
        }
    }

    // 取消任务
    function cancelTask() {
        const configSection = document.getElementById('taskConfigSection');
        const historySection = document.getElementById('taskHistorySection');
        
        if (configSection && historySection) {
            configSection.style.display = 'none';
            historySection.style.display = 'block';
        }
        
        resetTaskForm();
    }

    // 显示主机选择器
    async function showHostSelector() {
        try {
            const hosts = await hostService.loadHosts();
            
            const modal = createHostSelectorDialog(hosts);
            document.body.appendChild(modal);
        } catch (error) {
            console.error('加载主机列表失败:', error);
            showMessage('加载主机列表失败: ' + error.message, 'error');
        }
    }

    // 创建主机选择器对话框
    function createHostSelectorDialog(hosts) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        
        // 初始化筛选状态
        let currentFilters = {
            systemName: '',
            appName: '',
            datacenter: '',
            environment: '',
            owner: ''
        };
        
        // 提取唯一的系统名称（始终显示全部系统，不受其他筛选条件影响）
        const systemNames = [...new Set(hosts.map(h => h.systemName || h.system_name).filter(Boolean))];
        
        modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 1000px;">
                <div class="modal-header">
                    <h2>选择目标主机 <span id="modalSelectedCount" style="color: var(--primary); font-size: 0.9em; margin-left: 10px;">(已选择 ${selectedHosts.length} 台)</span></h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <!-- 快速筛选工具栏 -->
                    <div style="margin-bottom: 1rem;">
                        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 12px;">
                            <select class="form-control" id="filterSystemName" style="height: 38px; line-height: 22px; padding: 7px 12px; vertical-align: middle;">
                                <option value="">全部系统</option>
                                ${systemNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
                            </select>
                            <select class="form-control" id="filterAppName" style="height: 38px; line-height: 22px; padding: 7px 12px; vertical-align: middle;">
                                <option value="">全部应用</option>
                            </select>
                            <select class="form-control" id="filterDatacenter" style="height: 38px; line-height: 22px; padding: 7px 12px; vertical-align: middle;">
                                <option value="">全部机房</option>
                            </select>
                            <select class="form-control" id="filterEnvironment" style="height: 38px; line-height: 22px; padding: 7px 12px; vertical-align: middle;">
                                <option value="">全部环境</option>
                            </select>
                            <select class="form-control" id="filterOwner" style="height: 38px; line-height: 22px; padding: 7px 12px; vertical-align: middle;">
                                <option value="">全部负责人</option>
                            </select>
                        </div>
                        <div class="search-bar" style="width: 100%; margin-bottom: 10px;">
                            <input type="text" class="form-control" placeholder="搜索IP地址或主机名..." id="hostSelectorSearch" style="width: 100%;">
                        </div>
                        <!-- IP地址批量输入框 -->
                        <div style="width: 100%;">
                            <textarea class="form-control" id="ipBatchInput" placeholder="批量输入IP地址（用逗号分隔，例如：192.168.1.1, 192.168.1.2, 192.168.1.3）" style="width: 100%; min-height: 60px; resize: vertical; font-size: 0.875rem;"></textarea>
                            <div style="display: flex; gap: 10px; margin-top: 8px; align-items: center;">
                                <button class="btn btn-sm btn-primary" id="selectByIpBtn">识别并选中</button>
                                <button class="btn btn-sm btn-secondary" id="clearIpInputBtn">清空</button>
                                <span id="ipMatchResult" style="font-size: 0.875rem; color: var(--text-muted);"></span>
                            </div>
                        </div>
                    </div>
                    
                    <div style="max-height: 520px; overflow-y: auto;">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th><input type="checkbox" id="selectAllHostsModal"></th>
                                    <th>IP地址</th>
                                    <th>主机名</th>
                                    <th>系统名称</th>
                                    <th>应用名称</th>
                                    <th>机房</th>
                                    <th>环境</th>
                                    <th>负责人</th>
                                </tr>
                            </thead>
                            <tbody id="hostSelectorTableBody">
                                ${hosts.map(host => `
                                    <tr data-system-name="${escapeHtml(host.systemName || host.system_name || '')}" 
                                        data-app-name="${escapeHtml(host.appName || host.app_name || '')}" 
                                        data-datacenter="${escapeHtml(host.datacenter || '')}" 
                                        data-environment="${escapeHtml(host.environment || '')}"
                                        data-owner="${escapeHtml(host.owner || '')}">
                                        <td><input type="checkbox" class="host-checkbox" value="${host.id}" ${selectedHosts.includes(host.id) ? 'checked' : ''}></td>
                                        <td>${escapeHtml(host.ip)}</td>
                                        <td>${escapeHtml(host.hostname || '-')}</td>
                                        <td>${escapeHtml(host.systemName || host.system_name || '-')}</td>
                                        <td>${escapeHtml(host.appName || host.app_name || '-')}</td>
                                        <td>${escapeHtml(host.datacenter || '-')}</td>
                                        <td>${escapeHtml(host.environment || '-')}</td>
                                        <td>${escapeHtml(host.owner || '-')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="cancelHostSelectionBtn">取消</button>
                    <button class="btn btn-primary" id="confirmHostSelectionBtn">确定</button>
                </div>
            </div>
        `;

        // 绑定事件
        modalOverlay.querySelector('.modal-close').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.querySelector('#cancelHostSelectionBtn').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) modalOverlay.remove();
        });

        // 全选功能
        const selectAllCheckbox = modalOverlay.querySelector('#selectAllHostsModal');
        selectAllCheckbox.addEventListener('change', (e) => {
            const visibleCheckboxes = modalOverlay.querySelectorAll('#hostSelectorTableBody tr:not([style*="display: none"]) .host-checkbox');
            visibleCheckboxes.forEach(cb => cb.checked = e.target.checked);
            updateSelectAllState();
        });

        // 更新筛选器选项（级联联动）
        function updateFilterOptions() {
            // 根据当前筛选条件获取可用的主机列表
            const getFilteredHostsForOptions = () => {
                return hosts.filter(host => {
                    let match = true;
                    
                    // 如果已选择系统，则只显示该系统下的选项
                    if (currentFilters.systemName) {
                        match = match && ((host.systemName || host.system_name) === currentFilters.systemName);
                    }
                    
                    // 如果已选择应用，则只显示该应用下的选项
                    if (currentFilters.appName) {
                        match = match && ((host.appName || host.app_name) === currentFilters.appName);
                    }
                    
                    // 如果已选择机房，则只显示该机房下的选项
                    if (currentFilters.datacenter) {
                        match = match && (host.datacenter === currentFilters.datacenter);
                    }
                    
                    // 如果已选择环境，则只显示该环境下的选项
                    if (currentFilters.environment) {
                        match = match && (host.environment === currentFilters.environment);
                    }
                    
                    return match;
                });
            };
            
            const hostsForOptions = getFilteredHostsForOptions();
            
            // 更新应用名称筛选器（根据已选系统进行联动）
            const appNameFilter = modalOverlay.querySelector('#filterAppName');
            const appNames = [...new Set(hostsForOptions.map(h => h.appName || h.app_name).filter(Boolean))];
            
            appNameFilter.innerHTML = '<option value="">全部应用</option>';
            appNames.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                if (name === currentFilters.appName) {
                    option.selected = true;
                }
                appNameFilter.appendChild(option);
            });
            // 如果当前选中值不在可用选项中，恢复为默认值
            if (currentFilters.appName && !appNames.includes(currentFilters.appName)) {
                currentFilters.appName = '';
                appNameFilter.value = '';
            }
            
            // 更新机房筛选器（根据已选系统、应用进行联动）
            const datacenterFilter = modalOverlay.querySelector('#filterDatacenter');
            const datacenters = [...new Set(hostsForOptions.map(h => h.datacenter).filter(Boolean))];
            
            datacenterFilter.innerHTML = '<option value="">全部机房</option>';
            datacenters.forEach(dc => {
                const option = document.createElement('option');
                option.value = dc;
                option.textContent = dc;
                if (dc === currentFilters.datacenter) {
                    option.selected = true;
                }
                datacenterFilter.appendChild(option);
            });
            // 如果当前选中值不在可用选项中，恢复为默认值
            if (currentFilters.datacenter && !datacenters.includes(currentFilters.datacenter)) {
                currentFilters.datacenter = '';
                datacenterFilter.value = '';
            }
            
            // 更新环境筛选器（根据已选系统、应用、机房进行联动）
            const environmentFilter = modalOverlay.querySelector('#filterEnvironment');
            const environments = [...new Set(hostsForOptions.map(h => h.environment).filter(Boolean))];
            
            environmentFilter.innerHTML = '<option value="">全部环境</option>';
            environments.forEach(env => {
                const option = document.createElement('option');
                option.value = env;
                option.textContent = env;
                if (env === currentFilters.environment) {
                    option.selected = true;
                }
                environmentFilter.appendChild(option);
            });
            // 如果当前选中值不在可用选项中，恢复为默认值
            if (currentFilters.environment && !environments.includes(currentFilters.environment)) {
                currentFilters.environment = '';
                environmentFilter.value = '';
            }
            
            // 更新负责人筛选器（根据已选系统、应用、机房、环境进行联动）
            const ownerFilter = modalOverlay.querySelector('#filterOwner');
            const owners = [...new Set(hostsForOptions.map(h => h.owner).filter(Boolean))].sort();
            
            ownerFilter.innerHTML = '<option value="">全部负责人</option>';
            owners.forEach(owner => {
                const option = document.createElement('option');
                option.value = owner;
                option.textContent = owner;
                if (owner === currentFilters.owner) {
                    option.selected = true;
                }
                ownerFilter.appendChild(option);
            });
            // 如果当前选中值不在可用选项中，恢复为默认值
            if (currentFilters.owner && !owners.includes(currentFilters.owner)) {
                currentFilters.owner = '';
                ownerFilter.value = '';
            }
        }
        
        // 初始化筛选器选项
        updateFilterOptions();

        // 筛选功能
        function applyFilters() {
            const searchKeyword = modalOverlay.querySelector('#hostSelectorSearch').value.toLowerCase();
            
            const rows = modalOverlay.querySelectorAll('#hostSelectorTableBody tr');
            let visibleCount = 0;
            
            rows.forEach(row => {
                const rowText = row.textContent.toLowerCase();
                const systemName = row.dataset.systemName;
                const appName = row.dataset.appName;
                const datacenter = row.dataset.datacenter;
                const environment = row.dataset.environment;
                const owner = row.dataset.owner;
                
                // 检查是否匹配所有筛选条件
                const matchSearch = !searchKeyword || rowText.includes(searchKeyword);
                const matchSystem = !currentFilters.systemName || systemName === currentFilters.systemName;
                const matchApp = !currentFilters.appName || appName === currentFilters.appName;
                const matchDatacenter = !currentFilters.datacenter || datacenter === currentFilters.datacenter;
                const matchEnvironment = !currentFilters.environment || environment === currentFilters.environment;
                const matchOwner = !currentFilters.owner || owner === currentFilters.owner;
                
                const shouldShow = matchSearch && matchSystem && matchApp && matchDatacenter && matchEnvironment && matchOwner;
                row.style.display = shouldShow ? '' : 'none';
                
                if (shouldShow) visibleCount++;
            });
            
            // 更新全选框状态
            updateSelectAllState();
        }
        
        // 更新全选框状态
        function updateSelectAllState() {
            const visibleCheckboxes = modalOverlay.querySelectorAll('#hostSelectorTableBody tr:not([style*="display: none"]) .host-checkbox');
            const checkedCount = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;
            selectAllCheckbox.checked = visibleCheckboxes.length > 0 && checkedCount === visibleCheckboxes.length;
            selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
            
            // 更新对话框标题中的选中数量
            const allCheckboxes = modalOverlay.querySelectorAll('.host-checkbox');
            const totalCheckedCount = Array.from(allCheckboxes).filter(cb => cb.checked).length;
            const modalSelectedCount = modalOverlay.querySelector('#modalSelectedCount');
            if (modalSelectedCount) {
                modalSelectedCount.textContent = `(已选择 ${totalCheckedCount} 台)`;
            }
        }

        // 搜索功能
        const searchInput = modalOverlay.querySelector('#hostSelectorSearch');
        searchInput.addEventListener('input', applyFilters);
        
        // 下拉筛选功能（带级联联动）
        modalOverlay.querySelector('#filterSystemName').addEventListener('change', (e) => {
            currentFilters.systemName = e.target.value;
            updateFilterOptions();
            applyFilters();
        });
        modalOverlay.querySelector('#filterAppName').addEventListener('change', (e) => {
            currentFilters.appName = e.target.value;
            updateFilterOptions();
            applyFilters();
        });
        modalOverlay.querySelector('#filterDatacenter').addEventListener('change', (e) => {
            currentFilters.datacenter = e.target.value;
            updateFilterOptions();
            applyFilters();
        });
        modalOverlay.querySelector('#filterEnvironment').addEventListener('change', (e) => {
            currentFilters.environment = e.target.value;
            updateFilterOptions();
            applyFilters();
        });
        modalOverlay.querySelector('#filterOwner').addEventListener('change', (e) => {
            currentFilters.owner = e.target.value;
            updateFilterOptions();
            applyFilters();
        });
        
        // 复选框变化时更新全选状态
        modalOverlay.querySelectorAll('.host-checkbox').forEach(cb => {
            cb.addEventListener('change', updateSelectAllState);
        });

        // IP批量输入功能
        const ipBatchInput = modalOverlay.querySelector('#ipBatchInput');
        const selectByIpBtn = modalOverlay.querySelector('#selectByIpBtn');
        const clearIpInputBtn = modalOverlay.querySelector('#clearIpInputBtn');
        const ipMatchResult = modalOverlay.querySelector('#ipMatchResult');

        // 识别并选中IP按钮
        selectByIpBtn.addEventListener('click', () => {
            const ipInput = ipBatchInput.value.trim();
            if (!ipInput) {
                ipMatchResult.textContent = '请输入IP地址';
                ipMatchResult.style.color = 'var(--status-critical-fg)';
                return;
            }

            // 解析IP地址（支持逗号、空格、换行分隔）
            const inputIps = ipInput
                .split(/[,\s\n]+/)
                .map(ip => ip.trim())
                .filter(ip => ip.length > 0);

            if (inputIps.length === 0) {
                ipMatchResult.textContent = '未识别到有效的IP地址';
                ipMatchResult.style.color = 'var(--status-critical-fg)';
                return;
            }

            // 建立 IP -> Host ID 的映射
            const ipToHostMap = new Map();
            hosts.forEach(host => {
                ipToHostMap.set(host.ip, host.id);
            });

            // 匹配 IP 地址
            const matchedIps = [];
            const notFoundIps = [];
            const matchedHostIds = [];

            inputIps.forEach(ip => {
                if (ipToHostMap.has(ip)) {
                    matchedIps.push(ip);
                    matchedHostIds.push(ipToHostMap.get(ip));
                } else {
                    notFoundIps.push(ip);
                }
            });

            // 选中匹配的主机
            if (matchedHostIds.length > 0) {
                modalOverlay.querySelectorAll('.host-checkbox').forEach(cb => {
                    const hostId = parseInt(cb.value);
                    if (matchedHostIds.includes(hostId)) {
                        cb.checked = true;
                    }
                });
                updateSelectAllState();
            }

            // 显示结果
            let resultMsg = '';
            if (matchedIps.length > 0) {
                resultMsg += `已选中 ${matchedIps.length} 台主机`;
            }
            if (notFoundIps.length > 0) {
                if (resultMsg) resultMsg += '\uff1b';
                resultMsg += `未找到 ${notFoundIps.length} 个IP: ${notFoundIps.join(', ')}`;
                ipMatchResult.style.color = 'var(--status-critical-fg)';
            } else {
                ipMatchResult.style.color = 'var(--status-healthy-fg)';
            }
            ipMatchResult.textContent = resultMsg;
        });

        // 清空按钮
        clearIpInputBtn.addEventListener('click', () => {
            ipBatchInput.value = '';
            ipMatchResult.textContent = '';
        });

        // 回车键快捷识别
        ipBatchInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                selectByIpBtn.click();
            }
        });

        // 确定按钮
        modalOverlay.querySelector('#confirmHostSelectionBtn').addEventListener('click', () => {
            const checkboxes = modalOverlay.querySelectorAll('.host-checkbox:checked');
            selectedHosts = Array.from(checkboxes).map(cb => parseInt(cb.value));
            updateSelectedHostsList();
            modalOverlay.remove();
        });

        return modalOverlay;
    }

    // 更新选中的主机列表显示
    async function updateSelectedHostsList() {
        const countSpan = document.getElementById('selectedHostsCount');
        const listDiv = document.getElementById('selectedHostsList');
        const selectHostsBtn = document.getElementById('selectHostsBtn');
        const editHint = document.getElementById('teHostEditHint');
        
        if (!countSpan || !listDiv) return;

        // 二次修改入口：已选主机时按钮变为「编辑已选主机」，弹窗会预勾选已有主机，确认后整体替换
        if (selectHostsBtn) {
            selectHostsBtn.textContent = selectedHosts.length > 0 ? '编辑已选主机' : '从主机管理选择';
            selectHostsBtn.title = selectedHosts.length > 0
                ? '重新打开主机选择窗口（保留已勾选），可增加或取消主机，确认后整体替换'
                : '打开主机选择窗口';
        }
        if (editHint) {
            editHint.style.display = selectedHosts.length > 0 ? '' : 'none';
        }

        if (selectedHosts.length === 0) {
            countSpan.textContent = '';
            listDiv.innerHTML = '<span style="color: var(--text-muted);">未选择主机</span>';
            return;
        }

        countSpan.textContent = `已选择 ${selectedHosts.length} 台主机`;
        
        try {
            const hosts = await hostService.loadHosts();
            const selectedHostsData = hosts.filter(h => selectedHosts.includes(h.id));
            
            // 表格列表：IP / 应用名称 / 负责人 + 单独删除，按选择顺序展示
            listDiv.innerHTML = `
                <table class="table te-host-table">
                    <thead>
                        <tr><th>IP地址</th><th>应用名称</th><th>负责人</th><th></th></tr>
                    </thead>
                    <tbody>
                        ${selectedHosts.map(id => {
                            const host = selectedHostsData.find(h => h.id === id);
                            if (!host) return '';
                            const appName = host.appName || host.app_name || '-';
                            return `
                                <tr data-host-id="${host.id}">
                                    <td class="te-host-table-ip">${escapeHtml(host.ip)}</td>
                                    <td title="${escapeHtml(host.systemName || host.system_name || '')}">${escapeHtml(appName)}</td>
                                    <td>${escapeHtml(host.owner || '-')}</td>
                                    <td class="te-host-table-action">
                                        <button type="button" class="te-host-remove-btn" data-host-id="${host.id}" title="移除该主机"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
                                    </td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>`;
        } catch (error) {
            console.error('更新主机列表失败:', error);
        }
    }

    // 单独移除一台已选主机（事件委托，绑定一次）
    function handleSelectedHostsListClick(e) {
        const removeBtn = e.target.closest('.te-host-remove-btn');
        if (!removeBtn) return;
        const hostId = parseInt(removeBtn.dataset.hostId);
        if (isNaN(hostId)) return;
        selectedHosts = selectedHosts.filter(id => id !== hostId);
        updateSelectedHostsList();
    }

    // 清空主机选择
    function clearHostSelection() {
        selectedHosts = [];
        updateSelectedHostsList();
    }

    // 处理定时执行开关
    function handleScheduleToggle(e) {
        const scheduleTimeSection = document.getElementById('taskScheduleTimeSection');
        if (e.target.checked) {
            scheduleTimeSection.style.display = 'block';
            // 设置默认时间为当前时间+1小时
            const scheduleTimeInput = document.getElementById('taskScheduleTime');
            if (scheduleTimeInput) {
                const now = new Date();
                now.setHours(now.getHours() + 1);
                // 格式化为 datetime-local 格式
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                scheduleTimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
                // 设置最小时间为当前时间
                const minTime = new Date();
                const minYear = minTime.getFullYear();
                const minMonth = String(minTime.getMonth() + 1).padStart(2, '0');
                const minDay = String(minTime.getDate()).padStart(2, '0');
                const minHours = String(minTime.getHours()).padStart(2, '0');
                const minMinutes = String(minTime.getMinutes()).padStart(2, '0');
                scheduleTimeInput.min = `${minYear}-${minMonth}-${minDay}T${minHours}:${minMinutes}`;
            }
        } else {
            scheduleTimeSection.style.display = 'none';
        }
    }

    // 加载目录列表，构建目录 id → 名称映射（供分组展示）
    async function loadScriptCategories() {
        try {
            const categories = await categoryService.getAll();
            categoryMap = new Map();
            (categories || []).forEach(cat => {
                categoryMap.set(String(cat.id), cat.name);
            });
        } catch (e) {
            console.error('加载脚本目录失败:', e);
            categoryMap = new Map();
        }
    }

    // ===================================================
    // 脚本搜索式选择面板
    // ===================================================

    // 规范化脚本标签：兼容 {value} 对象数组与字符串数组
    function normalizeTags(script) {
        if (!script.tags || !Array.isArray(script.tags)) return [];
        return script.tags
            .map(t => (typeof t === 'string' ? t : (t && t.value ? t.value : '')))
            .filter(Boolean);
    }

    // 搜索匹配：名称 / 描述 / 标签（大小写不敏感包含）
    function matchesScript(script, keyword) {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return true;
        const hay = [
            script.name || '',
            script.description || '',
            ...normalizeTags(script)
        ].join('\n').toLowerCase();
        return hay.includes(kw);
    }

    // 标签过滤：匹配任一标签值
    function matchesTagFilter(script, tagValue) {
        if (!tagValue) return true;
        return normalizeTags(script).includes(tagValue);
    }

    // 相对时间：刚刚 / x分钟前 / x小时前 / x天前 / 日期
    function formatRelativeTime(dateStr) {
        if (!dateStr) return '';
        const time = new Date(dateStr).getTime();
        if (isNaN(time)) return '';
        const diff = Date.now() - time;
        if (diff < 60 * 1000) return '刚刚';
        if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}分钟前`;
        if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}小时前`;
        if (diff < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))}天前`;
        const d = new Date(time);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // 从任务历史提取最近使用的脚本 id（去重，取前5）
    function updateRecentScriptIds(tasks) {
        const sorted = [...tasks].sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
        });
        const seen = new Set();
        recentScriptIds = [];
        for (const task of sorted) {
            const sid = task.script_id ? String(task.script_id) : '';
            if (sid && !seen.has(sid)) {
                seen.add(sid);
                recentScriptIds.push(sid);
                if (recentScriptIds.length >= 5) break;
            }
        }
    }

    // 清空搜索与标签过滤
    function clearScriptFilters() {
        const input = document.getElementById('teScriptSearchInput');
        if (input) input.value = '';
        activeTagFilter = '';
        pickerHighlightIndex = -1;
        renderScriptPicker();
        if (input) input.focus();
    }

    // 清空已选脚本（更换）
    function clearSelectedScript() {
        const hidden = document.getElementById('taskScriptSelect');
        if (hidden) hidden.value = '';
        const taskNameInput = document.getElementById('taskName');
        if (taskNameInput) taskNameInput.value = '';
        const viewScriptBtn = document.getElementById('viewScriptBtn');
        if (viewScriptBtn) {
            viewScriptBtn.disabled = true;
            viewScriptBtn.title = '请先选择脚本';
        }
        renderScriptPicker();
    }

    // 选中脚本：写隐藏字段 + 生成任务名 + 启用查看按钮 + 更新选中态
    function selectScript(script) {
        const hidden = document.getElementById('taskScriptSelect');
        if (!script || !hidden) return;

        hidden.value = String(script.id);

        // 启用查看按钮
        const viewScriptBtn = document.getElementById('viewScriptBtn');
        if (viewScriptBtn) {
            viewScriptBtn.disabled = false;
            viewScriptBtn.title = '查看脚本内容';
        }

        // 生成任务名称：脚本名称_YYYYMMDD_HHmmss
        try {
            const now = new Date();
            const dateStr = formatDate(now, 'YYYYMMDD_HHmmss');
            const taskNameInput = document.getElementById('taskName');
            if (taskNameInput) {
                taskNameInput.value = `${script.name}_${dateStr}`;
            }
        } catch (error) {
            console.error('生成任务名称失败:', error);
        }

        renderScriptPicker();
    }

    // 按 id 选中脚本（再执行预填用）
    function selectScriptById(scriptId) {
        const script = allScripts.find(s => String(s.id) === String(scriptId));
        if (script) {
            selectScript(script);
        } else {
            const hidden = document.getElementById('taskScriptSelect');
            if (hidden) hidden.value = '';
        }
    }

    // 渲染选中摘要条
    function renderSelectedBar() {
        const bar = document.getElementById('teScriptSelected');
        const hidden = document.getElementById('taskScriptSelect');
        if (!bar || !hidden) return;

        const script = allScripts.find(s => String(s.id) === hidden.value);
        if (!script) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }

        const catName = script.category_id ? (categoryMap.get(String(script.category_id)) || '未分类') : '未分类';
        const tags = normalizeTags(script);
        bar.style.display = 'flex';
        bar.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            <span class="te-script-selected-name" title="${escapeHtml(script.description || script.name)}">${escapeHtml(script.name)}</span>
            <span class="te-script-selected-meta">${escapeHtml(catName)}${tags.length ? ' · ' + escapeHtml(tags.join(' / ')) : ''}</span>
            <button type="button" class="te-script-change-btn" id="teScriptChangeBtn" title="更换脚本">更换</button>
        `;
    }

    // 构建分组：[{ id, name, scripts }]
    function buildScriptGroups(filtered, showRecent) {
        const groups = [];

        // 置顶组（仅在无搜索词且无标签过滤时展示，避免重复干扰）
        const searchInput = document.getElementById('teScriptSearchInput');
        const keyword = searchInput ? searchInput.value : '';
        const showPinned = showRecent && !keyword.trim() && !activeTagFilter;
        if (showPinned) {
            // 最近使用组
            if (recentScriptIds.length > 0) {
                const recentScripts = recentScriptIds
                    .map(id => allScripts.find(s => String(s.id) === id))
                    .filter(Boolean);
                if (recentScripts.length > 0) {
                    groups.push({ id: '__recent__', name: '最近使用', scripts: recentScripts });
                }
            }

            // 最近添加组（按创建时间倒序取前5）
            const addedScripts = [...allScripts]
                .filter(s => s.created_at || s.updated_at)
                .sort((a, b) => {
                    const timeA = new Date(a.created_at || a.updated_at || 0).getTime();
                    const timeB = new Date(b.created_at || b.updated_at || 0).getTime();
                    return timeB - timeA;
                })
                .slice(0, 5);
            if (addedScripts.length > 0) {
                groups.push({ id: '__added__', name: '最近添加', scripts: addedScripts });
            }
        }

        // 目录分组（按目录名排序）
        const byCategory = new Map();
        filtered.forEach(script => {
            const catKey = script.category_id ? String(script.category_id) : '';
            if (!byCategory.has(catKey)) byCategory.set(catKey, []);
            byCategory.get(catKey).push(script);
        });
        [...byCategory.keys()].sort((a, b) => {
            const nameA = a ? (categoryMap.get(a) || '') : '未分类';
            const nameB = b ? (categoryMap.get(b) || '') : '未分类';
            return nameA.localeCompare(nameB, 'zh-CN');
        }).forEach(catKey => {
            const scripts = byCategory.get(catKey);
            const isUncategorized = !catKey;
            const catName = isUncategorized ? '未分类' : (categoryMap.get(catKey) || '未命名目录');
            groups.push({ id: catKey || '__none__', name: catName, scripts });
        });

        return groups;
    }

    // 渲染脚本选择面板主体
    function renderScriptPicker() {
        const listEl = document.getElementById('teScriptList');
        const countEl = document.getElementById('teScriptCount');
        const clearBtn = document.getElementById('teScriptSearchClear');
        const searchInput = document.getElementById('teScriptSearchInput');
        if (!listEl) return;

        renderSelectedBar();

        const keyword = searchInput ? searchInput.value : '';
        const hasFilter = keyword.trim() || activeTagFilter;

        // 应用搜索 + 标签过滤
        const filtered = allScripts.filter(s =>
            matchesScript(s, keyword) && matchesTagFilter(s, activeTagFilter)
        );

        // 计数提示
        if (countEl) {
            countEl.textContent = hasFilter ? `匹配 ${filtered.length}/${allScripts.length}` : `共 ${allScripts.length}`;
        }
        if (clearBtn) {
            clearBtn.style.display = hasFilter ? 'flex' : 'none';
        }

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="te-script-empty">${allScripts.length === 0 ? '暂无脚本，请先在「脚本管理」中创建' : '没有匹配的脚本'}</div>`;
            pickerHighlightIndex = -1;
            return;
        }

        const hidden = document.getElementById('taskScriptSelect');
        const selectedId = hidden ? hidden.value : '';
        const groups = buildScriptGroups(filtered, true);

        // 搜索/标签过滤时强制展开所有分组，避免命中结果被折叠隐藏
        const effectiveCollapsed = hasFilter ? {} : collapsedGroups;

        let html = '';
        groups.forEach(group => {
            const isRecent = group.id === '__recent__';
            const isAdded = group.id === '__added__';
            const isCollapsed = !!effectiveCollapsed[group.id];
            const groupIcon = isRecent
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
                : (isAdded
                    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'
                    : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>');
            html += `
                <div class="te-script-group${isCollapsed ? ' is-collapsed' : ''}" data-group-id="${group.id}">
                <div class="te-script-group-header" title="${isCollapsed ? '点击展开' : '点击折叠'}">
                    <svg class="te-script-group-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                    ${groupIcon}
                    <span>${escapeHtml(group.name)}</span>
                    <span class="te-script-group-count">${group.scripts.length}</span>
                </div>`;
            group.scripts.forEach(script => {
                const tags = normalizeTags(script);
                const isSelected = String(script.id) === selectedId;
                html += `
                    <div class="te-script-row${isSelected ? ' is-selected' : ''}" data-script-id="${script.id}" title="${escapeHtml(script.description || script.name)}">
                        <svg class="te-script-row-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        <span class="te-script-name">${escapeHtml(script.name)}</span>
                        ${tags.map(t => `<button type="button" class="te-script-tag-chip${t === activeTagFilter ? ' is-active' : ''}" data-tag-value="${escapeHtml(t)}" title="点击按此标签过滤">${escapeHtml(t)}</button>`).join('')}
                        <span class="te-script-time">${formatRelativeTime(script.updated_at)}</span>
                    </div>`;
            });
            html += `</div>`;
        });
        listEl.innerHTML = html;

        applyPickerHighlight();
    }

    // 键盘高亮同步（忽略已折叠分组内的行）
    function applyPickerHighlight() {
        const listEl = document.getElementById('teScriptList');
        if (!listEl) return;
        listEl.querySelectorAll('.te-script-row.is-highlight').forEach(el => el.classList.remove('is-highlight'));
        const rows = listEl.querySelectorAll('.te-script-group:not(.is-collapsed) .te-script-row');
        if (pickerHighlightIndex >= 0 && pickerHighlightIndex < rows.length) {
            rows[pickerHighlightIndex].classList.add('is-highlight');
            rows[pickerHighlightIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    // 列表点击（事件委托）：分组头 → 折叠/展开；标签 chip → toggle 过滤；行 → 选中
    function handleScriptListClick(e) {
        const groupHeader = e.target.closest('.te-script-group-header');
        if (groupHeader) {
            const keyword = document.getElementById('teScriptSearchInput');
            // 搜索/标签过滤时强制展开，禁止折叠，避免命中结果被隐藏
            if (keyword && keyword.value.trim()) return;
            if (activeTagFilter) return;
            const groupEl = groupHeader.closest('.te-script-group');
            if (groupEl) {
                toggleGroupCollapse(groupEl.dataset.groupId);
                groupEl.classList.toggle('is-collapsed');
                groupHeader.title = collapsedGroups[groupEl.dataset.groupId] ? '点击展开' : '点击折叠';
            }
            return;
        }

        const tagChip = e.target.closest('.te-script-tag-chip');
        if (tagChip) {
            e.stopPropagation();
            const value = tagChip.dataset.tagValue || '';
            activeTagFilter = (activeTagFilter === value) ? '' : value;
            pickerHighlightIndex = -1;
            renderScriptPicker();
            return;
        }

        const row = e.target.closest('.te-script-row');
        if (row) {
            const scriptId = row.dataset.scriptId;
            const script = allScripts.find(s => String(s.id) === String(scriptId));
            if (script) selectScript(script);
        }
    }

    // 搜索框键盘：↑↓ 高亮，Enter 选中，Esc 清空（忽略已折叠分组内的行）
    function handleScriptSearchKeydown(e) {
        const listEl = document.getElementById('teScriptList');
        const rows = listEl ? listEl.querySelectorAll('.te-script-group:not(.is-collapsed) .te-script-row') : [];

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (rows.length === 0) return;
            if (e.key === 'ArrowDown') {
                pickerHighlightIndex = (pickerHighlightIndex + 1) % rows.length;
            } else {
                pickerHighlightIndex = (pickerHighlightIndex <= 0) ? rows.length - 1 : pickerHighlightIndex - 1;
            }
            applyPickerHighlight();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const idx = pickerHighlightIndex >= 0 && pickerHighlightIndex < rows.length
                ? pickerHighlightIndex : 0;
            if (rows.length === 0) return;
            const row = rows[idx];
            const script = allScripts.find(s => String(s.id) === String(row.dataset.scriptId));
            if (script) {
                selectScript(script);
                renderScriptPicker(); // 重置高亮
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            clearScriptFilters();
        }
    }

    // 加载脚本列表
    async function loadScripts() {
        try {
            allScripts = await scriptService.loadScripts();
            // 按更新时间倒序排序（最近更新的在前面）
            allScripts = allScripts.sort((a, b) => {
                const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                return timeB - timeA;
            });
            renderScriptPicker();
        } catch (error) {
            console.error('加载脚本列表失败:', error);
        }
    }

    // 开始执行任务
    async function startExecution() {
        try {
            // 验证表单：先验证脚本，再验证主机
            const scriptSelect = document.getElementById('taskScriptSelect');
            const scriptId = scriptSelect ? scriptSelect.value : '';
            
            if (!scriptId) {
                showMessage('请选择执行脚本', 'error');
                return;
            }

            if (selectedHosts.length === 0) {
                showMessage('请选择目标主机', 'error');
                return;
            }

            // 从隐藏字段获取自动生成的任务名称
            const taskNameInput = document.getElementById('taskName');
            const taskName = taskNameInput ? taskNameInput.value.trim() : '';
            if (!taskName) {
                showMessage('任务名称生成失败，请重新选择脚本', 'error');
                return;
            }

            // 从隐藏字段获取默认配置
            const concurrencyInput = document.getElementById('taskConcurrency');
            const timeoutInput = document.getElementById('taskTimeout');
            const concurrency = concurrencyInput ? parseInt(concurrencyInput.value) : 1;
            const timeout = timeoutInput ? parseInt(timeoutInput.value) * 1000 : 300000;

            // 检查是否启用定时执行
            const scheduleEnabled = document.getElementById('taskScheduleEnabled');
            const isScheduled = scheduleEnabled && scheduleEnabled.checked;
            let scheduledTime = null;

            // 检查是否使用sudo执行
            const useSudoCheckbox = document.getElementById('taskUseSudo');
            const useSudo = useSudoCheckbox && useSudoCheckbox.checked;

            if (isScheduled) {
                const scheduleTimeInput = document.getElementById('taskScheduleTime');
                scheduledTime = scheduleTimeInput ? scheduleTimeInput.value : null;
                
                if (!scheduledTime) {
                    showMessage('请设置执行时间', 'error');
                    return;
                }

                // 验证时间不能是过去
                const selectedTime = new Date(scheduledTime);
                const now = new Date();
                if (selectedTime <= now) {
                    showMessage('执行时间必须晚于当前时间', 'error');
                    return;
                }
            }

            // 创建任务（支持数字或字符串ID）
            const taskData = {
                task_name: taskName,
                script_id: scriptId,  // 直接使用原始ID，不转换类型
                host_ids: selectedHosts,
                parameters: {
                    concurrency,
                    timeout,
                    useSudo
                },
                execution_type: isScheduled ? 'scheduled' : 'immediate',
                scheduled_time: isScheduled ? new Date(scheduledTime).toISOString() : null
            };
            console.log('准备创建任务，任务数据:', JSON.stringify(taskData, null, 2));
            
            const task = await taskService.createTask(taskData);
            console.log('任务创建返回结果:', JSON.stringify(task, null, 2));
            console.log('===========================');

            currentTaskId = task.id;
            
            // 如果是定时任务，创建成功后提示并跳转
            if (isScheduled) {
                const scheduleTimeFormatted = new Date(scheduledTime).toLocaleString('zh-CN');
                showMessage(`定时任务已创建，将在 ${scheduleTimeFormatted} 自动执行`, 'success');
                
                // 延迟1秒后跳转到任务调度页面
                setTimeout(() => {
                    // 触发导航到任务调度页面
                    const scheduledNav = document.querySelector('[data-page="scheduled"]');
                    if (scheduledNav) {
                        scheduledNav.click();
                    }
                }, 1000);
                
                // 重置表单
                cancelTask();
                return;
            }

            currentTaskId = task.id;
            
            // 显示监控区域
            const monitorSection = document.getElementById('taskMonitorSection');
            if (monitorSection) {
                monitorSection.style.display = 'block';
            }

            // 切换按钮状态
            const startBtn = document.getElementById('startExecutionBtn');
            const stopBtn = document.getElementById('stopExecutionBtn');
            if (startBtn) startBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-block';

            // 初始化监控界面
            initMonitorUI();
            
            // 记录开始时间
            executionStartTime = Date.now();
            startExecutionTimer();

            // 监听进度更新
            taskService.onTaskProgress(currentTaskId, handleProgressUpdate);

            // 开始执行
            addLog(`[${formatTime(new Date())}] 开始执行任务: ${taskName}`, 'info');
            addLog(`[${formatTime(new Date())}] 目标主机: ${selectedHosts.length} 台`, 'info');
            addLog(`[${formatTime(new Date())}] 并发数: ${concurrency}, 超时时间: ${timeout/1000}秒`, 'info');
            if (useSudo) {
                addLog(`[${formatTime(new Date())}] 使用sudo权限执行`, 'info');
            }

            // 异步执行任务
            taskService.executeTask(currentTaskId, { concurrency, timeout, useSudo })
                .then(result => {
                    handleTaskComplete(result);
                })
                .catch(error => {
                    handleTaskError(error);
                });

        } catch (error) {
            console.error('启动任务执行失败:', error);
            showMessage('启动任务执行失败: ' + error.message, 'error');
        }
    }

    // 停止执行任务
    async function stopExecution() {
        if (!currentTaskId) return;

        try {
            // 立即移除 IPC 监听器，防止旧任务事件污染下一次执行的 UI 状态
            taskService.offTaskProgress(currentTaskId);

            await taskService.stopTask(currentTaskId);
            addLog(`[${formatTime(new Date())}] 任务已停止`, 'warning');
            
            // 重置按钮状态
            const startBtn = document.getElementById('startExecutionBtn');
            const stopBtn = document.getElementById('stopExecutionBtn');
            if (startBtn) startBtn.style.display = 'inline-block';
            if (stopBtn) stopBtn.style.display = 'none';

            stopExecutionTimer();
        } catch (error) {
            console.error('停止任务失败:', error);
            showMessage('停止任务失败: ' + error.message, 'error');
        }
    }

    // 初始化监控界面
    function initMonitorUI() {
        updateProgress(0, selectedHosts.length);
        clearLog();
        // 清空当前任务结果
        currentTaskResults = [];
        // 清空结果视图
        clearResultView('script');
    }

    // 更新进度
    function updateProgress(completed, total) {
        const progressFill = document.getElementById('progressFill');
        const overallProgress = document.getElementById('overallProgress');
        const totalCount = document.getElementById('totalCount');
        
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        if (progressFill) progressFill.style.width = percentage + '%';
        if (overallProgress) overallProgress.textContent = percentage + '%';
        if (totalCount) totalCount.textContent = total.toString();
    }

    // 处理进度更新
    function handleProgressUpdate(data) {
        const { hostIp, status, stdout, stderr, duration, total, current } = data;
        
        // 收集执行结果用于导出
        if (status === 'success' || status === 'failed') {
            currentTaskResults.push({
                host_ip: hostIp,
                status: status,
                stdout: stdout || '',
                stderr: stderr || '',
                duration: duration
            });
            // 实时更新结果视图
            addResultCard('script', { host_ip: hostIp, status, stdout: stdout || '', stderr: stderr || '', duration });
        } else if (status === 'running') {
            // 实时显示正在执行的主机
            addResultCard('script', { host_ip: hostIp, status: 'running', stdout: '', stderr: '', duration: 0 });
        }
        
        // 更新统计
        updateProgress(current, total);
        
        // 更新成功/失败计数
        const successCount = document.getElementById('successCount');
        const failedCount = document.getElementById('failedCount');
        
        if (status === 'success' && successCount) {
            successCount.textContent = (parseInt(successCount.textContent) + 1).toString();
        } else if (status === 'failed' && failedCount) {
            failedCount.textContent = (parseInt(failedCount.textContent) + 1).toString();
        }
        
        // 添加日志
        if (status === 'running') {
            addLog(`[${formatTime(new Date())}] ${hostIp} - 开始执行...`, 'info');
        } else if (status === 'success') {
            // 检查是否为无匹配结果的情况
            const isNoMatch = (!stdout || !stdout.trim()) && stderr && stderr.trim();
            const hasErrorHint = data.errorHint && data.errorHint.includes('无匹配结果');
            
            if (isNoMatch && hasErrorHint) {
                addLog(`[${formatTime(new Date())}] ${hostIp} - ✓ 执行成功，无匹配结果 (耗时: ${duration}ms)`, 'success');
            } else {
                addLog(`[${formatTime(new Date())}] ${hostIp} - ✓ 执行成功 (耗时: ${duration}ms)`, 'success');
            }
            
            // 显示执行过程（bash -x 的输出在 stderr 中）
            if (stderr && stderr.trim()) {
                addLog(`┌─ 执行过程 (${hostIp}) ─────`, 'debug-header');
                // 按行显示执行过程
                stderr.trim().split('\n').forEach(line => {
                    addLog(`│ ${line}`, 'debug');
                });
                addLog(`└${'─'.repeat(50)}`, 'debug-header');
            }
            
            // 显示完整的标准输出
            if (stdout && stdout.trim()) {
                addLog(`┌─ 标准输出 (${hostIp}) ─────`, 'output-header');
                // 按行显示输出内容
                stdout.trim().split('\n').forEach(line => {
                    addLog(`│ ${line}`, 'output');
                });
                addLog(`└${'─'.repeat(50)}`, 'output-header');
            } else if (isNoMatch && hasErrorHint) {
                // 无匹配结果时显示友好提示
                addLog(`┌─ 执行结果 (${hostIp}) ─────`, 'output-header');
                addLog(`│ (过滤条件无匹配结果)`, 'output');
                addLog(`└${'─'.repeat(50)}`, 'output-header');
            }
            
            // 显示提示信息
            if (data.errorHint) {
                addLog(data.errorHint, 'info');
            }
        } else if (status === 'failed') {
            // 显示退出码（如果有）
            const exitCodeInfo = data.exitCode !== undefined && data.exitCode !== null ? ` (退出码: ${data.exitCode})` : '';
            addLog(`[${formatTime(new Date())}] ${hostIp} - ✗ 执行失败${exitCodeInfo}`, 'error');
            
            // 显示标准输出（可能包含错误信息）
            if (stdout && stdout.trim()) {
                addLog(`┌─ 标准输出 (${hostIp}) ─────`, 'output-header');
                stdout.trim().split('\n').forEach(line => {
                    addLog(`│ ${line}`, 'output');
                });
                addLog(`└${'─'.repeat(50)}`, 'output-header');
            }
            
            // 显示错误输出（包含执行过程）
            if (stderr && stderr.trim()) {
                addLog(`┌─ 错误输出 (${hostIp}) ─────`, 'error-header');
                stderr.trim().split('\n').forEach(line => {
                    addLog(`│ ${line}`, 'error');
                });
                addLog(`└${'─'.repeat(50)}`, 'error-header');
            }
            
            // 显示其他错误信息
            if (data.error) {
                addLog(`┌─ 错误详情 (${hostIp}) ─────`, 'error-header');
                addLog(`│ ${data.error}`, 'error');
                addLog(`└${'─'.repeat(50)}`, 'error-header');
            }
            
            // 显示错误提示
            if (data.errorHint) {
                addLog(data.errorHint, 'warning');
            }
            
            // 如果没有任何输出，提示用户
            if ((!stdout || !stdout.trim()) && (!stderr || !stderr.trim()) && !data.error) {
                addLog(`提示: 命令执行失败但未产生任何输出，可能原因：`, 'warning');
                addLog(`  1. 命令不存在或无法执行`, 'warning');
                addLog(`  2. 管道命令中某个环节失败且输出被过滤`, 'warning');
                addLog(`  3. 权限不足或资源限制`, 'warning');
            }
        }
    }

    // 处理任务完成
    function handleTaskComplete(result) {
        addLog(`[${formatTime(new Date())}] 任务执行完成`, 'info');
        addLog(`[${formatTime(new Date())}] 总计: ${result.totalCount} 台, 成功: ${result.successCount} 台, 失败: ${result.failedCount} 台`, 'info');
        
        // 使用后端返回的准确统计结果更新页面显示
        const successCount = document.getElementById('successCount');
        const failedCount = document.getElementById('failedCount');
        if (successCount) successCount.textContent = result.successCount.toString();
        if (failedCount) failedCount.textContent = result.failedCount.toString();
        
        // 确保进度条更新为100%
        updateProgress(result.totalCount, result.totalCount);
        
        stopExecutionTimer();
        
        // 重置按钮状态
        const startBtn = document.getElementById('startExecutionBtn');
        const stopBtn = document.getElementById('stopExecutionBtn');
        if (startBtn) startBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';

        showMessage('任务执行完成', 'success');
        
        // 取消监听
        taskService.offTaskProgress(currentTaskId);

        // 自动对比多台机器的执行结果
        showResultComparisonBanner('script', currentTaskResults);
        
        // 重新加载任务历史
        loadTaskHistory();
    }

    // 显示结果对比摘要横幅（方案A：一致性摘要）
    function showResultComparisonBanner(prefix, results) {
        const container = document.getElementById(prefix + 'ResultContainer');
        if (!container) return;

        // 移除旧横幅（重复执行时刷新）
        const existing = container.querySelector('.result-comparison-banner');
        if (existing) existing.remove();

        // 清除旧的差异标记
        container.querySelectorAll('.result-card.result-diff').forEach(card => {
            card.classList.remove('result-diff');
            const badge = card.querySelector('.diff-badge');
            if (badge) badge.remove();
        });

        // 少于2台无需对比
        if (!results || results.length < 2) return;

        const successResults = results.filter(r => r.status === 'success');
        const failedCount = results.filter(r => r.status !== 'success').length;

        // 成功台数不足2台，无法进行内容对比
        if (successResults.length < 2) return;

        // 对比各台 stdout（去除首尾空白后比较）
        const stdouts = successResults.map(r => (r.stdout || '').trim());
        const firstStdout = stdouts[0];
        const allSame = stdouts.every(s => s === firstStdout);

        const failedNote = failedCount > 0
            ? `<span class="banner-note">另有 ${failedCount} 台执行失败</span>`
            : '';

        let bannerHtml;
        let diffHostIps = null;
        if (allSame) {
            bannerHtml = `<div class="result-comparison-banner banner-consistent">
                <span class="banner-icon">${Utils.icon('check-circle', 14)}</span>
                <span class="banner-text">全部 ${successResults.length} 台输出一致</span>
                ${failedNote}
            </div>`;
        } else {
            // 以出现次数最多的输出为基准，统计偏差台数
            const countMap = new Map();
            stdouts.forEach(s => countMap.set(s, (countMap.get(s) || 0) + 1));
            const maxCount = Math.max(...countMap.values());
            const diffCount = successResults.length - maxCount;
            // 找出多数派输出内容，少数派主机即为差异主机
            const majorityStdout = [...countMap.entries()].find(([, v]) => v === maxCount)[0];
            diffHostIps = new Set(
                successResults.filter(r => (r.stdout || '').trim() !== majorityStdout).map(r => r.host_ip)
            );
            bannerHtml = `<div class="result-comparison-banner banner-diff">
                <span class="banner-icon">${Utils.icon('alert-triangle', 14)}</span>
                <span class="banner-text">发现差异（${diffCount} 台输出与多数不同）</span>
                ${failedNote}
            </div>`;
        }

        container.insertAdjacentHTML('afterbegin', bannerHtml);

        // 高亮差异卡片
        if (diffHostIps) {
            container.querySelectorAll('.result-card').forEach(card => {
                const ip = card.dataset.hostIp;
                if (diffHostIps.has(ip)) {
                    card.classList.add('result-diff');
                    if (!card.querySelector('.diff-badge')) {
                        const badge = document.createElement('span');
                        badge.className = 'diff-badge';
                        badge.textContent = '差异';
                        const hostIpEl = card.querySelector('.host-ip');
                        if (hostIpEl) hostIpEl.after(badge);
                    }
                }
            });
        }
    }

    // 处理任务错误
    function handleTaskError(error) {
        addLog(`[${formatTime(new Date())}] 任务执行失败: ${error.message}`, 'error');
        
        stopExecutionTimer();
        
        // 重置按钮状态
        const startBtn = document.getElementById('startExecutionBtn');
        const stopBtn = document.getElementById('stopExecutionBtn');
        if (startBtn) startBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';

        showMessage('任务执行失败: ' + error.message, 'error');
        
        // 取消监听
        if (currentTaskId) {
            taskService.offTaskProgress(currentTaskId);
        }
    }

    // 启动执行计时器
    function startExecutionTimer() {
        if (executionTimer) {
            clearInterval(executionTimer);
        }
        
        executionTimer = setInterval(() => {
            if (!executionStartTime) return;
            
            const elapsed = Date.now() - executionStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            
            const timeDisplay = document.getElementById('executionTime');
            if (timeDisplay) {
                timeDisplay.textContent = `${pad(minutes)}:${pad(seconds)}`;
            }
        }, 1000);
    }

    // 停止执行计时器
    function stopExecutionTimer() {
        if (executionTimer) {
            clearInterval(executionTimer);
            executionTimer = null;
        }
    }

    // 添加日志
    function addLog(message, type = 'info') {
        const logDiv = document.getElementById('executionLog');
        if (!logDiv) return;

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        
        let color = 'var(--text-body)';
        if (type === 'success') color = 'var(--status-healthy-fg)';
        else if (type === 'error') color = 'var(--status-critical-fg)';
        else if (type === 'warning') color = 'var(--status-warning-fg)';
        else if (type === 'output') color = 'var(--primary)';
        
        logEntry.style.color = color;
        logEntry.textContent = message;
        
        logDiv.appendChild(logEntry);
        
        // 【性能优化】限制最大日志行数,防止DOM节点过多导致页面卡顿
        // 保留最近1000行,超出时删除最旧的日志
        const MAX_LOG_LINES = 1000;
        while (logDiv.children.length > MAX_LOG_LINES) {
            logDiv.removeChild(logDiv.firstChild);
        }
        
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    // 清空日志
    function clearLog() {
        const logDiv = document.getElementById('executionLog');
        if (logDiv) {
            logDiv.innerHTML = '';
        }
        
        // 重置计数
        const successCount = document.getElementById('successCount');
        const failedCount = document.getElementById('failedCount');
        if (successCount) successCount.textContent = '0';
        if (failedCount) failedCount.textContent = '0';

        // 同步清空结果模式视图
        clearResultView('script');
        currentTaskResults = [];

        // 重置筛选/搜索状态
        scriptCurrentFilter = 'all';
        scriptSearchKeyword = '';
        const filterGroup = document.getElementById('scriptFilterGroup');
        if (filterGroup) {
            filterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            const allBtn = filterGroup.querySelector('[data-filter="all"]');
            if (allBtn) allBtn.classList.add('active');
        }
        const searchInput = document.getElementById('scriptResultSearch');
        if (searchInput) searchInput.value = '';
    }

    // 下载日志
    async function downloadLog() {
        const logDiv = document.getElementById('executionLog');
        if (!logDiv) {
            showMessage('日志为空', 'warning');
            return;
        }

        const logEntries = logDiv.querySelectorAll('.log-entry');
        if (logEntries.length === 0) {
            showMessage('日志为空，无法下载', 'warning');
            return;
        }

        try {
            // 提取日志文本
            const logText = Array.from(logEntries)
                .map(entry => entry.textContent)
                .join('\n');

            // 生成文件名：任务名称_日期时间.txt
            const taskNameInput = document.getElementById('taskName');
            let taskName = taskNameInput ? taskNameInput.value : '任务日志';
            
            // 清理任务名称中的非法文件名字符（Windows禁止: < > : " / \\ | ? *）
            taskName = taskName.replace(/[<>:"\/\\|?*]/g, '_');
            
            // 生成时间戳（格式：YYYYMMDD_HHmmss）
            const now = new Date();
            const timestamp = now.getFullYear() + 
                String(now.getMonth() + 1).padStart(2, '0') + 
                String(now.getDate()).padStart(2, '0') + '_' +
                String(now.getHours()).padStart(2, '0') + 
                String(now.getMinutes()).padStart(2, '0') + 
                String(now.getSeconds()).padStart(2, '0');
            
            const fileName = `${taskName}_${timestamp}.txt`;

            // 调用主进程保存文本文件并打开文件夹
            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('save-text-file', logText, fileName);
            
            if (result.canceled) {
                showMessage('用户取消了保存操作', 'info');
                return;
            }
            
            if (!result.success) {
                showMessage('保存失败: ' + (result.error || '未知错误'), 'error');
                return;
            }
            
            showMessage(`日志已保存: ${result.fileName}`, 'success');
        } catch (error) {
            console.error('下载日志失败:', error);
            showMessage('下载日志失败: ' + error.message, 'error');
        }
    }

    // 复制日志
    function copyLog() {
        const logDiv = document.getElementById('executionLog');
        if (!logDiv) {
            showMessage('日志为空', 'warning');
            return;
        }

        const logEntries = logDiv.querySelectorAll('.log-entry');
        if (logEntries.length === 0) {
            showMessage('日志为空，无法复制', 'warning');
            return;
        }

        try {
            // 提取日志文本
            const logText = Array.from(logEntries)
                .map(entry => entry.textContent)
                .join('\n');

            // 复制到剪贴板
            navigator.clipboard.writeText(logText).then(() => {
                showMessage('日志已复制到剪贴板', 'success');
            }).catch(error => {
                console.error('复制日志失败:', error);
                // 如果navigator.clipboard不可用，尝试使用旧的API
                fallbackCopyLog(logText);
            });
        } catch (error) {
            console.error('复制日志失败:', error);
            showMessage('复制日志失败: ' + error.message, 'error');
        }
    }

    // 退回的复制方法（当navigator.clipboard不可用时）
    function fallbackCopyLog(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showMessage('日志已复制到剪贴板', 'success');
            } else {
                showMessage('复制日志失败', 'error');
            }
        } catch (err) {
            console.error('复制日志失败:', err);
            showMessage('复制日志失败: ' + err.message, 'error');
        }

        document.body.removeChild(textArea);
    }

    // 导出执行结果到Excel
    async function exportResults() {
        // 检查是否有结果数据
        if (!currentTaskResults || currentTaskResults.length === 0) {
            showMessage('没有可导出的结果数据，请先执行任务', 'warning');
            return;
        }

        try {
            const XLSX = require('xlsx');
            
            // 加载主机数据以获取负责人信息
            const hosts = await hostService.loadHosts();
            const hostMap = new Map();
            hosts.forEach(host => {
                hostMap.set(host.ip, host);
            });
            
            // 准备数据：表头 + 数据行
            const data = [];
            
            // 添加表头（增加负责人列）
            data.push(['IP地址', '负责人', '标准输出']);
            
            // 添加数据行
            currentTaskResults.forEach(result => {
                // 如果失败，优先导出错误输出；否则导出标准输出
                let output = '';
                if (result.status === 'failed') {
                    // 失败时，优先使用stderr，如果stderr为空则使用stdout
                    output = result.stderr || result.stdout || '[执行失败，无输出信息]';
                } else {
                    // 成功时，优先使用stdout，如果为空则使用stderr（某些命令如java -version输出到stderr）
                    output = result.stdout || result.stderr || '[无输出]';
                }
                
                // 通过IP查找主机的负责人
                const host = hostMap.get(result.host_ip);
                const owner = host ? (host.owner || '-') : '-';
                
                data.push([
                    result.host_ip || '-',
                    owner,
                    output
                ]);
            });
            
            console.log('导出数据预览:', currentTaskResults.slice(0, 3).map(r => {
                const host = hostMap.get(r.host_ip);
                return {
                    ip: r.host_ip,
                    owner: host ? host.owner : '-',
                    status: r.status,
                    hasStdout: !!r.stdout,
                    hasStderr: !!r.stderr
                };
            }));
            
            // 创建工作表
            const worksheet = XLSX.utils.aoa_to_sheet(data);
            
            // 设置列宽
            const colWidths = [
                { wch: 20 },  // IP地址
                { wch: 15 },  // 负责人
                { wch: 100 }  // 标准输出（较宽）
            ];
            worksheet['!cols'] = colWidths;
            
            // 为标准输出列设置自动换行
            for (let i = 1; i <= currentTaskResults.length; i++) {
                const cellAddress = XLSX.utils.encode_cell({ r: i, c: 2 }); // 第3列（索引为2）
                if (worksheet[cellAddress]) {
                    if (!worksheet[cellAddress].s) worksheet[cellAddress].s = {};
                    worksheet[cellAddress].s.alignment = { wrapText: true, vertical: 'top' };
                }
            }
            
            // 创建工作簿
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '执行结果');
            
            // 生成Excel文件
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            
            // 生成文件名
            const taskNameInput = document.getElementById('taskName');
            let taskName = taskNameInput ? taskNameInput.value : '任务结果';
            taskName = taskName.replace(/[<>:"\/\\|?*]/g, '_');
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            const fileName = `${taskName}_结果_${timestamp}.xlsx`;
            
            // 保存文件
            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('save-excel-file', excelBuffer, fileName);
            
            if (result.success) {
                showMessage(`结果已导出: ${result.fileName}`, 'success');
            } else if (!result.canceled) {
                throw new Error(result.error || '导出失败');
            }
            
        } catch (error) {
            console.error('导出结果失败:', error);
            showMessage('导出结果失败: ' + error.message, 'error');
        }
    }

    // 加载任务历史
    async function loadTaskHistory() {
        try {
            const tasks = await taskService.getTasks();
            // 只显示脚本执行任务，过滤掉命令执行和文件上传
            const scriptTasks = tasks.filter(task => !task.is_temporary_command && !task.is_file_upload);
            // 提取最近使用的脚本（供选择面板置顶展示）
            updateRecentScriptIds(scriptTasks);
            await renderTaskHistory(scriptTasks);
        } catch (error) {
            console.error('加载任务历史失败:', error);
        }
    }

    // 渲染任务历史
    async function renderTaskHistory(tasks) {
        const tbody = document.querySelector('#taskHistoryTable tbody');
        if (!tbody) return;

        if (tasks.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                        暂无执行历史
                    </td>
                </tr>
            `;
            return;
        }

        // 按创建时间倒序排序（最新的任务在第一个）
        const sortedTasks = [...tasks].sort((a, b) => {
            const dateA = new Date(a.created_at || 0);
            const dateB = new Date(b.created_at || 0);
            return dateB - dateA;
        });

        // 加载所有脚本以获取脚本名称
        let allScripts = [];
        try {
            allScripts = await scriptService.loadScripts();
        } catch (error) {
            console.error('加载脚本列表失败:', error);
        }

        // 创建脚本ID到名称的映射
        const scriptMap = new Map();
        allScripts.forEach(script => {
            scriptMap.set(script.id, script.name);
        });

        tbody.innerHTML = sortedTasks.map(task => {
            // 获取脚本名称
            const scriptName = task.script_id ? (scriptMap.get(task.script_id) || '-') : '-';
            
            return `
            <tr class="task-row-clickable" data-task-id="${task.id}" style="cursor: pointer;">
                <td>${task.id}</td>
                <td>${escapeHtml(task.task_name)}</td>
                <td>${escapeHtml(scriptName)}</td>
                <td>${task.total_hosts || 0}</td>
                <td>${task.success_hosts || 0} / ${task.failed_hosts || 0}</td>
                <td><span class="status-badge status-${task.status}">${getStatusText(task.status)}</span></td>
                <td>${formatDateTime(task.created_at)}</td>
                <td>
                    <button class="btn btn-sm btn-warning btn-reexecute-script" data-task-id="${task.id}" title="根据此历史任务预填配置，重新执行一遍" style="white-space:nowrap;">再执行</button>
                </td>
            </tr>
        `;
        }).join('');

        // 绑定事件
        bindTaskHistoryEvents();
    }

    // 绑定任务历史事件
    function bindTaskHistoryEvents() {
        // 点击行查看结果
        document.querySelectorAll('.task-row-clickable').forEach(row => {
            row.addEventListener('click', async (e) => {
                // 若点击的是"再执行"按钮，不触发行级查看详情
                if (e.target.closest('.btn-reexecute-script')) return;
                const taskId = parseInt(e.currentTarget.dataset.taskId);
                await viewTaskResult(taskId);
            });
        });

        // 再执行按钮
        document.querySelectorAll('.btn-reexecute-script').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = parseInt(e.currentTarget.dataset.taskId);
                await reExecuteTask(taskId);
            });
        });
    }

    // 查看任务结果
    async function viewTaskResult(taskId) {
        try {
            const task = await taskService.getTask(taskId);
            const results = await taskService.getTaskResults(taskId);
            
            const modal = createTaskResultDialog(task, results);
            document.body.appendChild(modal);
        } catch (error) {
            console.error('查看任务结果失败:', error);
            showMessage('查看任务结果失败: ' + error.message, 'error');
        }
    }

    // 根据历史任务预填配置，再执行一遍
    async function reExecuteTask(taskId) {
        try {
            // 1. 获取历史任务详情
            const task = await taskService.getTask(taskId);
            if (!task) {
                showMessage('任务不存在', 'error');
                return;
            }

            // 2. 校验脚本是否仍然存在
            if (!task.script_id) {
                showMessage('该任务没有关联脚本，无法再执行', 'error');
                return;
            }
            const scripts = await scriptService.loadScripts();
            const script = scripts.find(s => String(s.id) === String(task.script_id));
            if (!script) {
                showMessage('关联脚本已被删除，无法再执行', 'error');
                return;
            }

            // 3. 校验主机是否仍然存在
            const allHosts = await hostService.loadHosts();
            const allHostIds = allHosts.map(h => h.id);
            const originalHostIds = task.host_ids || [];
            const validHostIds = originalHostIds.filter(id => allHostIds.includes(id));
            const invalidCount = originalHostIds.length - validHostIds.length;

            if (validHostIds.length === 0) {
                showMessage('原任务中的所有主机均已被删除，无法再执行', 'error');
                return;
            }
            if (invalidCount > 0) {
                showMessage(`注意：原任务中有 ${invalidCount} 台主机已被删除，将仅对剩余 ${validHostIds.length} 台主机执行`, 'warning');
            }

            // 4. 展示配置界面（会重置表单并加载脚本列表）
            await showTaskConfig();

            // 5. 预填脚本选择（等 DOM 更新后操作）
            await new Promise(resolve => setTimeout(resolve, 50));
            selectScriptById(task.script_id);

            // 6. 预填主机列表
            selectedHosts = validHostIds;
            await updateSelectedHostsList();

            // 7. 预填执行参数（并发数、超时时间）
            const params = task.parameters || {};
            const concurrencyInput = document.getElementById('taskConcurrency');
            const timeoutInput = document.getElementById('taskTimeout');
            if (concurrencyInput && params.concurrency) {
                concurrencyInput.value = params.concurrency;
            }
            if (timeoutInput && params.timeout) {
                // 数据库存的是毫秒，表单显示秒
                timeoutInput.value = Math.round(params.timeout / 1000);
            }

            showMessage(`已从历史任务「${task.task_name}」预填配置，请确认后点击"开始执行"`, 'info');
        } catch (error) {
            console.error('加载历史任务失败:', error);
            showMessage('加载历史任务失败: ' + error.message, 'error');
        }
    }

    // 创建任务结果对话框
    function createTaskResultDialog(task, results) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 1000px;">
                <div class="modal-header">
                    <h2>任务执行结果 - ${escapeHtml(task.task_name)}</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 1rem;">
                        <strong>状态:</strong> <span class="status-badge status-${task.status}">${getStatusText(task.status)}</span>
                        <strong style="margin-left: 2rem;">总主机:</strong> ${task.total_hosts || 0}
                        <strong style="margin-left: 1rem;">成功:</strong> <span style="color: var(--status-healthy-fg);">${task.success_hosts || 0}</span>
                        <strong style="margin-left: 1rem;">失败:</strong> <span style="color: var(--status-critical-fg);">${task.failed_hosts || 0}</span>
                    </div>
                    <div style="max-height: 500px; overflow-y: auto;">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>主机ID</th>
                                    <th>IP地址</th>
                                    <th>状态</th>
                                    <th>退出码</th>
                                    <th>耗时(ms)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${results.map(result => `
                                    <tr class="result-row-clickable" data-result='${JSON.stringify(result).replace(/'/g, "&#39;")}' style="cursor: pointer;">
                                        <td>${result.host_id}</td>
                                        <td>${escapeHtml(result.host_ip || '-')}</td>
                                        <td><span class="status-badge status-${result.status}">${result.status}</span></td>
                                        <td>${result.exit_code !== null ? result.exit_code : '-'}</td>
                                        <td>${result.duration || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            </div>
        `;

        // 绑定事件
        modalOverlay.querySelector('.modal-close').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) modalOverlay.remove();
        });

        // 点击行查看输出
        modalOverlay.querySelectorAll('.result-row-clickable').forEach(row => {
            row.addEventListener('click', (e) => {
                const result = JSON.parse(e.currentTarget.dataset.result);
                showOutputDialog(result);
            });
        });

        return modalOverlay;
    }

    // 显示输出对话框
    function showOutputDialog(result) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        const hostInfo = result.host_ip ? `${result.host_ip} (ID: ${result.host_id})` : `主机 ${result.host_id}`;
        modal.innerHTML = `
            <div class="modal" style="max-width: 800px;">
                <div class="modal-header">
                    <h2>执行输出 - ${hostInfo}</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 1rem;">
                        <strong>标准输出:</strong>
                        <pre style="background: var(--surface-subtle); padding: 1rem; border-radius: 6px; max-height: 300px; overflow: auto;">${escapeHtml(result.stdout || '(无输出)')}</pre>
                    </div>
                    <div>
                        <strong>错误输出:</strong>
                        <pre style="background: var(--surface-subtle); padding: 1rem; border-radius: 6px; max-height: 300px; overflow: auto;">${escapeHtml(result.stderr || result.error_message || '(无错误)')}</pre>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            </div>
        `;

        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);
    }

    // 工具函数
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTime(date) {
        return date.toLocaleTimeString('zh-CN', { hour12: false });
    }

    function formatDateTime(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleString('zh-CN');
    }

    function pad(num) {
        return num.toString().padStart(2, '0');
    }

    function getStatusText(status) {
        const statusMap = {
            'pending': '等待中',
            'running': '运行中',
            'completed': '已完成',
            'failed': '失败',
            'cancelled': '已取消'
        };
        return statusMap[status] || status;
    }

    function showMessage(message, type = 'info') {
        if (window.Utils && window.Utils.showMessage) {
            window.Utils.showMessage(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    // ========== 结果概览视图逻辑 ==========
    let scriptResultViewMode = 'result'; // 'log' | 'result'
    let scriptCurrentFilter = 'all';  // 'all' | 'success' | 'failed'
    let scriptSearchKeyword = '';

    // 初始化结果视图事件
    function initResultViewEvents() {
        // 视图切换
        const logBtn = document.getElementById('scriptViewLogBtn');
        const resultBtn = document.getElementById('scriptViewResultBtn');
        if (logBtn) logBtn.addEventListener('click', () => switchView('script', 'log'));
        if (resultBtn) resultBtn.addEventListener('click', () => switchView('script', 'result'));

        // 筛选按钮
        const filterGroup = document.getElementById('scriptFilterGroup');
        if (filterGroup) {
            filterGroup.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    filterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    scriptCurrentFilter = btn.dataset.filter;
                    applyResultFilter('script');
                });
            });
        }

        // 搜索
        const searchInput = document.getElementById('scriptResultSearch');
        if (searchInput) {
            let searchTimer = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    scriptSearchKeyword = searchInput.value.trim().toLowerCase();
                    applyResultFilter('script');
                }, 300);
            });
        }

    }

    // 切换视图
    function switchView(prefix, mode) {
        const logView = document.getElementById(prefix + 'LogView');
        const resultView = document.getElementById(prefix + 'ResultView');
        const logBtn = document.getElementById(prefix + 'ViewLogBtn');
        const resultBtn = document.getElementById(prefix + 'ViewResultBtn');
        const filterGroup = document.getElementById(prefix + 'FilterGroup');
        const searchInput = document.getElementById(prefix + 'ResultSearch');

        if (mode === 'log') {
            if (logView) logView.style.display = '';
            if (resultView) resultView.style.display = 'none';
            if (logBtn) logBtn.classList.add('active');
            if (resultBtn) resultBtn.classList.remove('active');
            if (filterGroup) filterGroup.style.display = 'none';
            if (searchInput) searchInput.style.display = 'none';
        } else {
            if (logView) logView.style.display = 'none';
            if (resultView) resultView.style.display = '';
            if (logBtn) logBtn.classList.remove('active');
            if (resultBtn) resultBtn.classList.add('active');
            if (filterGroup) filterGroup.style.display = '';
            if (searchInput) searchInput.style.display = '';
        }

        if (prefix === 'script') scriptResultViewMode = mode;
    }

    // 清空结果视图
    function clearResultView(prefix) {
        const container = document.getElementById(prefix + 'ResultContainer');
        if (container) {
            container.innerHTML = '<div class="result-empty-tip">暂无执行结果，请先执行任务</div>';
        }
    }

    // 添加结果卡片
    function addResultCard(prefix, result) {
        const container = document.getElementById(prefix + 'ResultContainer');
        if (!container) return;

        // 清除空提示
        const emptyTip = container.querySelector('.result-empty-tip');
        if (emptyTip) emptyTip.remove();

        // 检查是否已存在该主机的卡片（running状态升级为最终状态）
        const existingCard = container.querySelector(`[data-host-ip="${result.host_ip}"]`);
        if (existingCard) {
            if (result.status === 'running') return; // 已有卡片不重复添加running
            // 更新卡片
            updateResultCard(existingCard, result);
            return;
        }

        const card = createResultCardElement(result);
        container.appendChild(card);

        // 应用当前筛选
        applyFilterToCard(prefix, card);
    }

    // 创建结果卡片DOM元素
    function createResultCardElement(result) {
        const card = document.createElement('div');
        card.className = `result-card result-${result.status}`;
        card.dataset.hostIp = result.host_ip;
        card.dataset.status = result.status;

        const statusIcon = result.status === 'success' ? Utils.icon('check', 13, 2.5) : result.status === 'failed' ? Utils.icon('x', 13, 2.5) : '<span style="font-size:10px;">●</span>';
        const statusColor = result.status === 'success' ? 'var(--status-healthy-fg)' : result.status === 'failed' ? 'var(--status-critical-fg)' : 'var(--status-warning-fg)';
        const summaryText = result.status === 'running' ? '正在执行...' : getSummaryText(result);
        const durationText = result.duration ? `${result.duration}ms` : '-';

        card.innerHTML = `
            <div class="result-card-header">
                <span class="status-icon" style="color: ${statusColor}; display: inline-flex; align-items: center;">${statusIcon}</span>
                <span class="host-ip">${result.host_ip}</span>
                <span class="result-summary">${escapeHtml(summaryText)}</span>
                <span class="duration-badge">${durationText}</span>
                <button class="copy-single-btn" title="复制输出">复制</button>
                <span class="expand-icon">${Utils.icon('play', 9)}</span>
            </div>
            <div class="result-card-body">
                ${renderOutputBlocks(result)}
            </div>
        `;

        // 绑定展开/折叠事件
        const header = card.querySelector('.result-card-header');
        header.addEventListener('click', (e) => {
            if (e.target.classList.contains('copy-single-btn')) return;
            card.classList.toggle('expanded');
        });

        // 绑定复制按钮
        const copyBtn = card.querySelector('.copy-single-btn');
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const output = result.stdout || result.stderr || '';
            copyToClipboard(output);
            copyBtn.textContent = Utils.icon('check', 11, 2.5);
            setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
        });

        return card;
    }

    // 更新已有卡片
    function updateResultCard(cardEl, result) {
        cardEl.className = `result-card result-${result.status}`;
        cardEl.dataset.status = result.status;

        const statusIcon = result.status === 'success' ? Utils.icon('check', 13, 2.5) : Utils.icon('x', 13, 2.5);
        const statusColor = result.status === 'success' ? 'var(--status-healthy-fg)' : 'var(--status-critical-fg)';
        const summaryText = getSummaryText(result);
        const durationText = result.duration ? `${result.duration}ms` : '-';

        cardEl.querySelector('.status-icon').innerHTML = statusIcon;
        cardEl.querySelector('.status-icon').style.color = statusColor;
        cardEl.querySelector('.result-summary').textContent = summaryText;
        cardEl.querySelector('.duration-badge').textContent = durationText;
        cardEl.querySelector('.result-card-body').innerHTML = renderOutputBlocks(result);

        // 更新复制按钮事件
        const copyBtn = cardEl.querySelector('.copy-single-btn');
        const newCopyBtn = copyBtn.cloneNode(true);
        copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
        newCopyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const output = result.stdout || result.stderr || '';
            copyToClipboard(output);
            newCopyBtn.textContent = Utils.icon('check', 11, 2.5);
            setTimeout(() => { newCopyBtn.textContent = '复制'; }, 1500);
        });

        // 重新应用筛选
        const prefix = cardEl.closest('#scriptResultContainer') ? 'script' : 'command';
        applyFilterToCard(prefix, cardEl);
    }

    // 获取摘要文本
    function getSummaryText(result) {
        const output = result.stdout || result.stderr || '';
        if (!output.trim()) return '（无输出）';
        // 取第一行作为摘要
        const firstLine = output.trim().split('\n')[0];
        return firstLine.length > 80 ? firstLine.substring(0, 80) + '...' : firstLine;
    }

    // 渲染输出块
    function renderOutputBlocks(result) {
        let html = '';
        if (result.stdout && result.stdout.trim()) {
            html += `<div class="output-block">
                <div class="output-label">标准输出</div>
                <div class="output-content output-stdout">${escapeHtml(result.stdout.trim())}</div>
            </div>`;
        }
        // 结果模式只展示最终结果：成功时隐藏 stderr 执行过程，仅失败时展示 stderr 作为错误输出
        if (result.stderr && result.stderr.trim() && result.status === 'failed') {
            html += `<div class="output-block">
                <div class="output-label">错误输出</div>
                <div class="output-content output-error">${escapeHtml(result.stderr.trim())}</div>
            </div>`;
        }
        if (!html) {
            html = '<div class="output-block"><div class="output-content" style="color: var(--text-faint);">（无输出内容）</div></div>';
        }
        return html;
    }

    // 应用筛选
    function applyResultFilter(prefix) {
        const container = document.getElementById(prefix + 'ResultContainer');
        if (!container) return;

        const filter = prefix === 'script' ? scriptCurrentFilter : window._commandCurrentFilter || 'all';
        const keyword = prefix === 'script' ? scriptSearchKeyword : (window._commandSearchKeyword || '');

        container.querySelectorAll('.result-card').forEach(card => {
            let visible = true;

            // 状态筛选
            if (filter !== 'all' && card.dataset.status !== filter) {
                visible = false;
            }

            // 关键字搜索
            if (visible && keyword) {
                const ip = (card.dataset.hostIp || '').toLowerCase();
                const body = (card.querySelector('.result-card-body') || {}).textContent || '';
                if (!ip.includes(keyword) && !body.toLowerCase().includes(keyword)) {
                    visible = false;
                }
            }

            card.style.display = visible ? '' : 'none';
        });
    }

    // 对单个卡片应用筛选
    function applyFilterToCard(prefix, card) {
        const filter = prefix === 'script' ? scriptCurrentFilter : window._commandCurrentFilter || 'all';
        const keyword = prefix === 'script' ? scriptSearchKeyword : (window._commandSearchKeyword || '');
        let visible = true;

        if (filter !== 'all' && card.dataset.status !== filter) visible = false;
        if (visible && keyword) {
            const ip = (card.dataset.hostIp || '').toLowerCase();
            const body = (card.querySelector('.result-card-body') || {}).textContent || '';
            if (!ip.includes(keyword) && !body.toLowerCase().includes(keyword)) visible = false;
        }

        card.style.display = visible ? '' : 'none';
    }
    // HTML转义
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 复制到剪贴板
    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    }

    // 在init中调用结果视图初始化
    setTimeout(initResultViewEvents, 0);

    // 导出到全局
    window.TaskExecution = {
        init: function() {
            if (!this._initialized) {
                this._initialized = true;
                console.log('TaskExecution 初始化');
                init();
            } else {
                console.log('TaskExecution 重新加载数据');
                loadTaskHistory();
                // 重新加载脚本列表（确保 allScripts 和标签值下拉始终最新）
                loadScripts();
                loadScriptCategories();
            }
        },
        _initialized: false
    };

})();
