// 文件上传页面逻辑
(function() {
    'use strict';

    let taskService;
    let hostService;
    let selectedHosts = [];
    let selectedFiles = []; // 存储选中的文件路径
    let currentTaskId = null;
    let executionStartTime = null;
    let executionTimer = null;

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
        console.log('初始化文件上传页面...');
        
        // 创建服务实例
        taskService = new window.TaskService();
        hostService = new window.HostService();
        
        // 绑定事件
        bindEvents();
        
        // 加载任务历史
        await loadTaskHistory();
    }

    // 绑定事件（幂等守卫：模块自动初始化与导航初始化可能各调用一次，避免重复绑定）
    let eventsBound = false;
    function bindEvents() {
        if (eventsBound) return;
        eventsBound = true;
        console.log('绑定文件上传事件...');
        
        // 创建任务按钮
        const createTaskBtn = document.getElementById('createFileUploadTaskBtn');
        if (createTaskBtn) {
            createTaskBtn.addEventListener('click', showTaskConfig);
        }

        // 选择文件按钮（阻止冒泡，避免触发拖拽区点击）
        const selectFilesBtn = document.getElementById('selectFilesBtn');
        if (selectFilesBtn) {
            selectFilesBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectFiles();
            });
        }

        // 清空文件按钮
        const clearFilesBtn = document.getElementById('clearFilesBtn');
        if (clearFilesBtn) {
            clearFilesBtn.addEventListener('click', clearFiles);
        }

        // 拖拽上传区事件
        const dropzone = document.getElementById('fileUploadDropzone');
        if (dropzone) {
            // 点击拖拽区也触发选择文件
            dropzone.addEventListener('click', selectFiles);

            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('file-upload-dropzone-active');
            });

            dropzone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('file-upload-dropzone-active');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('file-upload-dropzone-active');
                // Electron 环境下可通过 File.path 获取本地文件绝对路径
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const droppedFiles = [];
                    for (let i = 0; i < e.dataTransfer.files.length; i++) {
                        const file = e.dataTransfer.files[i];
                        // Electron 扩展属性：file.path 返回本地文件的绝对路径
                        if (file.path) {
                            droppedFiles.push(file.path);
                        }
                    }
                    if (droppedFiles.length > 0) {
                        selectedFiles = droppedFiles;
                        updateSelectedFilesList();
                        updatePathPreview();
                        showMessage(`已添加 ${droppedFiles.length} 个文件`, 'success');
                    } else {
                        showMessage('未能获取拖拽文件的路径，请使用「选择文件」按钮', 'warning');
                    }
                }
            });
        }

        // 目标路径输入框 - 实时更新路径预览
        const targetPath = document.getElementById('targetPath');
        if (targetPath) {
            targetPath.addEventListener('input', updatePathPreview);
        }

        // 选择主机按钮
        const selectHostsBtn = document.getElementById('selectFileUploadHostsBtn');
        if (selectHostsBtn) {
            selectHostsBtn.addEventListener('click', showHostSelector);
        }

        // 清空选择按钮
        const clearHostsBtn = document.getElementById('clearFileUploadHostsBtn');
        if (clearHostsBtn) {
            clearHostsBtn.addEventListener('click', clearHostSelection);
        }

        // 开始上传按钮
        const startUploadBtn = document.getElementById('startFileUploadBtn');
        if (startUploadBtn) {
            startUploadBtn.addEventListener('click', startExecution);
        }

        // 停止上传按钮
        const stopUploadBtn = document.getElementById('stopFileUploadBtn');
        if (stopUploadBtn) {
            stopUploadBtn.addEventListener('click', stopExecution);
        }

        // 取消任务按钮
        const cancelTaskBtn = document.getElementById('cancelFileUploadTaskBtn');
        if (cancelTaskBtn) {
            cancelTaskBtn.addEventListener('click', cancelTask);
        }

        // 清空日志按钮
        const clearLogBtn = document.getElementById('clearFileUploadLogBtn');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', clearLog);
        }

        // 下载日志按钮
        const downloadLogBtn = document.getElementById('downloadFileUploadLogBtn');
        if (downloadLogBtn) {
            downloadLogBtn.addEventListener('click', downloadLog);
        }

        // 复制日志按钮
        const copyLogBtn = document.getElementById('copyFileUploadLogBtn');
        if (copyLogBtn) {
            copyLogBtn.addEventListener('click', copyLog);
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

    // 显示任务配置界面
    function showTaskConfig() {
        const configSection = document.getElementById('fileUploadTaskConfigSection');
        const historySection = document.getElementById('fileUploadTaskHistorySection');
        
        if (configSection && historySection) {
            configSection.style.display = 'block';
            historySection.style.display = 'none';
            
            // 重置表单
            resetTaskForm();
        }
    }

    // 重置任务表单
    function resetTaskForm() {
        selectedHosts = [];
        selectedFiles = [];
        currentTaskId = null;
        updateSelectedHostsList();
        updateSelectedFilesList();
        
        const targetPath = document.getElementById('targetPath');
        const taskName = document.getElementById('fileUploadTaskName');
        const taskConcurrency = document.getElementById('fileUploadTaskConcurrency');
        const taskTimeout = document.getElementById('fileUploadTaskTimeout');
        
        if (targetPath) targetPath.value = '';
        if (taskName) taskName.value = '';
        // 重置为全局设置的默认值
        resetExecutionParamsToGlobal(taskConcurrency, taskTimeout);
        
        // 重置配置选项为默认值
        const conflictBackup = document.querySelector('input[name="conflictStrategy"][value="backup"]');
        if (conflictBackup) conflictBackup.checked = true;
        
        const pathError = document.querySelector('input[name="pathCreateStrategy"][value="error"]');
        if (pathError) pathError.checked = true;
        
        // 隐藏路径预览
        const pathPreview = document.getElementById('fullPathPreview');
        if (pathPreview) pathPreview.style.display = 'none';
        
        // 隐藏监控区域
        const monitorSection = document.getElementById('fileUploadTaskMonitorSection');
        if (monitorSection) {
            monitorSection.style.display = 'none';
        }
    }

    // 取消任务
    function cancelTask() {
        const configSection = document.getElementById('fileUploadTaskConfigSection');
        const historySection = document.getElementById('fileUploadTaskHistorySection');
        
        if (configSection && historySection) {
            configSection.style.display = 'none';
            historySection.style.display = 'block';
        }
        
        resetTaskForm();
    }

    // 选择文件
    async function selectFiles() {
        try {
            const { ipcRenderer } = require('electron');
            const files = await ipcRenderer.invoke('select-files');
            if (files && files.length > 0) {
                selectedFiles = files;
                updateSelectedFilesList();
                updatePathPreview();
            }
        } catch (error) {
            console.error('选择文件失败:', error);
            showMessage('选择文件失败: ' + error.message, 'error');
        }
    }

    // 清空文件选择
    function clearFiles() {
        selectedFiles = [];
        updateSelectedFilesList();
        updatePathPreview();
    }

    // 更新选中的文件列表显示
    function updateSelectedFilesList() {
        const listDiv = document.getElementById('selectedFilesList');
        const fileCountSpan = document.getElementById('fileUploadFileCount');
        const clearBtn = document.getElementById('clearFilesBtn');

        if (!listDiv) return;

        if (selectedFiles.length === 0) {
            listDiv.style.display = 'none';
            listDiv.innerHTML = '';
            if (fileCountSpan) fileCountSpan.textContent = '未选择任何文件';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }

        listDiv.style.display = 'block';
        if (clearBtn) clearBtn.style.display = 'inline-flex';
        if (fileCountSpan) fileCountSpan.textContent = `已选择 ${selectedFiles.length} 个文件`;

        const path = require('path');
        listDiv.innerHTML = selectedFiles.map((file, index) => {
            const fileName = path.basename(file);
            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid var(--border-subtle);">
                <span style="font-family: var(--font-mono); font-size: 0.9rem;">
                    ${index + 1}. ${escapeHtml(fileName)}
                </span>
                <span style="color: var(--text-muted); font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(file)}">${escapeHtml(file)}</span>
            </div>`;
        }).join('');
    }

    // 更新路径预览
    function updatePathPreview() {
        const targetPath = document.getElementById('targetPath');
        const pathPreview = document.getElementById('fullPathPreview');
        const pathList = document.getElementById('fullPathList');
        
        if (!targetPath || !pathPreview || !pathList) return;

        const targetPathValue = targetPath.value.trim();
        
        if (!targetPathValue || selectedFiles.length === 0) {
            pathPreview.style.display = 'none';
            return;
        }

        const path = require('path');
        // 确保路径以 / 结尾
        const normalizedPath = targetPathValue.endsWith('/') ? targetPathValue : targetPathValue + '/';
        
        const previewHtml = selectedFiles.map((file, index) => {
            const fileName = path.basename(file);
            const fullPath = normalizedPath + fileName;
            return `<div style="margin: 0.2rem 0;">${index + 1}. ${escapeHtml(fullPath)}</div>`;
        }).join('');
        
        pathList.innerHTML = previewHtml;
        pathPreview.style.display = 'block';
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

    // 创建主机选择器对话框（完全复用命令执行的实现）
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
                    
                    <div style="max-height: 400px; overflow-y: auto;">
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
                    
                    if (currentFilters.systemName) {
                        match = match && ((host.systemName || host.system_name) === currentFilters.systemName);
                    }
                    
                    if (currentFilters.appName) {
                        match = match && ((host.appName || host.app_name) === currentFilters.appName);
                    }
                    
                    if (currentFilters.datacenter) {
                        match = match && (host.datacenter === currentFilters.datacenter);
                    }
                    
                    if (currentFilters.environment) {
                        match = match && (host.environment === currentFilters.environment);
                    }
                    
                    return match;
                });
            };
            
            const hostsForOptions = getFilteredHostsForOptions();
            
            // 更新应用名称筛选器
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
            if (currentFilters.appName && !appNames.includes(currentFilters.appName)) {
                currentFilters.appName = '';
                appNameFilter.value = '';
            }
            
            // 更新机房筛选器
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
            if (currentFilters.datacenter && !datacenters.includes(currentFilters.datacenter)) {
                currentFilters.datacenter = '';
                datacenterFilter.value = '';
            }
            
            // 更新环境筛选器
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
            
            updateSelectAllState();
        }
        
        // 更新全选框状态
        function updateSelectAllState() {
            const visibleCheckboxes = modalOverlay.querySelectorAll('#hostSelectorTableBody tr:not([style*="display: none"]) .host-checkbox');
            const checkedCount = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;
            selectAllCheckbox.checked = visibleCheckboxes.length > 0 && checkedCount === visibleCheckboxes.length;
            selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
            
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

        selectByIpBtn.addEventListener('click', () => {
            const ipInput = ipBatchInput.value.trim();
            if (!ipInput) {
                ipMatchResult.textContent = '请输入IP地址';
                ipMatchResult.style.color = 'var(--status-critical-fg)';
                return;
            }

            const inputIps = ipInput
                .split(/[,\s\n]+/)
                .map(ip => ip.trim())
                .filter(ip => ip.length > 0);

            if (inputIps.length === 0) {
                ipMatchResult.textContent = '未识别到有效的IP地址';
                ipMatchResult.style.color = 'var(--status-critical-fg)';
                return;
            }

            const ipToHostMap = new Map();
            hosts.forEach(host => {
                ipToHostMap.set(host.ip, host.id);
            });

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

            if (matchedHostIds.length > 0) {
                modalOverlay.querySelectorAll('.host-checkbox').forEach(cb => {
                    const hostId = parseInt(cb.value);
                    if (matchedHostIds.includes(hostId)) {
                        cb.checked = true;
                    }
                });
                updateSelectAllState();
            }

            let resultMsg = '';
            if (matchedIps.length > 0) {
                resultMsg += `已选中 ${matchedIps.length} 台主机`;
            }
            if (notFoundIps.length > 0) {
                if (resultMsg) resultMsg += '；';
                resultMsg += `未找到 ${notFoundIps.length} 个IP: ${notFoundIps.join(', ')}`;
                ipMatchResult.style.color = 'var(--status-critical-fg)';
            } else {
                ipMatchResult.style.color = 'var(--status-healthy-fg)';
            }
            ipMatchResult.textContent = resultMsg;
        });

        clearIpInputBtn.addEventListener('click', () => {
            ipBatchInput.value = '';
            ipMatchResult.textContent = '';
        });

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
        const countSpan = document.getElementById('selectedFileUploadHostsCount');
        const listDiv = document.getElementById('selectedFileUploadHostsList');
        
        if (!countSpan || !listDiv) return;

        if (selectedHosts.length === 0) {
            countSpan.textContent = '';
            listDiv.innerHTML = '<span style="color: var(--text-muted);">未选择主机</span>';
            return;
        }

        countSpan.textContent = `已选择 ${selectedHosts.length} 台主机`;
        
        try {
            const hosts = await hostService.loadHosts();
            const selectedHostsData = hosts.filter(h => selectedHosts.includes(h.id));
            
            listDiv.innerHTML = selectedHostsData.map(host => 
                `<span class="badge" style="margin: 2px;">${escapeHtml(host.ip)} (${escapeHtml(host.hostname || host.systemName || 'Unknown')})</span>`
            ).join('');
        } catch (error) {
            console.error('更新主机列表失败:', error);
        }
    }

    // 清空主机选择
    function clearHostSelection() {
        selectedHosts = [];
        updateSelectedHostsList();
    }

    // 开始执行任务
    async function startExecution() {
        try {
            // 验证表单
            if (selectedFiles.length === 0) {
                showMessage('请选择要上传的文件', 'error');
                return;
            }

            const targetPath = document.getElementById('targetPath');
            const targetPathValue = targetPath ? targetPath.value.trim() : '';
            
            if (!targetPathValue) {
                showMessage('请填写目标路径', 'error');
                return;
            }

            if (selectedHosts.length === 0) {
                showMessage('请选择目标主机', 'error');
                return;
            }

            // 获取配置选项
            const taskConcurrencyInput = document.getElementById('fileUploadTaskConcurrency');
            const taskTimeoutInput = document.getElementById('fileUploadTaskTimeout');
            const concurrency = taskConcurrencyInput ? Math.max(1, parseInt(taskConcurrencyInput.value, 10) || 1) : 1;
            const timeout = taskTimeoutInput ? Math.max(10000, (parseInt(taskTimeoutInput.value, 10) || 300) * 1000) : 300000;
            const conflictStrategy = document.querySelector('input[name="conflictStrategy"]:checked')?.value || 'backup';
            const pathCreateStrategy = document.querySelector('input[name="pathCreateStrategy"]:checked')?.value || 'error';

            // 生成任务名称
            const now = new Date();
            const dateStr = formatDate(now, 'YYYYMMDD_HHmmss');
            const path = require('path');
            const fileNames = selectedFiles.map(f => path.basename(f)).join(', ');
            const taskName = `文件上传_${fileNames.substring(0, 20)}_${dateStr}`;

            // 创建任务
            const task = await taskService.createTask({
                task_name: taskName,
                script_id: null,
                is_temporary_command: 0,
                is_file_upload: 1,
                upload_files: selectedFiles,
                target_path: targetPathValue,
                conflict_strategy: conflictStrategy,
                path_create_strategy: pathCreateStrategy,
                host_ids: selectedHosts,
                parameters: {
                    concurrency,
                    timeout
                }
            });

            currentTaskId = task.id;

            // 显示监控区域
            const monitorSection = document.getElementById('fileUploadTaskMonitorSection');
            if (monitorSection) {
                monitorSection.style.display = 'block';
                monitorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // 更新UI
            document.getElementById('startFileUploadBtn').style.display = 'none';
            document.getElementById('stopFileUploadBtn').style.display = 'inline-block';

            // 初始化监控显示
            document.getElementById('fileUploadTotalCount').textContent = selectedHosts.length;
            document.getElementById('fileUploadSuccessCount').textContent = '0';
            document.getElementById('fileUploadFailedCount').textContent = '0';
            document.getElementById('fileUploadOverallProgress').textContent = '0%';
            document.getElementById('fileUploadProgressFill').style.width = '0%';

            // 清空日志
            const logDiv = document.getElementById('fileUploadExecutionLog');
            if (logDiv) logDiv.innerHTML = '';

            // 开始执行
            executionStartTime = Date.now();
            startExecutionTimer();

            // 调用执行服务
            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('execute-file-upload', {
                taskId: currentTaskId,
                files: selectedFiles,
                targetPath: targetPathValue,
                hostIds: selectedHosts,
                conflictStrategy: conflictStrategy,
                pathCreateStrategy: pathCreateStrategy,
                concurrency,
                timeout
            });

            console.log('文件上传任务已完成:', result);

        } catch (error) {
            console.error('启动上传任务失败:', error);
            showMessage('启动上传任务失败: ' + error.message, 'error');
            appendLog(`错误: ${error.message}`, 'error');
        }
    }

    // 停止执行
    async function stopExecution() {
        try {
            if (!currentTaskId) return;

            const { ipcRenderer } = require('electron');
            await ipcRenderer.invoke('task:stop', currentTaskId);
            
            appendLog('用户取消了任务执行', 'warning');
            showMessage('已停止上传任务', 'success');
            
            stopExecutionTimer();
            
            document.getElementById('startFileUploadBtn').style.display = 'inline-block';
            document.getElementById('stopFileUploadBtn').style.display = 'none';
            
        } catch (error) {
            console.error('停止任务失败:', error);
            showMessage('停止任务失败: ' + error.message, 'error');
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
            
            const timeDisplay = document.getElementById('fileUploadExecutionTime');
            if (timeDisplay) {
                timeDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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

    // 清空日志
    function clearLog() {
        const logDiv = document.getElementById('fileUploadExecutionLog');
        if (logDiv) {
            logDiv.innerHTML = '';
        }
    }

    // 下载日志
    function downloadLog() {
        const logDiv = document.getElementById('fileUploadExecutionLog');
        if (!logDiv) return;

        const logContent = logDiv.textContent;
        const blob = new Blob([logContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `fileupload_log_${formatDate(new Date(), 'YYYYMMDD_HHmmss')}.txt`;
        a.click();
        
        URL.revokeObjectURL(url);
        showMessage('日志已下载', 'success');
    }

    // 复制日志
    async function copyLog() {
        const logDiv = document.getElementById('fileUploadExecutionLog');
        if (!logDiv) return;

        const logContent = logDiv.textContent;
        
        try {
            await navigator.clipboard.writeText(logContent);
            showMessage('日志已复制到剪贴板', 'success');
        } catch (error) {
            console.error('复制失败:', error);
            showMessage('复制失败', 'error');
        }
    }

    // 追加日志
    function appendLog(message, type = 'info') {
        const logDiv = document.getElementById('fileUploadExecutionLog');
        if (!logDiv) return;

        const timestamp = formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss');
        const logEntry = document.createElement('div');
        
        let color = 'var(--text-body)';
        let icon = '';
        
        switch (type) {
            case 'success':
                color = 'var(--status-healthy-fg)';
                icon = Utils.icon('check', 12, 2.5);
                break;
            case 'error':
                color = 'var(--status-critical-fg)';
                icon = Utils.icon('x', 12, 2.5);
                break;
            case 'warning':
                color = 'var(--status-warning-fg)';
                icon = Utils.icon('alert-triangle', 12);
                break;
            case 'info':
                color = 'var(--primary)';
                icon = Utils.icon('info', 12);
                break;
        }
        
        logEntry.innerHTML = `<span style="color: var(--text-faint);">[${timestamp}]</span> <span style="color: ${color};">${icon} ${escapeHtml(message)}</span>`;
        logDiv.appendChild(logEntry);
        
        // 【性能优化】限制最大日志行数,防止DOM节点过多导致页面卡顿
        // 保留最近1000行,超出时删除最旧的日志
        const MAX_LOG_LINES = 1000;
        while (logDiv.children.length > MAX_LOG_LINES) {
            logDiv.removeChild(logDiv.firstChild);
        }
        
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    // 加载任务历史
    async function loadTaskHistory() {
        try {
            const tasks = await taskService.getTasks();
            console.log('加载到的所有任务:', tasks.length);
            
            // 过滤出文件上传任务（兼容多种数据类型）
            const fileUploadTasks = tasks.filter(t => {
                // 支持 1, '1', true, 'true' 等多种格式
                return t.is_file_upload === 1 || t.is_file_upload === '1' || t.is_file_upload === true;
            });
            
            console.log('过滤后的文件上传任务:', fileUploadTasks.length);
            if (fileUploadTasks.length > 0) {
                console.log('第一个文件上传任务:', fileUploadTasks[0]);
            }
            
            const tableBody = document.querySelector('#fileUploadTaskHistoryTable tbody');
            if (!tableBody) {
                console.error('找不到表格 tbody 元素');
                return;
            }

            if (fileUploadTasks.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">暂无执行历史</td></tr>';
                return;
            }

            // 按创建时间倒序排序（最新的任务在第一个）
            const sortedTasks = [...fileUploadTasks].sort((a, b) => {
                const dateA = new Date(a.created_at || 0);
                const dateB = new Date(b.created_at || 0);
                return dateB - dateA;
            });

            tableBody.innerHTML = sortedTasks.map(task => {
                const statusClass = task.status === 'completed' ? 'success' : 
                                   task.status === 'failed' ? 'danger' : 
                                   task.status === 'running' ? 'primary' : 'secondary';
                const statusText = task.status === 'completed' ? '已完成' :
                                  task.status === 'failed' ? '失败' :
                                  task.status === 'running' ? '运行中' :
                                  task.status === 'cancelled' ? '已取消' : '等待中';
                
                const uploadFiles = task.upload_files || [];
                const fileCount = uploadFiles.length;
                
                return `
                    <tr>
                        <td>${task.id}</td>
                        <td>${escapeHtml(task.task_name)}</td>
                        <td>${fileCount}</td>
                        <td style="font-family: var(--font-mono); font-size: 0.875rem;">${escapeHtml(task.target_path || '-')}</td>
                        <td>${task.total_hosts || 0}</td>
                        <td>
                            <span class="badge badge-success">${task.success_hosts || 0}</span> / 
                            <span class="badge badge-danger">${task.failed_hosts || 0}</span>
                        </td>
                        <td><span class="badge badge-${statusClass}">${statusText}</span></td>
                        <td>${task.created_at ? new Date(task.created_at).toLocaleString('zh-CN') : '-'}</td>
                    </tr>
                `;
            }).join('');
            
        } catch (error) {
            console.error('加载任务历史失败:', error);
        }
    }

    // HTML转义函数
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 显示消息
    function showMessage(message, type = 'info') {
        // 使用项目统一的通知组件，避免原生弹窗
        if (window.Utils && window.Utils.notify) {
            // 根据类型调用对应的通知方法
            switch (type) {
                case 'success':
                    window.Utils.notify.success(message);
                    break;
                case 'error':
                    window.Utils.notify.error(message);
                    break;
                case 'warning':
                    window.Utils.notify.warning(message);
                    break;
                case 'info':
                default:
                    window.Utils.notify.info(message);
                    break;
            }
        } else {
            // 降级方案：使用console输出
            console.log(`[${type}] ${message}`);
        }
    }

    // 监听任务进度更新事件
    const { ipcRenderer } = require('electron');
    
    // 先移除可能存在的旧监听器，避免重复监听
    ipcRenderer.removeAllListeners('task-progress');
    
    ipcRenderer.on('task-progress', (event, data) => {
        if (!currentTaskId || data.taskId !== currentTaskId) return;
        
        // 更新进度显示
        if (data.progress !== undefined) {
            const progress = Math.round(data.progress);
            document.getElementById('fileUploadOverallProgress').textContent = `${progress}%`;
            document.getElementById('fileUploadProgressFill').style.width = `${progress}%`;
        }
        
        // 更新统计
        if (data.successCount !== undefined) {
            document.getElementById('fileUploadSuccessCount').textContent = data.successCount;
        }
        if (data.failedCount !== undefined) {
            document.getElementById('fileUploadFailedCount').textContent = data.failedCount;
        }
        
        // 追加日志
        if (data.log) {
            appendLog(data.log, data.logType || 'info');
        }
        
        // 任务完成
        if (data.completed) {
            stopExecutionTimer();
            document.getElementById('startFileUploadBtn').style.display = 'inline-block';
            document.getElementById('stopFileUploadBtn').style.display = 'none';
            
            loadTaskHistory();
            
            if (data.success) {
                appendLog('所有文件上传完成', 'success');
                showMessage('文件上传任务完成', 'success');
            } else {
                appendLog('上传任务结束，部分失败', 'warning');
                showMessage('文件上传任务完成，部分失败', 'warning');
            }
        }
    });

    // 页面加载时初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 导出到全局（供navigation.js调用）
    window.FileUploadPage = {
        init: function() {
            if (!this._initialized) {
                this._initialized = true;
                console.log('FileUploadPage 初始化');
                init();
            } else {
                console.log('FileUploadPage 重新加载数据');
                loadTaskHistory();
            }
        },
        _initialized: false
    };
})();
