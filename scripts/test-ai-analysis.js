#!/usr/bin/env node
/**
 * AI 脚本分析 - 纯 Node 环境验证脚本（不依赖 Electron）
 *
 * 用法：
 *   AI_BASE_URL=... AI_API_KEY=... AI_MODEL=... node scripts/test-ai-analysis.js
 *
 * 内容：
 *   1) 单元验证：resolveEndpoint / parseAnalysisJson
 *   2) 集成验证：真实调用 /chat/completions 分析一段含隐患的样例脚本，
 *      打印交通灯卡片摘要，验证 Prompt 与 JSON Schema 有效性
 */
const { resolveEndpoint, parseAnalysisJson, buildMessages, extractContent, extractUsage, sha256 } = require('../src/main/aiService');

const BASE_URL = process.env.AI_BASE_URL || '';
const API_KEY = process.env.AI_API_KEY || '';
const MODEL = process.env.AI_MODEL || '';

let failed = 0;
function assert(cond, name) {
    if (cond) { console.log(`  [PASS] ${name}`); }
    else { console.error(`  [FAIL] ${name}`); failed++; }
}

// ============================================================
// 1) 单元验证
// ============================================================
console.log('== 单元验证：resolveEndpoint ==');
assert(resolveEndpoint('https://open.bigmodel.cn/api/paas/v4').endpoint === 'https://open.bigmodel.cn/api/paas/v4/chat/completions', '基础地址自动补全 /chat/completions');
assert(resolveEndpoint('https://gpt.gjzq.cn/prod-api/v1/chat/completions').endpoint === 'https://gpt.gjzq.cn/prod-api/v1/chat/completions', '完整端点原样使用');
assert(resolveEndpoint('https://api.example.com/v1/').endpoint === 'https://api.example.com/v1/chat/completions', '去尾部斜杠后补全');
assert(resolveEndpoint('http://localhost:11434/v1').endpoint === 'http://localhost:11434/v1/chat/completions', 'localhost 允许 http');
assert(resolveEndpoint('http://127.0.0.1:8080').endpoint === 'http://127.0.0.1:8080/chat/completions', '127.0.0.1 允许 http');
try { resolveEndpoint('http://evil.example.com/v1'); assert(false, '非本机 http 应被拒绝'); }
catch (e) { assert(true, '非本机 http 被拒绝: ' + e.message); }
try { resolveEndpoint('ftp://example.com'); assert(false, '非 http(s) 应被拒绝'); }
catch (e) { assert(true, '非 http(s) 被拒绝'); }

console.log('== 单元验证：parseAnalysisJson ==');
assert(parseAnalysisJson('{"a":1}').ok === true, '纯 JSON 直接解析');
assert(parseAnalysisJson('```json\n{"a":1}\n```').ok === true, '剥离 json 围栏');
assert(parseAnalysisJson('分析结果如下：\n```json\n{"a":1}\n```\n请参考').ok === true, '围栏 + 前后杂文本');
assert(parseAnalysisJson('好的，这是结果 {"a":1} 以上').ok === true, '截取大括号');
assert(parseAnalysisJson('抱歉我无法分析').ok === false, '非 JSON 返回 ok=false 且保留原文');
assert(parseAnalysisJson('{"summary":{"risk_level":"HIGH"}}').data.summary.risk_level === 'HIGH', '嵌套结构解析');
assert(sha256('abc').length === 64, 'sha256 输出 64 位十六进制');

console.log('== 单元验证：extractUsage ==');
assert(extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }).total === 15, '正常提取 usage');
assert(extractUsage({}) === null, '无 usage 返回 null');
const u = extractUsage({ usage: { prompt_tokens: '87', completion_tokens: '135', total_tokens: '222' } });
assert(u.prompt === 87 && u.completion === 135 && u.total === 222, '字符串数字自动转数值');

if (failed > 0) {
    console.error(`\n单元验证有 ${failed} 项失败，中止后续集成测试`);
    process.exit(1);
}

// ============================================================
// 2) 集成验证：真实调用
// ============================================================
if (!BASE_URL || !API_KEY || !MODEL) {
    console.log('\n未设置 AI_BASE_URL / AI_API_KEY / AI_MODEL，跳过集成测试');
    process.exit(0);
}

// 样例脚本：包含多个典型隐患（空变量删除、无 set -e、未加引号、无 trap）
const SAMPLE_SCRIPT = `#!/bin/bash
# 清理归档日志并备份到备份机
BACKUP_DIR=$1
LOG_DIR=/data/logs

echo "开始清理 $LOG_DIR"
rm -rf $LOG_DIR/$BACKUP_DIR/*
tar czf /tmp/archive.tar.gz $LOG_DIR
scp /tmp/archive.tar.gz backup@10.10.1.20:/backup/
rm -f /tmp/archive.tar.gz
echo "完成"`;

const RISK_NAMES = { CRITICAL: '严重', HIGH: '高危', MEDIUM: '中危', LOW: '低危', SAFE: '安全' };

async function main() {
    console.log('\n== 集成验证：测试连接 ==');
    const { endpoint } = resolveEndpoint(BASE_URL);
    console.log(`  endpoint: ${endpoint}`);
    console.log(`  model:    ${MODEL}`);

    const t0 = Date.now();
    const t1 = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: '请只回复两个字：ok' }], temperature: 0.1 })
    });
    const t1body = await t1.json();
    if (!t1.ok) throw new Error(`测试连接失败 ${t1.status}: ${JSON.stringify(t1body).slice(0, 200)}`);
    console.log(`  [PASS] 连接成功（${Date.now() - t0}ms），模型回复: ${extractContent(t1body)}`);

    console.log('\n== 集成验证：脚本分析 ==');
    const t2 = Date.now();
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, messages: buildMessages(SAMPLE_SCRIPT), temperature: 0.3 })
    });
    const t2body = await res.json();
    if (!res.ok) throw new Error(`分析调用失败 ${res.status}: ${JSON.stringify(t2body).slice(0, 300)}`);
    const reply = extractContent(t2body);
    console.log(`  耗时 ${Date.now() - t2}ms，返回 ${reply.length} 字符`);

    // token 消耗提取
    const usage = extractUsage(t2body);
    assert(usage && usage.total > 0, `token 消耗提取: 输入 ${usage ? usage.prompt : '-'} / 输出 ${usage ? usage.completion : '-'} / 合计 ${usage ? usage.total : '-'} tokens`);

    const parsed = parseAnalysisJson(reply);
    assert(parsed.ok, '模型返回可解析为 JSON');
    if (!parsed.ok) {
        console.error('  原始返回:\n' + reply.slice(0, 2000));
        process.exit(1);
    }

    const r = parsed.data;
    const s = r.summary || {};
    console.log('\n  ---------- 交通灯卡片摘要 ----------');
    console.log(`  [${RISK_NAMES[s.risk_level] || s.risk_level} ${s.risk_level}]  权限: ${s.requires_root ? 'Root' : '普通'}  幂等: ${s.is_idempotent ? '是' : '否'}`);
    console.log(`  功能摘要: ${s.purpose}`);
    const risks = Array.isArray(r.critical_risks) ? r.critical_risks : [];
    console.log(`  [!] 严重风险 (${risks.length} 项)`);
    risks.slice(0, 5).forEach(k => {
        console.log(`      - 行 ${k.line}: ${String(k.issue).slice(0, 80)}`);
    });
    const dep = r.dependencies || {};
    console.log(`  [-] 依赖: 命令[${(dep.commands || []).join(', ')}] 环境变量[${(dep.env_vars || []).join(', ')}]`);
    console.log(`  [#] 健壮性评分: ${r.robustness_score}/10`);
    console.log(`  [T] token 消耗: 输入 ${usage ? usage.prompt : '-'} / 输出 ${usage ? usage.completion : '-'} / 合计 ${usage ? usage.total : '-'} tokens`);
    console.log(`  [>] 推荐改动: ${String(r.optimized_snippet || '').slice(0, 150).replace(/\n/g, ' ⏎ ')}...`);
    console.log('  ------------------------------------');

    // 断言：该样例至少应被判为 MEDIUM 以上，且识别到风险点
    const order = ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    assert(order.indexOf(s.risk_level) >= order.indexOf('MEDIUM'), `风险等级判定合理（实际: ${s.risk_level}，含 rm -rf 应 ≥ MEDIUM）`);
    assert(risks.length > 0, '识别到至少 1 个严重风险点（rm -rf 空变量隐患）');

    console.log('\n全部验证通过 ✅');
}

main().catch(e => {
    console.error('\n集成验证失败:', e.message);
    process.exit(1);
});
