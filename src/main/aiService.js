// AI 脚本分析服务（主进程）
// 职责：大模型接入配置读写（safeStorage 加密）、/chat/completions 调用、
//       Prompt 组装、JSON 容错解析、分析结果缓存（script_ai_analyses 表）、批量分析队列。
// 设计说明：纯函数部分不依赖 electron，便于在纯 Node 环境下做单元/集成测试。
const crypto = require('crypto');

// ============================================================
// 常量
// ============================================================
const MAX_SCRIPT_CHARS = 30000;   // 超过此长度拒绝分析（防止超上下文）
const DEFAULT_TIMEOUT_MS = 180000; // 单次请求超时（实测复杂脚本分析可达 2 分钟）
const BATCH_CONCURRENCY = 2;      // 批量分析并发上限
const ANALYSIS_TABLE = 'script_ai_analyses';
const SETTINGS_KEY = 'ai';        // simple-db settings 表中的配置键

// ============================================================
// 纯函数（无 electron 依赖，可独立测试）
// ============================================================

/**
 * 解析 Base URL 为完整 chat/completions 端点。
 * 规则：
 *  - 以 /chat/completions 结尾的完整端点原样使用
 *  - 基础地址自动补全路径（去尾部斜杠后拼 /chat/completions）
 *  - 必须 https://；明文 http:// 仅允许 localhost / 127.0.0.1
 * 返回 { endpoint } 或抛出 Error
 */
function resolveEndpoint(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) throw new Error('Base URL 不能为空');
    let u;
    try { u = new URL(raw); } catch (e) { throw new Error('Base URL 格式非法'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error('必须使用 http(s):// 地址');
    }
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
    if (u.protocol === 'http:' && !isLocal) {
        throw new Error('明文 http:// 仅允许 localhost 本机地址（如本地 Ollama），请使用 https://');
    }
    let endpoint = raw.replace(/\/+$/, '');
    if (!/\/chat\/completions$/.test(endpoint)) {
        endpoint = endpoint + '/chat/completions';
    }
    return { endpoint };
}

/** sha256 十六进制摘要（content_hash 缓存键） */
function sha256(text) {
    return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/**
 * 组装分析消息（System + User），Prompt 来自 docs/features/ai.md。
 * 分级标准基于「可逆性×影响范围」校准，避免常规运维脚本被误判为高危。
 */
function buildMessages(content) {
    const system = [
        '你是一个资深的 Linux 自动化与基础设施安全工程师。你的任务是对传入的 Shell 脚本进行安全合规、生产健壮性及逻辑影响评估。',
        '',
        '【核心原则】',
        '1. 生产安全性高于代码优雅度：优先捕获未受保护的删除、kill、无限循环、未定义变量使用。',
        '2. 保持极致精炼，直击要害，绝不堆砌套话。',
        '3. 必须严格按照指定 JSON Schema 输出，不得输出任何未经 JSON 包装的自然语言。',
        '',
        '【风险分级标准】（基于可逆性与影响范围，逐档递减）',
        '- CRITICAL：仅在出错/变量为空时即造成不可逆的大范围破坏。典型：空变量导致 rm -rf 路径坍缩删除整个目录、mkfs/dd 直写磁盘、curl|bash 远程任意执行、rm -rf / 或系统关键目录。',
        '- HIGH：存在明确的不可逆数据破坏操作且防护不足。典型：rm -rf 固定业务路径无确认无备份、覆盖写入配置/文件无备份、误操作直接导致数据丢失且无法恢复。',
        '- MEDIUM：影响大但可恢复。典型：服务重启/停止、防火墙规则变更、chmod -R 777、kill 运行中进程、批量文件移动/重命名、资源占满类风险。',
        '- LOW：小范围、易恢复或低概率影响。典型：清理明确的临时目录、生成/覆盖临时文件、常规文件操作但防护不完善。',
        '- SAFE：只读查询、纯计算、无副作用操作（df/free/ps/cat/echo/grep 等）。',
        '',
        '【评级校准原则】（必须遵守，防止过度报警）',
        '1. risk_level 反映「发生生产事故的概率 × 事故影响」，而不是发现问题的数量。',
        '2. 纯规范性缺陷（缺 set -euo pipefail、缺 trap、无幂等、无参数校验、未加引号）本身不能使评级超过 MEDIUM；仅当该缺陷与破坏性命令组合、会在出错时显著放大破坏时才可升级。',
        '3. 常规运维操作（重启服务、重载配置、清理指定临时目录）按其可恢复性评级，不因「未做防御措施」而拔高。',
        '4. 大多数内部运维脚本应落在 LOW 或 MEDIUM；评为 CRITICAL/HIGH 时 critical_risks 必须包含「一旦发生即不可逆」的具体触发路径。',
        '5. 只读巡检/监控类脚本一律 SAFE，即便写法不规范。',
        '',
        '【重点审查项】（作为发现问题的依据，但评级遵守上述分级标准）',
        '- 变量展开风险（如缺少双引号导致分词或 globbing、空变量导致路径坍缩）',
        '- 错误中断策略（set -euo pipefail、管道退出状态 PIPESTATUS）',
        '- 幂等性（重复执行是否安全）',
        '- 资源清理机制（trap 捕获信号并清理临时文件）',
        '- 外部依赖项（特殊外部二进制、网络连通性、特定执行权限）'
    ].join('\n');

    const user = [
        '请对以下 Shell 脚本进行安全与工程健壮性审查：',
        '',
        '```bash',
        String(content || ''),
        '```',
        '',
        '请严格按照以下 JSON 格式返回分析结果（risk_level 按分级标准校准，不要过度报警）：',
        '{',
        '"summary": {',
        '"purpose": "用1句话解释该脚本做什么",',
        '"risk_level": "CRITICAL / HIGH / MEDIUM / LOW / SAFE",',
        '"is_idempotent": true / false,',
        '"requires_root": true / false',
        '},',
        '"critical_risks": [',
        '{',
        '"line": 脚本行号,',
        '"snippet": "涉及代码片段",',
        '"issue": "风险具体解释",',
        '"solution": "修复建议"',
        '}',
        '],',
        '"dependencies": {',
        '"commands": ["外部命令清单"],',
        '"env_vars": ["依赖的环境变量"]',
        '},',
        '"robustness_score": 1到10分（评估其错误捕获与退出安全）,',
        '"optimized_snippet": "关键风险点修复后的代码片段"',
        '}'
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: user }
    ];
}

/**
 * 容错解析模型返回的 JSON：
 * 1) 直接 parse；2) 剥离 ```json 围栏；3) 截取首个 { 到末个 } 重试。
 * 返回 { ok: true, data } 或 { ok: false, raw }
 */
function parseAnalysisJson(text) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, raw };
    const candidates = [raw];
    // 剥围栏
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) candidates.push(fence[1].trim());
    // 截取大括号
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

    for (const c of candidates) {
        try {
            const data = JSON.parse(c);
            if (data && typeof data === 'object') return { ok: true, data };
        } catch (e) { /* 尝试下一个候选 */ }
    }
    return { ok: false, raw };
}

/** 从 chat/completions 响应体提取首条消息文本 */
function extractContent(body) {
    if (!body || !Array.isArray(body.choices) || body.choices.length === 0) return '';
    const msg = body.choices[0].message || {};
    return msg.content || '';
}

/** 从响应体提取 usage（部分网关可能不返回，返回 null） */
function extractUsage(body) {
    const u = body && body.usage;
    if (!u || typeof u !== 'object') return null;
    return {
        prompt: Number(u.prompt_tokens) || 0,
        completion: Number(u.completion_tokens) || 0,
        total: Number(u.total_tokens) || 0
    };
}

// ============================================================
// AIService（依赖 electron / simple-db，构造时懒加载）
// ============================================================
class AIService {
    constructor(options = {}) {
        this._db = null;
        this._safeStorage = options.safeStorage || null; // 便于测试注入
        this.batchCancelled = false;
        this._batchRunning = false;
    }

    _getDb() {
        if (!this._db) {
            const { getDatabase } = require('../database/simple-db');
            this._db = getDatabase();
        }
        return this._db;
    }

    _getSafeStorage() {
        if (this._safeStorage !== null) return this._safeStorage;
        try {
            const { safeStorage } = require('electron');
            this._safeStorage = safeStorage;
        } catch (e) {
            this._safeStorage = false;
        }
        return this._safeStorage;
    }

    // ---------- 配置 ----------

    /** 读取配置（不回传 Key 原文），含累计 token 消耗统计 */
    getSettings() {
        const db = this._getDb();
        const cfg = db.getSetting(SETTINGS_KEY, {}) || {};
        const hasEnc = !!(cfg.apiKeyEnc && cfg.apiKeyEncPlain !== true);
        const hasPlain = !!cfg.apiKeyPlain;
        return {
            baseUrl: cfg.baseUrl || '',
            model: cfg.model || '',
            temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.3,
            sse: !!cfg.sse,
            hasKey: hasEnc || hasPlain,
            keyPlainFallback: hasPlain && !hasEnc, // 明文降级存储标记
            // 累计消耗统计（仅统计脚本分析调用）
            totalCalls: Number(cfg.totalCalls) || 0,
            totalTokens: Number(cfg.totalTokens) || 0,
            totalPromptTokens: Number(cfg.totalPromptTokens) || 0,
            totalCompletionTokens: Number(cfg.totalCompletionTokens) || 0
        };
    }

    /** 解密 API Key（仅主进程内部使用） */
    _getApiKey() {
        const db = this._getDb();
        const cfg = db.getSetting(SETTINGS_KEY, {}) || {};
        if (cfg.apiKeyEnc) {
            const safeStorage = this._getSafeStorage();
            if (safeStorage && safeStorage.isEncryptionAvailable()) {
                try {
                    return safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, 'base64'));
                } catch (e) {
                    console.error('解密 API Key 失败:', e);
                    return '';
                }
            }
        }
        return cfg.apiKeyPlain || '';
    }

    /**
     * 保存配置。apiKey 留空表示保留旧值；提供非空值则重新加密。
     * 返回 { success, message }
     */
    async saveSettings(payload = {}) {
        const db = this._getDb();
        const cfg = { ...(db.getSetting(SETTINGS_KEY, {}) || {}) };

        if (payload.baseUrl !== undefined) {
            resolveEndpoint(payload.baseUrl); // 仅做校验，具体错误信息由此抛出
            cfg.baseUrl = String(payload.baseUrl).trim();
        }
        if (payload.model !== undefined) cfg.model = String(payload.model).trim();
        if (payload.temperature !== undefined) {
            const t = Number(payload.temperature);
            if (!Number.isFinite(t) || t < 0 || t > 2) {
                return { success: false, message: 'Temperature 必须在 0-2 之间' };
            }
            cfg.temperature = t;
        }
        if (payload.sse !== undefined) cfg.sse = !!payload.sse;

        if (payload.apiKey !== undefined && String(payload.apiKey).trim() !== '') {
            const key = String(payload.apiKey).trim();
            const safeStorage = this._getSafeStorage();
            if (safeStorage && safeStorage.isEncryptionAvailable()) {
                cfg.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
                delete cfg.apiKeyPlain;
            } else {
                // 降级：明文存储（部分 Linux 环境无钥匙串）
                cfg.apiKeyPlain = key;
                delete cfg.apiKeyEnc;
                console.warn('safeStorage 不可用，API Key 将明文存储');
            }
        }

        await db.setSetting(SETTINGS_KEY, cfg);
        return { success: true, message: '保存成功' };
    }

    // ---------- 聊天调用 ----------

    /** 累加 token 消耗统计（settings.ai） */
    async _addUsage(usage) {
        if (!usage || !usage.total) return;
        const db = this._getDb();
        const cfg = { ...(db.getSetting(SETTINGS_KEY, {}) || {}) };
        cfg.totalCalls = (Number(cfg.totalCalls) || 0) + 1;
        cfg.totalTokens = (Number(cfg.totalTokens) || 0) + usage.total;
        cfg.totalPromptTokens = (Number(cfg.totalPromptTokens) || 0) + usage.prompt;
        cfg.totalCompletionTokens = (Number(cfg.totalCompletionTokens) || 0) + usage.completion;
        await db.setSetting(SETTINGS_KEY, cfg);
    }

    /**
     * 调用 /chat/completions。
     * settingsOverride 可传 { baseUrl, apiKey, model, temperature }（测试连接时用表单值）。
     * 返回 { content, usage }（usage 可能为 null，网关未返回时）。
     */
    async chat(messages, { timeout = DEFAULT_TIMEOUT_MS, settingsOverride = null } = {}) {
        const cfg = settingsOverride || {};
        const baseUrl = cfg.baseUrl || this.getSettings().baseUrl;
        const model = cfg.model || this.getSettings().model;
        const temperature = typeof cfg.temperature === 'number'
            ? cfg.temperature : (this.getSettings().temperature ?? 0.3);
        const apiKey = cfg.apiKey !== undefined ? cfg.apiKey : this._getApiKey();

        if (!baseUrl || !model) throw new Error('请先在 设置 → 大模型接入 中配置 Base URL 与模型');
        if (!apiKey) throw new Error('请先在 设置 → 大模型接入 中配置 API Key');

        const { endpoint } = resolveEndpoint(baseUrl);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        let res;
        try {
            res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature,
                    stream: false // 分析结果需整体解析 JSON，本期不走 SSE
                }),
                signal: controller.signal
            });
        } catch (e) {
            if (e.name === 'AbortError') throw new Error(`请求超时（${Math.round(timeout / 1000)}s）`);
            throw new Error(`网络请求失败: ${e.message}`);
        } finally {
            clearTimeout(timer);
        }

        const text = await res.text();
        if (!res.ok) {
            let detail = text;
            try { const j = JSON.parse(text); detail = j.error?.message || j.message || text; } catch (e) { /* 保留原文 */ }
            throw new Error(`接口返回 ${res.status}: ${String(detail).slice(0, 300)}`);
        }
        let body;
        try { body = JSON.parse(text); } catch (e) {
            throw new Error('接口返回非 JSON 内容: ' + text.slice(0, 200));
        }
        const content = extractContent(body);
        if (!content) throw new Error('接口未返回任何消息内容');
        return { content, usage: extractUsage(body) };
    }

    /** 测试连接：发送最小消息（优先用表单值，未填 Key 时用已存 Key） */
    async testConnection(payload = {}) {
        const override = { ...payload };
        // 表单 Key 留空 → 使用已保存的 Key
        if (!override.apiKey) {
            override.apiKey = this._getApiKey();
        }
        const t0 = Date.now();
        const { content } = await this.chat(
            [{ role: 'user', content: '请只回复两个字：ok' }],
            { timeout: 30000, settingsOverride: override }
        );
        return { success: true, message: `连接成功（${Date.now() - t0}ms），模型回复: ${String(content).slice(0, 50)}` };
    }

    // ---------- 分析与缓存 ----------

    /** 读取某脚本的分析记录 */
    getAnalysis(scriptId) {
        const db = this._getDb();
        return db.getTable(ANALYSIS_TABLE).find(r => String(r.script_id) === String(scriptId)) || null;
    }

    /**
     * 读取分析记录并标记是否已过期（脚本内容相对分析时已变化）。
     * 返回 { record, stale }
     */
    getAnalysisWithStale(scriptId) {
        const record = this.getAnalysis(scriptId);
        if (!record) return { record: null, stale: false };
        const script = this._getDb().getTable('scripts').find(s => String(s.id) === String(scriptId));
        if (!script) return { record, stale: false };
        return { record, stale: record.content_hash !== sha256(script.content || '') };
    }

    /**
     * 批量读取所有脚本的分析状态（列表页 AI 角标用）。
     * 返回 { [scriptId]: { status, riskLevel, stale, createdAt } }
     */
    getAllAnalyses() {
        const db = this._getDb();
        const records = db.getTable(ANALYSIS_TABLE);
        const scripts = db.getTable('scripts');
        const hashById = new Map(scripts.map(s => [String(s.id), sha256(s.content || '')]));
        const map = {};
        records.forEach(r => {
            const sid = String(r.script_id);
            map[sid] = {
                status: r.status,
                riskLevel: (r.result && r.result.summary && r.result.summary.risk_level) || null,
                stale: hashById.has(sid) ? r.content_hash !== hashById.get(sid) : true,
                createdAt: r.created_at
            };
        });
        return map;
    }

    /**
     * 单脚本分析。
     * - content 超 MAX_SCRIPT_CHARS 拒绝
     * - 缓存命中（script_id + content_hash 相同）且非 force → 直接返回（不调模型）
     * - scriptId 为空（编辑中的新脚本）→ 只调用不落库
     * 返回 { success, data: { record, fromCache }, message }
     */
    async analyze({ scriptId, scriptName, content, force = false }) {
        const text = String(content || '');
        if (!text.trim()) return { success: false, message: '脚本内容为空，无法分析' };
        if (text.length > MAX_SCRIPT_CHARS) {
            return { success: false, message: `脚本内容超过 ${MAX_SCRIPT_CHARS} 字符，超出模型上下文限制，请精简后再分析` };
        }

        const contentHash = sha256(text);
        const hasId = scriptId !== undefined && scriptId !== null && String(scriptId) !== '';

        if (hasId && !force) {
            const cached = this.getAnalysis(scriptId);
            if (cached && cached.content_hash === contentHash && (cached.status === 'success' || cached.status === 'parse_error')) {
                return { success: true, data: { record: cached, fromCache: true }, message: '命中本地缓存' };
            }
        }

        let reply, usage;
        try {
            ({ content: reply, usage } = await this.chat(buildMessages(text)));
        } catch (e) {
            const record = this._makeRecord(scriptId, scriptName, contentHash, null, '', 'error', e.message);
            if (hasId) await this._upsertRecord(record);
            return { success: false, data: { record }, message: e.message };
        }

        // 累计 token 消耗统计（仅统计实际调用模型的分析）
        await this._addUsage(usage);

        const parsed = parseAnalysisJson(reply);
        const status = parsed.ok ? 'success' : 'parse_error';
        const record = this._makeRecord(scriptId, scriptName, contentHash, parsed.ok ? parsed.data : null, reply, status, parsed.ok ? '' : '模型未返回合法 JSON', usage);
        if (hasId) await this._upsertRecord(record);
        return { success: status === 'success', data: { record, fromCache: false }, message: status === 'success' ? '分析完成' : '解析失败（已保留原始返回）' };
    }

    _makeRecord(scriptId, scriptName, contentHash, result, raw, status, error, usage = null) {
        return {
            id: 'ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            script_id: scriptId !== undefined && scriptId !== null ? scriptId : '',
            script_name: scriptName || '',
            content_hash: contentHash,
            model: this.getSettings().model,
            result,
            raw: raw || '',
            status,
            error: error || '',
            usage, // { prompt, completion, total } 或 null
            created_at: new Date().toISOString()
        };
    }

    /** 每脚本仅保留最新一条分析记录 */
    async _upsertRecord(record) {
        const db = this._getDb();
        const list = db.getTable(ANALYSIS_TABLE).filter(r => String(r.script_id) !== String(record.script_id));
        list.push(record);
        await db.setTable(ANALYSIS_TABLE, list);
    }

    /** 删除指定脚本的分析记录（脚本删除时级联调用） */
    async deleteAnalyses(scriptIds = []) {
        const db = this._getDb();
        const idSet = new Set(scriptIds.map(String));
        const before = db.getTable(ANALYSIS_TABLE);
        const after = before.filter(r => !idSet.has(String(r.script_id)));
        if (after.length !== before.length) {
            await db.setTable(ANALYSIS_TABLE, after);
        }
        return true;
    }

    // ---------- 批量分析 ----------

    /** 取消正在进行的批量分析（停止派发新任务，已完成的保留） */
    cancelBatch() {
        this.batchCancelled = true;
        return { success: true };
    }

    /**
     * 批量分析。onProgress({done, total, scriptId, scriptName, status}) 逐条回调。
     * 返回 { success, summary: { total, success, failed, skipped, cancelled } }
     */
    async batchAnalyze(scriptIds = [], { force = false, skipCached = true, onProgress = null } = {}) {
        const db = this._getDb();
        const scripts = db.getTable('scripts').filter(s => scriptIds.some(id => String(s.id) === String(id)));
        if (scripts.length === 0) return { success: false, message: '未找到有效脚本' };

        this.batchCancelled = false;
        this._batchRunning = true;

        const total = scripts.length;
        const summary = { total, success: 0, failed: 0, skipped: 0, cancelled: 0 };
        let done = 0;
        let index = 0;

        const report = (script, status) => {
            done++;
            if (onProgress) {
                try {
                    onProgress({ done, total, scriptId: script.id, scriptName: script.name, status });
                } catch (e) { /* 进度回调异常不影响主流程 */ }
            }
        };

        const worker = async () => {
            while (index < scripts.length) {
                if (this.batchCancelled) break;
                const script = scripts[index++];
                const cached = this.getAnalysis(script.id);
                if (skipCached && !force && cached && cached.content_hash === sha256(script.content || '')
                    && (cached.status === 'success' || cached.status === 'parse_error')) {
                    summary.skipped++;
                    report(script, 'skipped');
                    continue;
                }
                try {
                    const r = await this.analyze({ scriptId: script.id, scriptName: script.name, content: script.content, force: true });
                    if (r.success) { summary.success++; report(script, 'success'); }
                    else { summary.failed++; report(script, 'failed'); }
                } catch (e) {
                    summary.failed++;
                    report(script, 'failed');
                }
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(BATCH_CONCURRENCY, scripts.length); i++) workers.push(worker());
        await Promise.all(workers);

        // 未跑完的都是被取消的
        summary.cancelled = total - done;

        this._batchRunning = false;
        return { success: summary.failed === 0 && summary.cancelled === 0, summary };
    }
}

module.exports = {
    AIService,
    resolveEndpoint,
    buildMessages,
    parseAnalysisJson,
    extractContent,
    extractUsage,
    sha256,
    MAX_SCRIPT_CHARS,
    BATCH_CONCURRENCY
};
