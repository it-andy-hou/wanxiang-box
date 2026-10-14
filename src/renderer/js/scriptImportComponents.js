// 脚本 JSON 备份导出 / 导入对话框，以及 .sh 脚本批量导入对话框
// JSON 备份格式（version 1）：
// {
//   format: 'wanxiang-scripts-backup',
//   version: 1,
//   exportedAt: 'ISO-8601',
//   categories: [{ id, name, parent_id, sort_order }],
//   tagValues:  [{ typeId, value }],
//   scripts:    [{ name, description, content, category, category_id, language,
//                   tags: [{ typeId, typeName, value }], author, usage_notes }]
// }

// ============================================================
// JSON 完整导出
// ============================================================
const ScriptJsonExport = {
    async perform() {
        try {
            const scriptService   = window.scriptService || new ScriptService();
            const categoryService = new window.CategoryService();
            const tagService      = new window.TagService();

            const scripts    = await scriptService.loadScripts();
            const categories = await categoryService.getAll();
            const tagTypes   = await tagService.getAllWithValues();

            const data = {
                format: 'wanxiang-scripts-backup',
                version: 1,
                exportedAt: new Date().toISOString(),
                categories: (categories || []).map(c => ({
                    id: c.id,
                    name: c.name,
                    parent_id: c.parent_id || null,
                    sort_order: c.sort_order || 0
                })),
                tagValues: (tagTypes || []).flatMap(t =>
                    (t.values || []).map(v => ({ typeId: t.id, value: v.value }))
                ),
                scripts: (scripts || []).map(s => ({
                    name: s.name,
                    description: s.description || '',
                    content: s.content || '',
                    category: s.category || 'custom',
                    category_id: s.category_id || null,
                    language: s.language || 'bash',
                    tags: (s.tags || []).map(t => ({ typeId: t.typeId, typeName: t.typeName, value: t.value })),
                    author: s.author || '',
                    usage_notes: s.usage_notes || s.usageNotes || ''
                }))
            };

            const json = JSON.stringify(data, null, 2);
            const buffer = new TextEncoder().encode(json);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            const fileName = `脚本备份_${timestamp}.json`;

            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('save-data-file', buffer, fileName, 'json');

                if (result.success) {
                    Utils.notify.success('导出成功！文件已保存');
                } else if (!result.canceled) {
                    throw new Error(result.error || '导出失败');
                }
            } else {
                // 浏览器环境，直接下载
                const blob = new Blob([json], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);

                Utils.notify.success('导出成功');
            }
            return true;
        } catch (error) {
            console.error('导出脚本备份失败:', error);
            Utils.notify.error('导出失败: ' + error.message);
            return false;
        }
    }
};

// ============================================================
// JSON 完整导入对话框
// ============================================================
class ScriptJsonImportDialog {
    constructor(options = {}) {
        this.options = {
            onImport: null,
            ...options
        };
        this.modal = null;
        this.backup = null; // 解析后的备份数据
    }

    show() {
        this.modal = new Components.Modal({
            title: '导入脚本备份（JSON）',
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
                    <h5>1. 选择备份文件</h5>
                    <div class="file-input-group">
                        <input type="file" class="form-control-file" id="scriptJsonFile" accept=".json,application/json" style="display: none;">
                        <div class="input-group">
                            <input type="text" class="form-control" id="scriptJsonFileName" placeholder="请选择 JSON 备份文件" readonly>
                            <div class="input-group-append">
                                <button class="btn btn-outline-primary" type="button" id="selectScriptJsonBtn">选择文件</button>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3">
                        <small class="text-muted">
                            备份文件包含脚本、目录结构与标签，导入时将自动重建缺失的目录并补建缺失的标签值。<br>
                            ${Utils.icon('info', 11)} 与本地同名脚本将使用备份数据覆盖更新
                        </small>
                    </div>
                </div>

                <div class="import-section" id="scriptJsonPreviewSection" style="display: none;">
                    <h5>2. 导入预览</h5>
                    <div class="import-summary" id="scriptJsonSummary"></div>
                </div>

                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelScriptJsonBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="importScriptJsonConfirmBtn" disabled>开始导入</button>
                </div>
            </div>
        `;
    }

    initImportForm() {
        const selectBtn = document.getElementById('selectScriptJsonBtn');
        const fileInput = document.getElementById('scriptJsonFile');
        const cancelBtn = document.getElementById('cancelScriptJsonBtn');
        const importBtn = document.getElementById('importScriptJsonConfirmBtn');

        selectBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                document.getElementById('scriptJsonFileName').value = file.name;
                this.parseJsonFile(file);
            }
        });

        cancelBtn.addEventListener('click', () => this.modal.hide());
        importBtn.addEventListener('click', () => this.performImport());
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file, 'utf-8');
        });
    }

    async parseJsonFile(file) {
        try {
            const text = await this.readFileAsText(file);
            let backup;
            try {
                backup = JSON.parse(text);
            } catch (e) {
                throw new Error('文件不是有效的 JSON 格式');
            }

            if (!backup || backup.format !== 'wanxiang-scripts-backup') {
                throw new Error('不是本应用的脚本备份文件');
            }
            if (!Array.isArray(backup.scripts)) {
                throw new Error('备份数据缺少脚本列表');
            }

            this.backup = {
                format: backup.format,
                version: backup.version || 1,
                exportedAt: backup.exportedAt,
                categories: Array.isArray(backup.categories) ? backup.categories : [],
                tagValues: Array.isArray(backup.tagValues) ? backup.tagValues : [],
                scripts: backup.scripts
            };

            await this.showPreview();
        } catch (error) {
            console.error('解析备份文件失败:', error);
            this.backup = null;
            document.getElementById('scriptJsonPreviewSection').style.display = 'none';
            document.getElementById('importScriptJsonConfirmBtn').disabled = true;
            Utils.notify.error(`解析备份文件失败: ${error.message}`);
        }
    }

    // 计算目录匹配结果：同父目录下同名视为同一目录，缺失的按原层级重建
    resolveCategoryMap(localCategories) {
        const localKey = (name, parentId) => `${String(parentId || '')}|${name}`;
        const localByName = new Map();
        (localCategories || []).forEach(c => {
            const key = localKey(c.name, c.parent_id);
            if (!localByName.has(key)) localByName.set(key, c);
        });

        // 备份目录先父后子排序
        const backupCats = this.backup.categories;
        const depthOf = (c, guard = 0) => {
            let d = 0, cur = c;
            while (cur && cur.parent_id && guard++ < 10) {
                cur = backupCats.find(x => String(x.id) === String(cur.parent_id));
                d++;
            }
            return d;
        };
        const sorted = [...backupCats].sort((a, b) => depthOf(a) - depthOf(b));

        const catMap = {}; // 备份目录id -> 本地目录id
        const toCreate = [];
        sorted.forEach(c => {
            const mappedParent = c.parent_id ? catMap[String(c.parent_id)] : null;
            const local = localByName.get(localKey(c.name, mappedParent));
            if (local) {
                catMap[String(c.id)] = local.id;
            } else {
                // parentId：已解析的本地父目录id；pendingParentId：父目录尚未创建/未匹配，保留备份id待执行时换算
                toCreate.push({
                    id: c.id,
                    name: c.name,
                    parentId: mappedParent === undefined ? null : mappedParent,
                    pendingParentId: mappedParent === undefined ? c.parent_id : null,
                    sort_order: c.sort_order || 0
                });
            }
        });
        return { catMap, toCreate };
    }

    async showPreview() {
        const categoryService = new window.CategoryService();
        const tagService      = new window.TagService();
        const scriptService   = window.scriptService || new ScriptService();

        let localCategories = [], tagTypes = [], localScripts = [];
        try { localCategories = await categoryService.getAll(); } catch (e) { console.error('加载本地目录失败:', e); }
        try { tagTypes = await tagService.getAllWithValues(); } catch (e) { console.error('加载本地标签失败:', e); }
        try { localScripts = await scriptService.loadScripts(); } catch (e) { console.error('加载本地脚本失败:', e); }

        const { toCreate } = this.resolveCategoryMap(localCategories);

        // 待补建的标签值
        const localTagSet = new Set();
        (tagTypes || []).forEach(t => (t.values || []).forEach(v => localTagSet.add(`${t.id}:${v.value}`)));
        const tagValuesToCreate = this.backup.tagValues.filter(tv => !localTagSet.has(`${tv.typeId}:${tv.value}`));

        // 同名冲突
        const localNames = new Set(localScripts.map(s => s.name));
        const conflicts = this.backup.scripts.filter(s => localNames.has(s.name));
        const newCount = this.backup.scripts.length - conflicts.length;

        // 目录路径（用于预览展示）
        const pathOf = (c) => {
            const names = [];
            let cur = c, guard = 0;
            while (cur && guard++ < 10) {
                names.unshift(cur.name);
                cur = this.backup.categories.find(x => String(x.id) === String(cur.parent_id));
            }
            return names.join('/');
        };

        const previewSection = document.getElementById('scriptJsonPreviewSection');
        const summaryDiv = document.getElementById('scriptJsonSummary');
        const importBtn = document.getElementById('importScriptJsonConfirmBtn');

        previewSection.style.display = 'block';
        const conflictHtml = conflicts.length > 0
            ? `<br>将覆盖更新的同名脚本（前 10 条）：${conflicts.slice(0, 10).map(s => escapeShHtml(s.name)).join('、')}${conflicts.length > 10 ? ' 等' : ''}`
            : '';

        summaryDiv.innerHTML = `
            <div class="alert alert-info">
                <strong>导入预览:</strong><br>
                脚本：新增 ${newCount} 个，覆盖更新 ${conflicts.length} 个<br>
                待重建目录：${toCreate.length} 个${toCreate.length > 0 ? '（' + toCreate.slice(0, 10).map(c => escapeShHtml(pathOf(c))).join('、') + (toCreate.length > 10 ? ' 等' : '') + '）' : ''}<br>
                待补建标签值：${tagValuesToCreate.length} 个${tagValuesToCreate.length > 0 ? '（' + tagValuesToCreate.slice(0, 10).map(tv => escapeShHtml(tv.value)).join('、') + (tagValuesToCreate.length > 10 ? ' 等' : '') + '）' : ''}
                ${conflictHtml}
            </div>
        `;

        importBtn.disabled = this.backup.scripts.length === 0;
    }

    async performImport() {
        if (!this.backup || this.backup.scripts.length === 0) {
            Utils.notify.error('没有可导入的数据');
            return;
        }

        const importBtn = document.getElementById('importScriptJsonConfirmBtn');
        importBtn.disabled = true;
        importBtn.textContent = '导入中...';

        try {
            const categoryService = new window.CategoryService();
            const tagService      = new window.TagService();
            const scriptService   = window.scriptService || new ScriptService();

            // 1. 目录：先按同父同名匹配，缺失的按原层级重建
            const localCategories = await categoryService.getAll();
            const { catMap, toCreate } = this.resolveCategoryMap(localCategories);
            for (const c of toCreate) {
                const realParent = c.pendingParentId !== null
                    ? (catMap[String(c.pendingParentId)] !== undefined ? catMap[String(c.pendingParentId)] : null)
                    : c.parentId;
                const created = await categoryService.create({
                    name: c.name,
                    parent_id: realParent,
                    sort_order: c.sort_order
                });
                catMap[String(c.id)] = created.id;
            }

            // 2. 标签值：补建本地缺失的值（含自定义标签）
            const tagTypes = await tagService.getAllWithValues();
            const localTagSet = new Set();
            (tagTypes || []).forEach(t => (t.values || []).forEach(v => localTagSet.add(`${t.id}:${v.value}`)));
            for (const tv of this.backup.tagValues) {
                if (!localTagSet.has(`${tv.typeId}:${tv.value}`)) {
                    await tagService.createValue(tv.typeId, tv.value);
                    localTagSet.add(`${tv.typeId}:${tv.value}`);
                }
            }

            // 3. 脚本：同名覆盖更新，否则新增
            const localScripts = await scriptService.loadScripts();
            const byName = new Map(localScripts.map(s => [s.name, s]));
            let imported = 0, updated = 0;
            const errors = [];

            for (const s of this.backup.scripts) {
                try {
                    const categoryId = s.category_id ? (catMap[String(s.category_id)] ?? null) : null;
                    const data = {
                        name: (s.name || '').trim(),
                        description: s.description || '',
                        content: s.content || '',
                        category: s.category || 'custom',
                        category_id: categoryId,
                        language: s.language || 'bash',
                        tags: (s.tags || []).map(t => ({ typeId: Number(t.typeId) || 4, typeName: t.typeName, value: String(t.value || '').trim() })).filter(t => t.value),
                        author: s.author || '',
                        usage_notes: s.usage_notes || ''
                    };

                    if (!data.name || !data.content) {
                        errors.push(`「${data.name || '未命名'}」: 缺少必填字段（脚本名称、脚本内容）`);
                        continue;
                    }

                    const existing = byName.get(data.name);
                    if (existing) {
                        await scriptService.updateScript(existing.id, data);
                        updated++;
                    } else {
                        await scriptService.addScript(data);
                        imported++;
                    }
                } catch (error) {
                    errors.push(`「${s.name || '未命名'}」: ${error.message}`);
                }
            }

            this.modal.hide();

            if (errors.length > 0) {
                Utils.notify.warning(`导入完成！新增: ${imported}, 更新: ${updated}, 失败: ${errors.length}`);
                console.log('导入错误:', errors);
            } else {
                Utils.notify.success(`导入完成！新增 ${imported} 个，覆盖更新 ${updated} 个`);
            }

            if (this.options.onImport) {
                this.options.onImport({ imported, updated, errors });
            }
        } catch (error) {
            console.error('导入脚本备份失败:', error);
            Utils.notify.error('导入失败: ' + error.message);
            importBtn.disabled = false;
            importBtn.textContent = '开始导入';
        }
    }
}

// .sh 脚本批量导入对话框
// 文件选择与读取在调用方完成，本对话框负责确认信息（归属目录 + 文件列表）
class ScriptShImportDialog {
    constructor(options = {}) {
        this.options = {
            onImport: null,
            filesData: [], // [{ name, content, originalFileName }] 必传，支持一个或多个
            ...options
        };
        this.modal = null;
        this.categories = []; // 目录列表
    }

    async show() {
        if (!Array.isArray(this.options.filesData) || this.options.filesData.length === 0) {
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
            title: this.options.filesData.length > 1 ? `批量导入 .sh 脚本（${this.options.filesData.length} 个）` : '单独导入 .sh 脚本',
            content: this.createForm(),
            width: '520px',
            onShow: () => this.initForm()
        });
        this.modal.show();
    }

    // 构建两层（父/子）目录选项：父目录为可选分组，子目录缩进显示
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
        const fileListHtml = this.options.filesData.map(f =>
            `<li>${escapeShHtml(f.originalFileName || (f.name + '.sh'))} → 脚本名「${escapeShHtml(f.name)}」</li>`
        ).join('');

        return `
            <div class="sh-import-form">
                <div class="import-section">
                    <div style="margin-bottom:0.5rem;color:var(--text-muted);font-size:0.875rem;">
                        文件列表：
                        <ul style="margin:0.35rem 0 0 1.2rem;padding:0;color:var(--text-heading);font-size:0.85rem;max-height:10rem;overflow-y:auto;">
                            ${fileListHtml}
                        </ul>
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label>统一归属目录</label>
                        <select class="form-control" id="shScriptCategory">${catOptions}</select>
                    </div>
                </div>

                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelShImportBtn">取消</button>
                    <button type="button" class="btn btn-primary" id="confirmShImportBtn">导入 ${this.options.filesData.length} 个脚本</button>
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
        const files = this.options.filesData;
        if (!files || files.length === 0) return;

        const catSelect  = document.getElementById('shScriptCategory');
        const categoryId = catSelect && catSelect.value ? parseInt(catSelect.value) : null;

        const confirmBtn = document.getElementById('confirmShImportBtn');
        confirmBtn.disabled = true;
        confirmBtn.textContent = '导入中...';

        let success = 0;
        const errors = [];

        try {
            const scriptService = window.scriptService || new ScriptService();
            for (const file of files) {
                const scriptName = (file.name || '').trim();
                try {
                    if (!scriptName) {
                        errors.push('脚本名称为空');
                        continue;
                    }
                    await scriptService.addScript({
                        name: scriptName,
                        description: '',
                        content: file.content,
                        category: 'custom',
                        category_id: categoryId,
                        language: 'bash',
                        tags: [],
                        author: '',
                        usage_notes: ''
                    });
                    success++;
                } catch (error) {
                    errors.push(`「${scriptName || '未命名'}」: ${error.message}`);
                }
            }

            if (errors.length > 0) {
                Utils.notify.warning(`导入完成！成功: ${success}, 失败: ${errors.length}`);
                console.log('导入错误:', errors);
            } else {
                Utils.notify.success(`成功导入 ${success} 个脚本`);
            }

            this.modal.hide();

            if (this.options.onImport) {
                this.options.onImport({ success, errors });
            }
        } catch (error) {
            console.error('导入 .sh 脚本失败:', error);
            Utils.notify.error('导入失败: ' + error.message);
            confirmBtn.disabled = false;
            confirmBtn.textContent = `导入 ${files.length} 个脚本`;
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
window.Components.ScriptJsonExport = ScriptJsonExport;
window.Components.ScriptJsonImportDialog = ScriptJsonImportDialog;
window.Components.ScriptShImportDialog = ScriptShImportDialog;
