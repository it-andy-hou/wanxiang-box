// AI 脚本分析 UI：结果卡片渲染、查看/编辑弹窗内嵌区块、批量分析弹窗
(function() {
    'use strict';

    const RISK_NAMES = { CRITICAL: '严重', HIGH: '高危', MEDIUM: '中危', LOW: '低危', SAFE: '安全' };
    const RISK_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'SAFE'];

    function esc(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function notify(msg, type) {
        if (window.Utils && window.Utils.notify) {
            (window.Utils.notify[type] || window.Utils.notify.info)(msg);
        } else {
            console.log(`[AI][${type}] ${msg}`);
        }
    }

    function svc() {
        if (!window.AiService) return null;
        if (!svc._inst) svc._inst = new window.AiService();
        return svc._inst;
    }

    /** 判断大模型是否已配置（baseUrl + model + key） */
    async function isConfigured() {
        const s = svc();
        if (!s) return { ok: false, msg: '仅支持 Electron 环境' };
        try {
            const r = await s.getSettings();
            const d = r.data || {};
            if (!d.baseUrl || !d.model) return { ok: false, msg: '请先在 设置 → 大模型接入 中配置 Base URL 与模型' };
            if (!d.hasKey) return { ok: false, msg: '请先在 设置 → 大模型接入 中配置 API Key' };
            return { ok: true };
        } catch (e) {
            return { ok: false, msg: '读取大模型配置失败: ' + e.message };
        }
    }

    /**
     * 刷新底部状态栏 AI token 累计消耗（实际调用才计数，命中缓存不计）。
     * el 可选，缺省时取 #totalAiTokens。
     */
    async function refreshTokenStats(el) {
        const target = el || document.getElementById('totalAiTokens');
        if (!target) return;
        const s = svc();
        if (!s) return;
        try {
            const r = await s.getSettings();
            if (r && r.success && r.data) {
                const n = Number(r.data.totalTokens) || 0;
                target.textContent = n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString();
                target.parentElement.title = `AI 分析累计消耗 ${n.toLocaleString()} tokens（分析 ${r.data.totalCalls || 0} 次，输入 ${(r.data.totalPromptTokens || 0).toLocaleString()} / 输出 ${(r.data.totalCompletionTokens || 0).toLocaleString()}）`;
            }
        } catch (e) { /* 静默失败 */ }
    }

    // 分析完成后统一调用：刷新状态栏 token 统计
    function afterModelCall() {
        refreshTokenStats();
    }

    // ============================================================
    // 结果卡片
    // ============================================================

    /** 渲染交通灯卡片 HTML */
    function renderCard(record) {
        if (!record) return '';
        const time = record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '-';
        // token 消耗（部分网关不返回 usage 时省略）
        const u = record.usage;
        const tokenInfo = (u && u.total)
            ? ` · 消耗: ${u.total.toLocaleString()} tokens (输入 ${u.prompt.toLocaleString()} / 输出 ${u.completion.toLocaleString()})`
            : '';
        const meta = `<div class="ai-card-meta">分析时间: ${esc(time)} · 模型: ${esc(record.model || '-')}${esc(tokenInfo)}</div>`;

        if (record.status === 'error') {
            return `<div class="ai-analysis-card ai-card-error">
                <div class="ai-card-title"><span class="ai-risk-badge ai-risk-error">分析失败</span></div>
                <div class="ai-card-raw">${esc(record.error || '未知错误')}</div>
                ${meta}
            </div>`;
        }

        const r = record.result;
        if (!r) {
            // parse_error：展示原始返回
            return `<div class="ai-analysis-card ai-card-error">
                <div class="ai-card-title"><span class="ai-risk-badge ai-risk-error">解析失败</span></div>
                <div class="ai-card-raw">${esc(record.raw || '')}</div>
                ${meta}
            </div>`;
        }

        const s = r.summary || {};
        const level = RISK_ORDER.includes(s.risk_level) ? s.risk_level : 'MEDIUM';
        const levelName = RISK_NAMES[level];

        // 摘要行：等级 + 权限 + 幂等
        const flags = [
            `权限: ${s.requires_root ? 'Root' : '普通'}`,
            `幂等: ${s.is_idempotent ? '是' : '否'}`
        ].filter(Boolean).join(' · ');
        const purposeHtml = s.purpose ? `<div class="ai-card-purpose">${esc(s.purpose)}</div>` : '';

        // 严重风险
        const risks = Array.isArray(r.critical_risks) ? r.critical_risks : [];
        const risksHtml = risks.length > 0 ? `
            <div class="ai-card-section ai-card-risks">
                <div class="ai-card-section-title"><span class="ai-card-mark ai-mark-risk">[!]</span> 严重风险 (${risks.length} 项)</div>
                ${risks.map(k => `
                    <div class="ai-card-risk-item">
                        <div class="ai-card-risk-line">
                            <span class="ai-card-lineno">行 ${esc(k.line)}</span>
                            <code class="ai-card-snippet">${esc(k.snippet)}</code>
                        </div>
                        <div class="ai-card-risk-issue">${esc(k.issue)}</div>
                        ${k.solution ? `<div class="ai-card-risk-solution">建议: ${esc(k.solution)}</div>` : ''}
                    </div>`).join('')}
            </div>` : '';

        // 依赖
        const dep = r.dependencies || {};
        const depParts = [];
        if (Array.isArray(dep.commands) && dep.commands.length) depParts.push('命令: ' + dep.commands.join(', '));
        if (Array.isArray(dep.env_vars) && dep.env_vars.length) depParts.push('环境变量: ' + dep.env_vars.join(', '));
        const depHtml = depParts.length ? `
            <div class="ai-card-section">
                <div class="ai-card-section-title"><span class="ai-card-mark ai-mark-dep">[-]</span> 依赖检测</div>
                <div class="ai-card-deps">${esc(depParts.join('　|　'))}</div>
            </div>` : '';

        // 健壮性评分
        const score = typeof r.robustness_score === 'number' ? r.robustness_score : null;
        const scoreHtml = score !== null ? `
            <div class="ai-card-section">
                <div class="ai-card-section-title"><span class="ai-card-mark ai-mark-score">[#]</span> 健壮性评分</div>
                <div class="ai-card-score"><span class="ai-card-score-value">${score}</span>/10</div>
            </div>` : '';

        // 推荐改动
        const patchHtml = r.optimized_snippet ? `
            <div class="ai-card-section">
                <div class="ai-card-section-title"><span class="ai-card-mark ai-mark-patch">[&gt;]</span> 推荐改动</div>
                <pre class="ai-card-patch"><code>${esc(r.optimized_snippet)}</code></pre>
            </div>` : '';

        return `<div class="ai-analysis-card ai-card-${level.toLowerCase()}">
            <div class="ai-card-title">
                <span class="ai-risk-badge ai-risk-${level.toLowerCase()}">${levelName} ${level}</span>
                <span class="ai-card-flags">${esc(flags)}</span>
            </div>
            ${purposeHtml}
            ${risksHtml}
            ${depHtml}
            ${scoreHtml}
            ${patchHtml}
            ${meta}
        </div>`;
    }

    // ============================================================
    // 查看弹窗内嵌区块
    // ============================================================

    /**
     * 在查看脚本弹窗中挂接 AI 分析区块（位于脚本内容下方）。
     * @param {HTMLElement} modalOverlay 查看弹窗根元素
     * @param {Object} script 脚本对象（含 id/name/content）
     * @param {Object} options { onAnalyzed: 分析完成后回调（刷新列表角标用） }
     */
    async function attachViewSection(modalOverlay, script, options = {}) {
        const modalBody = modalOverlay.querySelector('.modal-body');
        if (!modalBody) return;

        const section = document.createElement('div');
        section.className = 'ai-view-section';
        section.innerHTML = `
            <div class="ai-view-header">
                <strong>AI 分析</strong>
                <button class="btn btn-sm btn-primary" id="aiAnalyzeBtn">AI 分析</button>
            </div>
            <div class="ai-view-body" id="aiViewBody">
                <div class="ai-analysis-loading">尚未分析，点击「AI 分析」开始（内容未变化时复用本地结果，不重复消耗 token）</div>
            </div>
        `;
        // 位于脚本内容区块下方
        modalBody.appendChild(section);

        const btn = section.querySelector('#aiAnalyzeBtn');
        const body = section.querySelector('#aiViewBody');

        // 已有缓存则直接展示（不调用模型）；内容已变化时提示过期
        try {
            const s = svc();
            if (s && script.id) {
                const r = await s.getAnalysis(script.id);
                if (r.success && r.data && r.data.record) {
                    const staleTip = r.data.stale
                        ? '<div class="ai-analysis-loading ai-load-error" style="margin-bottom:0.5rem;">⚠ 脚本内容已修改，以下结果可能过期，建议重新分析</div>'
                        : '';
                    body.innerHTML = staleTip + renderCard(r.data.record);
                    btn.textContent = '重新分析';
                }
            }
        } catch (e) { /* 缓存读取失败不阻塞 */ }

        btn.addEventListener('click', async () => {
            const cfg = await isConfigured();
            if (!cfg.ok) { notify(cfg.msg, 'warning'); return; }

            btn.disabled = true;
            body.innerHTML = '<div class="ai-analysis-loading"><span class="ai-spin"></span> 正在分析，请稍候…（视模型响应速度，约需数秒到数十秒）</div>';
            try {
                const s = svc();
                const r = await s.analyze({
                    scriptId: script.id,
                    scriptName: script.name,
                    content: script.content,
                    force: btn.textContent === '重新分析'
                });
                if (r.success || (r.data && r.data.record)) {
                    body.innerHTML = renderCard(r.data.record);
                    btn.textContent = '重新分析';
                    if (!r.success) notify(r.message || '分析失败', 'error');
                    else if (r.data.fromCache) notify('命中本地缓存，未消耗 token', 'info');
                    if (!r.data.fromCache) afterModelCall(); // 实际调用了模型才刷新 token 统计
                    if (options.onAnalyzed) { try { options.onAnalyzed(); } catch (e) { /* 回调异常不影响 */ } }
                } else {
                    body.innerHTML = `<div class="ai-analysis-loading ai-load-error">${esc(r.message || '分析失败')}</div>`;
                }
            } catch (e) {
                body.innerHTML = `<div class="ai-analysis-loading ai-load-error">${esc(e.message)}</div>`;
            } finally {
                btn.disabled = false;
            }
        });
    }

    // ============================================================
    // 编辑弹窗内嵌区块
    // ============================================================

    /**
     * 在编辑脚本弹窗中挂接 AI 分析：按钮位于「脚本内容」标签行，结果折叠面板在内容区下方。
     * 分析对象为编辑器当前内容（新脚本未保存前也可分析，不落库）。
     * options.onAnalyzed: 分析完成后回调（刷新列表角标用）。
     */
    function attachEditSection(modalOverlay, script, options = {}) {
        const contentLabel = modalOverlay.querySelector('.form-label') ?
            Array.from(modalOverlay.querySelectorAll('.form-label')).find(el => el.textContent.includes('脚本内容')) : null;
        const contentGroup = contentLabel ? contentLabel.closest('.form-group') : null;
        if (!contentGroup) return;

        // 结果折叠面板（插在脚本内容区之后）
        const panel = document.createElement('div');
        panel.className = 'ai-edit-panel';
        panel.style.display = 'none';
        contentGroup.parentNode.insertBefore(panel, contentGroup.nextSibling);

        // 按钮（挂在标签行右侧与预览开关同排）
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-info';
        btn.id = 'aiEditAnalyzeBtn';
        btn.textContent = 'AI 分析';
        btn.style.marginLeft = '0.5rem';
        btn.title = '对当前编辑器内容进行大模型安全分析';
        const showPreviewLabel = contentLabel.querySelector('label[for="showPreview"], label:last-of-type') || contentLabel;
        showPreviewLabel.parentNode.appendChild(btn);

        btn.addEventListener('click', async () => {
            const cfg = await isConfigured();
            if (!cfg.ok) { notify(cfg.msg, 'warning'); return; }

            const textarea = modalOverlay.querySelector('#scriptContent');
            const content = textarea ? textarea.value : '';
            if (!content.trim()) { notify('脚本内容为空，无法分析', 'warning'); return; }

            btn.disabled = true;
            btn.textContent = '分析中…';
            panel.style.display = 'block';
            panel.innerHTML = '<div class="ai-analysis-loading"><span class="ai-spin"></span> 正在分析当前编辑内容…</div>';
            try {
                const s = svc();
                const r = await s.analyze({
                    // 编辑中的新脚本无 id → 不落库；已有脚本按 id 走缓存
                    scriptId: script && script.id ? script.id : null,
                    scriptName: script && script.name ? script.name : (modalOverlay.querySelector('#scriptName')?.value || ''),
                    content
                });
                if (r.data && r.data.record) {
                    panel.innerHTML = renderCard(r.data.record);
                    if (r.data.fromCache) notify('命中本地缓存，未消耗 token', 'info');
                    if (!r.data.fromCache) afterModelCall(); // 实际调用了模型才刷新 token 统计
                    if (options.onAnalyzed) { try { options.onAnalyzed(); } catch (e) { /* 回调异常不影响 */ } }
                } else {
                    panel.innerHTML = `<div class="ai-analysis-loading ai-load-error">${esc(r.message || '分析失败')}</div>`;
                }
            } catch (e) {
                panel.innerHTML = `<div class="ai-analysis-loading ai-load-error">${esc(e.message)}</div>`;
            } finally {
                btn.disabled = false;
                btn.textContent = 'AI 分析';
            }
        });
    }

    // ============================================================
    // 批量分析弹窗
    // ============================================================

    /**
     * 批量 AI 分析弹窗。
     * @param {Array} scripts 勾选的脚本对象数组 [{id, name, content}]
     * @param {Object} options { onDone: (summary) => void }
     */
    async function showBatchDialog(scripts, options = {}) {
        const s = svc();
        if (!s) { notify('仅支持 Electron 环境', 'error'); return; }

        const cfg = await isConfigured();
        if (!cfg.ok) { notify(cfg.msg, 'warning'); return; }

        // 超过阈值二次确认（token 消耗风险提示）
        if (scripts.length > 20) {
            const confirmed = window.Components && await Components.ConfirmDialog.show({
                title: '批量分析确认',
                message: `已选择 ${scripts.length} 个脚本，批量分析将逐个调用大模型，可能产生较多 token 消耗。确定继续吗？`,
                confirmText: '继续分析',
                cancelText: '取消'
            });
            if (!confirmed) return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="max-width:720px;">
                <div class="modal-header">
                    <h2>批量 AI 分析</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body" style="max-height:60vh;overflow-y:auto;">
                    <div class="ai-batch-summary">
                        <span>目标脚本: <strong>${scripts.length}</strong> 个（每个脚本独立分析）</span>
                        <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;" title="取消勾选将对所有选中脚本重新调模型分析（消耗 token），适用于风险评级标准更新后重新校准">
                            <input type="checkbox" id="aiBatchSkipCached" checked>
                            <span>跳过已有有效结果的脚本（取消勾选则强制全部重新分析，消耗 token）</span>
                        </label>
                    </div>
                    <div class="ai-batch-progress" id="aiBatchProgressWrap" style="display:none;">
                        <div class="progress-bar-container" style="margin-bottom:0.5rem;">
                            <div class="progress-bar">
                                <div class="progress-fill" id="aiBatchProgressFill" style="width:0%;"></div>
                            </div>
                            <span class="progress-text" id="aiBatchProgressText">0 / ${scripts.length}</span>
                        </div>
                    </div>
                    <div class="ai-batch-list" id="aiBatchList">
                        ${scripts.map(sc => `
                            <div class="ai-batch-item" data-script-id="${esc(String(sc.id))}">
                                <span class="ai-batch-item-name" title="${esc(sc.name)}">${esc(sc.name)}</span>
                                <span class="ai-batch-item-status st-pending">等待</span>
                            </div>`).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="aiBatchCancelTop" style="display:none;">取消分析</button>
                    <button class="btn btn-secondary" id="aiBatchCloseBtn">关闭</button>
                    <button class="btn btn-primary" id="aiBatchStartBtn">开始分析</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const closeBtn = overlay.querySelector('#aiBatchCloseBtn');
        const startBtn = overlay.querySelector('#aiBatchStartBtn');
        const cancelBtn = overlay.querySelector('#aiBatchCancelTop');
        const skipChk = overlay.querySelector('#aiBatchSkipCached');
        const progressWrap = overlay.querySelector('#aiBatchProgressWrap');
        const progressFill = overlay.querySelector('#aiBatchProgressFill');
        const progressText = overlay.querySelector('#aiBatchProgressText');
        const listEl = overlay.querySelector('#aiBatchList');

        const close = () => overlay.remove();
        overlay.querySelector('.modal-close').addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const setItemStatus = (scriptId, status, text) => {
            // 属性选择器带引号时值为字符串字面量，不需要 CSS.escape（数字 ID 会被错误转义）
            const row = listEl.querySelector(`[data-script-id="${String(scriptId)}"] .ai-batch-item-status`);
            if (!row) return;
            row.className = `ai-batch-item-status st-${status}`;
            row.textContent = text;
        };

        // 读取某行的当前状态标记（供轮询/终态兜底判断）
        const getItemStatus = (scriptId) => {
            const row = listEl.querySelector(`[data-script-id="${String(scriptId)}"] .ai-batch-item-status`);
            return row ? row.textContent : '';
        };

        const updateProgress = (done) => {
            const pct = Math.min(100, Math.round((done / scripts.length) * 100));
            progressFill.style.width = `${pct}%`;
            progressText.textContent = `${done} / ${scripts.length}`;
        };

        // 统计已非「等待」的行数并刷新进度条
        const refreshProgressByRows = () => {
            let done = 0;
            scripts.forEach(sc => {
                const t = getItemStatus(sc.id);
                if (t && t !== '等待') done++;
            });
            updateProgress(done);
        };

        let unsub = null;
        let pollTimer = null;
        let running = false;

        startBtn.addEventListener('click', async () => {
            if (running) return;
            running = true;
            startBtn.disabled = true;
            startBtn.style.display = 'none';
            cancelBtn.style.display = '';
            skipChk.disabled = true;
            progressWrap.style.display = 'block';

            // 订阅进度（主通道：主进程事件推送）
            unsub = s.onBatchProgress((p) => {
                updateProgress(p.done || 0);
                const map = {
                    success: ['success', '成功'],
                    failed: ['failed', '失败'],
                    skipped: ['skipped', '跳过（有缓存）']
                };
                if (map[p.status]) setItemStatus(p.scriptId, map[p.status][0], map[p.status][1]);
            });

            // 轮询兑底（兑底通道：事件丢失时仍能刷新进度）
            // 分析期间每 2s 查询一次分析记录，凡本轮开始后新产生的记录立即更新对应行
            const batchStartAt = Date.now();
            pollTimer = setInterval(async () => {
                try {
                    const r = await s.getAllAnalyses();
                    if (!r || !r.success || !r.data) return;
                    scripts.forEach(sc => {
                        if (getItemStatus(sc.id) !== '等待') return;
                        const a = r.data[String(sc.id)];
                        if (!a || !a.createdAt) return;
                        if (new Date(a.createdAt).getTime() < batchStartAt) return; // 旧记录，非本轮产出
                        if (a.status === 'success') setItemStatus(sc.id, 'success', '成功');
                        else if (a.status === 'parse_error') setItemStatus(sc.id, 'failed', '解析失败');
                        else setItemStatus(sc.id, 'failed', '失败');
                    });
                    refreshProgressByRows();
                } catch (e) { /* 轮询失败不影响主流程 */ }
            }, 2000);

            try {
                const result = await s.batchAnalyze(
                    scripts.map(sc => sc.id),
                    { skipCached: !!skipChk.checked, force: false }
                );

                // 终态兑底：无论事件/轮询是否送达，结束时用返回的 summary 校正所有行与进度条
                const sm = result && result.summary;
                if (sm) {
                    const pending = scripts.filter(sc => getItemStatus(sc.id) === '等待');
                    // 已展示终态的行数不变；剩余行按 summary 推断（先成功后失败后取消）
                    let successLeft = Math.max(0, sm.success - scripts.filter(sc => getItemStatus(sc.id) === '成功').length);
                    let failedLeft  = Math.max(0, sm.failed  - scripts.filter(sc => getItemStatus(sc.id) === '失败').length);
                    let skippedLeft = Math.max(0, sm.skipped - scripts.filter(sc => getItemStatus(sc.id).includes('跳过')).length);
                    const cancelledLeft = Math.max(0, sm.cancelled);
                    pending.forEach(sc => {
                        if (successLeft > 0) { setItemStatus(sc.id, 'success', '成功'); successLeft--; }
                        else if (failedLeft > 0) { setItemStatus(sc.id, 'failed', '失败'); failedLeft--; }
                        else if (skippedLeft > 0) { setItemStatus(sc.id, 'skipped', '跳过（有缓存）'); skippedLeft--; }
                        else if (cancelledLeft > 0) { setItemStatus(sc.id, 'skipped', '已取消'); }
                        else { setItemStatus(sc.id, 'success', '完成'); }
                    });
                    updateProgress(sm.total - (sm.cancelled || 0));
                }

                if (result.success) {
                    notify(`批量分析完成: 成功 ${sm.success}，跳过 ${sm.skipped}`, 'success');
                } else if (sm) {
                    notify(`批量分析结束: 成功 ${sm.success} / 失败 ${sm.failed} / 跳过 ${sm.skipped}` +
                        (sm.cancelled ? ` / 已取消 ${sm.cancelled}` : ''), 'warning');
                } else {
                    notify(result.message || '批量分析失败', 'error');
                }
                if (options.onDone) options.onDone(sm || null);
            } catch (e) {
                notify('批量分析失败: ' + e.message, 'error');
            } finally {
                if (unsub) { unsub(); unsub = null; }
                if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
                running = false;
                cancelBtn.style.display = 'none';
                closeBtn.textContent = '关闭';
                // 刷新底部状态栏 token 统计（批量分析无论成败均已实际调用模型）
                refreshTokenStats();
            }
        });

        cancelBtn.addEventListener('click', async () => {
            try { await s.batchCancel(); } catch (e) { /* 忽略 */ }
            cancelBtn.disabled = true;
            cancelBtn.textContent = '正在取消…';
        });
    }

    // 导出
    window.AIAnalysisUI = {
        renderCard,
        attachViewSection,
        attachEditSection,
        showBatchDialog,
        isConfigured,
        refreshTokenStats
    };
})();
