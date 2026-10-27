// AI 脚本分析服务（主进程）
// 职责：大模型接入配置读写（safeStorage 加密）、/chat/completions 调用、
//       Prompt 组装、JSON 容错解析、分析结果缓存（script_ai_analyses 表）、批量分析队列。
// 设计说明：纯函数部分不依赖 electron，便于在纯 Node 环境下做单元/集成测试。
const crypto = require('crypto');

// ============================================================
// 常量
// ============================================================
const MAX_SCRIPT_CHARS = 30000;   // 超过此长度拒绝分析（防止超上下文）
const MAX_GENERATE_REQUIREMENT_CHARS = 2000; // 脚本生成需求描述的最大长度
const DEFAULT_TIMEOUT_MS = 180000; // 单次请求超时（实测复杂脚本分析可达 2 分钟）
const BATCH_CONCURRENCY = 2;      // 批量分析并发上限
const ANALYSIS_TABLE = 'script_ai_analyses';
const REQUEST_LOG_TABLE = 'ai_request_logs'; // AI 请求日志表（滚动保留）
const MAX_REQUEST_LOGS = 200;    // 请求日志滚动保留条数（超出删最旧）
const MAX_LOG_BODY_CHARS = 200000; // 审计模式下请求/响应全文的截断上限
const RESPONSE_PREVIEW_CHARS = 500; // 响应预览截断长度
const SETTINGS_KEY = 'ai';        // simple-db settings 表中的配置键

// ============================================================
// 纯函数（无 electron 依赖，可独立测试）
// ============================================================

/**
 * 判断主机名是否为本机或内网地址（明文 http 的放行范围）。
 * 覆盖：loopback、RFC1918 私有网段、链路本地、IPv6 ULA、
 * .local/.internal 后缀、单标签主机名（如 docker 网络内的 ollama-server）。
 */
function isPrivateHost(hostname) {
    // URL.hostname 对 IPv6 会带方括号（如 [fd12::1]），先去掉再判定
    const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h === '::1') return true;
    if (h.endsWith('.local') || h.endsWith('.internal')) return true;
    // 单标签主机名（无点无冒号，如 docker 网络内的 ollama-server）；IPv6 含冒号需继续往下判定
    if (!h.includes('.') && !h.includes(':')) return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
        const a = Number(m[1]), b = Number(m[2]);
        if (a === 127 || a === 10 || a === 169 && b === 254) return true;
        if (a === 192 && b === 168) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
    }
    // IPv6 ULA（fc00::/7）与链路本地（fe80::/10）
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
    return false;
}

/**
 * 解析 Base URL 为完整 chat/completions 端点。
 * 规则：
 *  - 以 /chat/completions 结尾的完整端点原样使用
 *  - 基础地址自动补全路径（去尾部斜杠后拼 /chat/completions）
 *  - 必须 https://；明文 http:// 仅允许本机或内网地址（含 localhost、本地 Ollama、内网网关）
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
    if (u.protocol === 'http:' && !isPrivateHost(u.hostname)) {
        throw new Error('明文 http:// 仅允许本机或内网地址（如本地 Ollama、192.168.x.x），公网地址请使用 https://');
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
 * 组装脚本生成消息（System + User）。
 * 需求描述来自添加脚本弹窗的 AI 生成面板，目标环境等特殊要求由用户在需求中自行写明。
 */
function buildGenerateMessages(requirement) {
    const system = [
        '你是一个资深的 Linux 自动化运维工程师，为生产环境编写 Bash 脚本。你的任务是根据用户的需求描述生成可直接使用的脚本草稿。',
        '',
        '【强制工程规范】',
        '1. 以 #!/bin/bash 开头，第二行启用 set -euo pipefail。',
        '2. 变量引用一律用双引号包裹；关键路径/目录变量用 ${VAR:?提示信息} 判空防护，防止空变量导致路径坍缩。',
        '3. 幂等可重跑：重复执行不产生副作用（如先判断再操作）。',
        '4. 可配置项（路径、阈值、保留天数等）集中为脚本头部变量，并加中文注释说明。',
        '5. 关键步骤用 echo 输出中文执行日志；失败时错误信息明确，便于排查。',
        '',
        '【安全约束】',
        '1. 需求涉及破坏性操作（删除、kill、重启服务、覆盖文件等）时，必须内置防护：路径白名单/固定前缀校验、变量判空、操作前输出影响范围清单；禁止生成裸 rm -rf 类无防护代码。',
        '2. 无法安全实现的需求（如格式化磁盘、清空根目录）不得直接实现，应在 description 中明确标注风险与限制。',
        '3. description 保持简短核心（30字以内）；风险提示与适用环境等补充说明写在脚本文本的头部注释中，不写入 description。',
        '',
        '【输出约束】',
        '必须严格按照指定 JSON Schema 输出，不得输出任何未经 JSON 包装的自然语言。',
        'name 为英文脚本文件名（kebab-case 小写英文单词加连字符，10~30 字符，以 .sh 结尾，如 fix-data.sh、clean-expired-logs.sh，禁止中文与拼音）；description 为简短核心的一句话描述（30字以内，只讲脚本做什么，不要写适用环境、注意事项等补充说明）；content 为完整脚本文本文本（含 shebang、set 选项、中文注释），其中的换行用 \\n 转义以保证 JSON 合法。'
    ].join('\n');

    const user = [
        '请根据以下需求编写一个生产可用的 Bash 脚本：',
        '',
        '【需求描述】',
        String(requirement || ''),
        '',
        '请严格按照以下 JSON 格式返回：',
        '{',
        '"name": "英文脚本文件名（kebab-case，以 .sh 结尾，如 fix-data.sh）",',
        '"description": "简短核心描述（30字以内，只讲脚本做什么）",',
        '"content": "完整 Bash 脚本文本（含 shebang、set 选项、中文注释）"',
        '}'
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: user }
    ];
}

/**
 * 规范化 AI 生成的脚本名：kebab-case 英文 + .sh 后缀。
 * 模型偶尔不守约时兑底：非 [a-z0-9._-] 字符替换为连字符、补 .sh 后缀、全非法时回退为 script-<时间戳>.sh。
 */
function normalizeGeneratedName(name) {
    let n = String(name || '').trim().toLowerCase();
    // 只保留英文数字/连字符/点，其余（含中文、空格、下划线等）替换为连字符，压缩重复并去首尾
    n = n.replace(/[^a-z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    if (!n) return 'script-' + Date.now() + '.sh';
    // 去掉已有其他后缀后统一补 .sh（去后缀可能产生尾部连字符，再清一次）
    n = n.replace(/\.(sh|bash|shell)$/i, '').replace(/-+$/g, '');
    if (!n) return 'script-' + Date.now() + '.sh';
    return n.slice(0, 60) + '.sh';
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
            disableThinking: !!cfg.disableThinking, // 关闭推理模型的深度思考（qwen3 等，经 chat_template_kwargs 透传给 vLLM）
            sse: !!cfg.sse,
            logFullRequest: !!cfg.logFullRequest, // 审计模式：记录完整请求体（含脚本内容）
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
        if (payload.disableThinking !== undefined) cfg.disableThinking = !!payload.disableThinking;
        if (payload.logFullRequest !== undefined) cfg.logFullRequest = !!payload.logFullRequest;

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
     * 调用 /chat/completions，并写入请求日志（ai_request_logs 表，滚动保留）。
     * settingsOverride 可传 { baseUrl, apiKey, model, temperature }（测试连接时用表单值）。
     * purpose: 'analyze' | 'generate' | 'test'（日志来源标记，缺省 'other'）。
     * 返回 { content, usage, logId }（usage 可能为 null，网关未返回时；logId 供上层回填日志状态）。
     */
    async chat(messages, { timeout = DEFAULT_TIMEOUT_MS, settingsOverride = null, purpose = 'other', scriptId = null, scriptName = '' } = {}) {
        const cfg = settingsOverride || {};
        const baseUrl = cfg.baseUrl || this.getSettings().baseUrl;
        const model = cfg.model || this.getSettings().model;
        const temperature = typeof cfg.temperature === 'number'
            ? cfg.temperature : (this.getSettings().temperature ?? 0.3);
        const apiKey = cfg.apiKey !== undefined ? cfg.apiKey : this._getApiKey();

        if (!baseUrl || !model) throw new Error('请先在 设置 → 大模型接入 中配置 Base URL 与模型');
        if (!apiKey) throw new Error('请先在 设置 → 大模型接入 中配置 API Key');

        const { endpoint } = resolveEndpoint(baseUrl);
        const endpointHost = new URL(endpoint).hostname;

        // 请求日志基础字段（失败前就要能定位到目标，故先组装）
        const requestBodyJson = { model, messages, temperature, stream: false };
        // 关闭深度思考：qwen3 系推理模型经 vLLM 的 chat_template_kwargs 透传（实测复杂任务 342s -> 6s）
        if (!!(cfg.disableThinking || this.getSettings().disableThinking)) {
            requestBodyJson.chat_template_kwargs = { enable_thinking: false };
        }
        const requestBody = JSON.stringify(requestBodyJson);
        const logFullRequest = !!this.getSettings().logFullRequest;
        const log = {
            id: 'airq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            purpose,
            script_id: scriptId !== undefined && scriptId !== null ? scriptId : '',
            script_name: scriptName || '',
            endpoint_host: endpointHost,
            model,
            status: '',
            http_status: null,
            error: '',
            duration_ms: 0,
            ttfb_ms: null, // 首字节耗时（响应头到达时间）；null 表示超时前连响应头都未收到
            timeout_ms: timeout,
            usage: null,
            request_chars: requestBody.length,
            request_body: logFullRequest ? requestBody.slice(0, MAX_LOG_BODY_CHARS) : '',
            response_preview: '',
            created_at: new Date().toISOString()
        };

        const t0 = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        let res, text;
        try {
            try {
                res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: requestBody,
                    signal: controller.signal
                });
            } catch (e) {
                // 响应头都未返回：超时说明模型/网关在限时内未完成计算（连接、排队、推理均在此阶段）
                log.duration_ms = Date.now() - t0;
                const isTimeout = e.name === 'AbortError';
                log.status = isTimeout ? 'timeout' : 'network_error';
                log.error = isTimeout
                    ? `请求超时（${Math.round(timeout / 1000)}s，响应头未返回）`
                    : `网络请求失败: ${e.message}`;
                throw new Error(log.error);
            }
            log.http_status = res.status;
            log.ttfb_ms = Date.now() - t0; // 首字节耗时：stream:false 下响应头到达 ≈ 模型计算完成
            try {
                text = await res.text(); // 超时计时器持续有效：响应体传输同样受总超时约束，避免网关半开连接永久挂起
            } catch (e) {
                log.duration_ms = Date.now() - t0;
                const isTimeout = e.name === 'AbortError';
                log.status = isTimeout ? 'timeout' : 'network_error';
                log.error = isTimeout
                    ? `响应超时（响应头 ${log.ttfb_ms}ms 已返回，响应体未在 ${Math.round(timeout / 1000)}s 内传完）`
                    : `响应读取失败: ${e.message}`;
                throw new Error(log.error);
            }
        } catch (e) {
            this._writeRequestLog(log);
            console.warn(`[AI请求] ${purpose} ${endpointHost} 失败(${log.status}) ${log.duration_ms}ms: ${log.error}`);
            throw e;
        } finally {
            clearTimeout(timer);
        }

        log.duration_ms = Date.now() - t0;
        if (!res.ok) {
            let detail = text;
            try { const j = JSON.parse(text); detail = j.error?.message || j.message || text; } catch (e) { /* 保留原文 */ }
            log.status = 'http_error';
            log.error = `接口返回 ${res.status}: ${String(detail).slice(0, 300)}`;
            log.response_preview = text.slice(0, RESPONSE_PREVIEW_CHARS);
            this._writeRequestLog(log);
            console.warn(`[AI请求] ${purpose} ${endpointHost} 失败(http ${res.status}) ${log.duration_ms}ms: ${log.error}`);
            throw new Error(log.error);
        }
        let body;
        try { body = JSON.parse(text); } catch (e) {
            log.status = 'bad_response';
            log.error = '接口返回非 JSON 内容: ' + text.slice(0, 200);
            log.response_preview = text.slice(0, RESPONSE_PREVIEW_CHARS);
            this._writeRequestLog(log);
            console.warn(`[AI请求] ${purpose} ${endpointHost} 失败(非JSON) ${log.duration_ms}ms`);
            throw new Error(log.error);
        }
        const content = extractContent(body);
        if (!content) {
            log.status = 'bad_response';
            log.error = '接口未返回任何消息内容';
            log.response_preview = text.slice(0, RESPONSE_PREVIEW_CHARS);
            this._writeRequestLog(log);
            console.warn(`[AI请求] ${purpose} ${endpointHost} 失败(无内容) ${log.duration_ms}ms`);
            throw new Error(log.error);
        }
        log.status = 'success';
        log.usage = extractUsage(body);
        log.response_preview = String(content).slice(0, RESPONSE_PREVIEW_CHARS);
        this._writeRequestLog(log);
        return { content, usage: log.usage, logId: log.id };
    }

    /**
     * 写入请求日志（滚动保留 MAX_REQUEST_LOGS 条，超出删最旧）。
     * 日志写入失败不影响 AI 主流程。
     */
    async _writeRequestLog(log) {
        try {
            const db = this._getDb();
            const list = db.getTable(REQUEST_LOG_TABLE);
            list.push(log);
            while (list.length > MAX_REQUEST_LOGS) {
                list.shift();
            }
            await db.setTable(REQUEST_LOG_TABLE, list);
        } catch (e) {
            console.warn('写入 AI 请求日志失败:', e.message);
        }
    }

    /** 回填日志字段（如解析失败标记 parse_error、生成成功后回填脚本名） */
    async _updateRequestLog(logId, updates = {}) {
        if (!logId) return;
        try {
            const db = this._getDb();
            const list = db.getTable(REQUEST_LOG_TABLE);
            const idx = list.findIndex(r => r.id === logId);
            if (idx >= 0) {
                list[idx] = { ...list[idx], ...updates };
                await db.setTable(REQUEST_LOG_TABLE, list);
            }
        } catch (e) {
            console.warn('更新 AI 请求日志失败:', e.message);
        }
    }

    /** 读取请求日志（倒序，最新在前） */
    getRequestLogs() {
        const list = this._getDb().getTable(REQUEST_LOG_TABLE);
        return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    /** 清空请求日志 */
    async clearRequestLogs() {
        await this._getDb().setTable(REQUEST_LOG_TABLE, []);
        return true;
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
            { timeout: 30000, settingsOverride: override, purpose: 'test' }
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

        let reply, usage, logId;
        try {
            ({ content: reply, usage, logId } = await this.chat(buildMessages(text),
                { purpose: 'analyze', scriptId: hasId ? scriptId : null, scriptName: scriptName || '' }));
        } catch (e) {
            const record = this._makeRecord(scriptId, scriptName, contentHash, null, '', 'error', e.message);
            if (hasId) await this._upsertRecord(record);
            return { success: false, data: { record }, message: e.message };
        }

        // 累计 token 消耗统计（仅统计实际调用模型的分析）
        await this._addUsage(usage);

        const parsed = parseAnalysisJson(reply);
        const status = parsed.ok ? 'success' : 'parse_error';
        if (!parsed.ok && logId) {
            // 模型有返回但 JSON 不合法 → 回填日志状态，便于在请求记录页定位
            await this._updateRequestLog(logId, { status: 'parse_error', error: '模型未返回合法 JSON' });
        }
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

    // ---------- 脚本生成 ----------

    /**
     * AI 生成脚本草稿（一次性调用，不落库、不缓存；用户保存后才入脚本库）。
     * 返回 { success, data: { name, description, content }, usage, message }
     */
    async generateScript({ requirement } = {}) {
        const text = String(requirement || '').trim();
        if (!text) return { success: false, message: '请先描述你的脚本需求' };
        if (text.length > MAX_GENERATE_REQUIREMENT_CHARS) {
            return { success: false, message: `需求描述超过 ${MAX_GENERATE_REQUIREMENT_CHARS} 字符，请精简后再试` };
        }

        let reply, usage, logId;
        // 需求摘要先充当 script_name（生成时脚本尚不存在；超时/失败时也能定位是哪个需求）
        const requirementPreview = text.replace(/\s+/g, ' ').slice(0, 24);
        try {
            ({ content: reply, usage, logId } = await this.chat(buildGenerateMessages(text),
                { purpose: 'generate', scriptName: requirementPreview }));
        } catch (e) {
            return { success: false, message: e.message };
        }

        // 累计 token 消耗统计（与分析共用累计值）
        await this._addUsage(usage);

        const parsed = parseAnalysisJson(reply);
        if (!parsed.ok) {
            if (logId) await this._updateRequestLog(logId, { status: 'parse_error', error: '模型未返回合法结果' });
            return { success: false, message: '模型未返回合法结果，请调整需求后重试' };
        }

        const data = parsed.data || {};
        const name = normalizeGeneratedName(data.name);
        const description = String(data.description || '').trim();
        const content = String(data.content || '').trim();
        // 生成完成 → 回填实际生成的脚本名（覆盖需求摘要）
        if (name && logId) await this._updateRequestLog(logId, { script_name: name });
        if (!name) return { success: false, message: '模型未返回脚本名称，请重试' };
        if (!content) return { success: false, message: '模型未返回脚本内容，请重试' };
        if (content.length > MAX_SCRIPT_CHARS) {
            return { success: false, message: `生成的脚本超过 ${MAX_SCRIPT_CHARS} 字符，请精简需求后重试` };
        }

        return { success: true, data: { name, description, content }, usage, message: '生成完成' };
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
    buildGenerateMessages,
    normalizeGeneratedName,
    parseAnalysisJson,
    extractContent,
    extractUsage,
    sha256,
    MAX_SCRIPT_CHARS,
    MAX_GENERATE_REQUIREMENT_CHARS,
    BATCH_CONCURRENCY
};
