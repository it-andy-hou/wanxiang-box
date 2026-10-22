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
    let currentRiskFilter      = '';     // 独立风险筛选：'' 全部 / '高危' / '中危'
    let allCategories       = [];       // 所有目录（平展）
    let tagTypesWithValues  = [];       // [{id,name,is_system,values:[...]}]
    let selectedScriptIds   = new Set(); // 批量操作勾选的脚本ID
    let aiAnalysesMap       = {};       // 脚本ID -> { status, riskLevel, stale, createdAt }（AI 角标）

    // AI 角标级别（与规则引擎三档角标相互独立，以 “AI:” 前缀区分）
    const AI_RISK_BADGES = {
        CRITICAL: { name: 'AI:严重', cls: 'ai-badge-critical' },
        HIGH:     { name: 'AI:高危', cls: 'ai-badge-high' },
        MEDIUM:   { name: 'AI:中危', cls: 'ai-badge-medium' },
        LOW:      { name: 'AI:低危', cls: 'ai-badge-low' },
        SAFE:     { name: 'AI:安全', cls: 'ai-badge-safe' }
    };

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

        // 批量重新评估风险：已被 loadScripts 的静默同步取代，按钮移除

        // 风险筛选（独立切换按钮组，与标签筛选解耦）
        const riskFilterGroup = document.getElementById('riskFilterGroup');
        if (riskFilterGroup) {
            riskFilterGroup.addEventListener('click', (e) => {
                const btn = e.target.closest('.risk-filter-btn');
                if (!btn) return;
                currentRiskFilter = btn.dataset.risk || '';
                riskFilterGroup.querySelectorAll('.risk-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
                const searchInput = document.getElementById('scriptSearchInput');
                applyFilters(searchInput ? searchInput.value.trim() : '', currentTagTypeFilter, currentTagValueFilter);
            });
        }

        // 导入导出按钮
        const importSingleBtn = document.getElementById('importSingleScriptBtn');
        if (importSingleBtn) {
            importSingleBtn.addEventListener('click', importSingleScript);
        }

        const importBtn = document.getElementById('importScriptJsonBtn');
        if (importBtn) {
            importBtn.addEventListener('click', importScripts);
        }
        
        const exportBtn = document.getElementById('exportScriptJsonBtn');
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

        // 批量操作：全选/批量移动目录/批量AI分析/批量删除
        const selectAll = document.getElementById('selectAllScripts');
        if (selectAll) selectAll.addEventListener('change', handleSelectAllScripts);

        const batchMoveBtn = document.getElementById('scriptBatchMoveBtn');
        if (batchMoveBtn) batchMoveBtn.addEventListener('click', batchMoveScripts);

        const batchAnalyzeBtn = document.getElementById('scriptBatchAnalyzeBtn');
        if (batchAnalyzeBtn) batchAnalyzeBtn.addEventListener('click', batchAnalyzeScripts);

        const batchDeleteBtn = document.getElementById('scriptBatchDeleteBtn');
        if (batchDeleteBtn) batchDeleteBtn.addEventListener('click', batchDeleteScripts);
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
            // 静默同步风险标签：存量脚本/规则变更后自动对齐（仅对有差异的写库，就地更新内存对象）
            await syncRiskTags(currentScripts);
            // 加载 AI 分析状态（列表角标）
            await loadAiAnalyses();
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

    // 静默同步风险标签：按当前规则引擎重算，与现有标签有差异才写库
    // 目的：存量脚本（人工标签/无标签）打开页面即自动对齐，角标直接可见
    async function syncRiskTags(scripts) {
        if (!window.RiskAnalyzer || !scriptService) return;
        for (const s of scripts) {
            let result;
            try { result = window.RiskAnalyzer.analyzeRisk(s.content || ''); }
            catch (e) { continue; }
            const expected = result.level === 'normal' ? null : window.RiskAnalyzer.LEVEL_NAMES[result.level];
            const current  = (s.tags || []).find(t => t && Number(t.typeId) === 3);
            if (expected === (current ? current.value : null)) continue; // 无差异
            const tags = (s.tags || []).filter(t => !(t && Number(t.typeId) === 3));
            if (expected) tags.push({ typeId: 3, typeName: '风险等级', value: expected });
            s.tags = tags; // 就地更新内存对象，避免整页重刷
            try {
                await scriptService.updateScript(s.id, {
                    name: s.name,
                    description: s.description || '',
                    content: s.content || '',
                    category: s.category || 'custom',
                    category_id: s.category_id || null,
                    language: s.language || 'bash',
                    tags,
                    author: s.author || '',
                    usage_notes: s.usage_notes || ''
                });
            } catch (e) {
                console.warn(`同步脚本「${s.name}」的风险标签失败:`, e);
            }
        }
    }

    // 加载 AI 分析状态映射（列表角标用，失败静默）
    async function loadAiAnalyses() {
        try {
            if (!window.AiService) return;
            if (!loadAiAnalyses._svc) loadAiAnalyses._svc = new window.AiService();
            const r = await loadAiAnalyses._svc.getAllAnalyses();
            if (r && r.success) aiAnalysesMap = r.data || {};
        } catch (e) {
            console.warn('加载 AI 分析状态失败:', e);
        }
    }

    // 生成某脚本的 AI 角标 HTML（无分析记录返回空串；过期标记灰色）
    function buildAiBadge(script) {
        const a = aiAnalysesMap[String(script.id)];
        if (!a) return '';
        if (a.status === 'error') {
            return `<span class="ai-badge ai-badge-error" title="AI 分析失败">AI:异常</span>`;
        }
        if (a.status === 'parse_error') {
            return `<span class="ai-badge ai-badge-error" title="AI 分析结果解析失败">AI:解析失败</span>`;
        }
        if (a.stale) {
            return `<span class="ai-badge ai-badge-stale" title="脚本已修改，AI 分析结果可能过期，建议重新分析">AI:过期</span>`;
        }
        const badge = AI_RISK_BADGES[a.riskLevel];
        if (!badge) return '';
        const time = a.createdAt ? new Date(a.createdAt).toLocaleString('zh-CN') : '';
        return `<span class="ai-badge ${badge.cls}" title="AI 分析风险等级（${time}）">${badge.name}</span>`;
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
                    <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
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

        // 同步批量操作栏与全选状态（筛选/重渲染后保持一致）
        updateScriptBatchBar();
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

        // 风险角标（自动评估）：挂在脚本名称后，列表页直观可见，无需点开编辑；无风险标签 = 普通（绿色）也展示
        const riskTag = (script.tags || []).find(t => t && Number(t.typeId !== undefined ? t.typeId : t.type_id) === 3);
        const riskValue = riskTag ? riskTag.value : '普通';
        const riskClass = riskTag ? (riskTag.value === '高危' ? 'high' : 'medium') : 'normal';
        const riskBadge = `<span class="risk-badge ${riskClass}" title="风险等级（自动评估）">${escapeHtml(riskValue)}</span>`;

        // 标签显示（与编辑弹窗一致：带 typeName:value 前缀；风险已上移到名称角标，不再作为标签展示）
        let tagsHtml = '';
        const TYPE_NAMES = { 1: '环境', 2: '架构', 4: '自定义标签' };
        const TYPE_CLASS = { 1: 'env', 2: 'arch', 4: 'custom' };
        if (script.tags && script.tags.length > 0) {
            tagsHtml = script.tags.filter(tag => Number(tag.typeId) !== 3).map(tag => {
                const typeId = Number(tag.typeId);
                const typeName  = TYPE_NAMES[typeId] || tag.typeName || '标签';
                const typeClass = TYPE_CLASS[typeId] || 'custom';
                return `<span class="tag-chip ${typeClass}">`
                     + `<span style="opacity:0.7;font-size:0.7rem;margin-right:2px;">${escapeHtml(typeName)}:</span>`
                     + escapeHtml(tag.value || '')
                     + `</span>`;
            }).join('');
        }
        if (!tagsHtml) tagsHtml = '<span style="color:var(--text-faint);">-</span>';

        // 勾选状态（筛选重渲染后保持）
        const checked = selectedScriptIds.has(String(script.id)) ? 'checked' : '';
        // AI 分析角标（与规则引擎角标并列，位于其后）
        const aiBadge = buildAiBadge(script);

        return `
            <tr data-script-id="${script.id}">
                <td><input type="checkbox" class="script-row-check" data-script-id="${script.id}" ${checked}></td>
                <td><strong>${escapeHtml(script.name)}</strong>${riskBadge}${aiBadge}</td>
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
        // 勾选框
        document.querySelectorAll('.script-row-check').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const id = String(e.target.dataset.scriptId);
                if (e.target.checked) selectedScriptIds.add(id);
                else selectedScriptIds.delete(id);
                updateScriptBatchBar();
            });
        });

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

    // =====================================================
    // 批量操作：全选 / 批量AI分析 / 批量删除
    // =====================================================

    // 更新批量操作栏显隐与计数
    function updateScriptBatchBar() {
        const bar = document.getElementById('scriptBatchActions');
        const countEl = document.getElementById('scriptSelectedCount');
        if (!bar || !countEl) return;
        // 清理已被删除/不在当前筛选视图的勾选
        const visibleIds = new Set(filteredScripts.map(s => String(s.id)));
        selectedScriptIds.forEach(id => { if (!visibleIds.has(id)) selectedScriptIds.delete(id); });
        countEl.textContent = `已选择 ${selectedScriptIds.size} 个脚本`;
        bar.style.display = selectedScriptIds.size > 0 ? 'flex' : 'none';
        const selectAll = document.getElementById('selectAllScripts');
        if (selectAll) selectAll.checked = filteredScripts.length > 0 && selectedScriptIds.size === filteredScripts.length;
    }

    // 全选/取消全选（仅当前筛选视图）
    function handleSelectAllScripts(e) {
        if (e.target.checked) {
            filteredScripts.forEach(s => selectedScriptIds.add(String(s.id)));
        } else {
            selectedScriptIds.clear();
        }
        renderScripts();
        updateScriptBatchBar();
    }

    // 批量删除
    async function batchDeleteScripts() {
        if (selectedScriptIds.size === 0) return;
        const targets = currentScripts.filter(s => selectedScriptIds.has(String(s.id)));

        // 统计被任务引用的数量（仅提示，不阻塞删除；执行历史保留脚本名）
        let referencedCount = 0;
        try {
            const taskService = new window.TaskService();
            const tasks = await taskService.getTasks();
            referencedCount = tasks.filter(t => selectedScriptIds.has(String(t.script_id))).length;
        } catch (e) { /* 引用统计失败不阻塞 */ }

        const confirmed = await Components.ConfirmDialog.show({
            title: '批量删除脚本',
            message: `确定要删除选中的 ${targets.length} 个脚本吗？` +
                (referencedCount > 0 ? `\n其中 ${referencedCount} 个任务引用了这些脚本，删除后相关任务将无法执行（执行历史会保留）。` : '') +
                `\n将同步清理快捷面板条目与 AI 分析记录，此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消'
        });
        if (!confirmed) return;

        let success = 0, failed = 0;
        for (const s of targets) {
            try {
                await scriptService.deleteScript(s.id);
                success++;
            } catch (err) {
                console.error(`删除脚本「${s.name}」失败:`, err);
                failed++;
            }
        }
        selectedScriptIds.clear();
        if (failed > 0) showMessage(`删除完成: 成功 ${success} 个，失败 ${failed} 个`, 'warning');
        else showMessage(`已删除 ${success} 个脚本`, 'success');
        await loadScripts();
        updateScriptBatchBar();
    }

    // 批量移动脚本到指定目录：弹窗选择目标目录，跳过已在目标目录的脚本
    async function batchMoveScripts() {
        if (selectedScriptIds.size === 0) return;
        const targets = currentScripts.filter(s => selectedScriptIds.has(String(s.id)));

        // 选择目标目录（返回目录ID；null=未分类；undefined=取消）
        const targetCatId = await showMoveCategoryDialog();
        if (targetCatId === undefined) return;

        const targetName = targetCatId === null
            ? '未分类'
            : (allCategories.find(c => String(c.id) === String(targetCatId)) || {}).name || String(targetCatId);

        // 跳过已在目标目录的脚本，避免无谓刷新 updated_at
        const currentCatKey = s => String(s.category_id || '');
        const targetCatKey = String(targetCatId === null ? '' : targetCatId);
        const toMove = targets.filter(s => currentCatKey(s) !== targetCatKey);
        if (toMove.length === 0) {
            showMessage('选中脚本均已在目标目录，无需移动', 'info');
            return;
        }

        const confirmed = await Components.ConfirmDialog.show({
            title: '批量移动脚本',
            message: `确定要将 ${toMove.length} 个脚本移动到「${targetName}」吗？` +
                (toMove.length < targets.length ? `\n（另有 ${targets.length - toMove.length} 个已在目标目录，将跳过）` : '') +
                '\n移动会刷新脚本的更新时间。',
            confirmText: '移动',
            cancelText: '取消'
        });
        if (!confirmed) return;

        try {
            const result = await scriptService.batchMoveCategory(toMove.map(s => s.id), targetCatId);
            showMessage(`已移动 ${result.moved} 个脚本到「${targetName}」`, 'success');
            selectedScriptIds.clear();
            await loadScripts();
            renderCategoryTree();
            updateScriptBatchBar();
        } catch (error) {
            console.error('批量移动脚本失败:', error);
            showMessage('批量移动脚本失败: ' + error.message, 'error');
        }
    }

    // 目标目录选择弹窗（返回：目录ID / null=未分类 / undefined=取消）
    function showMoveCategoryDialog() {
        return new Promise(resolve => {
            let catOptions = '<option value="__null">未分类</option>';
            allCategories.forEach(cat => {
                catOptions += `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`;
            });

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `
                <div class="modal" style="max-width:380px;">
                    <div class="modal-header">
                        <h3 style="font-size:1rem;margin:0;">移动到目录</h3>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <label class="form-label">目标目录</label>
                        <select class="form-control" id="_moveCatSelect" style="width:100%;">${catOptions}</select>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" id="_moveCatCancel">取消</button>
                        <button class="btn btn-primary" id="_moveCatOk">移动</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            const select = overlay.querySelector('#_moveCatSelect');
            select.focus();
            const cleanup = (result) => { overlay.remove(); resolve(result); };
            const confirmMove = () => {
                const v = select.value;
                cleanup(v === '__null' ? null : (isNaN(v) ? v : parseInt(v)));
            };
            overlay.querySelector('.modal-close').addEventListener('click', () => cleanup(undefined));
            overlay.querySelector('#_moveCatCancel').addEventListener('click', () => cleanup(undefined));
            overlay.querySelector('#_moveCatOk').addEventListener('click', confirmMove);
            select.addEventListener('keydown', e => {
                if (e.key === 'Enter') confirmMove();
                if (e.key === 'Escape') cleanup(undefined);
            });
            overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(undefined); });
        });
    }

    // 批量 AI 分析
    async function batchAnalyzeScripts() {
        if (selectedScriptIds.size === 0) return;
        const targets = currentScripts.filter(s => selectedScriptIds.has(String(s.id)));
        if (!window.AIAnalysisUI) { showMessage('AI 分析模块未加载', 'error'); return; }
        window.AIAnalysisUI.showBatchDialog(targets, {
            onDone: async () => {
                // 完成后刷新 AI 角标与批量栏
                await loadAiAnalyses();
                renderScripts();
                updateScriptBatchBar();
            }
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

    // 固定标签类型（不再依赖数据库预设；风险等级已改为独立筛选，不在此列）
    const FIXED_TAG_TYPES = [
        { id: 1, name: '环境' },
        { id: 2, name: '架构' },
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
        // 环境/架构/自定义：从当前所有脚本中收集已有的唯一值
        {
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
        currentRiskFilter = '';
        const riskFilterGroup = document.getElementById('riskFilterGroup');
        if (riskFilterGroup) {
            riskFilterGroup.querySelectorAll('.risk-filter-btn').forEach(b => b.classList.toggle('active', !b.dataset.risk));
        }
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

            // 风险等级筛选（独立切换，不占用标签筛选通道）
            if (currentRiskFilter) {
                const rt = (script.tags || []).find(t => t && Number(t.typeId) === 3);
                if (!rt || rt.value !== currentRiskFilter) return false;
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
        // 挂接 AI 分析区块（位于脚本内容下方；分析完成后刷新列表角标）
        if (window.AIAnalysisUI) {
            window.AIAnalysisUI.attachViewSection(modal, script, {
                onAnalyzed: async () => {
                    await loadAiAnalyses();
                    renderScripts();
                }
            });
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
        // 新建脚本时默认选中左侧目录树当前选中的目录（「全部」null 或「未分类」-1 时保持「未分类」）；编辑时按脚本自身目录初始化
        const defaultCatId = !isEdit && currentCategoryFilter !== null && currentCategoryFilter > 0
            ? String(currentCategoryFilter) : '';
        let catOptions = '<option value="" ' + (defaultCatId === '' ? 'selected' : '') + '>未分类</option>';
        allCategories.forEach(cat => {
            catOptions += `<option value="${cat.id}" ${defaultCatId === String(cat.id) ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`;
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

                        <!-- 第二行：标签区（环境/架构/自定义自由输入，3 列一行；风险不属于自定义标签，已移至脚本内容区） -->
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label class="form-label">标签</label>
                            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">
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
                            </div>
                            <div id="tagChipsContainer" style="display:flex;flex-wrap:wrap;gap:0.25rem;margin-top:0.5rem;min-height:28px;"></div>
                        </div>

                        <!-- 脚本内容 -->
                        <div class="form-group" style="margin-bottom: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <label class="form-label" style="margin: 0; display: inline-flex; align-items: center; gap: 0.5rem;">脚本内容 <span style="color: red;">*</span>
                                    <span id="autoRiskBadge" title="由规则引擎按脚本内容自动评估，保存时自动打标" style="display:inline-flex;align-items:center;justify-content:center;height:calc(1.5rem + 2px);border-radius:6px;font-size:0.8125rem;font-weight:600;background:var(--status-healthy-bg);color:var(--status-healthy-fg);border:1px solid var(--status-healthy-border);">普通</span>
                                </label>
                                <label style="margin: 0; font-size: 0.875rem; color: var(--text-muted); cursor: pointer;">
                                    <input type="checkbox" id="showPreview" style="margin-right: 0.25rem; cursor: pointer;">
                                    显示预览
                                </label>
                            </div>
                            <div id="autoRiskFindings" style="display:none;margin-bottom:0.5rem;padding:0.4rem 0.6rem;background:var(--surface-subtle);border:1px solid var(--border-subtle);border-radius:6px;"></div>
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
            // 风险等级已改为自动评估，过滤掉人工/历史风险标签
            currentTags = script.tags.map(normalizeTagItem).filter(Boolean).filter(t => t.typeId !== 3);
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

        // 风险自动评估：按当前脚本内容实时更新只读徽标与命中明细
        function updateRiskBadge() {
            const badge = modalOverlay.querySelector('#autoRiskBadge');
            const detail = modalOverlay.querySelector('#autoRiskFindings');
            if (!badge || !window.RiskAnalyzer) return;
            const r = window.RiskAnalyzer.analyzeRisk(textarea.value || '');
            const styles = {
                high:   'background:var(--status-critical-bg);color:var(--status-critical-fg);border:1px solid var(--status-critical-border);',
                medium: 'background:var(--status-warning-bg);color:var(--status-warning-fg);border:1px solid var(--status-warning-border);',
                normal: 'background:var(--status-healthy-bg);color:var(--status-healthy-fg);border:1px solid var(--status-healthy-border);'
            };
            badge.textContent = window.RiskAnalyzer.LEVEL_NAMES[r.level] || '普通';
            badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;height:calc(1.5rem + 2px);padding:0 0.6rem;border-radius:6px;font-size:0.8125rem;font-weight:600;' + (styles[r.level] || styles.normal);
            if (detail) {
                if (r.findings.length > 0) {
                    detail.style.display = 'block';
                    detail.innerHTML = r.findings.map(f =>
                        `<div style="font-size:12px;line-height:1.5;">
                            <span style="font-family:var(--font-mono,monospace);color:var(--text-faint);">L${f.line}</span>
                            <strong style="color:${f.level === 'high' ? 'var(--status-critical-fg)' : 'var(--status-warning-fg)'};">[${f.ruleId}]</strong>
                            ${escapeHtml(f.message)}
                        </div>`).join('');
                } else {
                    detail.style.display = 'none';
                    detail.innerHTML = '';
                }
            }
        }

        showPreviewCheckbox.addEventListener('change', (e) => {
            preview.style.display = e.target.checked ? 'block' : 'none';
        });
        let updateTimer;
        textarea.addEventListener('input', () => {
            clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
                updateRiskBadge();
                if (showPreviewCheckbox.checked && window.hljs) {
                    previewCode.textContent = textarea.value;
                    previewCode.removeAttribute('data-highlighted');
                    previewCode.className = 'language-bash';
                    window.hljs.highlightElement(previewCode);
                }
            }, 300);
        });

        // 打开弹窗即评估一次（不信任存量标签）
        updateRiskBadge();

        // 挂接 AI 入口：生成（仅新增模式：需求描述 → 草稿直接覆盖三个字段）与分析
        // （对编辑器当前内容分析，未保存的新脚本也可分析但不落库）
        if (window.AIAnalysisUI) {
            if (!isEdit) {
                window.AIAnalysisUI.attachGenerateSection(modalOverlay);
            }
            window.AIAnalysisUI.attachEditSection(modalOverlay, script, {
                onAnalyzed: async () => {
                    await loadAiAnalyses();
                    renderScripts();
                }
            });
        }

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

    // 批量导入 .sh 脚本（支持多选）
    // 优化：去掉「选择文件」那层自定义弹窗，点按钮后直接调起系统文件选择器，
    //       选完文件且读取成功后才弹出「确认信息」对话框（统一选一次归属目录）
    async function importSingleScript() {
        try {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.sh';
            fileInput.multiple = true;
            fileInput.style.display = 'none';

            fileInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files || []);
                fileInput.remove();
                if (files.length === 0) return;

                try {
                    // 读取所有选中的 .sh 文件
                    const filesData = await Promise.all(files.map(file => new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve({
                            name: file.name.replace(/\.sh$/i, ''),
                            content: ev.target.result,
                            originalFileName: file.name
                        });
                        reader.onerror = () => reject(new Error(`读取文件 ${file.name} 失败`));
                        reader.readAsText(file, 'utf-8');
                    })));

                    const dialog = new Components.ScriptShImportDialog({
                        filesData,
                        onImport: () => {
                            loadScripts();
                        }
                    });
                    dialog.show();
                } catch (readError) {
                    console.error('读取文件失败:', readError);
                    showMessage(readError.message, 'error');
                }
            }, { once: true });

            document.body.appendChild(fileInput);
            fileInput.click();
        } catch (error) {
            console.error('导入失败:', error);
            showMessage('导入失败: ' + error.message, 'error');
        }
    }

    // 导入 JSON 备份
    async function importScripts() {
        try {
            const scriptImport = new Components.ScriptJsonImportDialog({
                onImport: () => {
                    loadCategories();
                    loadScripts();
                }
            });
            scriptImport.show();
        } catch (error) {
            console.error('JSON导入失败:', error);
            showMessage('JSON导入失败: ' + error.message, 'error');
        }
    }

    // 导出 JSON 备份
    async function exportScripts() {
        try {
            if (!scriptService || scriptService.scripts.length === 0) {
                showMessage('没有数据可导出', 'warning');
                return;
            }

            await Components.ScriptJsonExport.perform();
        } catch (error) {
            console.error('JSON导出失败:', error);
            showMessage('JSON导出失败: ' + error.message, 'error');
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
