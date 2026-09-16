// 脚本管理页面逻辑
(function() {
    'use strict';

    let scriptService;
    let categoryService;
    let tagService;
    let currentScripts = [];
    let filteredScripts = [];
    let currentSortField = 'updated_at';
    let currentSortOrder = 'desc';
    let currentCategoryFilter = null;   // null = 全部
    let currentTagTypeFilter  = '';     // typeId 字符串 or ''
    let currentTagValueFilter = '';     // value 字符串 or ''
    let allCategories       = [];       // 所有目录（平展）
    let tagTypesWithValues  = [];       // [{id,name,is_system,values:[...]}]

    // 初始化
    async function init() {
        console.log('初始化脚本管理页面...');
        scriptService   = new window.ScriptService();
        categoryService = new window.CategoryService();
        tagService      = new window.TagService();
        bindEvents();
        await Promise.all([loadCategories(), loadTagTypes(), loadScripts()]);
    }

    // 绑定事件
    function bindEvents() {
        console.log('绑定脚本管理事件...');
        
        // 添加脚本按钮
        const addScriptBtn = document.getElementById('addScriptBtn');
        console.log('addScriptBtn:', addScriptBtn);
        if (addScriptBtn) {
            addScriptBtn.addEventListener('click', showAddScriptDialog);
            console.log('已绑定添加脚本按钮事件');
        } else {
            console.warn('未找到addScriptBtn元素');
        }

        // 刷新按钮
        const refreshBtn = document.getElementById('refreshScriptsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadScripts);
        }

        // 导入导出按钮
        const importSingleBtn = document.getElementById('importSingleScriptBtn');
        if (importSingleBtn) {
            importSingleBtn.addEventListener('click', importSingleScript);
        }

        const importBtn = document.getElementById('importScriptExcelBtn');
        if (importBtn) {
            importBtn.addEventListener('click', importScripts);
        }
        
        const exportBtn = document.getElementById('exportScriptExcelBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportScripts);
        }

        // 目录管理
        const manageCatBtn = document.getElementById('manageCategoriesBtn');
        if (manageCatBtn) manageCatBtn.addEventListener('click', showCategoryManageDialog);

        // 搜索
        const searchInput    = document.getElementById('scriptSearchInput');
        const searchBtn      = document.getElementById('searchScriptBtn');
        const clearSearchBtn = document.getElementById('clearScriptSearchBtn');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(handleSearch, 300));
            searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearch(); });
        }
        if (searchBtn)      searchBtn.addEventListener('click', handleSearch);
        if (clearSearchBtn) clearSearchBtn.addEventListener('click', clearSearch);

        // 标签类型过滤
        const tagTypeFilter = document.getElementById('scriptTagTypeFilter');
        if (tagTypeFilter) tagTypeFilter.addEventListener('change', handleTagTypeFilter);

        // 标签值过滤
        const tagValueFilter = document.getElementById('scriptTagValueFilter');
        if (tagValueFilter) tagValueFilter.addEventListener('change', handleTagValueFilter);

        // 排序
        bindSortEvents();
    }

    // 绑定排序事件
    function bindSortEvents() {
        const sortableHeaders = document.querySelectorAll('#scriptsTable th.sortable');
        sortableHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const sortField = header.dataset.sort;
                handleSort(sortField);
            });
        });
        applySorting();
    }

    // 加载脚本列表
    // 加载目录树
    async function loadCategories() {
        try {
            const data = await categoryService.getAll();
            // 防御性去重：按 id 去重，避免重复记录导致目录显示两次
            const seen = new Set();
            allCategories = data.filter(c => {
                if (seen.has(String(c.id))) return false;
                seen.add(String(c.id));
                return true;
            });
            renderCategoryTree();
        } catch (e) {
            console.error('加载目录失败:', e);
        }
    }

    // 加载标签类型（目前类型已固定，仅初始化类型下拉即可）
    async function loadTagTypes() {
        try {
            tagTypesWithValues = await tagService.getAllWithValues();
        } catch (e) {
            console.error('加载标签类型失败:', e);
        } finally {
            // 无论数据库请求是否成功，类型下拉始终用固定列表
            updateTagTypeFilter();
        }
    }

    async function loadScripts() {
        try {
            console.log('加载脚本列表...');
            currentScripts = await scriptService.loadScripts();
            console.log(`加载了 ${currentScripts.length} 个脚本`);
            // 重新应用当前筛选条件（保持目录/搜索/标签状态，避免保存后丢失目录筛选）
            const searchInput = document.getElementById('scriptSearchInput');
            applyFilters(searchInput ? searchInput.value.trim() : '', currentTagTypeFilter, currentTagValueFilter);
            // 脚本数据加载完成后同步更新目录树计数（避免并行加载时计数显示为 0）
            renderCategoryTree();
            // 脚本刷新后同步更新标签值下拉（环境/架构标签值来自实际脚本）
            if (currentTagTypeFilter) updateTagValueFilter(currentTagTypeFilter);
        } catch (error) {
            console.error('加载脚本列表失败:', error);
            showMessage('加载脚本列表失败: ' + error.message, 'error');
        }
    }

    // 渲染脚本列表
    function renderScripts() {
        const scriptsTableBody = document.querySelector('#scriptsTable tbody');
        if (!scriptsTableBody) return;

        // 不再过滤内置脚本，显示所有脚本
        const userScripts = filteredScripts;

        if (userScripts.length === 0) {
            scriptsTableBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                        <p style="font-size: 1.125rem; margin-bottom: 0.5rem;">暂无脚本</p>
                        <p style="font-size: 0.875rem;">点击"添加脚本"创建您的第一个脚本</p>
                    </td>
                </tr>
            `;
            return;
        }

        scriptsTableBody.innerHTML = userScripts.map(script => createScriptRow(script)).join('');

        // 更新排序箭头
        updateSortArrows();

        // 绑定事件
        bindScriptRowEvents();
    }

    // 更新排序箭头
    function updateSortArrows() {
        // 清除所有箭头
        document.querySelectorAll('#scriptsTable th.sortable').forEach(th => {
            th.classList.remove('asc', 'desc');
        });

        // 设置当前排序字段的箭头
        const currentHeader = document.querySelector(`#scriptsTable th.sortable[data-sort="${currentSortField}"]`);
        if (currentHeader) {
            currentHeader.classList.add(currentSortOrder);
        }
    }

    // 创建脚本表格行
    function createScriptRow(script) {
        const createdAt = script.created_at ? new Date(script.created_at).toLocaleString('zh-CN') : '-';
        const updatedAt = script.updated_at ? new Date(script.updated_at).toLocaleString('zh-CN') : '-';

        // 标签显示（与编辑弹窗一致：带 typeName:value 前缀）
        let tagsHtml = '';
        const TYPE_NAMES = { 1: '环境', 2: '架构', 3: '风险等级', 4: '自定义标签' };
        const TYPE_CLASS = { 1: 'env', 2: 'arch', 3: 'risk', 4: 'custom' };
        if (script.tags && script.tags.length > 0) {
            tagsHtml = script.tags.map(tag => {
                const typeId = Number(tag.typeId);
                const typeName  = TYPE_NAMES[typeId] || tag.typeName || '标签';
                const typeClass = TYPE_CLASS[typeId] || 'custom';
                const isHighRisk = typeId === 3 && tag.value === '高危';
                return `<span class="tag-chip ${typeClass}${isHighRisk ? ' high' : ''}">`
                     + `<span style="opacity:0.7;font-size:0.7rem;margin-right:2px;">${escapeHtml(typeName)}:</span>`
                     + escapeHtml(tag.value || '')
                     + `</span>`;
            }).join('');
        }
        if (!tagsHtml) tagsHtml = '<span style="color:var(--text-faint);">-</span>';

        return `
            <tr data-script-id="${script.id}">
                <td><strong>${escapeHtml(script.name)}</strong></td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(script.description || '')}">${escapeHtml(script.description || '无描述')}</td>
                <td>${tagsHtml}</td>
                <td>${createdAt}</td>
                <td>${updatedAt}</td>
                <td>
                    <button class="btn btn-sm btn-primary btn-view"   data-script-id="${script.id}">查看</button>
                    <button class="btn btn-sm btn-secondary btn-edit" data-script-id="${script.id}">编辑</button>
                    <button class="btn btn-sm btn-info btn-copy"      data-script-id="${script.id}">复制</button>
                    <button class="btn btn-sm btn-danger btn-delete"  data-script-id="${script.id}">删除</button>
                </td>
            </tr>
        `;
    }

    // 绑定脚本行事件
    function bindScriptRowEvents() {
        // 查看按钮
        document.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const scriptId = e.currentTarget.dataset.scriptId;
                const id = isNaN(scriptId) ? scriptId : parseInt(scriptId);
                viewScript(id);
            });
        });

        // 编辑按钮
        document.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const scriptId = e.currentTarget.dataset.scriptId;
                const id = isNaN(scriptId) ? scriptId : parseInt(scriptId);
                editScript(id);
            });
        });

        // 复制按钮
        document.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const scriptId = e.currentTarget.dataset.scriptId;
                const id = isNaN(scriptId) ? scriptId : parseInt(scriptId);
                duplicateScript(id);
            });
        });

        // 删除按鈕
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const scriptId = e.currentTarget.dataset.scriptId;
                const id = isNaN(scriptId) ? scriptId : parseInt(scriptId);
                deleteScript(id);
            });
        });
    
        // 快捷按鈕
        document.querySelectorAll('.btn-shortcut').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const scriptId = e.currentTarget.dataset.scriptId;
                const id = isNaN(scriptId) ? scriptId : parseInt(scriptId);
                try {
                    const svc = new window.ShortcutService();
                    await svc.add(id);
                    showMessage('已加入快捷面板', 'success');
                } catch (err) {
                    showMessage('加入失败: ' + err.message, 'error');
                }
            });
        });
    }

    // 搜索处理
    function handleSearch() {
        const searchInput = document.getElementById('scriptSearchInput');
        const keyword = searchInput ? searchInput.value.trim() : '';
        applyFilters(keyword, currentTagTypeFilter, currentTagValueFilter);
    }

    // 标签类型过滤
    function handleTagTypeFilter(e) {
        currentTagTypeFilter  = e.target.value;
        currentTagValueFilter = '';
        updateTagValueFilter(currentTagTypeFilter);
        const searchInput = document.getElementById('scriptSearchInput');
        applyFilters(searchInput ? searchInput.value.trim() : '', currentTagTypeFilter, currentTagValueFilter);
    }

    // 标签值过滤
    function handleTagValueFilter(e) {
        currentTagValueFilter = e.target.value;
        const searchInput = document.getElementById('scriptSearchInput');
        applyFilters(searchInput ? searchInput.value.trim() : '', currentTagTypeFilter, currentTagValueFilter);
    }

    // 固定标签类型（不再依赖数据库预设）
    const FIXED_TAG_TYPES = [
        { id: 1, name: '环境' },
        { id: 2, name: '架构' },
        { id: 3, name: '风险等级' },
        { id: 4, name: '自定义标签' }
    ];

    // 更新标签类型下拉（固定4种类型）
    function updateTagTypeFilter() {
        const sel = document.getElementById('scriptTagTypeFilter');
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '<option value="">所有类型</option>';
        FIXED_TAG_TYPES.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            if (String(t.id) === prev) opt.selected = true;
            sel.appendChild(opt);
        });
    }

    // 更新标签值下拉（风险等级用固定选项，环境/架构/自定义从脚本实际标签动态收集）
    function updateTagValueFilter(typeId) {
        const sel = document.getElementById('scriptTagValueFilter');
        if (!sel) return;
        sel.innerHTML = '<option value="">所有标签</option>';
        if (!typeId) return;

        let values = [];
        if (String(typeId) === '3') {
            // 风险等级：固定两项
            values = ['普通', '高危'];
        } else {
            // 环境/架构：从当前所有脚本中收集已有的唯一值
            const seen = new Set();
            currentScripts.forEach(s => {
                if (s.tags && Array.isArray(s.tags)) {
                    s.tags.forEach(t => {
                        if (String(t.typeId) === String(typeId) && t.value && !seen.has(t.value)) {
                            seen.add(t.value);
                            values.push(t.value);
                        }
                    });
                }
            });
            values.sort();
        }

        values.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            if (v === currentTagValueFilter) opt.selected = true;
            sel.appendChild(opt);
        });
    }

    // 清除搜索
    function clearSearch() {
        const searchInput = document.getElementById('scriptSearchInput');
        if (searchInput) searchInput.value = '';
        const tagTypeFilter  = document.getElementById('scriptTagTypeFilter');
        const tagValueFilter = document.getElementById('scriptTagValueFilter');
        if (tagTypeFilter)  { tagTypeFilter.value  = ''; currentTagTypeFilter  = ''; }
        if (tagValueFilter) { tagValueFilter.value = ''; currentTagValueFilter = ''; }
        updateTagValueFilter('');
        applyFilters('', '', '');
    }

    // 处理排序
    function handleSort(field) {
        // 如果点击的是当前排序字段，则切换排序顺序
        if (currentSortField === field) {
            currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            // 否则，设置新的排序字段，默认降序
            currentSortField = field;
            currentSortOrder = 'desc';
        }

        // 应用排序
        applySorting();
        // 重新渲染
        renderScripts();
    }

    // 应用排序
    function applySorting() {
        filteredScripts.sort((a, b) => {
            let aValue = a[currentSortField];
            let bValue = b[currentSortField];

            // 处理时间字段
            if (currentSortField === 'created_at' || currentSortField === 'updated_at') {
                aValue = aValue ? new Date(aValue).getTime() : 0;
                bValue = bValue ? new Date(bValue).getTime() : 0;
            } else if (typeof aValue === 'string') {
                // 字符串比较（不区分大小写）
                aValue = aValue.toLowerCase();
                bValue = bValue.toLowerCase();
            }

            if (aValue < bValue) {
                return currentSortOrder === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return currentSortOrder === 'asc' ? 1 : -1;
            }
            return 0;
        });
    }

    // 应用筛选
    function applyFilters(keyword = '', tagTypeId = '', tagValue = '') {
        filteredScripts = currentScripts.filter(script => {
            // 目录筛选（一级平列，直接匹配 category_id）
            if (currentCategoryFilter !== null) {
                const catId = currentCategoryFilter;
                if (catId === -1) {
                    if (script.category_id) return false;
                } else {
                    if (String(script.category_id) !== String(catId)) return false;
                }
            }

            // 关键词筛选
            if (keyword) {
                const lk = keyword.toLowerCase();
                const matchName = script.name.toLowerCase().includes(lk);
                const matchDesc = script.description && script.description.toLowerCase().includes(lk);
                if (!matchName && !matchDesc) return false;
            }

            // 标签类型筛选
            if (tagTypeId) {
                if (!script.tags || !Array.isArray(script.tags)) return false;
                const hasType = script.tags.some(t => String(t.typeId) === String(tagTypeId));
                if (!hasType) return false;
            }

            // 标签值筛选
            if (tagValue) {
                if (!script.tags || !Array.isArray(script.tags)) return false;
                const hasValue = script.tags.some(t =>
                    (!tagTypeId || String(t.typeId) === String(tagTypeId)) && t.value === tagValue
                );
                if (!hasValue) return false;
            }

            return true;
        });

        console.log(`筛选后剩余 ${filteredScripts.length} 个脚本`);
        applySorting();
        renderScripts();
    }

    // 查看脚本
    function viewScript(scriptId) {
        // 支持数字和字符串ID的比较
        const script = currentScripts.find(s => s.id == scriptId);
        
        if (!script) {
            showMessage('脚本不存在', 'error');
            return;
        }

        // 创建查看对话框
        const modal = createViewScriptDialog(script);
        document.body.appendChild(modal);
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
                    ${script.usage_notes ? `
                        <div style="margin-bottom: 1rem;">
                            <strong>使用说明：</strong>
                            <p style="white-space: pre-wrap;">${escapeHtml(script.usage_notes)}</p>
                        </div>
                    ` : ''}
                    <div style="margin-bottom: 1rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                            <strong>脚本内容：</strong>
                            <button class="btn btn-secondary btn-sm" id="copyScriptContentBtn" title="复制脚本内容" style="padding: 4px 12px;">${Utils.icon('copy', 12)} 复制</button>
                        </div>
                        <pre style="margin: 0; border-radius: 8px; overflow: hidden;"><code class="language-bash" style="display: block; padding: 1.25rem; font-size: 14px; line-height: 1.6; max-height: 500px; overflow-y: auto;">${escapeHtml(script.content)}</code></pre>
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

        // 绑定复制脚本内容事件
        const copyBtn = modalOverlay.querySelector('#copyScriptContentBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    const content = script.content || '';
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(content);
                    } else {
                        // 降级方案：使用 textarea + execCommand
                        const ta = document.createElement('textarea');
                        ta.value = content;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    }
                    showMessage('脚本内容已复制到剪贴板', 'success');
                } catch (err) {
                    console.error('复制脚本内容失败:', err);
                    showMessage('复制失败：' + (err.message || '未知错误'), 'error');
                }
            });
        }
        
        // 应用语法高亮
        setTimeout(() => {
            const codeBlock = modalOverlay.querySelector('code');
            console.log('准备应用语法高亮...');
            console.log('codeBlock:', codeBlock);
            console.log('window.hljs:', window.hljs);
            
            if (codeBlock && window.hljs) {
                console.log('开始高亮代码块...');
                window.hljs.highlightElement(codeBlock);
                console.log('高亮完成！');
            } else {
                console.warn('无法应用语法高亮:', { codeBlock, hljs: window.hljs });
            }
        }, 100);

        return modalOverlay;
    }

    // 显示添加脚本对话框
    function showAddScriptDialog() {
        console.log('点击了添加脚本按钮');
        const modal = createScriptEditorDialog();
        document.body.appendChild(modal);
    }

    // 编辑脚本
    function editScript(scriptId) {
        const script = currentScripts.find(s => s.id == scriptId);
        if (!script) {
            showMessage('脚本不存在', 'error');
            return;
        }
        const modal = createScriptEditorDialog(script);
        document.body.appendChild(modal);
    }

    // 创建脚本编辑器对话框
    function createScriptEditorDialog(script = null) {
        const isEdit = script !== null;
        // 构建目录选项（一级平列）
        let catOptions = '<option value="">未分类</option>';
        allCategories.forEach(cat => {
            catOptions += `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`;
        });

        // 标签输入：用固定3行（环境标签、架构标签、风险等级）
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 1200px; max-height: 95vh; width: 1200px;">
                <div class="modal-header">
                    <h2>${isEdit ? '编辑脚本' : '添加脚本'}</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body" style="overflow-y: auto; max-height: calc(95vh - 140px); padding: 20px 24px;">
                    <form id="scriptForm">
                        <!-- 第一行：名称+描述+目录 -->
                        <div style="display: grid; grid-template-columns: 2fr 3fr 2fr; gap: 1rem; margin-bottom: 1rem;">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label">脚本名称 <span style="color: red;">*</span></label>
                                <input type="text" class="form-control" id="scriptName"
                                       value="${isEdit ? escapeHtml(script.name) : ''}"
                                       placeholder="请输入脚本名称" required>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label">脚本描述</label>
                                <input type="text" class="form-control" id="scriptDescription"
                                       value="${isEdit ? escapeHtml(script.description || '') : ''}"
                                       placeholder="请输入脚本描述">
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label">目录</label>
                                <select class="form-control" id="scriptCategoryId">
                                    ${catOptions}
                                </select>
                            </div>
                        </div>

                        <!-- 第二行：标签区（环境/架构/自定义自由输入，风险等级下拉，4 列一行紧凑布局） -->
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label class="form-label">标签</label>
                            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0.5rem;">
                                <div style="display:flex;align-items:center;gap:0.35rem;">
                                    <span style="font-size:0.8125rem;color:var(--text-body);flex-shrink:0;">环境</span>
                                    <input type="text" class="form-control form-control-sm" id="tagEnvInput" placeholder="测试/预发/生产" style="flex:1;min-width:0;">
                                    <button type="button" class="btn btn-secondary btn-sm" id="addEnvTagBtn" style="flex-shrink:0;">加</button>
                                </div>
                                <div style="display:flex;align-items:center;gap:0.35rem;">
                                    <span style="font-size:0.8125rem;color:var(--text-body);flex-shrink:0;">架构</span>
                                    <input type="text" class="form-control form-control-sm" id="tagArchInput" placeholder="X86/ARM/麒麟" style="flex:1;min-width:0;">
                                    <button type="button" class="btn btn-secondary btn-sm" id="addArchTagBtn" style="flex-shrink:0;">加</button>
                                </div>
                                <div style="display:flex;align-items:center;gap:0.35rem;">
                                    <span style="font-size:0.8125rem;color:var(--text-body);flex-shrink:0;">自定义标签</span>
                                    <input type="text" class="form-control form-control-sm" id="tagCustomInput" placeholder="输入自定义标签" style="flex:1;min-width:0;">
                                    <button type="button" class="btn btn-secondary btn-sm" id="addCustomTagBtn" style="flex-shrink:0;">加</button>
                                </div>
                                <div style="display:flex;align-items:center;gap:0.35rem;">
                                    <span style="font-size:0.8125rem;color:var(--text-body);flex-shrink:0;">风险</span>
                                    <select class="form-control form-control-sm" id="tagRiskSelect" style="flex:1;min-width:0;">
                                        <option value="普通">普通</option>
                                        <option value="高危">高危</option>
                                    </select>
                                    <button type="button" class="btn btn-secondary btn-sm" id="addRiskTagBtn" style="flex-shrink:0;">加</button>
                                </div>
                            </div>
                            <div id="tagChipsContainer" style="display:flex;flex-wrap:wrap;gap:0.25rem;margin-top:0.5rem;min-height:28px;"></div>
                        </div>

                        <!-- 脚本内容 -->
                        <div class="form-group" style="margin-bottom: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <label class="form-label" style="margin: 0;">脚本内容 <span style="color: red;">*</span></label>
                                <label style="margin: 0; font-size: 0.875rem; color: var(--text-muted); cursor: pointer;">
                                    <input type="checkbox" id="showPreview" style="margin-right: 0.25rem; cursor: pointer;">
                                    显示预览
                                </label>
                            </div>
                            <div style="display: flex; gap: 1rem; height: 460px;">
                                <div style="flex: 1; display: flex; flex-direction: column;">
                                    <textarea class="form-control" id="scriptContent"
                                              placeholder="请输入脚本内容"
                                              style="font-family: var(--font-mono); font-size: 14px; line-height: 1.6; resize: none; flex: 1; height: 100%;"
                                              required>${isEdit ? escapeHtml(script.content) : '#!/bin/bash\n\n'}</textarea>
                                </div>
                                <div id="scriptPreview" style="flex: 1; display: none; border-radius: 8px; overflow: hidden;">
                                    <pre style="margin: 0; height: 100%;"><code class="language-bash" style="display: block; padding: 1rem; font-size: 14px; line-height: 1.6; height: 100%; overflow-y: auto;">${isEdit ? escapeHtml(script.content) : '#!/bin/bash\n\n'}</code></pre>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="cancelBtn">取消</button>
                    <button class="btn btn-primary" id="saveScriptBtn">${isEdit ? '保存' : '创建'}</button>
                </div>
            </div>
        `;

        // 初始化已有标签 —— 客户端再做一次规范化，兼容历史/异常数据
        // 兼容: 字符串、{type,value}、{name}、{type_id,value}、{typeId,value} 等
        function normalizeTagItem(t) {
            const TYPE_NAME_MAP = { 1: '环境', 2: '架构', 3: '风险等级', 4: '自定义标签' };
            if (t == null) return null;
            if (typeof t === 'string') {
                const v = t.trim();
                return v ? { typeId: 4, typeName: '自定义标签', value: v } : null;
            }
            if (typeof t !== 'object') return null;
            let typeId;
            if (t.typeId !== undefined && t.typeId !== null && t.typeId !== '') typeId = Number(t.typeId);
            else if (t.type_id !== undefined && t.type_id !== null && t.type_id !== '') typeId = Number(t.type_id);
            else typeId = 4;
            if (!Number.isFinite(typeId)) typeId = 4;
            let value = '';
            if (t.value !== undefined && t.value !== null && t.value !== '') value = String(t.value);
            else if (t.name !== undefined && t.name !== null && t.name !== '') value = String(t.name);
            else if (t.label !== undefined && t.label !== null && t.label !== '') value = String(t.label);
            if (!value) return null;
            const typeName = TYPE_NAME_MAP[typeId] || t.typeName || t.type_name || '自定义标签';
            return { typeId, typeName, value };
        }
        let currentTags = [];
        if (isEdit && Array.isArray(script.tags)) {
            currentTags = script.tags.map(normalizeTagItem).filter(Boolean);
        }
        if (isEdit) {
            console.log('[编辑脚本] script.tags 原始：', script.tags, ' 规范化后：', currentTags);
        }

        function renderTagChips() {
            const container = modalOverlay.querySelector('#tagChipsContainer');
            if (!container) return;
            const TYPE_NAMES = { 1: '环境', 2: '架构', 3: '风险等级', 4: '自定义标签' };
            const TYPE_CLASS  = { 1: 'env', 2: 'arch', 3: 'risk', 4: 'custom' };
            container.innerHTML = currentTags.map((tag, idx) => {
                const typeName  = TYPE_NAMES[tag.typeId] || '标签';
                const typeClass = TYPE_CLASS[tag.typeId]  || 'custom';
                const isHighRisk = tag.typeId === 3 && tag.value === '高危';
                return `<span class="tag-chip ${typeClass}${isHighRisk ? ' high' : ''}" style="cursor:default;">
                    <span style="opacity:0.7;font-size:0.7rem;">${escapeHtml(typeName)}:</span>
                    ${escapeHtml(tag.value)}
                    <span class="remove-shortcut" data-idx="${idx}">&#x2715;</span>
                </span>`;
            }).join('');
            container.querySelectorAll('.remove-shortcut').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentTags.splice(parseInt(btn.dataset.idx), 1);
                    renderTagChips();
                });
            });
        }

        // 初始化标签输入器
        function initTagSelectors() {
            // 环境标签（自由输入）
            const envInput = modalOverlay.querySelector('#tagEnvInput');
            const addEnv = () => {
                const value = envInput.value.trim();
                if (!value) { showMessage('请输入环境标签', 'warning'); return; }
                if (!currentTags.some(t => t.typeId === 1 && t.value === value)) {
                    currentTags.push({ typeId: 1, typeName: '环境', value });
                    renderTagChips();
                }
                envInput.value = '';
            };
            modalOverlay.querySelector('#addEnvTagBtn').addEventListener('click', addEnv);
            envInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addEnv(); } });

            // 架构标签（自由输入）
            const archInput = modalOverlay.querySelector('#tagArchInput');
            const addArch = () => {
                const value = archInput.value.trim();
                if (!value) { showMessage('请输入架构标签', 'warning'); return; }
                if (!currentTags.some(t => t.typeId === 2 && t.value === value)) {
                    currentTags.push({ typeId: 2, typeName: '架构', value });
                    renderTagChips();
                }
                archInput.value = '';
            };
            modalOverlay.querySelector('#addArchTagBtn').addEventListener('click', addArch);
            archInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addArch(); } });

            // 自定义标签（自由输入，逻辑与环境/架构一致）
            const customInput = modalOverlay.querySelector('#tagCustomInput');
            const addCustom = () => {
                const value = customInput.value.trim();
                if (!value) { showMessage('请输入自定义标签', 'warning'); return; }
                if (!currentTags.some(t => t.typeId === 4 && t.value === value)) {
                    currentTags.push({ typeId: 4, typeName: '自定义标签', value });
                    renderTagChips();
                }
                customInput.value = '';
            };
            modalOverlay.querySelector('#addCustomTagBtn').addEventListener('click', addCustom);
            customInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });

            // 风险等级（下拉选择）
            const riskSelect = modalOverlay.querySelector('#tagRiskSelect');
            modalOverlay.querySelector('#addRiskTagBtn').addEventListener('click', () => {
                const value = riskSelect.value;
                const idx = currentTags.findIndex(t => t.typeId === 3);
                if (idx >= 0) {
                    currentTags[idx].value = value;  // 已存在则更新
                } else {
                    currentTags.push({ typeId: 3, typeName: '风险等级', value });
                }
                renderTagChips();
            });

            // 编辑时初始化风险等级选中状态
            if (isEdit) {
                const existingRisk = currentTags.find(t => t.typeId === 3);
                if (existingRisk && riskSelect) riskSelect.value = existingRisk.value;
            }
        }

        // 目录选择器初始化
        if (isEdit && script.category_id) {
            const selCat = modalOverlay.querySelector('#scriptCategoryId');
            if (selCat) selCat.value = String(script.category_id);
        }

        renderTagChips();
        setTimeout(initTagSelectors, 0);

        // 关闭事件
        modalOverlay.querySelector('.modal-close').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.querySelector('#cancelBtn').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.remove(); });

        // 保存事件
        modalOverlay.querySelector('#saveScriptBtn').addEventListener('click', async () => {
            await saveScript(modalOverlay, script, currentTags);
        });
        modalOverlay.querySelector('#scriptForm').addEventListener('submit', (e) => e.preventDefault());

        // 预览
        setTimeout(() => {
            const previewCode = modalOverlay.querySelector('#scriptPreview code');
            if (previewCode && window.hljs) window.hljs.highlightElement(previewCode);
        }, 50);

        const textarea = modalOverlay.querySelector('#scriptContent');
        const preview  = modalOverlay.querySelector('#scriptPreview');
        const previewCode = modalOverlay.querySelector('#scriptPreview code');
        const showPreviewCheckbox = modalOverlay.querySelector('#showPreview');
        showPreviewCheckbox.addEventListener('change', (e) => {
            preview.style.display = e.target.checked ? 'block' : 'none';
        });
        let updateTimer;
        textarea.addEventListener('input', () => {
            clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
                if (showPreviewCheckbox.checked && window.hljs) {
                    previewCode.textContent = textarea.value;
                    previewCode.removeAttribute('data-highlighted');
                    previewCode.className = 'language-bash';
                    window.hljs.highlightElement(previewCode);
                }
            }, 300);
        });

        return modalOverlay;
    }

    // 保存脚本
    async function saveScript(modal, existingScript = null, tags = []) {
        const isEdit = existingScript !== null;
    
        const nameInput    = modal.querySelector('#scriptName');
        const contentInput = modal.querySelector('#scriptContent');
        const name         = nameInput.value.trim();
        const description  = modal.querySelector('#scriptDescription').value.trim();
        const content      = contentInput.value.trim();
        const categoryIdEl = modal.querySelector('#scriptCategoryId');
        const category_id  = categoryIdEl && categoryIdEl.value ? parseInt(categoryIdEl.value) : null;
    
        if (!name) {
            showMessage('请输入脚本名称', 'error');
            nameInput.style.border = '2px solid var(--status-critical-fg)';
            nameInput.focus();
            setTimeout(() => { nameInput.style.border = ''; }, 3000);
            return;
        }
        if (!content) {
            showMessage('请输入脚本内容', 'error');
            contentInput.style.border = '2px solid var(--status-critical-fg)';
            contentInput.focus();
            setTimeout(() => { contentInput.style.border = ''; }, 3000);
            return;
        }
    
        const scriptData = {
            name, description, content, category_id,
            usage_notes: '', category: 'custom', language: 'bash',
            tags, author: ''
        };
        if (!isEdit) {
            scriptData.id = 'script_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
    
        try {
            if (isEdit) {
                await scriptService.updateScript(existingScript.id, scriptData);
                showMessage('脚本更新成功', 'success');
            } else {
                await scriptService.addScript(scriptData);
                showMessage('脚本创建成功', 'success');
            }
            modal.remove();
            await loadScripts();
            renderCategoryTree();
        } catch (error) {
            console.error('保存脚本失败:', error);
            showMessage('保存脚本失败: ' + error.message, 'error');
        }
    }

    // 删除脚本
    async function deleteScript(scriptId) {
        const script = currentScripts.find(s => s.id === scriptId);
        if (!script) {
            showMessage('脚本不存在', 'error');
            return;
        }

        // 使用自定义确认对话框替代原生confirm，避免焦点被锁定
        const confirmed = await Components.ConfirmDialog.show({
            title: '确认删除脚本',
            message: `确定要删除脚本“${script.name}”吗？`,
            confirmText: '删除',
            cancelText: '取消'
        });
                
        if (!confirmed) {
            return;
        }

        try {
            await scriptService.deleteScript(scriptId);
            showMessage('脚本删除成功', 'success');
            await loadScripts();
        } catch (error) {
            console.error('删除脚本失败:', error);
            showMessage('删除脚本失败: ' + error.message, 'error');
        }
    }

    // 复制脚本
    async function duplicateScript(scriptId) {
        try {
            const newScript = await scriptService.duplicateScript(scriptId);
            showMessage(`脚本复制成功：${newScript.name}`, 'success');
            await loadScripts();
        } catch (error) {
            console.error('复制脚本失败:', error);
            showMessage('复制脚本失败: ' + error.message, 'error');
        }
    }

    // 工具函数：HTML转义
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 工具函数：防抖
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 显示消息
    function showMessage(message, type = 'info') {
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

    // =====================================================
    // 目录树渲染
    // =====================================================
    function renderCategoryTree() {
        const treeEl = document.getElementById('categoryTree');
        if (!treeEl) return;

        // 一级平列目录树
        const scriptCounts = {};
        currentScripts.forEach(s => {
            const key = s.category_id ? String(s.category_id) : '__null';
            scriptCounts[key] = (scriptCounts[key] || 0) + 1;
        });

        const nullCount = scriptCounts['__null'] || 0;
        const totalCount = currentScripts.length;

        let html = `
            <div class="category-tree-item ${currentCategoryFilter === null ? 'active' : ''}" data-cat-id="__all">
                <span class="cat-item-name">全部脚本</span>
                <span class="item-count">${totalCount}</span>
            </div>`;

        allCategories.forEach(cat => {
            const isActive = currentCategoryFilter !== null && String(currentCategoryFilter) === String(cat.id);
            const cnt = scriptCounts[String(cat.id)] || 0;
            html += `
                <div class="category-tree-item ${isActive ? 'active' : ''}" data-cat-id="${cat.id}">
                    <span class="cat-item-name" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</span>
                    <span class="item-count">${cnt}</span>
                </div>`;
        });

        if (nullCount > 0 || !allCategories.length) {
            html += `
                <div class="category-tree-separator"></div>
                <div class="category-tree-item ${currentCategoryFilter === -1 ? 'active' : ''}" data-cat-id="__null">
                    <span class="cat-item-name" style="color:var(--text-faint);">未分类</span>
                    <span class="item-count">${nullCount}</span>
                </div>`;
        }

        treeEl.innerHTML = html;

        // 绑定点击事件
        treeEl.querySelectorAll('.category-tree-item').forEach(item => {
            item.addEventListener('click', () => {
                const catId = item.dataset.catId;
                if (catId === '__all') {
                    currentCategoryFilter = null;
                } else if (catId === '__null') {
                    currentCategoryFilter = -1;
                } else {
                    currentCategoryFilter = parseInt(catId);
                }
                renderCategoryTree();
                const searchInput = document.getElementById('scriptSearchInput');
                applyFilters(searchInput ? searchInput.value.trim() : '', currentTagTypeFilter, currentTagValueFilter);
                // 切换目录后将列表滚动位置重置到顶部
                const tableContainer = document.querySelector('#page-scripts .table-container');
                if (tableContainer) tableContainer.scrollTop = 0;
            });
        });
    }

    // =====================================================
    // 目录管理对话框
    // =====================================================

    // 自定义输入对话框（替代原生 prompt，Electron 中 prompt 不可用）
    function showInputDialog(title, defaultValue) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.zIndex = '10001';
            overlay.innerHTML = `
                <div class="modal" style="max-width:380px;">
                    <div class="modal-header">
                        <h3 style="font-size:1rem;margin:0;">${escapeHtml(title)}</h3>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <input type="text" class="form-control" id="_inputDlgField"
                               value="${escapeHtml(defaultValue || '')}" style="width:100%;">
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" id="_inputDlgCancel">取消</button>
                        <button class="btn btn-primary" id="_inputDlgOk">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            const input = overlay.querySelector('#_inputDlgField');
            input.focus();
            input.select();
            const cleanup = (result) => { overlay.remove(); resolve(result); };
            overlay.querySelector('.modal-close').addEventListener('click', () => cleanup(null));
            overlay.querySelector('#_inputDlgCancel').addEventListener('click', () => cleanup(null));
            overlay.querySelector('#_inputDlgOk').addEventListener('click', () => cleanup(input.value));
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') cleanup(input.value);
                if (e.key === 'Escape') cleanup(null);
            });
            overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
        });
    }

    async function showCategoryManageDialog() {
        await loadCategories(); // 刷新

        function buildListHtml() {
            return allCategories.map(cat => `
                <div class="category-manage-item" data-cat-id="${cat.id}">
                    <span class="cat-name"><span class="cat-lv-icon">${Utils.icon('folder', 13)}</span>${escapeHtml(cat.name)}</span>
                    <button class="btn btn-sm btn-secondary btn-rename-cat" data-cat-id="${cat.id}" data-cat-name="${escapeHtml(cat.name)}">重命名</button>
                    <button class="btn btn-sm btn-danger btn-del-cat" data-cat-id="${cat.id}">删除</button>
                </div>
            `).join('');
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.innerHTML = `
            <div class="modal" style="max-width:500px;">
                <div class="modal-header"><h2>目录管理</h2><button class="modal-close">&times;</button></div>
                <div class="modal-body" style="max-height:60vh;overflow-y:auto;">
                    <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
                        <input type="text" class="form-control" id="newCatName" placeholder="输入目录名称" style="flex:1;">
                        <button class="btn btn-primary" id="addCatBtn">新增</button>
                    </div>
                    <div id="catList">${buildListHtml()}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="closeCatDialogBtn">关闭</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);
        modalOverlay.querySelector('.modal-close').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.querySelector('#closeCatDialogBtn').addEventListener('click', () => modalOverlay.remove());
        modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.remove(); });

        // 新增目录
        modalOverlay.querySelector('#addCatBtn').addEventListener('click', async () => {
            const name = modalOverlay.querySelector('#newCatName').value.trim();
            if (!name) { showMessage('请输入目录名称', 'warning'); return; }
            try {
                await categoryService.create({ name, parent_id: null });
                await loadCategories();
                modalOverlay.querySelector('#newCatName').value = '';
                const catList = modalOverlay.querySelector('#catList');
                catList.innerHTML = allCategories.map(cat => `
                    <div class="category-manage-item" data-cat-id="${cat.id}">
                        <span class="cat-name"><span class="cat-lv-icon">${Utils.icon('folder', 13)}</span>${escapeHtml(cat.name)}</span>
                        <button class="btn btn-sm btn-secondary btn-rename-cat" data-cat-id="${cat.id}" data-cat-name="${escapeHtml(cat.name)}">重命名</button>
                        <button class="btn btn-sm btn-danger btn-del-cat" data-cat-id="${cat.id}">删除</button>
                    </div>
                `).join('');
                rebindCatListEvents(modalOverlay);
                showMessage('目录创建成功', 'success');
            } catch(e) { showMessage('创建失败: '+e.message, 'error'); }
        });

        rebindCatListEvents(modalOverlay);
    }

    function rebindCatListEvents(modalOverlay) {
        modalOverlay.querySelectorAll('.btn-del-cat').forEach(btn => {
            btn.addEventListener('click', async () => {
                const catId = btn.dataset.catId;
                const confirmed = await Components.ConfirmDialog.show({
                    title: '删除目录',
                    message: '删除后该目录下的脚本将移至“未分类”，确定吘？',
                    confirmText: '删除', cancelText: '取消'
                });
                if (!confirmed) return;
                try {
                    await categoryService.delete(catId);
                    await loadCategories();
                    if (String(currentCategoryFilter) === String(catId)) currentCategoryFilter = null;
                    modalOverlay.remove();
                    showCategoryManageDialog();
                    loadScripts();
                } catch(e) { showMessage('删除失败: '+e.message, 'error'); }
            });
        });
        modalOverlay.querySelectorAll('.btn-rename-cat').forEach(btn => {
            btn.addEventListener('click', async () => {
                const catId  = btn.dataset.catId;
                const oldName = btn.dataset.catName;
                const newName = await showInputDialog('重命名目录', oldName);
                if (!newName || newName.trim() === oldName) return;
                try {
                    await categoryService.update(catId, { name: newName.trim() });
                    await loadCategories();
                    modalOverlay.remove();
                    showCategoryManageDialog();
                } catch(e) { showMessage('重命名失败: '+e.message, 'error'); }
            });
        });
    }

    // 单独导入 .sh 脚本
    // 优化：去掉「选择文件」那层自定义弹窗，点按钮后直接调起系统文件选择器，
    //       选完文件且读取成功后才弹出「确认信息」对话框
    async function importSingleScript() {
        try {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.sh';
            fileInput.style.display = 'none';

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) {
                    fileInput.remove();
                    return;
                }

                const reader = new FileReader();
                reader.onload = (ev) => {
                    const content = ev.target.result;
                    const defaultName = file.name.replace(/\.sh$/i, '');

                    const dialog = new Components.ScriptShImportDialog({
                        fileData: { name: defaultName, content, originalFileName: file.name },
                        onImport: () => {
                            loadScripts();
                        }
                    });
                    dialog.show();
                };
                reader.onerror = () => showMessage('读取文件失败', 'error');
                reader.readAsText(file, 'utf-8');

                fileInput.remove();
            }, { once: true });

            document.body.appendChild(fileInput);
            fileInput.click();
        } catch (error) {
            console.error('单独导入失败:', error);
            showMessage('单独导入失败: ' + error.message, 'error');
        }
    }

    // 导入脚本
    async function importScripts() {
        try {
            const scriptImport = new Components.ScriptExcelImportDialog({
                onImport: (result) => {
                    loadScripts();
                }
            });
            scriptImport.show();
        } catch (error) {
            console.error('Excel导入失败:', error);
            showMessage('Excel导入失败: ' + error.message, 'error');
        }
    }

    // 导出脚本
    async function exportScripts() {
        try {
            if (currentScripts.length === 0) {
                showMessage('没有数据可导出', 'warning');
                return;
            }
            
            // 显示导出选项对话框
            const exportDialog = new Components.ScriptExcelExportDialog({
                scripts: currentScripts
            });
            exportDialog.show();
        } catch (error) {
            console.error('Excel导出失败:', error);
            showMessage('Excel导出失败: ' + error.message, 'error');
        }
    }

    // 导出到全局
    window.ScriptManagement = {
        init: function() {
            if (!this._initialized) {
                this._initialized = true;
                console.log('ScriptManagement 初始化');
                init();
            } else {
                // 已经初始化过，重置分类筛选到「全部脚本」并重新加载数据
                console.log('ScriptManagement 重新加载数据');
                currentCategoryFilter = null;
                if (scriptService) {
                    Promise.all([loadCategories(), loadScripts()]);
                }
            }
        },
        loadScripts: loadScripts,
        renderScripts: renderScripts,
        _initialized: false
    };

})();
