// ============================================================
// 统计看板聚合服务（主进程）
// 纯读聚合：从 simple-db 各表读取数据并分组统计，一次性返回看板全量 JSON。
// 不做任何写入；AI 用量日汇总的写入在 aiService._upsertUsageDaily。
// ============================================================
const { getDatabase } = require('../database/simple-db');

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * 分组计数：返回 [{ label, count }] 按 count 降序
 * 取值函数 getField(row) 返回 null/'' 视为「未设置」归组
 */
function countBy(rows, getField, { sortByCount = true, limit = 0 } = {}) {
    const map = new Map();
    for (const row of rows) {
        const key = getField(row);
        const label = (key === null || key === undefined || String(key).trim() === '')
            ? '未设置' : String(key).trim();
        map.set(label, (map.get(label) || 0) + 1);
    }
    let list = Array.from(map.entries()).map(([label, count]) => ({ label, count }));
    if (sortByCount) list.sort((a, b) => b.count - a.count);
    if (limit > 0 && list.length > limit) list = list.slice(0, limit);
    return list;
}

/**
 * 本地时区日期字符串 YYYY-MM-DD（toISOString 是 UTC 日期，与本地时区会错位一天）
 */
function localDateStr(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * range 起始日期（含）；range='all' 返回 null
 */
function rangeStart(range) {
    const days = RANGE_DAYS[range];
    if (!days) return null;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
}

/**
 * 判断时间戳是否在范围内（无时间戳的历史记录归入 all）
 */
function inRange(ts, start) {
    if (!start) return true;
    if (!ts) return false;
    return new Date(ts) >= start;
}

/**
 * 生成 range 内的完整日期序列（补零用），返回 ['YYYY-MM-DD', ...]
 */
function buildDateSeries(start) {
    const series = [];
    if (!start) return series;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = new Date(start);
    while (d <= now) {
        series.push(localDateStr(d));
        d.setDate(d.getDate() + 1);
    }
    return series;
}

/**
 * 计算数组分位数（P95）
 */
function percentile(sortedValues, p) {
    if (sortedValues.length === 0) return 0;
    const idx = Math.ceil(p / 100 * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, idx))];
}

// ============================================================
// 各维度统计
// ============================================================

/** 主机资产统计 */
function statsHosts(db) {
    const hosts = db.getTable('hosts');

    const osVersion = countBy(hosts, h => {
        const type = String(h.os_type || '').trim();
        const ver = String(h.os_version || '').trim();
        if (!type && !ver) return '';
        if (type && ver) return `${type} ${ver}`;
        return type || ver;
    });

    const online = hosts.filter(h => h.status === 'online').length;
    return {
        total: hosts.length,
        online,
        onlineRate: hosts.length ? +(online / hosts.length * 100).toFixed(1) : 0,
        byDatacenter: countBy(hosts, h => h.datacenter),
        bySystem: countBy(hosts, h => h.system_name),
        byApp: countBy(hosts, h => h.app_name),
        byEnvironment: countBy(hosts, h => h.environment),
        byOwner: countBy(hosts, h => h.owner),
        byOsVersion: osVersion
    };
}

/** 脚本统计（KPI 卡用，仅汇总数） */
function statsScripts(db) {
    const scripts = db.getTable('scripts');
    return {
        total: scripts.length,
        builtin: scripts.filter(s => s.is_builtin === 1 || s.is_builtin === '1' || s.is_builtin === true).length
    };
}

/** 工程任务统计（KPI 卡用，仅汇总数） */
function statsProjects(db) {
    const tasks = db.getTable('project_tasks')
        .filter(t => t.is_template !== 1 && t.is_template !== '1' && t.is_template !== true);
    const steps = db.getTable('project_steps');
    return {
        total: tasks.length,
        totalSteps: steps.length,
        avgSteps: tasks.length ? +(steps.length / tasks.length).toFixed(1) : 0
    };
}

/** 任务执行统计（含时间轴） */
function statsTasks(db, start) {
    const tasks = db.getTable('task_executions');
    const results = db.getTable('task_results');

    const scoped = tasks.filter(t => inRange(t.created_at, start));

    // 按日聚合：执行次数 / 成功任务数（完全成功 = success_hosts === total_hosts）
    const dates = buildDateSeries(start);
    const index = new Map(dates.map((d, i) => [d, i]));
    const dailyCount = new Array(dates.length).fill(0);
    const dailySuccess = new Array(dates.length).fill(0);
    let rangeTotal = 0, rangeSuccess = 0;
    for (const t of scoped) {
        rangeTotal += 1;
        const total = Number(t.total_hosts) || 0;
        const success = Number(t.success_hosts) || 0;
        if (total > 0 && success === total) rangeSuccess += 1;
        // 日序列仅在有限 range 内生成；all 范围不建序列，只计总数
        if (!t.created_at) continue;
        const i = index.get(localDateStr(t.created_at));
        if (i === undefined) continue;
        dailyCount[i] += 1;
        if (total > 0 && success === total) dailySuccess[i] += 1;
    }

    // 小时分布
    const hourly = new Array(24).fill(0);
    for (const t of scoped) {
        if (!t.created_at) continue;
        const h = new Date(t.created_at).getHours();
        if (h >= 0 && h <= 23) hourly[h] += 1;
    }

    // 耗时统计（基于 task_results.duration）
    const durations = results
        .map(r => Number(r.duration))
        .filter(d => d > 0)
        .sort((a, b) => a - b);
    const avgDuration = durations.length ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0;
    const p95Duration = percentile(durations, 95);

    // 全量成功率（不限时间范围，KPI 用）
    const allSuccess = tasks.filter(t => {
        const total = Number(t.total_hosts) || 0;
        return total > 0 && Number(t.success_hosts) === total;
    }).length;

    return {
        rangeTotal,
        rangeSuccess,
        allTotal: tasks.length,
        allSuccess,
        successRate: scoped.length ? +(rangeSuccess / rangeTotal * 100).toFixed(1) : 0,
        daily: { dates, count: dailyCount, success: dailySuccess },
        hourly,
        avgDurationMs: avgDuration,
        p95DurationMs: p95Duration
    };
}

/** AI 用量统计（按日汇总表 + 请求日志） */
function statsAi(db, start) {
    const daily = db.getTable('ai_usage_daily');
    // date 字段为 YYYY-MM-DD，与起始日直接字符串比较（避免 new Date 字符串按 UTC 解析的边界错位）
    const startStr = start ? localDateStr(start) : '';
    const scoped = startStr ? daily.filter(r => r.date >= startStr) : daily.slice();

    // 按日聚合（date 维度合并 model/purpose）
    const byDate = new Map();
    for (const r of scoped) {
        const row = byDate.get(r.date) || {
            requests: 0, success: 0, failed: 0,
            prompt: 0, completion: 0, total: 0,
            durationTotal: 0
        };
        row.requests += Number(r.requests) || 0;
        row.success += Number(r.success) || 0;
        row.failed += Number(r.failed) || 0;
        row.prompt += Number(r.prompt_tokens) || 0;
        row.completion += Number(r.completion_tokens) || 0;
        row.total += Number(r.total_tokens) || 0;
        row.durationTotal += Number(r.duration_ms_total) || 0;
        byDate.set(r.date, row);
    }

    // 补零日期序列
    const dates = buildDateSeries(start);
    const series = {
        prompt: new Array(dates.length).fill(0),
        completion: new Array(dates.length).fill(0),
        total: new Array(dates.length).fill(0),
        requests: new Array(dates.length).fill(0),
        success: new Array(dates.length).fill(0),
        failed: new Array(dates.length).fill(0),
        avgDurationMs: new Array(dates.length).fill(0),
        avgTtfbMs: new Array(dates.length).fill(0)
    };
    for (let i = 0; i < dates.length; i++) {
        const row = byDate.get(dates[i]);
        if (!row) continue;
        series.prompt[i] = row.prompt;
        series.completion[i] = row.completion;
        series.total[i] = row.total;
        series.requests[i] = row.requests;
        series.success[i] = row.success;
        series.failed[i] = row.failed;
        series.avgDurationMs[i] = row.requests ? Math.round(row.durationTotal / row.requests) : 0;
    }

    // TTFB 只能从滚动日志取近期值（按日均值）
    const logs = db.getTable('ai_request_logs');
    const ttfbByDate = new Map();
    for (const log of logs) {
        if (!inRange(log.created_at, start)) continue;
        if (log.ttfb_ms === null || log.ttfb_ms === undefined) continue;
        const date = localDateStr(log.created_at);
        const row = ttfbByDate.get(date) || { sum: 0, n: 0 };
        row.sum += Number(log.ttfb_ms) || 0;
        row.n += 1;
        ttfbByDate.set(date, row);
    }
    for (let i = 0; i < dates.length; i++) {
        const row = ttfbByDate.get(dates[i]);
        if (row) series.avgTtfbMs[i] = Math.round(row.sum / row.n);
    }

    // 范围内汇总
    const sum = (f) => scoped.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const totalRequests = sum('requests');
    const totalSuccess = sum('success');

    const PURPOSE_NAMES = { analyze: '脚本分析', execution_analysis: '执行结果分析', generate: '脚本生成', test: '测试连接', other: '其他' };
    const purposeMap = new Map();
    const modelMap = new Map();
    for (const r of scoped) {
        purposeMap.set(r.purpose, (purposeMap.get(r.purpose) || 0) + (Number(r.requests) || 0));
        modelMap.set(r.model, (modelMap.get(r.model) || 0) + (Number(r.total_tokens) || 0));
    }

    return {
        range: {
            requests: totalRequests,
            success: totalSuccess,
            successRate: totalRequests ? +(totalSuccess / totalRequests * 100).toFixed(1) : 0,
            promptTokens: sum('prompt_tokens'),
            completionTokens: sum('completion_tokens'),
            totalTokens: sum('total_tokens')
        },
        all: {
            requests: daily.reduce((s, r) => s + (Number(r.requests) || 0), 0),
            totalTokens: daily.reduce((s, r) => s + (Number(r.total_tokens) || 0), 0)
        },
        daily: { dates, series },
        purposeRatio: Array.from(purposeMap.entries())
            .map(([p, requests]) => ({ label: PURPOSE_NAMES[p] || p, count: requests }))
            .sort((a, b) => b.count - a.count),
        modelTokens: Array.from(modelMap.entries())
            .map(([model, tokens]) => ({ label: model || '未知模型', count: tokens }))
            .sort((a, b) => b.count - a.count)
    };
}

// ============================================================
// 对外接口
// ============================================================

/**
 * 获取看板全量统计数据。
 * @param {string} range '7d' | '30d' | '90d' | 'all'
 */
function getStatistics(range) {
    const db = getDatabase();
    const start = rangeStart(range);

    return {
        range: range || 'all',
        hosts: statsHosts(db),
        scripts: statsScripts(db),
        projects: statsProjects(db),
        tasks: statsTasks(db, start),
        ai: statsAi(db, start)
    };
}

module.exports = { getStatistics };
