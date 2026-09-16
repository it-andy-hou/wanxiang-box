// UI组件库

// 模态框组件
class Modal {
    constructor(options = {}) {
        this.options = {
            title: '提示',
            content: '',
            width: '500px',
            height: 'auto',
            showCloseButton: true,
            backdrop: true,
            ...options
        };
        
        this.element = null;
        this.isVisible = false;
    }
    
    create() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.width = this.options.width;
        if (this.options.height !== 'auto') {
            modal.style.height = this.options.height;
        }
        
        const header = document.createElement('div');
        header.className = 'modal-header';
        header.innerHTML = `
            <h3 class="modal-title">${this.options.title}</h3>
            ${this.options.showCloseButton ? '<button class="modal-close">&times;</button>' : ''}
        `;
        
        const body = document.createElement('div');
        body.className = 'modal-body';
        if (typeof this.options.content === 'string') {
            body.innerHTML = this.options.content;
        } else {
            body.appendChild(this.options.content);
        }
        
        modal.appendChild(header);
        modal.appendChild(body);
        
        if (this.options.footer) {
            const footer = document.createElement('div');
            footer.className = 'modal-footer';
            if (typeof this.options.footer === 'string') {
                footer.innerHTML = this.options.footer;
            } else {
                footer.appendChild(this.options.footer);
            }
            modal.appendChild(footer);
        }
        
        overlay.appendChild(modal);
        this.element = overlay;
        
        // 绑定事件
        this.bindEvents();
    }
    
    bindEvents() {
        // 关闭按钮事件
        const closeBtn = this.element.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }
        
        // 背景点击关闭
        if (this.options.backdrop) {
            this.element.addEventListener('click', (e) => {
                if (e.target === this.element) {
                    this.hide();
                }
            });
        }
        
        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });
    }
    
    show() {
        if (!this.element) {
            this.create();
        }
        
        document.body.appendChild(this.element);
        this.isVisible = true;
        
        // 触发显示动画
        setTimeout(() => {
            this.element.style.opacity = '1';
        }, 10);
        
        if (this.options.onShow) {
            this.options.onShow();
        }
    }
    
    hide() {
        if (!this.isVisible) return;
        
        this.element.style.opacity = '0';
        this.isVisible = false;
        
        setTimeout(() => {
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            
            if (this.options.onHide) {
                this.options.onHide();
            }
        }, 300);
    }
    
    setContent(content) {
        if (this.element) {
            const body = this.element.querySelector('.modal-body');
            if (typeof content === 'string') {
                body.innerHTML = content;
            } else {
                body.innerHTML = '';
                body.appendChild(content);
            }
        }
    }
    
    setTitle(title) {
        if (this.element) {
            const titleEl = this.element.querySelector('.modal-title');
            titleEl.textContent = title;
        }
    }
}

// 表格组件
class DataTable {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.querySelector(container) : container;
        this.options = {
            columns: [],
            data: [],
            pagination: false,
            pageSize: 10,
            sortable: true,
            searchable: false,
            selectable: false,
            ...options
        };
        
        this.currentPage = 1;
        this.sortColumn = null;
        this.sortDirection = 'asc';
        this.searchTerm = '';
        this.selectedRows = new Set();
        
        this.init();
    }
    
    init() {
        this.render();
        this.bindEvents();
    }
    
    render() {
        this.container.innerHTML = '';
        
        // 搜索框
        if (this.options.searchable) {
            this.renderSearchBox();
        }
        
        // 表格
        this.renderTable();
        
        // 分页
        if (this.options.pagination) {
            this.renderPagination();
        }
    }
    
    renderSearchBox() {
        const searchContainer = document.createElement('div');
        searchContainer.className = 'datatable-search';
        searchContainer.innerHTML = `
            <input type="text" class="form-control" placeholder="搜索..." value="${this.searchTerm}">
        `;
        this.container.appendChild(searchContainer);
    }
    
    renderTable() {
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';
        
        const table = document.createElement('table');
        table.className = 'table';
        
        // 表头
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        if (this.options.selectable) {
            const selectCell = document.createElement('th');
            selectCell.innerHTML = '<input type="checkbox" class="select-all">';
            headerRow.appendChild(selectCell);
        }
        
        this.options.columns.forEach(column => {
            const th = document.createElement('th');
            th.textContent = column.title || column.key;
            th.dataset.key = column.key;
            
            if (this.options.sortable && column.sortable !== false) {
                th.classList.add('sortable');
                if (this.sortColumn === column.key) {
                    th.classList.add(`sort-${this.sortDirection}`);
                }
            }
            
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // 表体
        const tbody = document.createElement('tbody');
        const filteredData = this.getFilteredData();
        const paginatedData = this.getPaginatedData(filteredData);
        
        paginatedData.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.dataset.index = index;
            
            if (this.options.selectable) {
                const selectCell = document.createElement('td');
                selectCell.innerHTML = `<input type="checkbox" class="row-select" value="${index}">`;
                tr.appendChild(selectCell);
            }
            
            this.options.columns.forEach(column => {
                const td = document.createElement('td');
                
                if (column.render) {
                    td.innerHTML = column.render(row[column.key], row, index);
                } else {
                    td.textContent = row[column.key] || '';
                }
                
                tr.appendChild(td);
            });
            
            tbody.appendChild(tr);
        });
        
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        this.container.appendChild(tableContainer);
    }
    
    renderPagination() {
        const filteredData = this.getFilteredData();
        const totalPages = Math.ceil(filteredData.length / this.options.pageSize);
        
        if (totalPages <= 1) return;
        
        const paginationContainer = document.createElement('div');
        paginationContainer.className = 'datatable-pagination';
        
        const pagination = document.createElement('ul');
        pagination.className = 'pagination';
        
        // 上一页
        const prevItem = document.createElement('li');
        prevItem.className = `page-item ${this.currentPage === 1 ? 'disabled' : ''}`;
        prevItem.innerHTML = '<a class="page-link" href="#" data-page="prev">上一页</a>';
        pagination.appendChild(prevItem);
        
        // 页码
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(totalPages, this.currentPage + 2);
        
        for (let i = startPage; i <= endPage; i++) {
            const pageItem = document.createElement('li');
            pageItem.className = `page-item ${i === this.currentPage ? 'active' : ''}`;
            pageItem.innerHTML = `<a class="page-link" href="#" data-page="${i}">${i}</a>`;
            pagination.appendChild(pageItem);
        }
        
        // 下一页
        const nextItem = document.createElement('li');
        nextItem.className = `page-item ${this.currentPage === totalPages ? 'disabled' : ''}`;
        nextItem.innerHTML = '<a class="page-link" href="#" data-page="next">下一页</a>';
        pagination.appendChild(nextItem);
        
        paginationContainer.appendChild(pagination);
        this.container.appendChild(paginationContainer);
    }
    
    bindEvents() {
        // 搜索事件
        const searchInput = this.container.querySelector('.datatable-search input');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.searchTerm = e.target.value;
                this.currentPage = 1;
                this.render();
            }, 300));
        }
        
        // 排序事件
        this.container.addEventListener('click', (e) => {
            if (e.target.closest('.sortable')) {
                const th = e.target.closest('.sortable');
                const key = th.dataset.key;
                
                if (this.sortColumn === key) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = key;
                    this.sortDirection = 'asc';
                }
                
                this.render();
            }
        });
        
        // 分页事件
        this.container.addEventListener('click', (e) => {
            if (e.target.classList.contains('page-link')) {
                e.preventDefault();
                const page = e.target.dataset.page;
                
                if (page === 'prev' && this.currentPage > 1) {
                    this.currentPage--;
                } else if (page === 'next') {
                    const filteredData = this.getFilteredData();
                    const totalPages = Math.ceil(filteredData.length / this.options.pageSize);
                    if (this.currentPage < totalPages) {
                        this.currentPage++;
                    }
                } else if (!isNaN(page)) {
                    this.currentPage = parseInt(page);
                }
                
                this.render();
            }
        });
        
        // 选择事件
        this.container.addEventListener('change', (e) => {
            if (e.target.classList.contains('select-all')) {
                const checked = e.target.checked;
                this.container.querySelectorAll('.row-select').forEach(checkbox => {
                    checkbox.checked = checked;
                });
                this.updateSelectedRows();
            } else if (e.target.classList.contains('row-select')) {
                this.updateSelectedRows();
            }
        });
    }
    
    updateSelectedRows() {
        this.selectedRows.clear();
        this.container.querySelectorAll('.row-select:checked').forEach(checkbox => {
            this.selectedRows.add(parseInt(checkbox.value));
        });
        
        if (this.options.onSelectionChange) {
            this.options.onSelectionChange(Array.from(this.selectedRows));
        }
    }
    
    getFilteredData() {
        if (!this.searchTerm) {
            return this.options.data;
        }
        
        return this.options.data.filter(row => {
            return this.options.columns.some(column => {
                const value = row[column.key];
                return value && value.toString().toLowerCase().includes(this.searchTerm.toLowerCase());
            });
        });
    }
    
    getPaginatedData(data) {
        if (!this.options.pagination) {
            return this.getSortedData(data);
        }
        
        const startIndex = (this.currentPage - 1) * this.options.pageSize;
        const endIndex = startIndex + this.options.pageSize;
        
        return this.getSortedData(data).slice(startIndex, endIndex);
    }
    
    getSortedData(data) {
        if (!this.sortColumn) {
            return data;
        }
        
        return [...data].sort((a, b) => {
            const aValue = a[this.sortColumn];
            const bValue = b[this.sortColumn];
            
            let comparison = 0;
            if (aValue > bValue) {
                comparison = 1;
            } else if (aValue < bValue) {
                comparison = -1;
            }
            
            return this.sortDirection === 'desc' ? -comparison : comparison;
        });
    }
    
    setData(data) {
        this.options.data = data;
        this.currentPage = 1;
        this.selectedRows.clear();
        this.render();
    }
    
    getSelectedRows() {
        return Array.from(this.selectedRows);
    }
    
    refresh() {
        this.render();
    }
}

// 表单验证器
class FormValidator {
    constructor(form, rules = {}) {
        this.form = typeof form === 'string' ? document.querySelector(form) : form;
        this.rules = rules;
        this.errors = {};
    }
    
    validate() {
        this.errors = {};
        
        Object.keys(this.rules).forEach(fieldName => {
            const field = this.form.querySelector(`[name="${fieldName}"]`);
            if (!field) return;
            
            const value = field.value.trim();
            const fieldRules = this.rules[fieldName];
            
            fieldRules.forEach(rule => {
                if (typeof rule === 'function') {
                    const result = rule(value, field);
                    if (result !== true) {
                        this.addError(fieldName, result);
                    }
                } else if (typeof rule === 'object') {
                    const { validator, message } = rule;
                    if (!validator(value, field)) {
                        this.addError(fieldName, message);
                    }
                }
            });
        });
        
        this.displayErrors();
        return Object.keys(this.errors).length === 0;
    }
    
    addError(fieldName, message) {
        if (!this.errors[fieldName]) {
            this.errors[fieldName] = [];
        }
        this.errors[fieldName].push(message);
    }
    
    displayErrors() {
        // 清除之前的错误显示
        this.form.querySelectorAll('.error-message').forEach(el => el.remove());
        this.form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        
        // 显示新的错误
        Object.keys(this.errors).forEach(fieldName => {
            const field = this.form.querySelector(`[name="${fieldName}"]`);
            if (field) {
                field.classList.add('is-invalid');
                
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-message text-danger';
                errorDiv.textContent = this.errors[fieldName][0];
                
                field.parentNode.appendChild(errorDiv);
            }
        });
    }
    
    clearErrors() {
        this.errors = {};
        this.form.querySelectorAll('.error-message').forEach(el => el.remove());
        this.form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    }
}

// 主机表单组件
class HostForm {
    constructor(options = {}) {
        this.options = {
            mode: 'add', // 'add' 或 'edit'
            host: null,
            onSave: null,
            onCancel: null,
            ...options
        };
        this.modal = null;
        this.validator = null;
        this.entryMode = 'single'; // 'single' 单台录入 / 'batch' 批量录入（仅 add 模式可用）
    }
    
    show() {
        this.modal = new Modal({
            title: this.options.title || (this.options.mode === 'add' ? '添加主机' : '编辑主机'),
            content: this.createForm(),
            width: '800px',
            onShow: () => this.initForm(),
            onHide: () => {
                if (this.options.onCancel) {
                    this.options.onCancel();
                }
            }
        });
        
        this.modal.show();
    }
    
    createForm() {
        const host = this.options.host || {};
        
        return `
            <form id="hostForm" class="host-form">
                ${this.options.mode === 'add' ? `
                <!-- 录入模式切换（仅添加模式） -->
                <div class="entry-mode-tabs" id="entryModeTabs">
                    <button type="button" class="entry-mode-tab active" data-mode="single">单台录入</button>
                    <button type="button" class="entry-mode-tab" data-mode="batch">批量录入</button>
                </div>
                ` : ''}
                
                <!-- 批量录入区域（仅批量模式显示） -->
                <fieldset class="form-fieldset" id="batchEntrySection" style="display: none;">
                    <legend>批量 IP 录入</legend>
                    
                    <div class="form-row">
                        <div class="form-group col-md-12">
                            <label for="batchIpInput">IP 地址列表 *</label>
                            <textarea class="form-control batch-ip-textarea" id="batchIpInput" rows="6"
                                      placeholder="每行一个，支持逗号/分号/空格/斜杠/竖线分隔，例如：&#10;192.168.1.11&#10;192.168.1.12, 192.168.1.13&#10;10.0.0.1; 10.0.0.2"></textarea>
                            <div class="batch-ip-stats" id="batchIpStats"></div>
                        </div>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group col-md-6">
                            <label for="hostnamePrefix">主机名前缀（可选）</label>
                            <input type="text" class="form-control" id="hostnamePrefix" name="hostnamePrefix"
                                   placeholder="留空则主机名默认为 IP 地址">
                            <small class="form-text text-muted">留空 → 主机名 = IP；填 web → web-192.168.1.11</small>
                        </div>
                    </div>
                </fieldset>
                
                <!-- 基本信息区域 -->
                <fieldset class="form-fieldset">
                    <legend>基本信息</legend>
                    
                    <div class="form-row">
                        <div class="form-group col-md-6" id="hostnameField">
                            <label for="hostname">主机名 *</label>
                            <input type="text" class="form-control" name="hostname" id="hostname" 
                                   value="${host.hostname || ''}" placeholder="请输入主机名" required>
                        </div>
                        <div class="form-group col-md-6" id="ipField">
                            <label for="ip">IP地址 *</label>
                            <input type="text" class="form-control" name="ip" id="ip" 
                                   value="${host.ip || ''}" placeholder="请输入IP地址" required>
                        </div>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group col-md-4">
                            <label for="port">端口</label>
                            <input type="number" class="form-control" name="port" id="port" 
                                   value="${host.port || '22'}" placeholder="22" min="1" max="65535">
                        </div>
                        <div class="form-group col-md-4">
                            <label for="username">用户名 *</label>
                            <input type="text" class="form-control" name="username" id="username" 
                                   value="${host.username || ''}" placeholder="请输入用户名" required>
                        </div>
                        <div class="form-group col-md-4">
                            <label for="password">密码</label>
                            <div class="input-group">
                                <input type="password" class="form-control" name="password" id="password" 
                                       value="${host.password || ''}" placeholder="请输入密码">
                                <div class="input-group-append">
                                    <button class="btn btn-outline-secondary" type="button" id="togglePasswordBtn" title="显示密码">
                                        <span class="password-toggle-icon">${Utils.icon('eye', 14)}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </fieldset>
                
                <!-- 系统信息区域 -->
                <fieldset class="form-fieldset">
                    <legend>系统信息</legend>
                    
                    <div class="form-row">
                        <div class="form-group col-md-6">
                            <label for="systemName">系统名称</label>
                            <input type="text" class="form-control" name="systemName" id="systemName" 
                                   value="${host.systemName || host.system_name || ''}" 
                                   placeholder="如：xxx系统">
                            <small class="form-text text-muted">服务器所属的系统</small>
                        </div>
                        <div class="form-group col-md-6">
                            <label for="appName">应用名称</label>
                            <input type="text" class="form-control" name="appName" id="appName" 
                                   value="${host.appName || host.app_name || ''}" 
                                   placeholder="如：xxx应用">
                            <small class="form-text text-muted">运行的应用服务</small>
                        </div>
                    </div>
                </fieldset>
                
                <!-- 环境和位置信息 -->
                <fieldset class="form-fieldset">
                    <legend>环境与位置</legend>
                    
                    <div class="form-row">
                        <div class="form-group col-md-4">
                            <label for="datacenter">机房位置</label>
                            <input type="text" class="form-control" name="datacenter" id="datacenter" 
                                   value="${host.datacenter || ''}" 
                                   placeholder="如：机房1、机房2、机房3等">
                            <small class="form-text text-muted">服务器所在机房位置</small>
                        </div>
                        <div class="form-group col-md-4">
                            <label for="environment">环境标识</label>
                            <input type="text" class="form-control" name="environment" id="environment" 
                                   value="${host.environment || ''}" 
                                   placeholder="如：生产、测试、灰度等">
                            <small class="form-text text-muted">服务器所属环境</small>
                        </div>
                        <div class="form-group col-md-4">
                            <label for="owner">负责人</label>
                            <input type="text" class="form-control" name="owner" id="owner" 
                                   value="${host.owner || ''}" 
                                   placeholder="请输入负责人姓名">
                            <small class="form-text text-muted">该服务器的负责人</small>
                        </div>
                    </div>
                </fieldset>
                
                <!-- 执行环境信息区域（只读，由系统自动收集） -->
                <fieldset class="form-fieldset" id="execEnvFieldset">
                    <legend>执行环境 <small class="text-muted">(由系统自动收集)</small></legend>
                    
                    <div class="form-row">
                        <div class="form-group col-md-3">
                            <label for="osType">系统类型</label>
                            <input type="text" class="form-control" name="osType" id="osType" 
                                   value="${host.osType || host.os_type || ''}" readonly
                                   placeholder="如：Red Hat / CentOS / Ubuntu">
                        </div>
                        <div class="form-group col-md-2">
                            <label for="osVersion">系统版本</label>
                            <input type="text" class="form-control" name="osVersion" id="osVersion" 
                                   value="${host.osVersion || host.os_version || ''}" readonly
                                   placeholder="如：6.8 / 7.9 / 22.04">
                        </div>
                        <div class="form-group col-md-2">
                            <label for="kernelVersion">内核版本</label>
                            <input type="text" class="form-control" name="kernelVersion" id="kernelVersion" 
                                   value="${host.kernelVersion || host.kernel_version || ''}" readonly
                                   placeholder="如：2.6.32-642.el6.x86_64">
                        </div>
                        <div class="form-group col-md-2">
                            <label for="cpuInfo">CPU核数</label>
                            <input type="text" class="form-control" name="cpuInfo" id="cpuInfo" 
                                   value="${host.cpuInfo || host.cpu_info || ''}" readonly
                                   placeholder="如：8核">
                        </div>
                        <div class="form-group col-md-2">
                            <label for="memoryInfo">内存大小</label>
                            <input type="text" class="form-control" name="memoryInfo" id="memoryInfo" 
                                   value="${host.memoryInfo || host.memory_info || ''}" readonly
                                   placeholder="如：16Gi">
                        </div>
                        <div class="form-group col-md-1">
                            <label for="collectInfoBtn">信息采集</label>
                            <button type="button" class="btn btn-outline-info form-control" id="collectInfoBtn" style="height: calc(1.5em + 0.75rem + 2px); padding: 0.25rem 0.5rem; font-size: 0.875rem;">
                                ${Utils.icon('bar-chart', 12)} 收集
                            </button>
                        </div>
                    </div>
                </fieldset>
                

                
                <!-- 备注信息 -->
                <fieldset class="form-fieldset">
                    <legend>备注信息</legend>
                    
                    <div class="form-row">
                        <div class="form-group col-md-6">
                            <label for="description">描述</label>
                            <textarea class="form-control" name="description" id="description" 
                                      rows="3" placeholder="可选，主机描述信息">${host.description || ''}</textarea>
                        </div>
                        <div class="form-group col-md-6">
                            <label for="tags">标签</label>
                            <textarea class="form-control" name="tags" id="tags" 
                                      rows="3" placeholder="可选，用逗号分隔多个标签">${Array.isArray(host.tags) ? host.tags.join(', ') : (host.tags || '')}</textarea>
                        </div>
                    </div>
                </fieldset>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-light" id="cancelBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="testConnBtn">测试连接</button>
                    ${this.options.mode === 'add' ? '<button type="button" class="btn btn-info" id="continuousAddBtn" title="保存后保留当前表单，仅清空IP和主机名，方便连续录入">持续添加</button>' : ''}
                    <button type="submit" class="btn btn-success" id="saveBtn">
                        ${this.options.mode === 'add' ? '添加' : '保存'}
                    </button>
                </div>
            </form>
        `;
    }
    
    initForm() {
        const form = document.getElementById('hostForm');
        
        // 初始化表单验证
        this.validator = new FormValidator(form, {
            hostname: [
                (value) => value.trim() ? true : '主机名不能为空',
                (value) => value.length <= 50 ? true : '主机名长度不能超过50个字符'
            ],
            ip: [
                (value) => value.trim() ? true : 'IP地址不能为空',
                (value) => Utils.validators.isIP(value) ? true : 'IP地址格式不正确'
            ],
            username: [
                (value) => value.trim() ? true : '用户名不能为空',
                (value) => value.length <= 32 ? true : '用户名长度不能超过32个字符'
            ],
            port: [
                (value) => {
                    const port = parseInt(value);
                    return (port >= 1 && port <= 65535) ? true : '端口号必须在1-65535之间';
                }
            ]
        });
        
        // 绑定事件
        this.bindFormEvents(form);
    }
    
    bindFormEvents(form) {
        // 取消按钮
        form.querySelector('#cancelBtn').addEventListener('click', () => {
            this.modal.hide();
        });
        
        // 测试连接按钮
        form.querySelector('#testConnBtn').addEventListener('click', () => {
            this.testConnection();
        });
        
        // 收集系统信息按钮
        const collectInfoBtn = form.querySelector('#collectInfoBtn');
        if (collectInfoBtn) {
            collectInfoBtn.addEventListener('click', () => {
                this.collectSystemInfo();
            });
        }
        
        // 持续添加按钮
        const continuousAddBtn = form.querySelector('#continuousAddBtn');
        if (continuousAddBtn) {
            continuousAddBtn.addEventListener('click', () => {
                this.saveHostContinuous();
            });
        }
        
        // 密码显示/隐藏按钮
        const togglePasswordBtn = form.querySelector('#togglePasswordBtn');
        if (togglePasswordBtn) {
            togglePasswordBtn.addEventListener('click', () => {
                this.togglePasswordVisibility();
            });
        }
        
        // 密码输入框键盘快捷键
        const passwordInput = form.querySelector('#password');
        if (passwordInput) {
            passwordInput.addEventListener('keydown', (e) => {
                // Ctrl+Shift+H 切换密码显示状态
                if (e.ctrlKey && e.shiftKey && e.key === 'H') {
                    e.preventDefault();
                    this.togglePasswordVisibility();
                }
            });
        }
        
        // 录入模式切换（单台/批量）
        const entryModeTabs = form.querySelector('#entryModeTabs');
        if (entryModeTabs) {
            entryModeTabs.querySelectorAll('.entry-mode-tab').forEach(tab => {
                tab.addEventListener('click', () => this.switchEntryMode(tab.dataset.mode));
            });
        }
        
        // 批量 IP 实时统计
        const batchIpInput = form.querySelector('#batchIpInput');
        if (batchIpInput) {
            batchIpInput.addEventListener('input', () => this.updateBatchIpStats());
        }
        
        // 表单提交
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveHost();
        });
        
        // 实时验证
        const inputs = form.querySelectorAll('input[required]');
        inputs.forEach(input => {
            input.addEventListener('blur', () => {
                this.validateField(input.name);
            });
        });
    }
    
    validateField(fieldName) {
        const form = document.getElementById('hostForm');
        const field = form.querySelector(`[name="${fieldName}"]`);
        
        if (this.validator && this.validator.rules[fieldName]) {
            const value = field.value.trim();
            const rules = this.validator.rules[fieldName];
            
            // 清除之前的错误
            field.classList.remove('is-invalid');
            const errorEl = field.parentNode.querySelector('.error-message');
            if (errorEl) errorEl.remove();
            
            // 验证规则
            for (const rule of rules) {
                const result = rule(value, field);
                if (result !== true) {
                    field.classList.add('is-invalid');
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-message text-danger';
                    errorDiv.textContent = result;
                    field.parentNode.appendChild(errorDiv);
                    return false;
                }
            }
        }
        
        return true;
    }
    
    togglePasswordVisibility() {
        const passwordInput = document.getElementById('password');
        const toggleBtn = document.getElementById('togglePasswordBtn');
        const toggleIcon = toggleBtn.querySelector('.password-toggle-icon');
        
        if (passwordInput.type === 'password') {
            // 显示密码
            passwordInput.type = 'text';
            toggleIcon.innerHTML = Utils.icon('eye-off', 14); // 闭眼图标，表示可点击隐藏
            toggleBtn.title = '隐藏密码 (Ctrl+Shift+H)';
            toggleBtn.setAttribute('aria-label', '隐藏密码');
            
            // 添加视觉反馈
            passwordInput.style.backgroundColor = 'var(--status-warning-bg)';
            setTimeout(() => {
                passwordInput.style.backgroundColor = '';
            }, 200);
        } else {
            // 隐藏密码
            passwordInput.type = 'password';
            toggleIcon.innerHTML = Utils.icon('eye', 14); // 睁眼图标，表示可点击显示
            toggleBtn.title = '显示密码 (Ctrl+Shift+H)';
            toggleBtn.setAttribute('aria-label', '显示密码');
            
            // 添加视觉反馈
            passwordInput.style.backgroundColor = 'var(--status-healthy-bg)';
            setTimeout(() => {
                passwordInput.style.backgroundColor = '';
            }, 200);
        }
        
        // 短暂显示按钮反馈
        toggleBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            toggleBtn.style.transform = '';
        }, 100);
    }
    
    async testConnection() {
        if (!this.validator.validate()) {
            Utils.notify.warning('请先填写必填字段');
            return;
        }
        
        const form = document.getElementById('hostForm');
        const formData = new FormData(form);
        const hostData = {
            hostname: formData.get('hostname'),
            ip: formData.get('ip'),
            port: parseInt(formData.get('port')) || 22,
            username: formData.get('username'),
            password: formData.get('password'),
            privateKeyPath: formData.get('privateKeyPath')
        };
        
        const testBtn = form.querySelector('#testConnBtn');
        const originalText = testBtn.textContent;
        testBtn.disabled = true;
        testBtn.textContent = '测试中...';
        
        try {
            // 这里会调用真实的SSH连接测试
            const result = await window.hostService.testConnectionDirect(hostData);
            
            if (result.success) {
                Utils.notify.success('连接测试成功');
            } else {
                Utils.notify.error(`连接测试失败: ${result.message}`);
            }
        } catch (error) {
            Utils.notify.error(`连接测试出错: ${error.message}`);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = originalText;
        }
    }
    
    async collectSystemInfo() {
        const form = document.getElementById('hostForm');
        const formData = new FormData(form);
        
        // 获取连接信息
        const hostData = {
            hostname: (formData.get('hostname') || '').trim(),
            ip: (formData.get('ip') || '').trim(),
            port: parseInt(formData.get('port')) || 22,
            username: (formData.get('username') || '').trim(),
            password: formData.get('password') || '',
            privateKeyPath: (formData.get('privateKeyPath') || '').trim()
        };
        
        // 验证必要字段
        if (!hostData.hostname || !hostData.ip || !hostData.username) {
            Utils.notify.error('请先填写主机名、IP地址和用户名');
            return;
        }
        
        const collectBtn = form.querySelector('#collectInfoBtn');
        const originalText = collectBtn.textContent;
        collectBtn.disabled = true;
        collectBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 收集中...';
        
        try {
            let result;
            if (window.require) {
                // 在Electron环境中使用SSH服务收集信息
                const { ipcRenderer } = window.require('electron');
                result = await ipcRenderer.invoke('ssh-collect-host-info', hostData);
            } else {
                // 浏览器环境模拟
                result = {
                    success: false,
                    message: '系统信息收集功能需要在Electron环境中使用'
                };
            }
            
            if (result.success && result.data) {
                // 更新表单中的硬件信息字段
                this.updateHardwareFields(result.data);
                Utils.notify.success('系统信息收集成功');

                // 编辑模式下同步持久化到主机档案（system_info_json），
                // 保证「主机信息」弹窗与表单数据一致；新增模式主机未入库，仅回填表单
                if (this.options.mode === 'edit' && this.options.host && this.options.host.id) {
                    try {
                        await window.hostService.updateHostInfo(this.options.host.id, result.data);
                    } catch (syncError) {
                        console.warn('同步系统信息到主机档案失败:', syncError);
                    }
                }
            } else {
                Utils.notify.error(`收集系统信息失败: ${result.message}`);
            }
        } catch (error) {
            console.error('收集系统信息失败:', error);
            Utils.notify.error(`收集失败: ${error.message}`);
        } finally {
            collectBtn.disabled = false;
            collectBtn.innerHTML = `${Utils.icon('bar-chart', 12)} 收集系统信息`;
        }
    }
    
    updateHardwareFields(systemInfo) {
        try {
            let osType = '';
            let osVersion = '';
            let kernelVersion = '';
            let cpuInfo = '';
            let memoryInfo = '';
    
            // 新格式字段
            if (systemInfo.osType)    osType       = systemInfo.osType;
            if (systemInfo.osVersion) osVersion    = systemInfo.osVersion;
            if (systemInfo.kernelVer) kernelVersion = systemInfo.kernelVer;
            if (systemInfo.cpuCores)  cpuInfo      = `${systemInfo.cpuCores}核`;
            if (systemInfo.memTotal)  memoryInfo   = systemInfo.memTotal;
    
            // 兼容旧格式字段
            if (!cpuInfo && systemInfo.cpu)           cpuInfo   = systemInfo.cpu;
            if (!memoryInfo && systemInfo.totalMemory) memoryInfo = systemInfo.totalMemory;
            if (!osType && systemInfo.osName)         osType    = systemInfo.osName.replace(/\s+\d+.*$/, '').trim();
            if (!osType && systemInfo.distribution)   osType    = systemInfo.distribution;
    
            // 更新表单字段
            const fields = [
                { id: 'osType',        value: osType },
                { id: 'osVersion',     value: osVersion },
                { id: 'kernelVersion', value: kernelVersion },
                { id: 'cpuInfo',       value: cpuInfo },
                { id: 'memoryInfo',    value: memoryInfo }
            ];
    
            fields.forEach(({ id, value }) => {
                const el = document.getElementById(id);
                if (el && value) {
                    el.value = value;
                    el.style.backgroundColor = 'var(--status-healthy-bg)';
                    setTimeout(() => el.style.backgroundColor = '', 2000);
                }
            });
    
        } catch (error) {
            console.error('更新执行环境信息字段失败:', error);
        }
    }
    
    async saveHost() {
        // 批量录入模式走独立的提交逻辑
        if (this.entryMode === 'batch') {
            return this.saveHostBatch();
        }
        
        if (!this.validator.validate()) {
            return;
        }
        
        const form = document.getElementById('hostForm');
        const formData = new FormData(form);
        
        const hostData = {
            hostname: (formData.get('hostname') || '').trim(),
            systemName: (formData.get('systemName') || '').trim(),         // 系统名称
            appName: (formData.get('appName') || '').trim(),               // 应用名称
            ip: (formData.get('ip') || '').trim(),
            port: parseInt(formData.get('port')) || 22,
            username: (formData.get('username') || '').trim(),
            password: formData.get('password') || '',
            privateKeyPath: (formData.get('privateKeyPath') || '').trim(),
            description: (formData.get('description') || '').trim(),
            tags: formData.get('tags') ? formData.get('tags').split(',').map(tag => tag.trim()).filter(tag => tag) : [], // 标签字段
            
            // 环境和位置信息
            datacenter: formData.get('datacenter') || '',
            environment: formData.get('environment') || '',
            owner: (formData.get('owner') || '').trim(),
            
            // 执行环境信息（从表单中获取，包括收集到的数据）
            cpuInfo: formData.get('cpuInfo') || '',
            memoryInfo: formData.get('memoryInfo') || '',
            kernelVersion: formData.get('kernelVersion') || '',
            osType: formData.get('osType') || '',
            osVersion: formData.get('osVersion') || ''
        };
        
        console.log('准备保存主机数据:', hostData);
        
        const saveBtn = form.querySelector('#saveBtn');
        const originalText = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
        
        try {
            let result;
            if (this.options.mode === 'add') {
                result = await window.hostService.addHost(hostData);
            } else {
                result = await window.hostService.updateHost(this.options.host.id, hostData);
            }
            
            Utils.notify.success(this.options.mode === 'add' ? '主机添加成功' : '主机更新成功');
            
            if (this.options.onSave) {
                this.options.onSave(result);
            }
            
            this.modal.hide();
        } catch (error) {
            console.error('保存主机失败:', error);
            Utils.notify.error(`保存失败: ${error.message}`);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    }

    // 持续添加：保存成功后只清空 IP 和主机名，其余字段保留，方便快速录入下一台
    async saveHostContinuous() {
        if (!this.validator.validate()) {
            return;
        }

        const form = document.getElementById('hostForm');
        const formData = new FormData(form);

        const hostData = {
            hostname: (formData.get('hostname') || '').trim(),
            systemName: (formData.get('systemName') || '').trim(),
            appName: (formData.get('appName') || '').trim(),
            ip: (formData.get('ip') || '').trim(),
            port: parseInt(formData.get('port')) || 22,
            username: (formData.get('username') || '').trim(),
            password: formData.get('password') || '',
            privateKeyPath: (formData.get('privateKeyPath') || '').trim(),
            description: (formData.get('description') || '').trim(),
            tags: formData.get('tags') ? formData.get('tags').split(',').map(tag => tag.trim()).filter(tag => tag) : [],
            datacenter: formData.get('datacenter') || '',
            environment: formData.get('environment') || '',
            owner: (formData.get('owner') || '').trim(),
            cpuInfo: formData.get('cpuInfo') || '',
            memoryInfo: formData.get('memoryInfo') || '',
            kernelVersion: formData.get('kernelVersion') || '',
            osType: formData.get('osType') || '',
            osVersion: formData.get('osVersion') || ''
        };

        const continuousBtn = form.querySelector('#continuousAddBtn');
        const originalText = continuousBtn.textContent;
        continuousBtn.disabled = true;
        continuousBtn.textContent = '保存中...';

        try {
            await window.hostService.addHost(hostData);
            Utils.notify.success(`主机 ${hostData.hostname}（${hostData.ip}）添加成功，请继续录入下一台`);

            if (this.options.onSave) {
                this.options.onSave();
            }

            // 清空主机名和 IP，清除验证状态
            const hostnameInput = form.querySelector('#hostname');
            const ipInput = form.querySelector('#ip');
            hostnameInput.value = '';
            ipInput.value = '';
            hostnameInput.classList.remove('is-invalid', 'is-valid');
            ipInput.classList.remove('is-invalid', 'is-valid');
            const hostnameErr = hostnameInput.parentNode.querySelector('.error-message');
            if (hostnameErr) hostnameErr.remove();
            const ipErr = ipInput.parentNode.querySelector('.error-message');
            if (ipErr) ipErr.remove();

            // 自动聚焦到 IP 输入框
            ipInput.focus();
        } catch (error) {
            console.error('持续添加主机失败:', error);
            Utils.notify.error(`保存失败: ${error.message}`);
        } finally {
            continuousBtn.disabled = false;
            continuousBtn.textContent = originalText;
        }
    }
    
    // 切换录入模式（单台/批量，仅 add 模式）
    switchEntryMode(mode) {
        if (this.options.mode !== 'add' || mode === this.entryMode) return;
        this.entryMode = mode;
        
        const form = document.getElementById('hostForm');
        if (!form) return;
        
        form.querySelectorAll('.entry-mode-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });
        
        const isBatch = mode === 'batch';
        form.querySelector('#hostnameField').style.display = isBatch ? 'none' : '';
        form.querySelector('#ipField').style.display = isBatch ? 'none' : '';
        form.querySelector('#batchEntrySection').style.display = isBatch ? '' : 'none';
        
        // 隐藏的 hostname/ip 带 required 会触发浏览器原生验证拦截提交，需同步移除/恢复
        form.querySelector('#hostname').required = !isBatch;
        form.querySelector('#ip').required = !isBatch;
        
        // 依赖单台 IP 的功能在批量模式下隐藏
        const execEnvFieldset = form.querySelector('#execEnvFieldset');
        if (execEnvFieldset) execEnvFieldset.style.display = isBatch ? 'none' : '';
        const testConnBtn = form.querySelector('#testConnBtn');
        if (testConnBtn) testConnBtn.style.display = isBatch ? 'none' : '';
        const continuousAddBtn = form.querySelector('#continuousAddBtn');
        if (continuousAddBtn) continuousAddBtn.style.display = isBatch ? 'none' : '';
        
        form.querySelector('#saveBtn').textContent = isBatch ? '批量添加' : '添加';
        
        // 清除残留的验证错误提示
        if (this.validator) this.validator.clearErrors();
        
        // 清理上次的批量结果摘要
        const resultEl = form.querySelector('#batchResult');
        if (resultEl) resultEl.remove();
        
        if (isBatch) {
            this.updateBatchIpStats();
            const input = form.querySelector('#batchIpInput');
            if (input) input.focus();
        }
    }
    
    // 解析批量 IP 输入（分隔符与批量IP搜索弹窗保持一致）
    parseBatchIps(text) {
        const tokens = text.split(/[,，;；\/\s|]+/).map(s => s.trim()).filter(Boolean);
        const seen = new Set();
        const uniqueIPs = [];
        const invalidTokens = [];
        let dupCount = 0;
        
        tokens.forEach(token => {
            if (Utils.validators.isIP(token)) {
                if (seen.has(token)) {
                    dupCount++;
                } else {
                    seen.add(token);
                    uniqueIPs.push(token);
                }
            } else {
                invalidTokens.push(token);
            }
        });
        
        return { uniqueIPs, dupCount, invalidTokens };
    }
    
    // 批量 IP 实时识别统计
    updateBatchIpStats() {
        const form = document.getElementById('hostForm');
        const statsEl = form.querySelector('#batchIpStats');
        const textarea = form.querySelector('#batchIpInput');
        if (!statsEl || !textarea) return;
        
        const text = textarea.value.trim();
        if (!text) {
            statsEl.innerHTML = '<span style="color: var(--text-faint);">粘贴或输入 IP 后，此处实时显示识别结果</span>';
            return;
        }
        
        const { uniqueIPs, dupCount, invalidTokens } = this.parseBatchIps(text);
        if (uniqueIPs.length === 0 && invalidTokens.length === 0) {
            statsEl.innerHTML = '<span style="color: var(--text-faint);">粘贴或输入 IP 后，此处实时显示识别结果</span>';
            return;
        }
        
        // 对照已有主机判断“已存在”（IP + 端口 + 用户名相同）
        const port = parseInt(form.querySelector('[name="port"]').value) || 22;
        const username = (form.querySelector('[name="username"]').value || '').trim();
        const existingIPs = (window.hostService && username)
            ? window.hostService.hosts.filter(h => h.port === port && h.username === username).map(h => h.ip)
            : [];
        const existingSet = new Set(existingIPs);
        const existingCount = uniqueIPs.filter(ip => existingSet.has(ip)).length;
        
        const parts = [];
        if (uniqueIPs.length > 0) {
            parts.push(`<span style="color: var(--status-healthy-fg);">有效 <strong>${uniqueIPs.length}</strong></span>`);
        }
        if (dupCount > 0) {
            parts.push(`<span style="color: var(--status-warning-fg);">批内重复 ${dupCount}（自动去重）</span>`);
        }
        if (existingCount > 0) {
            parts.push(`<span style="color: var(--status-warning-fg);">已存在 ${existingCount}（提交时自动跳过）</span>`);
        }
        if (invalidTokens.length > 0) {
            const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            const shown = invalidTokens.slice(0, 5).map(esc).join('、');
            parts.push(`<span style="color: var(--status-critical-fg);">无效 ${invalidTokens.length}: ${shown}${invalidTokens.length > 5 ? ' 等' : ''}</span>`);
        }
        statsEl.innerHTML = parts.join('<span class="batch-ip-stats-sep">·</span>') || '<span style="color: var(--text-faint);">未识别到有效 IP</span>';
    }
    
    // 批量录入提交
    async saveHostBatch() {
        const form = document.getElementById('hostForm');
        const formData = new FormData(form);
        
        // 校验共享必填字段
        if (!this.validateField('username') || !this.validateField('port')) {
            Utils.notify.warning('请先填写正确的用户名和端口');
            return;
        }
        
        const textarea = form.querySelector('#batchIpInput');
        const text = textarea.value.trim();
        if (!text) {
            Utils.notify.warning('请输入至少一个 IP 地址');
            textarea.focus();
            return;
        }
        
        const { uniqueIPs, invalidTokens } = this.parseBatchIps(text);
        if (uniqueIPs.length === 0) {
            Utils.notify.error('未识别到有效的 IP 地址');
            textarea.focus();
            return;
        }
        if (invalidTokens.length > 0) {
            const shown = invalidTokens.slice(0, 5).join('、');
            Utils.notify.error(`存在 ${invalidTokens.length} 项无效内容：${shown}${invalidTokens.length > 5 ? ' 等' : ''}，请修正后重试`);
            return;
        }
        
        // 已存在 IP 客户端预过滤（服务端 skipExisting 兑底）
        const port = parseInt(formData.get('port')) || 22;
        const username = (formData.get('username') || '').trim();
        const existingSet = new Set(
            (window.hostService ? window.hostService.hosts : [])
                .filter(h => h.port === port && h.username === username)
                .map(h => h.ip)
        );
        const toAdd = uniqueIPs.filter(ip => !existingSet.has(ip));
        const preSkipped = uniqueIPs.filter(ip => existingSet.has(ip)).map(ip => ({ ip, reason: '主机已存在' }));
        
        if (toAdd.length === 0) {
            Utils.notify.warning('所有 IP 均已存在，无需重复添加');
            return;
        }
        
        const fields = {
            hostnamePrefix: (formData.get('hostnamePrefix') || '').trim(),
            port: port,
            username: username,
            password: formData.get('password') || '',
            privateKeyPath: (formData.get('privateKeyPath') || '').trim(),
            systemName: (formData.get('systemName') || '').trim(),
            appName: (formData.get('appName') || '').trim(),
            datacenter: formData.get('datacenter') || '',
            environment: formData.get('environment') || '',
            owner: (formData.get('owner') || '').trim(),
            description: (formData.get('description') || '').trim(),
            tags: formData.get('tags') ? formData.get('tags').split(',').map(t => t.trim()).filter(Boolean) : []
        };
        
        const saveBtn = form.querySelector('#saveBtn');
        const originalText = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = '批量添加中...';
        
        try {
            const results = await window.hostService.batchAddHosts(fields, toAdd);
            const skipped = [...preSkipped, ...(results.skipped || [])];
            
            if (results.added > 0 && this.options.onSave) {
                this.options.onSave();
            }
            
            const hasErrors = results.errors && results.errors.length > 0;
            if (!hasErrors) {
                const skipMsg = skipped.length > 0 ? `，跳过 ${skipped.length} 台（已存在）` : '';
                Utils.notify.success(`批量添加成功：新增 ${results.added} 台主机${skipMsg}`);
                this.modal.hide();
            } else {
                // 存在失败项：保留模态框展示结果摘要，便于修正后重试
                this.renderBatchResult(results, skipped);
                Utils.notify.warning(`批量添加部分失败：新增 ${results.added} 台，失败 ${results.errors.length} 项`);
            }
        } catch (error) {
            console.error('批量添加主机失败:', error);
            Utils.notify.error(`批量添加失败: ${error.message}`);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    }
    
    // 批量录入结果摘要（存在失败项时展示在表单内）
    renderBatchResult(results, skipped) {
        const form = document.getElementById('hostForm');
        
        let resultEl = form.querySelector('#batchResult');
        if (!resultEl) {
            resultEl = document.createElement('div');
            resultEl.id = 'batchResult';
            resultEl.className = 'batch-result';
            const actions = form.querySelector('.form-actions');
            form.insertBefore(resultEl, actions);
        }
        
        const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        
        resultEl.innerHTML = `
            <div class="batch-result-item batch-result-success">${Utils.icon('check', 12)} 成功新增 ${results.added} 台</div>
            ${skipped.length > 0 ? `<div class="batch-result-item batch-result-skip">${Utils.icon('skip-forward', 12)} 跳过 ${skipped.length} 台（已存在）: ${skipped.map(s => escapeHtml(s.ip)).join('、')}</div>` : ''}
            ${(results.errors || []).length > 0 ? `<div class="batch-result-item batch-result-error">${Utils.icon('x', 12)} 失败 ${results.errors.length} 项:<br>${results.errors.map(e => escapeHtml(e)).join('<br>')}</div>` : ''}
        `;
    }
}

// Excel导入组件
class ExcelImportDialog {
    constructor(options = {}) {
        this.options = {
            onImport: null,
            ...options
        };
        this.modal = null;
        this.excelData = null;
    }
    
    show() {
        this.modal = new Modal({
            title: 'Excel批量导入主机',
            content: this.createImportForm(),
            width: '700px',
            onShow: () => this.initImportForm()
        });
        
        this.modal.show();
    }
    
    createImportForm() {
        return `
            <div class="csv-import-form">
                <div class="import-section">
                    <h5>1. 选择Excel文件</h5>
                    <div class="file-input-group">
                        <input type="file" class="form-control-file" id="excelFile" accept=".xlsx,.xls" style="display: none;">
                        <div class="input-group">
                            <input type="text" class="form-control" id="excelFileName" placeholder="请选择Excel文件" readonly>
                            <div class="input-group-append">
                                <button class="btn btn-outline-primary" type="button" id="selectFileBtn">选择文件</button>
                                <button class="btn btn-outline-success" type="button" id="downloadTemplateBtn" title="下载导入模板">下载模板</button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="mt-3">
                        <small class="text-muted">
                            <strong>Excel文件格式：</strong><br>
                            • 第一行为表头：IP地址,端口,用户名,密码,描述,环境,系统名称,应用名称,机房,负责人<br>
                            • ${Utils.icon('info', 11)} 首次导入？点击「下载模板」获取标准格式文件<br>
                            <br>
                            <strong style="color: var(--status-info-fg);">${Utils.icon('clipboard', 11)} 导入逻辑说明：</strong><br>
                            • <strong>智能识别</strong>：根据 IP地址+端口+用户名 判断主机是否已存在<br>
                            • <strong>已存在</strong>：自动更新密码、描述、环境等信息<br>
                            • <strong>不存在</strong>：新增主机记录<br>
                            • 可用于批量修改密码或其他字段信息
                        </small>
                    </div>
                </div>
                
                <div class="import-section" id="previewSection" style="display: none;">
                    <h5>2. 数据预览</h5>
                    <div class="table-responsive">
                        <table class="table table-sm" id="previewTable">
                            <thead></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                    <div class="import-summary" id="importSummary"></div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelImportBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="importBtn" disabled>开始导入</button>
                </div>
            </div>
        `;
    }
    
    initImportForm() {
        const selectBtn = document.getElementById('selectFileBtn');
        const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
        const fileInput = document.getElementById('excelFile');
        const fileNameInput = document.getElementById('excelFileName');
        const cancelBtn = document.getElementById('cancelImportBtn');
        const importBtn = document.getElementById('importBtn');
        
        selectBtn.addEventListener('click', () => fileInput.click());
        downloadTemplateBtn.addEventListener('click', () => this.downloadTemplate());
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                fileNameInput.value = file.name;
                this.parseExcelFile(file);
            }
        });
        
        cancelBtn.addEventListener('click', () => this.modal.hide());
        importBtn.addEventListener('click', () => this.performImport());
    }
    
    downloadTemplate() {
        try {
            const XLSX = require('xlsx');
            
            // 创建模板数据
            const templateData = [
                // 表头
                ['IP地址', '端口', '用户名', '密码', '描述', '环境', '系统名称', '应用名称', '机房', '负责人'],
                // 示例数据
                ['127.0.0.1', '22', 'root', '123456', '测试', '灰度', 'xxx子系统', '应用1', '机房1', '张三']
            ];
            
            // 创建工作表
            const worksheet = XLSX.utils.aoa_to_sheet(templateData);
            
            // 设置列宽
            const colWidths = [
                { wch: 15 },  // IP地址
                { wch: 8 },   // 端口
                { wch: 12 },  // 用户名
                { wch: 12 },  // 密码
                { wch: 20 },  // 描述
                { wch: 10 },  // 环境
                { wch: 20 },  // 系统名称
                { wch: 15 },  // 应用名称
                { wch: 12 },  // 机房
                { wch: 12 }   // 负责人
            ];
            worksheet['!cols'] = colWidths;
            
            // 创建工作簿
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '主机导入模板');
            
            // 生成Excel文件
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            // 下载文件
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'SSH主机导入模板.xlsx';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            Utils.notify.success('模板文件已下载');
        } catch (error) {
            console.error('下载模板失败:', error);
            Utils.notify.error(`下载模板失败: ${error.message}`);
        }
    }
    
    async parseExcelFile(file) {
        try {
            const arrayBuffer = await this.readFileAsArrayBuffer(file);
            const XLSX = require('xlsx');
            
            // 解析Excel文件
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            
            // 获取第一个工作表
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // 转换为JSON数据
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (jsonData.length < 2) {
                throw new Error('Excel文件至少需要包含表头和一行数据');
            }
            
            // 获取表头和数据行
            const headers = jsonData[0].map(h => String(h || '').trim());
            const rows = jsonData.slice(1).filter(row => row && row.length > 0);
            
            // 映射表头
            const headerMap = this.mapHeaders(headers);
            
            // 转换数据
            this.excelData = rows.map(row => {
                const hostData = {};
                Object.keys(headerMap).forEach(key => {
                    const index = headerMap[key];
                    const value = index !== -1 && row[index] !== undefined ? String(row[index]).trim() : '';
                    hostData[key] = value;
                });
                return hostData;
            }).filter(host => host.ip); // 过滤空行（至少需要IP地址）
            
            this.showPreview(headers, this.excelData);
            
        } catch (error) {
            console.error('解析Excel文件失败:', error);
            Utils.notify.error(`解析Excel文件失败: ${error.message}`);
        }
    }
    
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsArrayBuffer(file);
        });
    }
    
    mapHeaders(headers) {
        const mapping = {
            ip: -1,
            port: -1,
            username: -1,
            password: -1,
            description: -1,
            environment: -1,
            system_name: -1,
            app_name: -1,
            datacenter: -1,
            owner: -1
        };
        
        headers.forEach((header, index) => {
            const normalizedHeader = header.toLowerCase().trim();
            
            // 英文表头映射
            if (normalizedHeader === 'ip') mapping.ip = index;
            else if (normalizedHeader === 'port') mapping.port = index;
            else if (normalizedHeader === 'username') mapping.username = index;
            else if (normalizedHeader === 'password') mapping.password = index;
            else if (normalizedHeader === 'description') mapping.description = index;
            else if (normalizedHeader === 'environment') mapping.environment = index;
            else if (normalizedHeader === 'system_name') mapping.system_name = index;
            else if (normalizedHeader === 'app_name') mapping.app_name = index;
            else if (normalizedHeader === 'datacenter') mapping.datacenter = index;
            else if (normalizedHeader === 'owner') mapping.owner = index;
            
            // 中文表头映射
            else if (normalizedHeader === 'ip地址') mapping.ip = index;
            else if (normalizedHeader === '端口') mapping.port = index;
            else if (normalizedHeader === '用户名') mapping.username = index;
            else if (normalizedHeader === '密码') mapping.password = index;
            else if (normalizedHeader === '描述') mapping.description = index;
            else if (normalizedHeader === '环境') mapping.environment = index;
            else if (normalizedHeader === '系统名称') mapping.system_name = index;
            else if (normalizedHeader === '应用名称') mapping.app_name = index;
            else if (normalizedHeader === '机房') mapping.datacenter = index;
            else if (normalizedHeader === '负责人') mapping.owner = index;
        });
        
        return mapping;
    }
    
    validateImportData(data) {
        const valid = [];
        const invalid = [];
        
        data.forEach((item, index) => {
            const errors = [];
            const lineNumber = index + 2;
            
            // 必填字段验证
            if (!item.ip || !item.ip.trim()) {
                errors.push('IP地址不能为空');
            } else if (!Utils.validators.isIP(item.ip.trim())) {
                errors.push('IP地址格式不正确');
            }
            if (!item.username || !item.username.trim()) {
                errors.push('用户名不能为空');
            }
            if (!item.password || !item.password.trim()) {
                errors.push('密码不能为空');
            }
            
            // 端口号验证
            if (item.port) {
                const port = parseInt(item.port);
                if (isNaN(port) || port < 1 || port > 65535) {
                    errors.push('端口号必须在1-65535之间');
                }
            }
            
            if (errors.length > 0) {
                invalid.push({ ...item, lineNumber, errors });
            } else {
                // 数据清理，并将字段名转换为 addHost 接受的格式
                const cleanedItem = {
                    // 自动生成 hostname（使用IP地址作为默认主机名）
                    hostname: item.ip.trim(),
                    ip: item.ip.trim(),
                    port: parseInt(item.port) || 22,
                    username: item.username.trim(),
                    password: item.password.trim(),
                    description: item.description ? item.description.trim() : '',
                    environment: item.environment ? item.environment.trim() : '',
                    // 转换为驼峰式命名
                    systemName: item.system_name ? item.system_name.trim() : '',
                    appName: item.app_name ? item.app_name.trim() : '',
                    datacenter: item.datacenter ? item.datacenter.trim() : '',
                    owner: item.owner ? item.owner.trim() : '',
                    lineNumber
                };
                valid.push(cleanedItem);
            }
        });
        
        return { valid, invalid };
    }
    
    async importDataWithProgress(validData) {
        const { valid, invalid } = validData;
        
        // 直接调用 hostService.importFromExcel 方法
        const progressBar = document.querySelector('.import-progress-bar');
        const progressText = document.querySelector('.import-progress-text');
        
        if (progressText) progressText.textContent = `正在导入 ${valid.length} 条记录...`;
        if (progressBar) progressBar.style.width = '50%';
        
        // 使用优化后的导入方法
        const results = await window.hostService.importFromExcel(valid);
        
        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = `导入完成！`;
        
        // 返回结果，并补充 skipped 字段
        return {
            ...results,
            skipped: invalid.length
        };
    }
    
    createProgressBar() {
        const container = document.createElement('div');
        container.className = 'import-progress-container mt-3';
        container.innerHTML = `
            <div class="import-progress-text">准备导入...</div>
            <div class="progress" style="height: 8px; margin-top: 8px;">
                <div class="import-progress-bar progress-bar" style="width: 0%; background-color: var(--primary);"></div>
            </div>
        `;
        return container;
    }
    
    showImportResult(result) {
        const { added = 0, updated = 0, imported = 0, skipped = 0, errors = [] } = result;
        
        // 计算失败数（从 errors 数组长度获取）
        const failed = errors.length;
        
        // 兼容旧版本的 imported 字段
        const totalSuccess = added + updated || imported;
        
        let resultClass = 'success';
        if (failed > 0) resultClass = 'warning';
        if (totalSuccess === 0) resultClass = 'error';
        
        // 构建消息
        let message = '导入完成！';
        if (added > 0 || updated > 0) {
            const parts = [];
            if (added > 0) parts.push(`新增 ${added} 台`);
            if (updated > 0) parts.push(`更新 ${updated} 台`);
            message += parts.join('、');
        } else if (imported > 0) {
            message += `成功: ${imported}`;
        }
        
        if (failed > 0) message += `、失败: ${failed}`;
        if (skipped > 0) message += `、跳过: ${skipped}`;
        
        if (resultClass === 'error') {
            Utils.notify.error(message);
        } else if (resultClass === 'warning') {
            Utils.notify.warning(message);
        } else {
            Utils.notify.success(message);
        }
        
        // 如果有错误，显示详情
        if (errors.length > 0) {
            console.warn('导入错误详情:', errors);
        }
        
        // 触发回调刷新页面数据
        if (this.options.onImport) {
            this.options.onImport(result);
        }
        
        // 导入完成后自动关闭对话框
        setTimeout(() => this.modal.hide(), 1500);
    }
    
    showPreview(headers, data) {
        const previewSection = document.getElementById('previewSection');
        const previewTable = document.getElementById('previewTable');
        const importSummary = document.getElementById('importSummary');
        const importBtn = document.getElementById('importBtn');
        
        // 显示预览表头
        const thead = previewTable.querySelector('thead');
        thead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
        
        // 显示预览数据（最多显示5行）
        const tbody = previewTable.querySelector('tbody');
        const previewData = data.slice(0, 5);
        tbody.innerHTML = previewData.map(row => 
            `<tr>${headers.map((_, i) => `<td>${row[Object.keys(row)[i]] || ''}</td>`).join('')}</tr>`
        ).join('');
        
        // 显示导入摘要
        const validCount = data.filter(host => host.ip && host.username).length;
        const invalidCount = data.length - validCount;
        
        importSummary.innerHTML = `
            <div class="alert ${invalidCount > 0 ? 'alert-warning' : 'alert-info'}">
                <strong>导入摘要:</strong><br>
                总记录数: ${data.length}<br>
                有效记录: ${validCount}<br>
                无效记录: ${invalidCount}
                ${invalidCount > 0 ? '<br><small>无效记录将被跳过（缺少必填字段：IP地址、用户名）</small>' : ''}
            </div>
        `;
        
        previewSection.style.display = 'block';
        importBtn.disabled = validCount === 0;
    }
    
    async performImport() {
        if (!this.excelData || this.excelData.length === 0) {
            Utils.notify.warning('没有可导入的数据');
            return;
        }
        
        const importBtn = document.getElementById('importBtn');
        const cancelBtn = document.getElementById('cancelImportBtn');
        const originalText = importBtn.textContent;
        
        importBtn.disabled = true;
        cancelBtn.disabled = true;
        importBtn.textContent = '导入中...';
        
        // 显示进度条
        const progressContainer = this.createProgressBar();
        document.getElementById('importSummary').appendChild(progressContainer);
        
        try {
            // 数据预处理和验证
            const validData = this.validateImportData(this.excelData);
            
            if (validData.valid.length === 0) {
                throw new Error('没有有效的数据可以导入');
            }
            
            // 导入数据
            const result = await this.importDataWithProgress(validData);
            
            // 显示结果
            this.showImportResult(result);
            
        } catch (error) {
            console.error('导入失败:', error);
            Utils.notify.error(`导入失败: ${error.message}`);
        } finally {
            importBtn.disabled = false;
            cancelBtn.disabled = false;
            importBtn.textContent = originalText;
            
            // 移除进度条
            if (progressContainer.parentNode) {
                progressContainer.parentNode.removeChild(progressContainer);
            }
        }
    }
}

// 主机信息查看组件
class HostInfoDialog {
    constructor(options = {}) {
        this.options = {
            host: null,
            onCollect: null,
            ...options
        };
        this.modal = null;
    }
    
    show() {
        this.modal = new Modal({
            title: `主机信息 - ${this.options.host.hostname || this.options.host.ip}`,
            content: this.createInfoView(),
            width: '800px',
            onShow: () => this.initInfoView()
        });
        
        this.modal.show();
    }
    
    createInfoView() {
        const host = this.options.host;
        const systemInfo = host.systemInfo || {};
        
        return `
            <div class="host-info-dialog">
                <div class="info-actions">
                    <button type="button" class="btn btn-primary" id="collectInfoBtn">
                        <span class="btn-icon">${Utils.icon('refresh-cw', 13)}</span> 收集执行环境信息
                    </button>
                    <button type="button" class="btn btn-secondary" id="refreshInfoBtn">
                        <span class="btn-icon">${Utils.icon('refresh-cw', 13)}</span> 刷新
                    </button>
                </div>
                
                <div class="info-content" id="infoContent">
                    ${this.renderSystemInfo(systemInfo)}
                </div>
            </div>
        `;
    }
    
    renderSystemInfo(systemInfo) {
        if (!systemInfo || Object.keys(systemInfo).length === 0) {
            return `
                <div class="info-empty">
                    <p>暂无执行环境信息</p>
                    <p class="text-muted">点击“收集执行环境信息”按鈕获取该主机的环境详情</p>
                </div>
            `;
        }
    
        const row = (label, value) => value
            ? `<div class="info-item"><label>${label}:</label><span>${value}</span></div>`
            : '';
    
        return `
            <div class="system-info-layout">
                <!-- 执行环境（核心信息） -->
                <div class="info-section">
                    <h6 class="info-section-title">执行环境</h6>
                    <div class="info-grid">
                        ${row('系统类型', systemInfo.osType  || '')}
                        ${row('系统版本', systemInfo.osVersion || '')}
                        ${row('内核版本', systemInfo.kernelVer || systemInfo.kernelVersion || '')}
                        ${row('CPU架构',  systemInfo.osArch  || '')}
                        ${row('CPU核数', systemInfo.cpuCores ? `${systemInfo.cpuCores}核` : '')}
                        ${row('内存大小', systemInfo.memTotal || systemInfo.totalMemory || '')}
                    </div>
                </div>
    
                <!-- 系统详情（辅助信息） -->
                <div class="info-section">
                    <h6 class="info-section-title">系统详情</h6>
                    ${this.renderDetailsSection(systemInfo)}
                </div>
            </div>
        `;
    }

    renderDetailsSection(systemInfo) {
        const row = (label, value) => value
            ? `<div class="info-item"><label>${label}:</label><span>${value}</span></div>`
            : '';

        const lastCollected = systemInfo.lastCollected || (this.options.host && this.options.host.lastInfoCollectedAt) || '';
        const rows = row('根分区可用', systemInfo.diskFree || '')
            + row('采集时间', lastCollected ? Utils.formatters.date(lastCollected) : '');

        if (!rows) {
            return '<p class="text-muted" style="padding: 4px 0;">暂无详情数据，请重新收集执行环境信息</p>';
        }
        return `<div class="info-grid">${rows}</div>`;
    }
    
    initInfoView() {
        const collectBtn = document.getElementById('collectInfoBtn');
        const refreshBtn = document.getElementById('refreshInfoBtn');
        
        collectBtn.addEventListener('click', () => this.collectInfo());
        refreshBtn.addEventListener('click', () => this.refreshInfo());
    }
    
    async collectInfo() {
        const collectBtn = document.getElementById('collectInfoBtn');
        const originalText = collectBtn.innerHTML;
        
        try {
            collectBtn.disabled = true;
            collectBtn.innerHTML = '<span class="loading"></span> 收集中...';
            
            const result = await window.hostService.collectHostInfo(this.options.host.id);
            
            if (result.success) {
                Utils.notify.success('系统信息收集成功');
                this.refreshInfo();
                
                if (this.options.onCollect) {
                    this.options.onCollect(result.data);
                }
            } else {
                Utils.notify.error(`收集失败: ${result.message}`);
            }
        } catch (error) {
            Utils.notify.error(`收集失败: ${error.message}`);
        } finally {
            collectBtn.disabled = false;
            collectBtn.innerHTML = originalText;
        }
    }
    
    async refreshInfo() {
        try {
            // 重新获取主机信息
            const updatedHost = await window.hostService.getHostById(this.options.host.id);
            if (updatedHost) {
                this.options.host = updatedHost;
                const infoContent = document.getElementById('infoContent');
                infoContent.innerHTML = this.renderSystemInfo(updatedHost.systemInfo || {});
            }
        } catch (error) {
            console.error('刷新主机信息失败:', error);
        }
    }
}
// Excel导出组件
class ExcelExportDialog {
    constructor(options = {}) {
        this.options = {
            hosts: [],
            ...options
        };
        this.modal = null;
        this.selectedFields = {
            ip: true,
            port: true,
            username: true,
            password: true,
            description: true,
            environment: true,
            system_name: false,
            app_name: false,
            datacenter: false,
            owner: false,
            // 执行环境字段（默认不勾选）
            os_type: false,
            os_version: false,
            kernel_version: false,
            cpu_info: false,
            memory_info: false
        };
    }
    
    show() {
        this.modal = new Modal({
            title: 'Excel导出设置',
            content: this.createExportForm(),
            width: '1000px',
            onShow: () => this.initExportForm()
        });
        
        this.modal.show();
    }
    
    createExportForm() {
        return `
            <div class="csv-export-form">
                <div class="export-section">
                    <h5>选择导出字段</h5>
                    <div class="field-selection">
                        <label class="field-checkbox">
                            <input type="checkbox" name="ip" checked> IP地址
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="port" checked> 端口
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="username" checked> 用户名
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="password" checked> 密码
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="description" checked> 描述
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="environment" checked> 环境
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="system_name"> 系统名称
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="app_name"> 应用名称
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="datacenter"> 机房
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="owner"> 负责人
                        </label>
                    </div>
                </div>

                <div class="export-section">
                    <h5>执行环境 <small class="text-muted">(采集后可导出)</small></h5>
                    <div class="field-selection">
                        <label class="field-checkbox">
                            <input type="checkbox" name="os_type"> 系统类型
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="os_version"> 系统版本
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="kernel_version"> 内核版本
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="cpu_info"> CPU核数
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="memory_info"> 内存大小
                        </label>
                    </div>
                </div>
                
                <div class="export-section">
                    <h5>导出选项</h5>
                    <div class="export-options">
                        <label class="field-checkbox">
                            <input type="checkbox" id="includeHeaders" checked> 包含表头
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" id="selectedOnly"> 仅导出已选中的主机
                        </label>
                    </div>
                </div>
                
                <div class="export-section">
                    <h5>预览</h5>
                    <div class="export-preview" id="exportPreview">
                        <p class="text-muted">请选择字段查看预览</p>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelExportBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="exportBtn">导出 Excel</button>
                </div>
            </div>
        `;
    }
    
    initExportForm() {
        const cancelBtn = document.getElementById('cancelExportBtn');
        const exportBtn = document.getElementById('exportBtn');
        const fieldCheckboxes = document.querySelectorAll('.field-checkbox input[type="checkbox"]');
        
        // 绑定事件
        cancelBtn.addEventListener('click', () => this.modal.hide());
        exportBtn.addEventListener('click', () => this.performExport());
        
        // 字段选择变化事件
        fieldCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => this.updatePreview());
        });
        
        // 初始化预览
        this.updatePreview();
    }
    
    updatePreview() {
        const selectedFields = this.getSelectedFields();
        const previewDiv = document.getElementById('exportPreview');
        
        if (Object.keys(selectedFields).length === 0) {
            previewDiv.innerHTML = '<p class="text-muted">请至少选择一个字段</p>';
            return;
        }
        
        // 生成预览数据（前3行）
        const headers = Object.keys(selectedFields);
        const previewData = this.options.hosts.slice(0, 3).map(host => 
            headers.map(field => this.getFieldValue(host, field))
        );
        
        const table = document.createElement('table');
        table.className = 'table table-sm';
        
        // 表头
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headers.forEach(field => {
            const th = document.createElement('th');
            th.textContent = this.getFieldLabel(field);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // 表体
        const tbody = document.createElement('tbody');
        previewData.forEach(row => {
            const tr = document.createElement('tr');
            row.forEach(value => {
                const td = document.createElement('td');
                td.textContent = value || '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        
        previewDiv.innerHTML = '';
        previewDiv.appendChild(table);
        
        if (this.options.hosts.length > 3) {
            const moreInfo = document.createElement('p');
            moreInfo.className = 'text-muted mt-2';
            moreInfo.textContent = `显示前3行，共${this.options.hosts.length}行数据`;
            previewDiv.appendChild(moreInfo);
        }
    }
    
    getSelectedFields() {
        const selected = {};
        const checkboxes = document.querySelectorAll('.field-checkbox input[type="checkbox"]:not(#includeHeaders):not(#selectedOnly)');
        
        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                selected[checkbox.name] = true;
            }
        });
        
        return selected;
    }
    
    getFieldValue(host, field) {
        switch (field) {
            case 'ip': return host.ip || '';
            case 'port': return host.port || '22';
            case 'username': return host.username || '';
            case 'password': return host.password || '';
            case 'description': return host.description || '';
            case 'environment': return host.environment || '';
            case 'system_name': return host.system_name || host.systemName || '';
            case 'app_name': return host.app_name || host.appName || '';
            case 'datacenter': return host.datacenter || '';
            case 'owner': return host.owner || '';
            case 'os_type': return host.os_type || host.osType || '';
            case 'os_version': return host.os_version || host.osVersion || '';
            case 'kernel_version': return host.kernel_version || host.kernelVersion || '';
            case 'cpu_info': return host.cpu_info || host.cpuInfo || '';
            case 'memory_info': return host.memory_info || host.memoryInfo || '';
            default: return '';
        }
    }
    
    getFieldLabel(field) {
        const labels = {
            ip: 'IP地址',
            port: '端口',
            username: '用户名',
            password: '密码',
            description: '描述',
            environment: '环境',
            system_name: '系统名称',
            app_name: '应用名称',
            datacenter: '机房',
            owner: '负责人',
            os_type: '系统类型',
            os_version: '系统版本',
            kernel_version: '内核版本',
            cpu_info: 'CPU核数',
            memory_info: '内存大小'
        };
        return labels[field] || field;
    }
    
    async performExport() {
        const selectedFields = this.getSelectedFields();
        
        if (Object.keys(selectedFields).length === 0) {
            Utils.notify.warning('请至少选择一个字段');
            return;
        }
        
        const includeHeaders = document.getElementById('includeHeaders').checked;
        const selectedOnly = document.getElementById('selectedOnly').checked;
        const exportBtn = document.getElementById('exportBtn');
        const cancelBtn = document.getElementById('cancelExportBtn');
        const originalText = exportBtn.textContent;
        
        exportBtn.disabled = true;
        cancelBtn.disabled = true;
        exportBtn.textContent = '导出中...';
        
        try {
            // 获取要导出的数据
            let hostsToExport = this.options.hosts;
            
            if (selectedOnly) {
                // 获取已选中的主机
                const selectedIndices = this.getSelectedHostIndices();
                if (selectedIndices.length === 0) {
                    Utils.notify.warning('没有选中的主机可导出');
                    return;
                }
                hostsToExport = selectedIndices.map(index => this.options.hosts[index]);
            }
            
            if (hostsToExport.length === 0) {
                Utils.notify.warning('没有数据可导出');
                return;
            }
            
            // 数据验证和清理
            const cleanedData = this.validateAndCleanExportData(hostsToExport);
            
            // 生成Excel内容
            await this.generateAndDownloadExcel(cleanedData, selectedFields, includeHeaders, hostsToExport.length);
            
            Utils.notify.success(`Excel导出成功！共导出 ${hostsToExport.length} 条记录`);
            this.modal.hide();
            
        } catch (error) {
            console.error('Excel导出失败:', error);
            Utils.notify.error(`导出失败: ${error.message}`);
        } finally {
            exportBtn.disabled = false;
            cancelBtn.disabled = false;
            exportBtn.textContent = originalText;
        }
    }
    
    async generateAndDownloadExcel(hosts, selectedFields, includeHeaders, recordCount) {
        try {
            const XLSX = require('xlsx');
            const headers = Object.keys(selectedFields);
            
            // 准备数据
            const worksheetData = [];
            
            // 添加表头（使用中文标签）
            if (includeHeaders) {
                worksheetData.push(headers.map(field => this.getFieldLabel(field)));
            }
            
            // 添加数据行
            hosts.forEach(host => {
                const row = headers.map(field => this.getFieldValue(host, field));
                worksheetData.push(row);
            });
            
            // 创建工作簿
            const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
            
            // 设置列宽
            const columnWidths = headers.map(field => {
                switch(field) {
                    case 'ip': return { wch: 15 };
                    case 'port': return { wch: 8 };
                    case 'username': return { wch: 12 };
                    case 'password': return { wch: 15 };
                    case 'description': return { wch: 25 };
                    case 'environment': return { wch: 10 };
                    case 'system_name': return { wch: 15 };
                    case 'app_name': return { wch: 15 };
                    case 'datacenter': return { wch: 12 };
                    case 'owner': return { wch: 12 };
                    case 'os_type': return { wch: 12 };
                    case 'os_version': return { wch: 10 };
                    case 'kernel_version': return { wch: 25 };
                    case 'cpu_info': return { wch: 10 };
                    case 'memory_info': return { wch: 10 };
                    default: return { wch: 15 };
                }
            });
            worksheet['!cols'] = columnWidths;
            
            // 创建工作簿
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '主机列表');
            
            // 生成Excel文件的buffer
            const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            
            // 保存文件
            const timestamp = Utils.formatters.date(new Date(), 'YYYY-MM-DD_HH-mm-ss');
            const filename = `hosts_export_${timestamp}.xlsx`;
            
            // 调用主进程保存Excel文件并打开文件夹
            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('save-excel-file', excelBuffer, filename);
            
            if (result.canceled) {
                throw new Error('用户取消了保存操作');
            }
            
            if (!result.success) {
                throw new Error(result.error || '保存文件失败');
            }
            
        } catch (error) {
            throw new Error('文件保存失败: ' + error.message);
        }
    }
    
    getSelectedHostIndices() {
        // 从主应用获取选中的主机索引
        if (window.app && typeof window.app.getSelectedHosts === 'function') {
            return window.app.getSelectedHosts();
        }
        return [];
    }
    
    validateAndCleanExportData(hosts) {
        return hosts.map(host => {
            const cleaned = { ...host };
            
            // 清理字符串字段
            ['ip', 'username', 'password', 'description', 'environment', 'system_name', 'app_name', 'datacenter'].forEach(field => {
                if (cleaned[field] && typeof cleaned[field] === 'string') {
                    cleaned[field] = cleaned[field].trim();
                }
            });
            
            // 确保端口号是数字
            if (cleaned.port) {
                cleaned.port = parseInt(cleaned.port) || 22;
            }
            
            return cleaned;
        });
    }
}

// Toast 通知组件
class Toast {
    constructor() {
        this.container = this.createContainer();
        this.toasts = new Map();
        this.nextId = 1;
    }
    
    createContainer() {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }
        return container;
    }
    
    show(message, type = 'info', duration = 3000) {
        const id = this.nextId++;
        const toast = this.createToast(id, message, type, duration);
        
        this.container.appendChild(toast);
        this.toasts.set(id, toast);
        
        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
            toast.style.opacity = '1';
        }, 10);
        
        if (duration > 0) {
            setTimeout(() => {
                this.hide(id);
            }, duration);
        }
        
        return id;
    }
    
    createToast(id, message, type, duration) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = `
            background: var(--surface-float);
            border: 1px solid var(--border-default);
            border-radius: 8px;
            padding: 12px 16px;
            box-shadow: var(--shadow-modal);
            border-left: 4px solid ${this.getTypeColor(type)};
            min-width: 300px;
            max-width: 400px;
            transform: translateX(100%);
            opacity: 0;
            transition: all 0.3s ease;
            pointer-events: auto;
            cursor: pointer;
        `;
        
        const icon = this.getTypeIcon(type);
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">${icon}</span>
                <span style="flex: 1; color: var(--text-body);">${message}</span>
                <button style="background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-muted);" onclick="window.Components.toast.hide(${id})">&times;</button>
            </div>
        `;
        
        return toast;
    }
    
    hide(id) {
        const toast = this.toasts.get(id);
        if (toast) {
            toast.style.transform = 'translateX(100%)';
            toast.style.opacity = '0';
            
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
                this.toasts.delete(id);
            }, 300);
        }
    }
    
    getTypeColor(type) {
        const colors = {
            success: 'var(--status-healthy-fg)',
            error: 'var(--status-critical-fg)',
            warning: 'var(--status-warning-fg)',
            info: 'var(--status-info-fg)'
        };
        return colors[type] || colors.info;
    }
    
    getTypeIcon(type) {
        const icons = {
            success: Utils.icon('check', 13, 2.5),
            error: Utils.icon('x', 13, 2.5),
            warning: Utils.icon('alert-triangle', 13, 2.5),
            info: Utils.icon('info', 13, 2.5)
        };
        return icons[type] || icons.info;
    }
}

// 确认对话框组件
class ConfirmDialog {
    static show(options = {}) {
        return new Promise((resolve) => {
            const dialog = new ConfirmDialog({
                ...options,
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
            dialog.show();
        });
    }
    
    constructor(options = {}) {
        this.options = {
            title: '确认',
            message: '确定要执行此操作吗？',
            confirmText: '确定',
            cancelText: '取消',
            type: 'warning',
            ...options
        };
    }
    
    show() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: var(--surface-overlay); display: flex;
            align-items: center; justify-content: center;
            z-index: 2000; opacity: 0; transition: opacity 0.3s ease;
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--surface-float); border-radius: 8px; padding: 24px;
            border: 1px solid var(--border-default);
            max-width: 400px; width: 90%;
            transform: scale(0.9); transition: transform 0.3s ease;
            box-shadow: var(--shadow-modal);
        `;
        
        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px; color: var(--text-heading);">${this.options.title}</h3>
            <p style="margin: 0 0 24px; color: var(--text-muted);">${this.options.message}</p>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button class="btn btn-secondary cancel-btn">${this.options.cancelText}</button>
                <button class="btn btn-danger confirm-btn">${this.options.confirmText}</button>
            </div>
        `;
        
        dialog.querySelector('.confirm-btn').onclick = () => {
            overlay.remove();
            if (this.options.onConfirm) this.options.onConfirm();
        };
        
        dialog.querySelector('.cancel-btn').onclick = () => {
            overlay.remove();
            if (this.options.onCancel) this.options.onCancel();
        };
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        setTimeout(() => {
            overlay.style.opacity = '1';
            dialog.style.transform = 'scale(1)';
        }, 10);
    }
}

// 进度条组件
class ProgressBar {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.querySelector(container) : container;
        this.options = { value: 0, max: 100, showText: true, ...options };
        this.render();
    }
    
    render() {
        const progress = document.createElement('div');
        progress.style.cssText = `
            background-color: var(--surface-active); border-radius: 0.25rem;
            height: 1rem; overflow: hidden; position: relative;
        `;
        
        const bar = document.createElement('div');
        bar.style.cssText = `
            height: 100%; background-color: var(--primary);
            transition: width 0.6s ease; display: flex;
            align-items: center; justify-content: center;
            color: white; font-size: 0.75rem; font-weight: 600;
        `;
        
        progress.appendChild(bar);
        this.container.appendChild(progress);
        
        this.bar = bar;
        this.updateValue();
    }
    
    setValue(value) {
        this.options.value = Math.max(0, Math.min(this.options.max, value));
        this.updateValue();
    }
    
    updateValue() {
        const percentage = (this.options.value / this.options.max) * 100;
        this.bar.style.width = `${percentage}%`;
        if (this.options.showText) {
            this.bar.textContent = `${Math.round(percentage)}%`;
        }
    }
}

// 状态指示器组件
class StatusIndicator {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.querySelector(container) : container;
        this.options = { status: 'unknown', text: '', ...options };
        this.render();
    }
    
    render() {
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 8px; border-radius: 12px;
            font-size: 12px; font-weight: 500;
        `;
        
        const dot = document.createElement('div');
        dot.style.cssText = `
            width: 8px; height: 8px; border-radius: 50%;
            background-color: ${this.getStatusColor()};
        `;
        
        const text = document.createElement('span');
        text.textContent = this.options.text || this.getStatusText();
        text.style.color = this.getStatusColor();
        
        indicator.appendChild(dot);
        indicator.appendChild(text);
        this.container.appendChild(indicator);
        
        this.element = indicator;
    }
    
    setStatus(status, text) {
        this.options.status = status;
        if (text) this.options.text = text;
        
        const dot = this.element.querySelector('div');
        const textEl = this.element.querySelector('span');
        
        dot.style.backgroundColor = this.getStatusColor();
        textEl.style.color = this.getStatusColor();
        textEl.textContent = this.options.text || this.getStatusText();
    }
    
    getStatusColor() {
        const colors = {
            online: 'var(--status-healthy-fg)',
            offline: 'var(--status-critical-fg)',
            auth_failed: 'var(--status-warning-fg)',
            testing: 'var(--status-info-fg)',
            unknown: 'var(--text-muted)'
        };
        return colors[this.options.status] || colors.unknown;
    }
    
    getStatusText() {
        const texts = {
            online: '在线',
            offline: '离线',
            auth_failed: '认证失败',
            testing: '测试中',
            unknown: '未知'
        };
        return texts[this.options.status] || '未知';
    }
}

// 批量操作对话框组件
class BatchOperationDialog {
    constructor(options = {}) {
        this.options = {
            operation: 'connect_test', // connect_test, delete, update_status, collect_info
            title: '批量操作',
            hosts: [],
            onComplete: null,
            onProgress: null,
            ...options
        };
        this.modal = null;
        this.isRunning = false;
        this.results = [];
        this.currentIndex = 0;
    }
    
    show() {
        this.modal = new Modal({
            title: this.options.title,
            content: this.createBatchForm(),
            width: '900px',
            onShow: () => this.initBatchForm()
        });
        
        this.modal.show();
    }
    
    createBatchForm() {
        const operationName = this.getOperationName();
        
        return `
            <div class="batch-operation-form">
                <div class="operation-summary">
                    <span class="summary-item">操作类型: <strong>${operationName}</strong></span>
                    <span class="summary-sep"></span>
                    <span class="summary-item">目标主机: <strong>${this.options.hosts.length}</strong> 台</span>
                    ${this.options.operation === 'connect_test' ? `
                        <span class="summary-sep"></span>
                        <span class="summary-item test-type-selection">
                            测试方式:
                            <label class="radio-inline"><input type="radio" name="testType" value="ssh" checked> SSH (Port 22)</label>
                            <label class="radio-inline"><input type="radio" name="testType" value="ping"> Ping (ICMP)</label>
                        </span>
                    ` : ''}
                    ${this.options.operation === 'configure_keys' ? `<span class="summary-item text-muted">${Utils.icon('info', 12)} 将使用系统默认SSH密钥进行批量配置</span>` : ''}
                </div>
                
                <div class="host-list">
                    <div class="host-items" id="hostItems">
                        ${this.renderHostItems()}
                    </div>
                </div>
                
                <div class="operation-progress" id="operationProgress" style="display: none;">
                    <h5>执行进度</h5>
                    <div class="progress-bar-container">
                        <div class="progress-bar" id="progressBar">
                            <div class="progress-fill" id="progressFill" style="width: 0%;"></div>
                        </div>
                        <span class="progress-text" id="progressText">0 / ${this.options.hosts.length}</span>
                    </div>
                    <div class="current-operation" id="currentOperation"></div>
                </div>
                
                <div class="operation-results" id="operationResults" style="display: none;">
                    <div class="results-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h5>执行结果</h5>
                        <button type="button" class="btn btn-outline-success btn-sm" id="exportResultsBtn">
                            ${Utils.icon('file-spreadsheet', 13)} 导出结果到Excel
                        </button>
                    </div>
                    <div class="results-summary" id="resultsSummary"></div>
                    <div class="results-detail" id="resultsDetail"></div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="startBtn">开始执行</button>
                    <button type="button" class="btn btn-success" id="closeBtn" style="display: none;">关闭</button>
                </div>
            </div>
        `;
    }
    
    renderHostItems() {
        const escapeHtml = (str) => {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        };
        
        return `
            <table class="table batch-host-table">
                <thead>
                    <tr>
                        <th style="width: 44px;">#</th>
                        <th>IP:端口</th>
                        <th>主机名</th>
                        <th style="width: 170px;">状态</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.options.hosts.map((host, index) => `
                        <tr id="hostItem_${index}">
                            <td class="col-muted">${index + 1}</td>
                            <td><code>${escapeHtml(host.ip)}:${host.port || 22}</code></td>
                            <td>${escapeHtml(host.hostname || '-')}</td>
                            <td class="host-status" id="hostStatus_${index}"><span class="status-badge info">等待中</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
    
    getOperationName() {
        const names = {
            connect_test: '连接测试',
            delete: '删除主机',
            update_status: '更新状态',
            collect_info: '收集信息',
            configure_keys: '配置SSH密钥'
        };
        return names[this.options.operation] || '未知操作';
    }
    
    initBatchForm() {
        const cancelBtn = document.getElementById('cancelBtn');
        const startBtn = document.getElementById('startBtn');
        const closeBtn = document.getElementById('closeBtn');
        
        cancelBtn.addEventListener('click', () => {
            if (this.isRunning) {
                this.stopOperation();
            } else {
                this.modal.hide();
            }
        });
        
        startBtn.addEventListener('click', () => this.startOperation());
        closeBtn.addEventListener('click', () => this.modal.hide());
        
        const exportBtn = document.getElementById('exportResultsBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportResultsToExcel());
        }
    }
    
    async startOperation() {
        const startBtn = document.getElementById('startBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const progressSection = document.getElementById('operationProgress');
        
        this.isRunning = true;
        this.results = [];
        this.currentIndex = 0;
        
        // 获取选中的测试类型并锁定
        if (this.options.operation === 'connect_test') {
            this.selectedTestType = document.querySelector('input[name="testType"]:checked')?.value || 'ssh';
            const radios = document.querySelectorAll('input[name="testType"]');
            radios.forEach(r => r.disabled = true);
        }
        
        startBtn.style.display = 'none';
        cancelBtn.textContent = '停止';
        progressSection.style.display = 'block';
        
        try {
            // 连接测试使用并发模式
            if (this.options.operation === 'connect_test' && this.selectedTestType === 'ssh') {
                await this.startConcurrentConnectTest();
            } else if (this.options.operation === 'connect_test' && this.selectedTestType === 'ping') {
                await this.startConcurrentPingTest();
            } else if (this.options.operation === 'collect_info') {
                // 收集信息使用并发模式（每台主机独立SSH连接）
                await this.startConcurrentCollectInfo();
            } else {
                // 其他操作保持串行执行
                await this.startSerialOperation();
            }
        } catch (error) {
            console.error('批量操作执行失败:', error);
        } finally {
            this.completeOperation();
        }
    }
    
    /**
     * 并发连接测试（性能优化）
     * 通过主进程并发执行，速度提升约10倍
     */
    async startConcurrentConnectTest() {
        const hosts = this.options.hosts;
        
        // 所有主机先标记为执行中
        for (let i = 0; i < hosts.length; i++) {
            this.updateHostStatus(i, 'running', '等待中...');
        }
        
        try {
            const results = await window.hostService.batchTestConnectionConcurrent(
                hosts,
                10, // 并发数10
                (progress) => {
                    // 实时进度更新
                    if (!this.isRunning) return;
                    
                    const { completed, total, index, result } = progress;
                    this.currentIndex = completed - 1;
                    
                    // 更新单个主机状态（区分认证失败和连接失败）
                    const statusLabel = result.success ? `成功 (${result.duration}ms)`
                        : (result.authFailed ? `认证失败` : result.message || '失败');
                    this.updateHostStatus(index, result.success ? 'success' : (result.authFailed ? 'warning' : 'error'),
                        statusLabel);
                    
                    // 更新进度条
                    const progressFill = document.getElementById('progressFill');
                    const progressText = document.getElementById('progressText');
                    if (progressFill && progressText) {
                        const percent = Math.round((completed / total) * 100);
                        progressFill.style.width = `${percent}%`;
                        progressText.textContent = `${completed} / ${total}`;
                    }
                }
            );
            
            this.results = results;
            
            // 强制更新进度条到100%（避免最后几个进度事件未到达的竞态问题）
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            if (progressFill && progressText) {
                progressFill.style.width = '100%';
                progressText.textContent = `${this.options.hosts.length} / ${this.options.hosts.length}`;
            }
        } catch (error) {
            console.error('并发批量测试失败, 回退到串行模式:', error);
            // 回退到串行模式
            await this.startSerialOperation();
        }
    }
    
    /**
     * 并发Ping测试（性能优化）
     * 通过主进程TCP端口探测并发执行，50并发，速度提升约20倍
     */
    async startConcurrentPingTest() {
        const hosts = this.options.hosts;
        
        // 所有主机先标记为执行中
        for (let i = 0; i < hosts.length; i++) {
            this.updateHostStatus(i, 'running', '等待中...');
        }
        
        try {
            if (!window.require) {
                await this.startSerialOperation();
                return;
            }
            
            const { ipcRenderer } = window.require('electron');
            
            // 构建主机列表
            const hostList = hosts.map(host => ({
                id: host.id,
                ip: host.ip,
                port: host.port || 22
            }));
            
            // 监听进度更新
            const progressHandler = (event, progress) => {
                if (!this.isRunning) return;
                
                const { completed, total, index, result } = progress;
                this.currentIndex = completed - 1;
                
                // 更新单个主机状态
                const latencyMsg = result.success ? `在线 (${result.latency}ms)` : '离线';
                this.updateHostStatus(index, result.success ? 'success' : 'error', latencyMsg);
                
                // 更新进度条
                const progressFill = document.getElementById('progressFill');
                const progressText = document.getElementById('progressText');
                if (progressFill && progressText) {
                    const percent = Math.round((completed / total) * 100);
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `${completed} / ${total}`;
                }
                
                // 更新当前操作显示
                const currentOperation = document.getElementById('currentOperation');
                if (currentOperation && index < hosts.length) {
                    const host = hosts[index];
                    currentOperation.textContent = `最新完成: ${host.hostname || host.ip} (${host.ip}) - ${latencyMsg}`;
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
            
            // 强制更新进度条到100%（避免最后几个进度事件未到达的竞态问题）
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            if (progressFill && progressText) {
                progressFill.style.width = '100%';
                progressText.textContent = `${hosts.length} / ${hosts.length}`;
            }
            
            if (response.success) {
                // 构造结果数据（兼容导出和结果概览）
                this.results = response.results.map((result, i) => ({
                    success: result.success,
                    message: result.success ? `在线 (延迟: ${result.latency}ms)` : '离线 (端口不可达)',
                    host: hosts[i],
                    duration: result.latency
                }));
                
                // 异步更新主机状态（Ping不覆盖auth_failed）
                const statusUpdates = [];
                for (let i = 0; i < hosts.length; i++) {
                    const result = response.results[i];
                    const currentStatus = hosts[i].status;
                    let newStatus;
                    if (result && result.success) {
                        newStatus = (currentStatus === 'auth_failed') ? 'auth_failed' : 'online';
                    } else {
                        newStatus = 'offline';
                    }
                    if (newStatus !== currentStatus) {
                        statusUpdates.push(window.hostService.updateHostStatus(hosts[i].id, newStatus));
                    }
                }
                if (statusUpdates.length > 0) {
                    Promise.all(statusUpdates).catch(err => console.warn('批量更新状态失败:', err));
                }
            } else {
                throw new Error(response.message || '批量Ping失败');
            }
        } catch (error) {
            console.error('并发Ping测试失败, 回退到串行模式:', error);
            await this.startSerialOperation();
        }
    }
    
    /**
     * 并发收集主机信息（性能优化）
     * 渲染进程侧并发池，每台主机独立SSH连接；
     * 每台写入时跳过全量缓存刷新（reload:false），完成后由 onComplete 统一刷新列表
     */
    async startConcurrentCollectInfo() {
        const hosts = this.options.hosts;
        const concurrency = 5;
        let cursor = 0;
        let completed = 0;
        this.results = new Array(hosts.length);
        
        // 所有主机先标记为等待中
        for (let i = 0; i < hosts.length; i++) {
            this.updateHostStatus(i, 'running', '等待中...');
        }
        
        const worker = async () => {
            while (this.isRunning) {
                const index = cursor++;
                if (index >= hosts.length) break;
                
                const host = hosts[index];
                this.currentIndex = index;
                this.updateCurrentOperation(host);
                this.updateHostStatus(index, 'running', '执行中');
                
                try {
                    const result = await window.hostService.collectHostInfo(host.id, { reload: false });
                    if (result && !result.host) result.host = host;
                    this.results[index] = result;
                    this.updateHostStatus(index, result.success ? 'success' : 'error',
                        result.success ? '成功' : result.message || '失败');
                } catch (error) {
                    this.results[index] = { success: false, message: error.message, host };
                    this.updateHostStatus(index, 'error', error.message);
                }
                
                // 按完成数更新进度（并发场景 currentIndex 不代表完成数）
                completed++;
                const progressFill = document.getElementById('progressFill');
                const progressText = document.getElementById('progressText');
                if (progressFill && progressText) {
                    progressFill.style.width = `${(completed / hosts.length) * 100}%`;
                    progressText.textContent = `${completed} / ${hosts.length}`;
                }
            }
        };
        
        const workerCount = Math.min(concurrency, hosts.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        
        // 用户中途停止时过滤未执行的空位，保证结果统计准确
        this.results = this.results.filter(Boolean);
    }
    
    /**
     * 串行执行操作（原始模式，用于非SSH测试的操作）
     */
    async startSerialOperation() {
        for (let i = 0; i < this.options.hosts.length && this.isRunning; i++) {
            this.currentIndex = i;
            const host = this.options.hosts[i];
            
            // 更新当前操作显示
            this.updateCurrentOperation(host);
            
            // 更新主机状态为进行中
            this.updateHostStatus(i, 'running', '执行中');
            
            try {
                // 执行具体操作
                const result = await this.executeOperation(host, i);
                this.results.push(result);
                
                // 更新主机状态
                this.updateHostStatus(i, result.success ? 'success' : 'error', 
                    result.success ? '成功' : result.message || '失败');
            } catch (error) {
                const result = {
                    success: false,
                    message: error.message,
                    host: host
                };
                this.results.push(result);
                this.updateHostStatus(i, 'error', error.message);
            }
            
            // 更新进度条
            this.updateProgress();
            
            // 稍微延迟，避免过于频繁的操作
            await Utils.sleep(100);
        }
    }
    
    async executeOperation(host, index) {
        let result;
        switch (this.options.operation) {
            case 'connect_test':
                const testType = this.selectedTestType || 'ssh';
                if (testType === 'ping') {
                    result = await window.hostService.pingHost(host.ip);
                    // 批量Ping测试时也同步更新主机的在线/离线状态
                    const newStatus = result.success ? 'online' : 'offline';
                    await window.hostService.updateHostStatus(host.id, newStatus);
                } else {
                    result = await window.hostService.testConnection(host.id);
                }
                break;
            
            case 'collect_info':
                // reload:false 跳过每台的全量缓存刷新，批量完成后由 onComplete 统一刷新
                result = await window.hostService.collectHostInfo(host.id, { reload: false });
                break;
            
            case 'configure_keys':
                result = await this.configureHostKey(host);
                break;
            
            case 'delete':
                await window.hostService.deleteHost(host.id);
                result = { success: true, message: '删除成功' };
                break;
            
            case 'update_status':
                await window.hostService.updateHostStatus(host.id, 'unknown');
                result = { success: true, message: '状态已重置' };
                break;
            
            default:
                throw new Error('不支持的操作类型');
        }
        
        // 确保结果中包含主机信息，用于导出等后续操作
        if (result && !result.host) {
            result.host = host;
        }
        return result;
    }
    
    updateCurrentOperation(host) {
        const currentOperation = document.getElementById('currentOperation');
        currentOperation.textContent = `正在处理: ${host.hostname || host.ip} (${host.ip})`;
    }
    
    updateHostStatus(index, status, message) {
        const hostStatus = document.getElementById(`hostStatus_${index}`);
        const statusClasses = {
            waiting: 'info',
            running: 'warning',
            success: 'success',
            error: 'danger'
        };
        
        hostStatus.innerHTML = `<span class="status-badge ${statusClasses[status] || 'info'}">${message}</span>`;
    }
    
    updateProgress() {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        
        const completed = this.currentIndex + 1;
        const total = this.options.hosts.length;
        const percentage = (completed / total) * 100;
        
        progressFill.style.width = `${percentage}%`;
        progressText.textContent = `${completed} / ${total}`;
    }
    
    completeOperation() {
        const cancelBtn = document.getElementById('cancelBtn');
        const closeBtn = document.getElementById('closeBtn');
        const resultsSection = document.getElementById('operationResults');
        const currentOperation = document.getElementById('currentOperation');
        
        this.isRunning = false;
        
        cancelBtn.style.display = 'none';
        closeBtn.style.display = 'inline-block';
        resultsSection.style.display = 'block';
        
        currentOperation.textContent = '操作完成';
        
        // 显示结果摘要
        this.showResults();
        
        // 回调完成事件
        if (this.options.onComplete) {
            this.options.onComplete(this.results);
        }
    }
    
    showResults() {
        const resultsSummary = document.getElementById('resultsSummary');
        const resultsDetail = document.getElementById('resultsDetail');
        
        const successCount = this.results.filter(r => r.success).length;
        const failCount = this.results.length - successCount;
        
        resultsSummary.innerHTML = `
            <div class="results-stats">
                <div class="stat-item success">
                    <span class="stat-number">${successCount}</span>
                    <span class="stat-label">成功</span>
                </div>
                <div class="stat-item error">
                    <span class="stat-number">${failCount}</span>
                    <span class="stat-label">失败</span>
                </div>
                <div class="stat-item total">
                    <span class="stat-number">${this.results.length}</span>
                    <span class="stat-label">总计</span>
                </div>
            </div>
        `;
        
        // 显示失败的详细信息
        const failedResults = this.results.filter(r => !r.success);
        if (failedResults.length > 0) {
            resultsDetail.innerHTML = `
                <h6>失败详情:</h6>
                <div class="failed-items">
                    ${failedResults.map(result => `
                        <div class="failed-item">
                            <strong>${result.host.hostname || result.host.ip}</strong>: ${result.message}
                        </div>
                    `).join('')}
                </div>
            `;
        }
    }
    
    stopOperation() {
        this.isRunning = false;
        Utils.notify.info('操作已停止');
    }
    
    // 导出测试结果到Excel
    async exportResultsToExcel() {
        if (this.results.length === 0) {
            Utils.notify.warning('没有结果可以导出');
            return;
        }

        try {
            // 使用与项目中其他导出逻辑一致的加载方式
            let XLSX;
            if (typeof require !== 'undefined') {
                XLSX = require('xlsx');
            } else if (window.require) {
                XLSX = window.require('xlsx');
            } else {
                XLSX = window.XLSX;
            }

            if (!XLSX || !XLSX.utils) {
                throw new Error('未找到 Excel 导出库或库加载不完整');
            }

            const testType = this.selectedTestType || 'N/A';
            const timestamp = Utils.formatters.date(new Date(), 'YYYY-MM-DD HH:mm:ss');
            
            // 准备数据
            const data = this.results.map(result => {
                const host = result.host || {};
                return {
                    'IP地址': host.ip || '未知',
                    '主机名': host.hostname || '未知',
                    '系统名称': host.systemName || host.system_name || '',
                    '机房': host.datacenter || '',
                    '环境': host.environment || '',
                    '负责人': host.owner || '',
                    '测试方式': testType.toUpperCase(),
                    '测试状态': result.success ? '在线' : '离线',
                    '详细详情/延迟': result.message || (result.success ? '成功' : '失败'),
                    '测试时间': timestamp
                };
            });

            // 创建工作表
            const worksheet = XLSX.utils.json_to_sheet(data);
            
            // 设置列宽
            const colWidths = [
                { wch: 15 }, // IP
                { wch: 20 }, // 主机名
                { wch: 20 }, // 系统名称
                { wch: 12 }, // 机房
                { wch: 10 }, // 环境
                { wch: 12 }, // 负责人
                { wch: 10 }, // 测试方式
                { wch: 10 }, // 测试状态
                { wch: 30 }, // 详情
                { wch: 20 }  // 时间
            ];
            worksheet['!cols'] = colWidths;

            // 创建工作簿
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '测试结果');

            // 生成Buffer
            const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            
            // 保存文件
            const filename = `batch_test_results_${Utils.formatters.date(new Date(), 'YYYYMMDD_HHmmss')}.xlsx`;
            
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const saveResult = await ipcRenderer.invoke('save-excel-file', excelBuffer, filename);
                
                if (saveResult.success) {
                    Utils.notify.success('结果已成功导出');
                } else if (!saveResult.canceled) {
                    Utils.notify.error('导出失败: ' + (saveResult.error || '未知错误'));
                }
            } else {
                // 非Electron环境下载
                const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                Utils.notify.success('结果已开始下载');
            }
        } catch (error) {
            console.error('导出测试结果失败:', error);
            Utils.notify.error('导出失败: ' + error.message);
        }
    }
    
    // 创建密钥选择区域（用于批量配置）
    createKeySelectionSection() {
        return `
                <div class="key-selection-section">
                    <h5>选择SSH密钥</h5>
                    <div class="form-group">
                        <div class="key-source-options">
                            <label class="radio-option">
                                <input type="radio" name="batchKeySource" value="generate" checked>
                                <span>生成新的密钥对</span>
                            </label>
                            <label class="radio-option">
                                <input type="radio" name="batchKeySource" value="existing">
                                <span>使用现有公钥</span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="generate-key-section" id="batchGenerateKeySection">
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label for="batchKeySize">密钥长度</label>
                                <select class="form-control" id="batchKeySize">
                                    <option value="2048">2048 bits</option>
                                    <option value="3072">3072 bits</option>
                                    <option value="4096" selected>4096 bits</option>
                                </select>
                            </div>
                            <div class="form-group col-md-6">
                                <label for="batchKeyComment">注释 (可选)</label>
                                <input type="text" class="form-control" id="batchKeyComment" 
                                       placeholder="用于标识该密钥的用途">
                            </div>
                        </div>
                        <button type="button" class="btn btn-info btn-sm" id="generateBatchKeyBtn">生成密钥对</button>
                        <div class="key-preview" id="batchKeyPreview" style="display: none;">
                            <div class="alert alert-success mt-2">
                                <strong>密钥对生成成功！</strong>
                                <div class="mt-2">
                                    <small>公钥预览: <code id="publicKeyPreview"></code></small>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="existing-key-section" id="batchExistingKeySection" style="display: none;">
                        <div class="form-group">
                            <label for="batchPublicKeyFile">公钥文件</label>
                            <div class="input-group">
                                <input type="text" class="form-control" id="batchPublicKeyFile" 
                                       placeholder="选择公钥文件" readonly>
                                <div class="input-group-append">
                                    <button class="btn btn-outline-secondary" type="button" id="selectBatchPublicKeyBtn">浏览</button>
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="batchPublicKeyContent">或直接粘贴公钥内容</label>
                            <textarea class="form-control" id="batchPublicKeyContent" rows="3" 
                                      placeholder="ssh-rsa AAAAB3NzaC1yc2E..."></textarea>
                        </div>
                    </div>
                </div>
`;
    }
    
    // 批量配置主机密钥（使用默认密钥）
    async configureHostKey(host) {
        try {
            // 获取默认密钥
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                
                // 获取默认公钥
                const keyResult = await ipcRenderer.invoke('get-default-ssh-key');
                if (!keyResult.success) {
                    throw new Error(`获取默认密钥失败: ${keyResult.message}`);
                }
                
                // 使用默认公钥配置主机
                const result = await ipcRenderer.invoke('ssh-configure-key', {
                    host: {
                        ip: host.ip,
                        port: host.port || 22,
                        username: host.username,
                        password: host.password,
                        privateKeyPath: host.privateKeyPath
                    },
                    publicKey: keyResult.publicKey
                });
                
                return {
                    success: result.success,
                    message: result.message || (result.success ? 'SSH密钥配置成功' : '配置失败'),
                    host: host
                };
            } else {
                throw new Error('SSH密钥配置功能需要在Electron环境中使用');
            }
        } catch (error) {
            return {
                success: false,
                message: error.message,
                host: host
            };
        }
    }
    
    // 获取批量操作的公钥
    getBatchPublicKey() {
        const keySource = document.querySelector('input[name="batchKeySource"]:checked')?.value;
        
        if (keySource === 'generate') {
            return this.generatedBatchKey?.publicKey || null;
        } else {
            const publicKeyContent = document.getElementById('batchPublicKeyContent')?.value.trim();
            return publicKeyContent || null;
        }
    }
    
    // 初始化批量密钥选择
    initBatchKeySelection() {
        const keySourceRadios = document.querySelectorAll('input[name="batchKeySource"]');
        const generateSection = document.getElementById('batchGenerateKeySection');
        const existingSection = document.getElementById('batchExistingKeySection');
        const generateBtn = document.getElementById('generateBatchKeyBtn');
        const selectFileBtn = document.getElementById('selectBatchPublicKeyBtn');
        
        // 密钥来源切换
        keySourceRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'existing') {
                    generateSection.style.display = 'none';
                    existingSection.style.display = 'block';
                } else {
                    generateSection.style.display = 'block';
                    existingSection.style.display = 'none';
                }
            });
        });
        
        // 生成密钥按钮
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.generateBatchKeyPair());
        }
        
        // 选择文件按钮
        if (selectFileBtn) {
            selectFileBtn.addEventListener('click', () => this.selectBatchPublicKeyFile());
        }
    }
    
    // 生成批量配置用的密钥对
    async generateBatchKeyPair() {
        const generateBtn = document.getElementById('generateBatchKeyBtn');
        const keyPreview = document.getElementById('batchKeyPreview');
        const keySize = parseInt(document.getElementById('batchKeySize').value);
        const keyComment = document.getElementById('batchKeyComment').value;
        
        generateBtn.disabled = true;
        generateBtn.textContent = '生成中...';
        
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('ssh-generate-keypair', {
                    keySize,
                    comment: keyComment
                });
                
                if (result.success) {
                    this.generatedBatchKey = {
                        publicKey: result.publicKey,
                        privateKey: result.privateKey
                    };
                    
                    // 显示公钥预览
                    document.getElementById('publicKeyPreview').textContent = 
                        result.publicKey.substring(0, 50) + '...';
                    keyPreview.style.display = 'block';
                    
                    Utils.notify.success('密钥对生成成功');
                } else {
                    Utils.notify.error(`生成失败: ${result.message}`);
                }
            } else {
                Utils.notify.error('密钥生成功能需要在Electron环境中使用');
            }
        } catch (error) {
            console.error('生成批量密钥对失败:', error);
            Utils.notify.error('生成失败');
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = '生成密钥对';
        }
    }
    
    // 选择批量配置用的公钥文件
    async selectBatchPublicKeyFile() {
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('show-open-dialog', {
                    properties: ['openFile'],
                    filters: [
                        { name: 'SSH公钥', extensions: ['pub'] },
                        { name: '所有文件', extensions: ['*'] }
                    ]
                });
                
                if (!result.canceled && result.filePaths.length > 0) {
                    document.getElementById('batchPublicKeyFile').value = result.filePaths[0];
                    // 读取文件内容
                    const content = await ipcRenderer.invoke('read-file', result.filePaths[0]);
                    document.getElementById('batchPublicKeyContent').value = content;
                    
                    Utils.notify.success('公钥文件加载成功');
                }
            } else {
                Utils.notify.info('文件选择功能需要在Electron环境中使用');
            }
        } catch (error) {
            console.error('选择文件失败:', error);
            Utils.notify.error('选择文件失败');
        }
    }
}

// 默认密钥管理组件
class DefaultSSHKeyDialog {
    constructor(options = {}) {
        this.options = {
            onComplete: null,
            ...options
        };
        this.modal = null;
        this.keyInfo = null;
    }
    
    show() {
        this.modal = new Modal({
            title: '默认SSH密钥管理',
            content: this.createKeyManagementForm(),
            width: '600px',
            onShow: () => this.initKeyManagement()
        });
        
        this.modal.show();
    }
    
    createKeyManagementForm() {
        return `
            <div class="default-key-management">
                <div class="key-info-section">
                    <h5>当前默认密钥</h5>
                    <div class="key-status" id="keyStatus">
                        <div class="text-center">
                            <div class="spinner-border spinner-border-sm" role="status">
                                <span class="sr-only">加载中...</span>
                            </div>
                            <span class="ml-2">正在加载默认密钥信息...</span>
                        </div>
                    </div>
                </div>
                
                <div class="key-actions">
                    <button type="button" class="btn btn-info" id="viewPublicKeyBtn" disabled>
                        <span class="btn-icon">${Utils.icon('key', 13)}</span> 查看公钥
                    </button>
                    <button type="button" class="btn btn-warning" id="regenerateKeyBtn">
                        <span class="btn-icon">${Utils.icon('refresh-cw', 13)}</span> 重新生成密钥
                    </button>
                    <button type="button" class="btn btn-success" id="copyPublicKeyBtn" disabled>
                        <span class="btn-icon">${Utils.icon('copy', 13)}</span> 复制公钥
                    </button>
                </div>
                
                <div class="public-key-display" id="publicKeyDisplay" style="display: none;">
                    <h5>公钥内容</h5>
                    <textarea class="form-control" id="publicKeyContent" rows="4" readonly></textarea>
                </div>
                
                <div class="key-info mt-3">
                    <small class="text-muted">
                        <strong>说明：</strong><br>
                        • 默认密钥用于批量配置SSH免密登录<br>
                        • 系统启动时会自动生成默认密钥（如果不存在）<br>
                        • 重新生成密钥后，之前配置的主机需要重新配置
                    </small>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">关闭</button>
                </div>
            </div>
        `;
    }
    
    async initKeyManagement() {
        const cancelBtn = document.getElementById('cancelBtn');
        const viewPublicKeyBtn = document.getElementById('viewPublicKeyBtn');
        const regenerateKeyBtn = document.getElementById('regenerateKeyBtn');
        const copyPublicKeyBtn = document.getElementById('copyPublicKeyBtn');
        
        cancelBtn.addEventListener('click', () => this.modal.hide());
        viewPublicKeyBtn.addEventListener('click', () => this.togglePublicKeyDisplay());
        regenerateKeyBtn.addEventListener('click', () => this.regenerateDefaultKey());
        copyPublicKeyBtn.addEventListener('click', () => this.copyPublicKey());
        
        // 加载默认密钥信息
        await this.loadDefaultKeyInfo();
    }
    
    async loadDefaultKeyInfo() {
        const keyStatus = document.getElementById('keyStatus');
        const viewPublicKeyBtn = document.getElementById('viewPublicKeyBtn');
        const copyPublicKeyBtn = document.getElementById('copyPublicKeyBtn');
        
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('get-default-ssh-key');
                
                if (result.success) {
                    this.keyInfo = result;
                    
                    keyStatus.innerHTML = `
                        <div class="alert alert-success">
                            <strong>${Utils.icon('check-circle', 13)} 默认密钥已存在</strong><br>
                            <small>公钥路径：<code>${result.publicKeyPath}</code></small><br>
                            <small>私钥路径：<code>${result.privateKeyPath}</code></small>
                        </div>
                    `;
                    
                    viewPublicKeyBtn.disabled = false;
                    copyPublicKeyBtn.disabled = false;
                } else {
                    keyStatus.innerHTML = `
                        <div class="alert alert-danger">
                            <strong>${Utils.icon('x-circle', 13)} 默认密钥不存在</strong><br>
                            <small>错误信息：${result.message}</small>
                        </div>
                    `;
                }
            }
        } catch (error) {
            keyStatus.innerHTML = `
                <div class="alert alert-danger">
                    <strong>${Utils.icon('x-circle', 13)} 加载失败</strong><br>
                    <small>错误信息：${error.message}</small>
                </div>
            `;
        }
    }
    
    togglePublicKeyDisplay() {
        const publicKeyDisplay = document.getElementById('publicKeyDisplay');
        const publicKeyContent = document.getElementById('publicKeyContent');
        const viewPublicKeyBtn = document.getElementById('viewPublicKeyBtn');
        
        if (publicKeyDisplay.style.display === 'none') {
            publicKeyContent.value = this.keyInfo.publicKey;
            publicKeyDisplay.style.display = 'block';
            viewPublicKeyBtn.innerHTML = `<span class="btn-icon">${Utils.icon('eye-off', 13)}</span> 隐藏公钥`;
        } else {
            publicKeyDisplay.style.display = 'none';
            viewPublicKeyBtn.innerHTML = `<span class="btn-icon">${Utils.icon('key', 13)}</span> 查看公钥`;
        }
    }
    
    async regenerateDefaultKey() {
        const regenerateKeyBtn = document.getElementById('regenerateKeyBtn');
        
        const confirmed = await Utils.confirm('确定要重新生成默认SSH密钥吗？\n\n注意：这将会导致之前使用旧密钥配置的主机需要重新配置免密登录。');
        if (!confirmed) return;
        
        regenerateKeyBtn.disabled = true;
        regenerateKeyBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 生成中...';
        
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('regenerate-default-ssh-key');
                
                if (result.success) {
                    Utils.notify.success('默认SSH密钥重新生成成功');
                    
                    // 重新加载密钥信息
                    await this.loadDefaultKeyInfo();
                    
                    // 隐藏公钥显示
                    const publicKeyDisplay = document.getElementById('publicKeyDisplay');
                    publicKeyDisplay.style.display = 'none';
                    
                    if (this.options.onComplete) {
                        this.options.onComplete();
                    }
                } else {
                    Utils.notify.error(`重新生成失败: ${result.message}`);
                }
            }
        } catch (error) {
            console.error('重新生成默认密钥失败:', error);
            Utils.notify.error('重新生成失败');
        } finally {
            regenerateKeyBtn.disabled = false;
            regenerateKeyBtn.innerHTML = `<span class="btn-icon">${Utils.icon('refresh-cw', 13)}</span> 重新生成密钥`;
        }
    }
    
    async copyPublicKey() {
        if (!this.keyInfo || !this.keyInfo.publicKey) {
            Utils.notify.warning('暂无公钥可复制');
            return;
        }
        
        try {
            await navigator.clipboard.writeText(this.keyInfo.publicKey);
            Utils.notify.success('公钥已复制到剪贴板');
        } catch (error) {
            console.error('复制公钥失败:', error);
            Utils.notify.error('复制失败');
        }
    }
}

// SSH密钥管理组件
class SSHKeyDialog {
    constructor(options = {}) {
        this.options = {
            mode: 'generate', // generate, configure
            host: null,
            onComplete: null,
            ...options
        };
        this.modal = null;
        this.keyPair = null;
    }
    
    show() {
        this.modal = new Modal({
            title: this.options.mode === 'generate' ? '生成SSH密钥对' : '配置SSH免密登录',
            content: this.createKeyForm(),
            width: '600px',
            onShow: () => this.initKeyForm()
        });
        
        this.modal.show();
    }
    
    createKeyForm() {
        if (this.options.mode === 'generate') {
            return this.createGenerateForm();
        } else {
            return this.createConfigureForm();
        }
    }
    
    createGenerateForm() {
        return `
            <div class="ssh-key-form">
                <div class="form-section">
                    <h5>密钥生成设置</h5>
                    <div class="form-group">
                        <label for="keyName">密钥名称</label>
                        <input type="text" class="form-control" id="keyName" 
                               value="id_rsa_${Date.now()}" placeholder="请输入密钥名称">
                    </div>
                    <div class="form-group">
                        <label for="keySize">密钥长度</label>
                        <select class="form-control" id="keySize">
                            <option value="2048">2048 bits</option>
                            <option value="3072">3072 bits</option>
                            <option value="4096" selected>4096 bits</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="keyComment">注释 (可选)</label>
                        <input type="text" class="form-control" id="keyComment" 
                               placeholder="用于标识该密钥的用途">
                    </div>
                </div>
                
                <div class="key-output" id="keyOutput" style="display: none;">
                    <h5>生成结果</h5>
                    <div class="key-display">
                        <div class="key-item">
                            <label>公钥 (id_rsa.pub)</label>
                            <textarea class="form-control" id="publicKey" rows="3" readonly></textarea>
                            <button type="button" class="btn btn-sm btn-secondary mt-2" id="copyPublicKey">复制公钥</button>
                        </div>
                        <div class="key-item">
                            <label>私钥 (id_rsa)</label>
                            <textarea class="form-control" id="privateKey" rows="8" readonly></textarea>
                            <button type="button" class="btn btn-sm btn-secondary mt-2" id="copyPrivateKey">复制私钥</button>
                        </div>
                    </div>
                    <div class="key-actions">
                        <button type="button" class="btn btn-primary" id="saveKeysBtn">保存到本地</button>
                        <button type="button" class="btn btn-success" id="configureKeysBtn">配置到主机</button>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="generateBtn">生成密钥对</button>
                </div>
            </div>
        `;
    }
    
    createConfigureForm() {
        const host = this.options.host;
        return `
            <div class="ssh-key-form">
                <div class="host-info">
                    <h5>目标主机</h5>
                    <p><strong>${host.hostname || host.ip}</strong> (${host.ip}:${host.port || 22})</p>
                </div>
                
                <div class="form-section">
                    <div class="alert alert-info">
                        <h5><span class="btn-icon">${Utils.icon('key', 13)}</span> 使用系统默认密钥</h5>
                        <p class="mb-0">将使用系统默认SSH密钥配置免密登录，无需手动选择密钥文件。</p>
                    </div>
                </div>
                
                <div class="configure-progress" id="configureProgress" style="display: none;">
                    <h5>配置进度</h5>
                    <div class="progress-steps">
                        <div class="step" id="step1">
                            <span class="step-icon">①</span>
                            <span class="step-text">连接到主机</span>
                            <span class="step-status"></span>
                        </div>
                        <div class="step" id="step2">
                            <span class="step-icon">②</span>
                            <span class="step-text">创建.ssh目录</span>
                            <span class="step-status"></span>
                        </div>
                        <div class="step" id="step3">
                            <span class="step-icon">③</span>
                            <span class="step-text">上传公钥</span>
                            <span class="step-status"></span>
                        </div>
                        <div class="step" id="step4">
                            <span class="step-icon">④</span>
                            <span class="step-text">设置权限</span>
                            <span class="step-status"></span>
                        </div>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="configureBtn">开始配置</button>
                    <button type="button" class="btn btn-success" id="completeBtn" style="display: none;">完成</button>
                </div>
            </div>
        `;
    }
    
    initKeyForm() {
        const cancelBtn = document.getElementById('cancelBtn');
        cancelBtn.addEventListener('click', () => this.modal.hide());
        
        if (this.options.mode === 'generate') {
            this.initGenerateForm();
        } else {
            this.initConfigureForm();
        }
    }
    
    initGenerateForm() {
        const generateBtn = document.getElementById('generateBtn');
        generateBtn.addEventListener('click', () => this.generateKeyPair());
        
        // 初始化生成后的事件
        document.addEventListener('keyPairGenerated', () => {
            document.getElementById('copyPublicKey').addEventListener('click', () => this.copyToClipboard('public'));
            document.getElementById('copyPrivateKey').addEventListener('click', () => this.copyToClipboard('private'));
            document.getElementById('saveKeysBtn').addEventListener('click', () => this.saveKeys());
            document.getElementById('configureKeysBtn').addEventListener('click', () => this.configureKeys());
        });
    }
    
    initConfigureForm() {
        const configureBtn = document.getElementById('configureBtn');
        const completeBtn = document.getElementById('completeBtn');
        
        configureBtn.addEventListener('click', () => this.configureSSHKey());
        completeBtn.addEventListener('click', () => this.modal.hide());
    }
    
    async generateKeyPair() {
        const generateBtn = document.getElementById('generateBtn');
        const keyOutput = document.getElementById('keyOutput');
        const keyName = document.getElementById('keyName').value;
        const keySize = parseInt(document.getElementById('keySize').value);
        const keyComment = document.getElementById('keyComment').value;
        
        generateBtn.disabled = true;
        generateBtn.textContent = '生成中...';
        
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('ssh-generate-keypair', {
                    keySize,
                    comment: keyComment
                });
                
                if (result.success) {
                    this.keyPair = result;
                    document.getElementById('publicKey').value = result.publicKey;
                    document.getElementById('privateKey').value = result.privateKey;
                    
                    keyOutput.style.display = 'block';
                    generateBtn.style.display = 'none';
                    
                    // 发送事件通知
                    document.dispatchEvent(new CustomEvent('keyPairGenerated'));
                    
                    Utils.notify.success('密钥对生成成功');
                } else {
                    throw new Error(result.message);
                }
            } else {
                throw new Error('密钥生成功能需要在Electron环境中使用');
            }
        } catch (error) {
            console.error('生成密钥对失败:', error);
            Utils.notify.error(`生成失败: ${error.message}`);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = '生成密钥对';
        }
    }
    
    async copyToClipboard(type) {
        try {
            const textArea = document.getElementById(type === 'public' ? 'publicKey' : 'privateKey');
            await navigator.clipboard.writeText(textArea.value);
            Utils.notify.success(`${type === 'public' ? '公钥' : '私钥'}已复制到剪贴板`);
        } catch (error) {
            console.error('复制失败:', error);
            Utils.notify.error('复制失败');
        }
    }
    
    async saveKeys() {
        try {
            if (!this.keyPair) {
                Utils.notify.warning('请先生成密钥对');
                return;
            }
            
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                
                // 显示私钥保存对话框
                const privateKeyResult = await ipcRenderer.invoke('show-save-dialog', {
                    title: '保存私钥文件',
                    defaultPath: 'id_rsa',
                    filters: [
                        { name: 'SSH私钥', extensions: [''] },
                        { name: '所有文件', extensions: ['*'] }
                    ]
                });
                
                if (privateKeyResult.canceled) {
                    return;
                }
                
                const privateKeyPath = privateKeyResult.filePath;
                const publicKeyPath = privateKeyPath + '.pub';
                
                // 保存密钥对
                const saveResult = await ipcRenderer.invoke('save-ssh-keys', {
                    privateKeyPath: privateKeyPath,
                    publicKeyPath: publicKeyPath,
                    privateKey: this.keyPair.privateKey,
                    publicKey: this.keyPair.publicKey
                });
                
                if (saveResult.success) {
                    Utils.notify.success(`密钥文件保存成功\n私钥: ${privateKeyPath}\n公钥: ${publicKeyPath}`);
                    
                    // 更新界面显示保存路径
                    const keyOutput = document.getElementById('keyOutput');
                    if (keyOutput) {
                        const pathInfo = document.createElement('div');
                        pathInfo.className = 'key-paths mt-3';
                        pathInfo.innerHTML = `
                            <div class="alert alert-success">
                                <strong>保存成功！</strong><br>
                                私钥: <code>${privateKeyPath}</code><br>
                                公钥: <code>${publicKeyPath}</code>
                            </div>
                        `;
                        
                        // 清除之前的路径信息
                        const existingPaths = keyOutput.querySelector('.key-paths');
                        if (existingPaths) {
                            existingPaths.remove();
                        }
                        
                        keyOutput.appendChild(pathInfo);
                    }
                } else {
                    Utils.notify.error(`保存失败: ${saveResult.message || saveResult.error}`);
                }
            } else {
                Utils.notify.info('文件保存功能需要在Electron环境中使用');
            }
        } catch (error) {
            console.error('保存密钥失败:', error);
            Utils.notify.error('保存失败');
        }
    }
    
    configureKeys() {
        // 切换到配置模式
        this.options.mode = 'configure';
        this.modal.setContent(this.createConfigureForm());
        this.initConfigureForm();
    }
    
    
    async configureSSHKey() {
        const configureBtn = document.getElementById('configureBtn');
        const completeBtn = document.getElementById('completeBtn');
        const progressSection = document.getElementById('configureProgress');
        
        configureBtn.disabled = true;
        configureBtn.textContent = '配置中...';
        progressSection.style.display = 'block';
        
        try {
            // 获取默认密钥
            let publicKey = '';
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const keyResult = await ipcRenderer.invoke('get-default-ssh-key');
                if (!keyResult.success) {
                    throw new Error(`获取默认密钥失败: ${keyResult.message}`);
                }
                publicKey = keyResult.publicKey;
            } else {
                throw new Error('需要在Electron环境中运行');
            }
            
            await this.performSSHConfiguration(publicKey);
            
            configureBtn.style.display = 'none';
            completeBtn.style.display = 'inline-block';
            
            Utils.notify.success('SSH免密配置完成');
            
            if (this.options.onComplete) {
                this.options.onComplete();
            }
        } catch (error) {
            console.error('SSH配置失败:', error);
            Utils.notify.error(`配置失败: ${error.message}`);
        } finally {
            configureBtn.disabled = false;
            configureBtn.textContent = '开始配置';
        }
    }
    
    async performSSHConfiguration(publicKey) {
        const steps = ['step1', 'step2', 'step3', 'step4'];
        const host = this.options.host;
        
        try {
            // 步顤1: 连接到主机
            this.updateStepStatus('step1', 'running');
            await Utils.sleep(500);
            
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                
                // 执行配置命令
                const result = await ipcRenderer.invoke('ssh-configure-key', {
                    host: {
                        ip: host.ip,
                        port: host.port || 22,
                        username: host.username,
                        password: host.password,
                        privateKeyPath: host.privateKeyPath
                    },
                    publicKey: publicKey
                });
                
                if (result.success) {
                    // 模拟步骤进度
                    this.updateStepStatus('step1', 'success');
                    await Utils.sleep(300);
                    
                    this.updateStepStatus('step2', 'running');
                    await Utils.sleep(500);
                    this.updateStepStatus('step2', 'success');
                    await Utils.sleep(300);
                    
                    this.updateStepStatus('step3', 'running');
                    await Utils.sleep(800);
                    this.updateStepStatus('step3', 'success');
                    await Utils.sleep(300);
                    
                    this.updateStepStatus('step4', 'running');
                    await Utils.sleep(500);
                    this.updateStepStatus('step4', 'success');
                } else {
                    throw new Error(result.message);
                }
            } else {
                throw new Error('SSH配置功能需要在Electron环境中使用');
            }
        } catch (error) {
            // 标记当前步骤为失败
            const currentStep = steps.find(stepId => {
                const step = document.getElementById(stepId);
                return step && step.querySelector('.step-status').textContent === '正在执行...';
            });
            
            if (currentStep) {
                this.updateStepStatus(currentStep, 'error');
            }
            
            throw error;
        }
    }
    
    updateStepStatus(stepId, status) {
        const step = document.getElementById(stepId);
        if (!step) return;
        
        const statusEl = step.querySelector('.step-status');
        const stepEl = step.querySelector('.step-icon');
        
        step.className = `step ${status}`;
        
        switch (status) {
            case 'running':
                statusEl.textContent = '正在执行...';
                break;
            case 'success':
                statusEl.innerHTML = Utils.icon('check', 13, 2.5);
                break;
            case 'error':
                statusEl.innerHTML = Utils.icon('x', 13, 2.5);
                break;
            default:
                statusEl.textContent = '';
        }
    }
}

// 导出组件
window.Components = {
    Modal,
    DataTable,
    FormValidator,
    Toast,
    ConfirmDialog,
    ProgressBar,
    StatusIndicator,
    HostForm,
    ExcelImportDialog,
    HostInfoDialog,
    ExcelExportDialog,
    BatchOperationDialog,
    SSHKeyDialog,
    DefaultSSHKeyDialog
};

// 创建全局实例
window.Components.toast = new Toast();