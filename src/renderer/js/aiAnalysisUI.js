// AI 脚本分析 UI：结果卡片渲染、查看/编辑弹窗内嵌区块、批量分析弹窗
(function() {
    'use strict';

    const RISK_NAMES = { CRITICAL: '严重', HIGH: '高危', MEDIUM: '中危', LOW: '低危', SAFE: '安全' };
    const RISK_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'SAFE'];
    const executionAnalysisCache = new Map();

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
    // 添加弹窗 AI 生成区块
    // ============================================================

    /**
     * 在「添加脚本」弹窗中挂接 AI 生成：按钮位于「脚本内容」标签行，
     * 点击展开内嵌面板（需求输入 + 生成按钮），生成成功后直接覆盖名称/描述/内容三个字段。
     * 生成为一次性调用（不落库不缓存），用户点「创建」后才入脚本库。
     */
    function attachGenerateSection(modalOverlay) {
        const contentLabel = Array.from(modalOverlay.querySelectorAll('.form-label')).find(el => el.textContent.includes('脚本内容'));
        if (!contentLabel) return;
        const contentGroup = contentLabel.closest('.form-group');
        if (!contentGroup) return;

        // 按钮（与 AI 分析按钮、预览开关同排）
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-info';
        btn.id = 'aiGenerateToggleBtn';
        btn.textContent = 'AI 生成';
        btn.style.marginLeft = '0.5rem';
        btn.title = '用自然语言描述需求，AI 生成脚本草稿并自动填充名称、描述与内容';
        contentLabel.parentNode.appendChild(btn);

        // 内嵌面板（插在脚本内容标题行之后、风险明细之前）
        const panel = document.createElement('div');
        panel.className = 'ai-generate-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
            <div class="ai-generate-title">用一句话描述你要的脚本，目标系统、路径、特殊要求等直接写明：</div>
            <textarea class="form-control" id="aiGenerateReq" rows="3" maxlength="2000"
                placeholder="例：清理 /data/logs 下超过 7 天的 .log 文件，删除前统计每个文件大小并输出汇总，CentOS 7 环境"></textarea>
            <div class="ai-generate-actions">
                <span class="ai-generate-hint" id="aiGenerateHint"></span>
                <div>
                    <button type="button" class="btn btn-sm btn-secondary" id="aiGenerateHideBtn">收起</button>
                    <button type="button" class="btn btn-sm btn-primary" id="aiGenerateRunBtn">生成</button>
                </div>
            </div>
        `;
        const riskFindings = contentGroup.querySelector('#autoRiskFindings');
        if (riskFindings) contentGroup.insertBefore(panel, riskFindings);
        else contentGroup.insertBefore(panel, contentGroup.lastElementChild);

        const reqInput = panel.querySelector('#aiGenerateReq');
        const runBtn = panel.querySelector('#aiGenerateRunBtn');
        const hideBtn = panel.querySelector('#aiGenerateHideBtn');
        const hintEl = panel.querySelector('#aiGenerateHint');

        btn.addEventListener('click', () => {
            const visible = panel.style.display !== 'none';
            panel.style.display = visible ? 'none' : 'block';
            if (!visible) reqInput.focus();
        });
        // 仅收起面板，需求文本保留（误点后再展开不丢内容）
        hideBtn.addEventListener('click', () => { panel.style.display = 'none'; });

        runBtn.addEventListener('click', async () => {
            const requirement = reqInput.value.trim();
            if (!requirement) { notify('请先描述你的脚本需求', 'warning'); reqInput.focus(); return; }

            const cfg = await isConfigured();
            if (!cfg.ok) { notify(cfg.msg, 'warning'); return; }

            runBtn.disabled = true;
            runBtn.textContent = '生成中…';
            reqInput.disabled = true;
            hintEl.textContent = 'AI 生成中，可能需要十几秒到几分钟，请稍候…';
            try {
                const s = svc();
                const r = await s.generateScript({ requirement });
                afterModelCall(); // 实际调用了模型，刷新底部 token 统计（不受弹窗关闭影响）
                // 弹窗已关闭则丢弃结果
                if (!document.body.contains(panel)) return;
                if (!r.success) {
                    hintEl.textContent = '';
                    notify(r.message || '生成失败', 'error');
                    return;
                }
                // 直接覆盖三个字段（需求已确认：不弹覆盖确认）
                modalOverlay.querySelector('#scriptName').value = r.data.name;
                modalOverlay.querySelector('#scriptDescription').value = r.data.description;
                const textarea = modalOverlay.querySelector('#scriptContent');
                textarea.value = r.data.content;
                // 触发 input 事件复用编辑器现有防抖逻辑：风险徽标重评 + 预览刷新
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                hintEl.textContent = '已填充，可调整需求后重新生成';
                notify('已按 AI 结果填充名称、描述与脚本内容', 'success');
            } catch (e) {
                if (document.body.contains(panel)) hintEl.textContent = '';
                notify('AI 生成失败: ' + e.message, 'error');
            } finally {
                runBtn.disabled = false;
                runBtn.textContent = '生成';
                reqInput.disabled = false;
            }
        });
    }

    // ============================================================
    // 执行结果 AI 分析
    // ============================================================

    const EXECUTION_ATTENTION = {
        normal: ['正常', 'normal'], warning: ['需要关注', 'warning'], critical: ['严重异常', 'critical']
    };
    const EXECUTION_ISSUE_TYPES = {
        failure: '执行失败', suspected_failure: '疑似隐性失败', inconsistency: '多机差异', performance: '耗时异常'
    };
    const EXECUTION_CONFIDENCE = { high: '高', medium: '中', low: '低' };
    const EXECUTION_RECOMMENDATION_RISK = { readonly: '只读', caution: '谨慎操作', destructive: '高风险' };

    function executionStats(results) {
        return {
            total: results.length,
            success: results.filter(r => r.status === 'success').length,
            failed: results.filter(r => r.status === 'failed').length,
            cancelled: results.filter(r => r.status === 'cancelled').length
        };
    }

    function renderExecutionStats(stats) {
        return `<div class="ai-execution-stats">
            <span>主机 <strong>${stats.total}</strong></span>
            <span class="text-success">成功 <strong>${stats.success}</strong></span>
            <span class="text-danger">失败 <strong>${stats.failed}</strong></span>
            ${stats.cancelled ? `<span>取消 <strong>${stats.cancelled}</strong></span>` : ''}
        </div>`;
    }

    function renderExecutionAnalysis(record, results) {
        if (!record) return '';
        if (!record.result) {
            return `<div class="ai-analysis-card ai-card-error">
                <div class="ai-card-title"><span class="ai-risk-badge ai-risk-error">${record.status === 'parse_error' ? '解析失败' : '分析失败'}</span></div>
                <div class="ai-card-raw">${esc(record.error || record.raw || '未知错误')}</div>
                ${record.raw && record.error ? `<details class="ai-execution-raw"><summary>查看模型原始返回</summary><pre>${esc(record.raw)}</pre></details>` : ''}
            </div>`;
        }
        const r = record.result;
        const hostMap = new Map(results.map((item, index) => [`H${index + 1}`, item.host_ip || `主机 ${index + 1}`]));
        const hostText = ref => `${esc(ref)}${hostMap.has(ref) ? ` · ${esc(hostMap.get(ref))}` : ''}`;
        const refsHtml = refs => refs && refs.length ? refs.map(ref => `<span class="ai-execution-host">${hostText(ref)}</span>`).join('') : '<span class="ai-execution-muted">全局问题</span>';
        const listHtml = items => items && items.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
        const attention = EXECUTION_ATTENTION[r.overall.attention_level] || EXECUTION_ATTENTION.warning;
        const coverage = record.execution && record.execution.coverage;
        const coverageHtml = coverage ? `<div class="ai-execution-coverage">本次输入覆盖 ${coverage.includedHosts}/${coverage.totalHosts} 台主机，${coverage.outputGroups} 组不同输出${coverage.omittedHosts ? `；${coverage.omittedHosts} 台因上下文限制未发送` : ''}${coverage.truncatedRepresentatives ? `；${coverage.truncatedRepresentatives} 份代表日志已截断` : ''}</div>` : '';
        const issuesHtml = r.issues.length ? r.issues.map(issue => `
            <section class="ai-execution-issue ai-execution-issue-${esc(issue.type)}">
                <div class="ai-execution-issue-head"><span class="ai-execution-issue-type">${esc(EXECUTION_ISSUE_TYPES[issue.type] || issue.type)}</span><strong>${esc(issue.title)}</strong></div>
                <div class="ai-execution-hosts">${refsHtml(issue.host_refs)}</div>
                ${issue.facts.length ? `<div class="ai-execution-block"><h4>确定事实</h4>${listHtml(issue.facts)}</div>` : ''}
                ${issue.evidence.length ? `<div class="ai-execution-block"><h4>原始证据</h4>${issue.evidence.map(e => `<div class="ai-execution-evidence"><span>${hostText(e.host_ref)} · ${esc(e.source)}</span><pre>${esc(e.excerpt)}</pre></div>`).join('')}</div>` : ''}
                ${issue.possible_causes.length ? `<div class="ai-execution-block"><h4>可能原因</h4><ul>${issue.possible_causes.map(c => `<li>${esc(c.cause)} <span class="ai-execution-muted">（置信度：${esc(EXECUTION_CONFIDENCE[c.confidence] || c.confidence)}）</span></li>`).join('')}</ul></div>` : ''}
                ${issue.recommendations.length ? `<div class="ai-execution-block"><h4>处置建议</h4>${issue.recommendations.map(item => `<div class="ai-execution-recommendation ai-recommendation-${esc(item.risk)}"><div><strong>${item.priority}. ${esc(item.action)}</strong><span class="ai-execution-risk">${esc(EXECUTION_RECOMMENDATION_RISK[item.risk] || item.risk)}</span></div>${item.command ? `<pre><code>${esc(item.command)}</code></pre>` : ''}${item.verification ? `<p>验证：${esc(item.verification)}</p>` : ''}</div>`).join('')}</div>` : ''}
            </section>`).join('') : '<div class="ai-execution-empty">未发现需要单列的异常问题</div>';
        const u = record.usage;
        const meta = `<div class="ai-card-meta">分析时间: ${esc(new Date(record.created_at).toLocaleString('zh-CN'))} · 模型: ${esc(record.model || '-')}${u && u.total ? ` · ${u.total.toLocaleString()} tokens` : ''}</div>`;
        return `<div class="ai-execution-result">
            <div class="ai-execution-overall ai-execution-attention-${attention[1]}">
                <span class="ai-execution-attention">${attention[0]}</span>
                <strong>${esc(r.overall.conclusion)}</strong>
                <span class="ai-execution-muted">结论置信度：${esc(EXECUTION_CONFIDENCE[r.overall.confidence] || r.overall.confidence)}</span>
            </div>
            ${coverageHtml}${issuesHtml}
            ${r.success_observations.length ? `<section class="ai-execution-summary"><h3>正常结果发现</h3>${listHtml(r.success_observations)}</section>` : ''}
            ${r.next_checks.length ? `<section class="ai-execution-summary"><h3>后续核验</h3>${listHtml(r.next_checks)}</section>` : ''}
            ${r.limitations.length ? `<section class="ai-execution-limitations"><h3>分析限制</h3>${listHtml(r.limitations)}</section>` : ''}
            ${meta}
        </div>`;
    }

    function executionCacheKey(payload) {
        return JSON.stringify({ type: payload.type, taskName: payload.taskName, content: payload.content, intent: payload.intent, results: payload.results });
    }

    async function showExecutionDialog(payload = {}) {
        const baseResults = Array.isArray(payload.results) ? payload.results.map(r => ({ ...r })) : [];
        if (!baseResults.length) { notify('没有可分析的执行结果', 'warning'); return; }
        if (payload.finished === false) { notify('任务尚未正常完成，暂不能分析', 'warning'); return; }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal ai-execution-modal">
            <div class="modal-header"><h2>AI 分析执行结果</h2><button class="modal-close">&times;</button></div>
            <div class="modal-body">
                <div class="ai-execution-task"><strong>${esc(payload.taskName || '未命名任务')}</strong><span>${payload.type === 'command' ? '临时命令' : '脚本任务'}</span></div>
                <div class="ai-execution-controls">
                    <label>分析范围<select class="form-control" id="aiExecutionScope"><option value="all">全部结果</option><option value="failed">仅失败主机</option></select></label>
                    <label class="ai-execution-intent">执行目的 / 成功标准（可选）<textarea class="form-control" id="aiExecutionIntent" rows="2" maxlength="1000" placeholder="例：确认 nginx 已启动且监听 80 端口；留空则仅根据命令和输出分析"></textarea></label>
                </div>
                <div class="ai-execution-privacy">日志将在本地脱敏、分组和必要截断后发送至当前配置的大模型服务。AI 结论仅作辅助，不会自动执行修复命令。</div>
                <div id="aiExecutionStats"></div>
                <div id="aiExecutionReport" class="ai-execution-report"><div class="ai-analysis-loading">请选择范围并点击“开始分析”</div></div>
            </div>
            <div class="modal-footer"><button class="btn btn-secondary" id="aiExecutionCopy" disabled>复制分析报告</button><button class="btn btn-secondary" id="aiExecutionClose">关闭</button><button class="btn btn-primary" id="aiExecutionRun">开始分析</button></div>
        </div>`;
        document.body.appendChild(overlay);
        const scopeEl = overlay.querySelector('#aiExecutionScope');
        const intentEl = overlay.querySelector('#aiExecutionIntent');
        const statsEl = overlay.querySelector('#aiExecutionStats');
        const reportEl = overlay.querySelector('#aiExecutionReport');
        const runBtn = overlay.querySelector('#aiExecutionRun');
        const copyBtn = overlay.querySelector('#aiExecutionCopy');
        let running = false;
        let hasResult = false;

        const selectedResults = () => scopeEl.value === 'failed' ? baseResults.filter(r => r.status === 'failed') : baseResults;
        const resetResult = () => {
            hasResult = false;
            runBtn.textContent = '开始分析';
            copyBtn.disabled = true;
            reportEl.innerHTML = '<div class="ai-analysis-loading">范围或成功标准已变化，请重新分析</div>';
        };
        const refreshStats = () => { statsEl.innerHTML = renderExecutionStats(executionStats(selectedResults())); };
        const close = () => overlay.remove();
        overlay.querySelector('.modal-close').addEventListener('click', close);
        overlay.querySelector('#aiExecutionClose').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay && !running) close(); });
        scopeEl.addEventListener('change', () => { refreshStats(); resetResult(); });
        intentEl.addEventListener('input', resetResult);
        refreshStats();

        copyBtn.addEventListener('click', async () => {
            const text = `任务：${payload.taskName || '未命名任务'}\n${statsEl.innerText}\n\n${reportEl.innerText}`;
            try {
                await navigator.clipboard.writeText(text);
                notify('分析报告已复制', 'success');
            } catch (e) {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
                notify('分析报告已复制', 'success');
            }
        });

        runBtn.addEventListener('click', async () => {
            if (running) return;
            const results = selectedResults();
            if (!results.length) { notify('当前没有失败主机，可切换为全部结果分析', 'warning'); return; }
            const cfg = await isConfigured();
            if (!cfg.ok) { notify(cfg.msg, 'warning'); return; }
            const request = {
                type: payload.type, taskName: payload.taskName, content: payload.content || '',
                intent: intentEl.value.trim(), finished: true, results
            };
            const cacheKey = executionCacheKey(request);
            const force = hasResult;
            if (!force && executionAnalysisCache.has(cacheKey)) {
                const cached = executionAnalysisCache.get(cacheKey);
                reportEl.innerHTML = renderExecutionAnalysis(cached.data.record, results);
                hasResult = true;
                runBtn.textContent = '重新分析';
                copyBtn.disabled = false;
                notify('已复用当前页面内的分析结果，未消耗 token', 'info');
                return;
            }

            running = true;
            runBtn.disabled = true;
            scopeEl.disabled = true;
            intentEl.disabled = true;
            copyBtn.disabled = true;
            reportEl.innerHTML = '<div class="ai-analysis-loading"><span class="ai-spin"></span> 正在分析执行结果，复杂日志可能需要数十秒到数分钟…</div>';
            try {
                const response = await svc().analyzeExecutionResult(request);
                afterModelCall();
                if (!document.body.contains(overlay)) return;
                if (response.data && response.data.record) {
                    reportEl.innerHTML = renderExecutionAnalysis(response.data.record, results);
                    hasResult = !!response.data.record.result;
                    copyBtn.disabled = !hasResult;
                    if (hasResult) {
                        executionAnalysisCache.set(cacheKey, response);
                        if (executionAnalysisCache.size > 5) executionAnalysisCache.delete(executionAnalysisCache.keys().next().value);
                    }
                    if (!response.success) notify(response.message || '分析失败', 'error');
                } else {
                    reportEl.innerHTML = `<div class="ai-analysis-loading ai-load-error">${esc(response.message || '分析失败')}</div>`;
                }
            } catch (e) {
                if (document.body.contains(overlay)) reportEl.innerHTML = `<div class="ai-analysis-loading ai-load-error">${esc(e.message)}</div>`;
            } finally {
                running = false;
                runBtn.disabled = false;
                runBtn.textContent = hasResult ? '重新分析' : '开始分析';
                scopeEl.disabled = false;
                intentEl.disabled = false;
            }
        });
    }

    function closeExecutionDialogs() {
        document.querySelectorAll('.ai-execution-modal').forEach(modal => {
            const overlay = modal.closest('.modal-overlay');
            if (overlay) overlay.remove();
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
        attachGenerateSection,
        showBatchDialog,
        showExecutionDialog,
        closeExecutionDialogs,
        isConfigured,
        refreshTokenStats
    };
})();
