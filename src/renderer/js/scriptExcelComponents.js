// 脚本 Excel 导入对话框
class ScriptExcelImportDialog {
    constructor(options = {}) {
        this.options = {
            onImport: null,
            ...options
        };
        this.modal = null;
        this.excelData = null;
    }
    
    show() {
        this.modal = new Components.Modal({
            title: 'Excel批量导入脚本',
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
                        <input type="file" class="form-control-file" id="scriptExcelFile" accept=".xlsx,.xls" style="display: none;">
                        <div class="input-group">
                            <input type="text" class="form-control" id="scriptExcelFileName" placeholder="请选择Excel文件" readonly>
                            <div class="input-group-append">
                                <button class="btn btn-outline-primary" type="button" id="selectScriptFileBtn">选择文件</button>
                                <button class="btn btn-outline-success" type="button" id="downloadScriptTemplateBtn" title="下载导入模板">下载模板</button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="mt-3">
                        <small class="text-muted">
                            Excel文件:<br>
                            • 第一行为表头:脚本名称,描述,脚本内容,分类,语言,标签,作者,使用说明<br>
                            • ${Utils.icon('info', 11)} 首次导入?点击「下载模板」获取标准格式文件
                        </small>
                    </div>
                </div>
                
                <div class="import-section" id="scriptPreviewSection" style="display: none;">
                    <h5>2. 数据预览</h5>
                    <div class="table-responsive">
                        <table class="table table-sm" id="scriptPreviewTable">
                            <thead></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                    <div class="import-summary" id="scriptImportSummary"></div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelScriptImportBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="importScriptBtn" disabled>开始导入</button>
                </div>
            </div>
        `;
    }
    
    initImportForm() {
        const selectBtn = document.getElementById('selectScriptFileBtn');
        const downloadTemplateBtn = document.getElementById('downloadScriptTemplateBtn');
        const fileInput = document.getElementById('scriptExcelFile');
        const fileNameInput = document.getElementById('scriptExcelFileName');
        const cancelBtn = document.getElementById('cancelScriptImportBtn');
        const importBtn = document.getElementById('importScriptBtn');
        
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
                ['脚本名称', '描述', '脚本内容', '分类', '语言', '标签', '作者', '使用说明'],
                // 示例数据
                ['示例脚本', '这是一个示例脚本', '#!/bin/bash\necho "Hello World"', 'custom', 'bash', '示例,测试', '管理员', '直接运行即可']
            ];
            
            // 创建工作表
            const worksheet = XLSX.utils.aoa_to_sheet(templateData);
            
            // 设置列宽
            const colWidths = [
                { wch: 20 },  // 脚本名称
                { wch: 30 },  // 描述
                { wch: 50 },  // 脚本内容
                { wch: 12 },  // 分类
                { wch: 10 },  // 语言
                { wch: 20 },  // 标签
                { wch: 12 },  // 作者
                { wch: 30 }   // 使用说明
            ];
            worksheet['!cols'] = colWidths;
            
            // 创建工作簿
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '脚本导入模板');
            
            // 生成Excel文件
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            // 下载文件
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'SSH脚本导入模板.xlsx';
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
                const scriptData = {};
                Object.keys(headerMap).forEach(key => {
                    const index = headerMap[key];
                    const value = index !== -1 && row[index] !== undefined ? String(row[index]).trim() : '';
                    scriptData[key] = value;
                });
                return scriptData;
            }).filter(script => script.name); // 过滤空行(至少需要脚本名称)
            
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
            name: -1,
            description: -1,
            content: -1,
            category: -1,
            language: -1,
            tags: -1,
            author: -1,
            usage_notes: -1
        };
        
        headers.forEach((header, index) => {
            const normalizedHeader = header.toLowerCase().trim();
            
            // 英文表头映射
            if (normalizedHeader === 'name') mapping.name = index;
            else if (normalizedHeader === 'description') mapping.description = index;
            else if (normalizedHeader === 'content') mapping.content = index;
            else if (normalizedHeader === 'category') mapping.category = index;
            else if (normalizedHeader === 'language') mapping.language = index;
            else if (normalizedHeader === 'tags') mapping.tags = index;
            else if (normalizedHeader === 'author') mapping.author = index;
            else if (normalizedHeader === 'usage_notes') mapping.usage_notes = index;
            
            // 中文表头映射
            else if (normalizedHeader === '脚本名称') mapping.name = index;
            else if (normalizedHeader === '描述') mapping.description = index;
            else if (normalizedHeader === '脚本内容') mapping.content = index;
            else if (normalizedHeader === '分类') mapping.category = index;
            else if (normalizedHeader === '语言') mapping.language = index;
            else if (normalizedHeader === '标签') mapping.tags = index;
            else if (normalizedHeader === '作者') mapping.author = index;
            else if (normalizedHeader === '使用说明') mapping.usage_notes = index;
        });
        
        return mapping;
    }
    
    showPreview(headers, data) {
        const previewSection = document.getElementById('scriptPreviewSection');
        const previewTable = document.getElementById('scriptPreviewTable');
        const importBtn = document.getElementById('importScriptBtn');
        const summaryDiv = document.getElementById('scriptImportSummary');
        
        // 显示预览区域
        previewSection.style.display = 'block';
        
        // 生成表头
        const thead = previewTable.querySelector('thead');
        thead.innerHTML = `
            <tr>
                ${['脚本名称', '描述', '分类', '语言'].map(h => `<th>${h}</th>`).join('')}
            </tr>
        `;
        
        // 生成预览数据(前5行)
        const tbody = previewTable.querySelector('tbody');
        const previewRows = data.slice(0, 5);
        tbody.innerHTML = previewRows.map(row => `
            <tr>
                <td>${row.name || '-'}</td>
                <td>${row.description || '-'}</td>
                <td>${row.category || 'custom'}</td>
                <td>${row.language || 'bash'}</td>
            </tr>
        `).join('');
        
        // 显示总结
        summaryDiv.innerHTML = `
            <div class="alert alert-info">
                <strong>导入预览:</strong>共找到 ${data.length} 条数据。
                ${data.length > 5 ? `<br>仅显示前 5 条数据。` : ''}
            </div>
        `;
        
        // 启用导入按钮
        importBtn.disabled = false;
    }
    
    async performImport() {
        if (!this.excelData || this.excelData.length === 0) {
            Utils.notify.error('没有可导入的数据');
            return;
        }
        
        const importBtn = document.getElementById('importScriptBtn');
        importBtn.disabled = true;
        importBtn.textContent = '导入中...';
        
        try {
            const scriptService = window.scriptService || new ScriptService();
            const result = await scriptService.importFromExcel(this.excelData);
            
            this.modal.hide();
            
            if (result.errors.length > 0) {
                Utils.notify.warning(`导入完成!成功: ${result.imported}, 失败: ${result.errors.length}`);
                console.log('导入错误:', result.errors);
            } else {
                Utils.notify.success(`成功导入 ${result.imported} 条脚本`);
            }
            
            if (this.options.onImport) {
                this.options.onImport(result);
            }
            
        } catch (error) {
            console.error('导入失败:', error);
            Utils.notify.error('导入失败: ' + error.message);
        } finally {
            importBtn.disabled = false;
            importBtn.textContent = '开始导入';
        }
    }
}

// 脚本 Excel 导出对话框
class ScriptExcelExportDialog {
    constructor(options = {}) {
        this.options = {
            scripts: [],
            ...options
        };
        this.modal = null;
        this.selectedFields = {
            name: true,
            description: true,
            content: true,
            category: true,
            language: true,
            tags: true,
            author: false,
            usage_notes: false
        };
    }
    
    show() {
        this.modal = new Components.Modal({
            title: 'Excel导出设置',
            content: this.createExportForm(),
            width: '900px',
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
                            <input type="checkbox" name="name" checked> 脚本名称
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="description" checked> 描述
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="content" checked> 脚本内容
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="category" checked> 分类
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="language" checked> 语言
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="tags" checked> 标签
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="author"> 作者
                        </label>
                        <label class="field-checkbox">
                            <input type="checkbox" name="usage_notes"> 使用说明
                        </label>
                    </div>
                </div>
                
                <div class="export-section">
                    <h5>导出选项</h5>
                    <div class="export-options">
                        <label class="field-checkbox">
                            <input type="checkbox" id="includeHeaders" checked> 包含表头
                        </label>
                    </div>
                </div>
                
                <div class="export-section">
                    <h5>预览</h5>
                    <div class="export-preview" id="scriptExportPreview">
                        <p class="text-muted">请选择字段查看预览</p>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelScriptExportBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="exportScriptBtn">导出 Excel</button>
                </div>
            </div>
        `;
    }
    
    initExportForm() {
        const cancelBtn = document.getElementById('cancelScriptExportBtn');
        const exportBtn = document.getElementById('exportScriptBtn');
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
        const previewDiv = document.getElementById('scriptExportPreview');
        
        if (Object.keys(selectedFields).length === 0) {
            previewDiv.innerHTML = '<p class="text-muted">请至少选择一个字段</p>';
            return;
        }
        
        // 生成预览数据(前3行)
        const headers = Object.keys(selectedFields);
        const previewData = this.options.scripts.slice(0, 3).map(script => 
            headers.map(field => this.getFieldValue(script, field))
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
                // 截断过长的内容
                const displayValue = value && value.length > 50 ? value.substring(0, 50) + '...' : value;
                td.textContent = displayValue || '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        
        previewDiv.innerHTML = '';
        previewDiv.appendChild(table);
        
        if (this.options.scripts.length > 3) {
            const moreInfo = document.createElement('p');
            moreInfo.className = 'text-muted mt-2';
            moreInfo.textContent = `显示前3行,共${this.options.scripts.length}行数据`;
            previewDiv.appendChild(moreInfo);
        }
    }
    
    getSelectedFields() {
        const selected = {};
        const checkboxes = document.querySelectorAll('.field-checkbox input[type="checkbox"]:not(#includeHeaders)');
        
        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                selected[checkbox.name] = true;
            }
        });
        
        return selected;
    }
    
    getFieldValue(script, field) {
        switch (field) {
            case 'name': return script.name || '';
            case 'description': return script.description || '';
            case 'content': return script.content || '';
            case 'category': return script.category || 'custom';
            case 'language': return script.language || 'bash';
            case 'tags': return Array.isArray(script.tags) ? script.tags.join(',') : (script.tags || '');
            case 'author': return script.author || '';
            case 'usage_notes': return script.usage_notes || '';
            default: return '';
        }
    }
    
    getFieldLabel(field) {
        const labels = {
            name: '脚本名称',
            description: '描述',
            content: '脚本内容',
            category: '分类',
            language: '语言',
            tags: '标签',
            author: '作者',
            usage_notes: '使用说明'
        };
        return labels[field] || field;
    }
    
    async performExport() {
        const selectedFields = this.getSelectedFields();
        
        if (Object.keys(selectedFields).length === 0) {
            Utils.notify.warning('请至少选择一个字段');
            return;
        }
        
        try {
            const XLSX = require('xlsx');
            const includeHeaders = document.getElementById('includeHeaders').checked;
            
            // 准备数据
            const headers = Object.keys(selectedFields);
            const data = [];
            
            // 添加表头
            if (includeHeaders) {
                data.push(headers.map(field => this.getFieldLabel(field)));
            }
            
            // 添加数据行
            this.options.scripts.forEach(script => {
                const row = headers.map(field => this.getFieldValue(script, field));
                data.push(row);
            });
            
            // 创建工作表
            const worksheet = XLSX.utils.aoa_to_sheet(data);
            
            // 设置列宽
            const colWidths = headers.map(field => {
                if (field === 'content') return { wch: 60 };
                if (field === 'description' || field === 'usage_notes') return { wch: 40 };
                if (field === 'name') return { wch: 25 };
                return { wch: 15 };
            });
            worksheet['!cols'] = colWidths;
            
            // 设置包含脚本内容的单元格样式：自动换行
            const contentColumnIndex = headers.indexOf('content');
            if (contentColumnIndex !== -1) {
                const startRow = includeHeaders ? 2 : 1; // 如果有表头，从第2行开始
                for (let i = 0; i < this.options.scripts.length; i++) {
                    const cellAddress = XLSX.utils.encode_cell({ r: startRow + i - 1, c: contentColumnIndex });
                    if (!worksheet[cellAddress]) continue;
                    
                    // 设置单元格样式：自动换行
                    if (!worksheet[cellAddress].s) worksheet[cellAddress].s = {};
                    worksheet[cellAddress].s.alignment = { wrapText: true, vertical: 'top' };
                }
            }
            
            // 同样为使用说明字段设置自动换行
            const usageNotesColumnIndex = headers.indexOf('usage_notes');
            if (usageNotesColumnIndex !== -1) {
                const startRow = includeHeaders ? 2 : 1;
                for (let i = 0; i < this.options.scripts.length; i++) {
                    const cellAddress = XLSX.utils.encode_cell({ r: startRow + i - 1, c: usageNotesColumnIndex });
                    if (!worksheet[cellAddress]) continue;
                    
                    if (!worksheet[cellAddress].s) worksheet[cellAddress].s = {};
                    worksheet[cellAddress].s.alignment = { wrapText: true, vertical: 'top' };
                }
            }
            
            // 创建工作簿
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '脚本列表');
            
            // 生成Excel文件
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            
            // 保存文件
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                const fileName = `脚本导出_${timestamp}.xlsx`;
                
                const result = await ipcRenderer.invoke('save-excel-file', excelBuffer, fileName);
                
                if (result.success) {
                    Utils.notify.success('导出成功!文件已保存');
                    this.modal.hide();
                } else if (!result.canceled) {
                    throw new Error(result.error || '导出失败');
                }
            } else {
                // 浏览器环境,直接下载
                const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `脚本导出_${new Date().getTime()}.xlsx`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                
                Utils.notify.success('导出成功');
                this.modal.hide();
            }
            
        } catch (error) {
            console.error('导出失败:', error);
            Utils.notify.error('导出失败: ' + error.message);
        }
    }
}

// .sh 脚本单独导入对话框
// 优化：仅负责展示「确认信息」（脚本名称 + 归属目录），文件选择与读取在调用方完成
class ScriptShImportDialog {
    constructor(options = {}) {
        this.options = {
            onImport: null,
            fileData: null, // { name, content, originalFileName } 必传
            ...options
        };
        this.modal = null;
        this.fileData = this.options.fileData;
        this.categories = []; // 目录列表
    }

    async show() {
        if (!this.fileData || !this.fileData.content) {
            Utils.notify.error('未接收到脚本文件内容');
            return;
        }

        // 先加载目录列表
        try {
            const catSvc = new window.CategoryService();
            this.categories = await catSvc.getAll();
        } catch (e) {
            this.categories = [];
        }

        this.modal = new Components.Modal({
            title: '单独导入 .sh 脚本',
            content: this.createForm(),
            width: '520px',
            onShow: () => this.initForm()
        });
        this.modal.show();
    }

    // 构建两层（父/子）目录选项：父目录为不可选的分组标题，子目录缩进显示
    buildCategoryOptions() {
        const topCats = this.categories.filter(c => !c.parent_id);
        let html = '<option value="">未分类（默认）</option>';

        topCats.forEach(parent => {
            const children = this.categories.filter(c => String(c.parent_id) === String(parent.id));
            // 父目录本身可选
            html += `<option value="${parent.id}">${escapeShHtml(parent.name)}</option>`;
            // 子目录缩进一层显示
            children.forEach(child => {
                html += `<option value="${child.id}">　　└ ${escapeShHtml(child.name)}</option>`;
            });
        });

        // 处理一些 parent_id 指向不存在父级的孤立子目录（容错）
        const topIds = new Set(topCats.map(c => String(c.id)));
        const orphans = this.categories.filter(c => c.parent_id && !topIds.has(String(c.parent_id)));
        orphans.forEach(o => {
            html += `<option value="${o.id}">${escapeShHtml(o.name)}</option>`;
        });

        return html;
    }

    createForm() {
        const catOptions = this.buildCategoryOptions();
        const fileNameDisplay = escapeShHtml(this.fileData.originalFileName || (this.fileData.name + '.sh'));

        return `
            <div class="sh-import-form">
                <div class="import-section">
                    <div style="margin-bottom:0.5rem;color:var(--text-muted);font-size:0.875rem;">
                        文件：<span style="color:var(--text-heading);">${fileNameDisplay}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                        <div class="form-group" style="margin-bottom:0;">
                            <label>脚本名称</label>
                            <input type="text" class="form-control" id="shScriptName" value="${escapeShHtml(this.fileData.name)}">
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label>归属目录</label>
                            <select class="form-control" id="shScriptCategory">${catOptions}</select>
                        </div>
                    </div>
                </div>

                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelShImportBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="confirmShImportBtn">确认导入</button>
                </div>
            </div>
        `;
    }

    initForm() {
        const cancelBtn  = document.getElementById('cancelShImportBtn');
        const confirmBtn = document.getElementById('confirmShImportBtn');

        if (cancelBtn) cancelBtn.addEventListener('click', () => this.modal.hide());
        if (confirmBtn) confirmBtn.addEventListener('click', () => this.performImport());
    }

    async performImport() {
        if (!this.fileData) return;

        const nameInput   = document.getElementById('shScriptName');
        const catSelect   = document.getElementById('shScriptCategory');
        const scriptName  = (nameInput ? nameInput.value : this.fileData.name).trim();
        const categoryId  = catSelect && catSelect.value ? parseInt(catSelect.value) : null;

        if (!scriptName) {
            Utils.notify.warning('脚本名称不能为空');
            return;
        }

        const confirmBtn = document.getElementById('confirmShImportBtn');
        confirmBtn.disabled = true;
        confirmBtn.textContent = '导入中...';

        try {
            const scriptService = window.scriptService || new ScriptService();
            await scriptService.addScript({
                name: scriptName,
                description: '',
                content: this.fileData.content,
                category: 'custom',
                category_id: categoryId,
                language: 'bash',
                tags: [],
                author: '',
                usage_notes: ''
            });

            Utils.notify.success(`脚本「${scriptName}」导入成功`);
            this.modal.hide();

            if (this.options.onImport) {
                this.options.onImport({ name: scriptName });
            }
        } catch (error) {
            console.error('导入 .sh 脚本失败:', error);
            Utils.notify.error('导入失败: ' + error.message);
            confirmBtn.disabled = false;
            confirmBtn.textContent = '确认导入';
        }
    }
}

// 辅助转义函数
function escapeShHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 导出到全局
window.Components = window.Components || {};
window.Components.ScriptExcelImportDialog = ScriptExcelImportDialog;
window.Components.ScriptExcelExportDialog = ScriptExcelExportDialog;
window.Components.ScriptShImportDialog = ScriptShImportDialog;
