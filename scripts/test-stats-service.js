// 统计看板聚合服务冒烟测试（mock electron + 临时数据目录，不污染真实数据）
// 用法：node scripts/test-stats-service.js
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');

// 拦截 electron：app.getPath 返回临时目录，隔离真实用户数据
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === 'electron') {
        return { app: { getPath: () => path.join(os.tmpdir(), 'stats-test-' + Date.now()) } };
    }
    return origLoad.apply(this, arguments);
};

(async () => {
    const sdb = require('../src/database/simple-db');
    await sdb.initDatabase();
    const db = sdb.getDatabase();

    // 注入 mock 数据
    const today = new Date().toISOString().slice(0, 10);
    db.setTable('hosts', [
        { id: 1, hostname: 'web-1', ip: '10.0.0.1', status: 'online', datacenter: '北京机房', system_name: '订单系统', app_name: 'nginx', environment: '生产', owner: '张三', os_type: 'CentOS', os_version: '7.9', tags: JSON.stringify([{ typeId: 1, value: '生产' }]) },
        { id: 2, hostname: 'web-2', ip: '10.0.0.2', status: 'offline', datacenter: '北京机房', system_name: '订单系统', app_name: 'nginx', environment: '测试', owner: '李四', os_type: 'Ubuntu', os_version: '22.04', tags: '' },
        { id: 3, hostname: 'db-1', ip: '10.0.0.3', status: 'online', datacenter: '上海机房', system_name: '', app_name: 'mysql', environment: '生产', owner: '张三', os_type: '', os_version: '', tags: '' }
    ]);
    db.setTable('scripts', [
        { id: 's1', name: '脚本A', language: 'bash', category_id: 1, is_builtin: 1 },
        { id: 's2', name: '脚本B', language: 'python', category_id: null, is_builtin: 0 },
        { id: 's3', name: '脚本C', language: 'bash', category_id: 2, is_builtin: 0 }
    ]);
    db.setTable('script_categories', [{ id: 1, name: '系统管理' }, { id: 2, name: '网络工具' }]);
    db.setTable('project_tasks', [{ id: 1, name: '工程一', is_template: 0 }]);
    db.setTable('project_steps', [
        { id: 1, step_type: 'script' }, { id: 2, step_type: 'command' }, { id: 3, step_type: 'upload' }
    ]);
    db.setTable('project_executions', [{ id: 1, status: 'completed' }, { id: 2, status: 'failed' }]);
    db.setTable('task_executions', [
        { id: 't1', created_at: new Date().toISOString(), is_temporary_command: 0, is_file_upload: 0, total_hosts: 2, success_hosts: 2, status: 'completed' },
        { id: 't2', created_at: new Date().toISOString(), is_temporary_command: 1, script_content: 'df -h', total_hosts: 1, success_hosts: 0, status: 'failed' },
        { id: 't3', created_at: new Date(Date.now() - 40 * 86400e3).toISOString(), is_temporary_command: 1, script_content: 'df -h', total_hosts: 1, success_hosts: 1, status: 'completed' }
    ]);
    db.setTable('task_results', [
        { id: 1, host_id: 1, duration: 1500 }, { id: 2, host_id: 2, duration: 3200 }, { id: 3, host_id: 1, duration: 800 },
        { id: 4, host_id: 3, duration: 64000 }
    ]);
    db.setTable('ai_usage_daily', [
        { date: today, model: 'qwen3', purpose: 'analyze', requests: 3, success: 2, failed: 1, prompt_tokens: 3000, completion_tokens: 1500, total_tokens: 4500, duration_ms_total: 30000 },
        { date: today, model: 'qwen3', purpose: 'generate', requests: 1, success: 1, failed: 0, prompt_tokens: 800, completion_tokens: 1200, total_tokens: 2000, duration_ms_total: 9000 }
    ]);
    db.setTable('ai_request_logs', [
        { created_at: new Date().toISOString(), ttfb_ms: 1200, duration_ms: 9000, status: 'success', model: 'qwen3', purpose: 'analyze', usage: { prompt: 100, completion: 200, total: 300 } }
    ]);

    const { getStatistics } = require('../src/main/statsService');

    // 30d 范围
    const r30 = getStatistics('30d');
    const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('PASS:', msg); };

    assert(r30.hosts.total === 3, 'hosts.total=3');
    assert(r30.hosts.online === 2, 'hosts.online=2');
    assert(r30.hosts.onlineRate === 66.7, 'hosts.onlineRate=66.7');
    assert(r30.hosts.byDatacenter[0].label === '北京机房' && r30.hosts.byDatacenter[0].count === 2, '机房分组: 北京机房=2');
    assert(r30.hosts.byOsVersion[0].label === 'CentOS 7.9', '系统版本合并: CentOS 7.9');

    assert(r30.scripts.total === 3 && r30.scripts.builtin === 1, 'scripts: total=3 builtin=1');

    assert(r30.projects.total === 1 && r30.projects.avgSteps === 3, '工程: 1 个，均 3 步');

    // 30d 内 t1/t2 两条
    assert(r30.tasks.rangeTotal === 2, '30d 范围内执行 2 次');
    assert(r30.tasks.allTotal === 3, '全量执行 3 次');
    assert(r30.tasks.daily.count[r30.tasks.daily.count.length - 1] === 2, '今日执行 2 次已入序列');
    assert(r30.tasks.p95DurationMs === 64000, 'P95 耗时 64000ms');

    assert(r30.ai.range.requests === 4 && r30.ai.range.totalTokens === 6500, 'AI: 4 次请求, 6500 tokens');
    assert(r30.ai.range.successRate === 75, 'AI 成功率 75%');
    assert(r30.ai.daily.series.prompt[r30.ai.daily.series.prompt.length - 1] === 3800, '今日 prompt tokens=3800');
    assert(r30.ai.daily.series.avgTtfbMs[r30.ai.daily.series.avgTtfbMs.length - 1] === 1200, 'TTFB 日均 1200ms');
    assert(r30.ai.purposeRatio[0].label === '脚本分析', 'purpose 排序首位为脚本分析');

    // all 范围：40 天前的 t3 也计入
    const rAll = getStatistics('all');
    assert(rAll.tasks.rangeTotal === 3, 'all 范围执行 3 次');

    // 7d 范围补零序列
    const r7 = getStatistics('7d');
    assert(r7.tasks.daily.dates.length === 7, '7d 日期序列 7 天');
    assert(r7.ai.daily.dates.length === 7, 'AI 7d 序列 7 天');

    console.log('\n全部断言通过 ✓');
    process.exit(0);
})().catch(e => { console.error('冒烟测试异常:', e); process.exit(1); });
