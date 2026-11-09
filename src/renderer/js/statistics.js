// 统计看板页面逻辑（数据可视化：主机资产 / 脚本工程 / 执行时间轴 / AI Token）
(function() {
    'use strict';

    let currentRange = '30d';
    let charts = {};          // id -> ECharts 实例
    let initialized = false;  // 事件是否已绑定
    let resizeTimer = null;   // 窗口 resize 防抖定时器

    // ============================================================
    // 主题色：从 CSS 变量取值，与现有令牌保持一致
    // ============================================================
    function cssVar(name, fallback) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    }

    function theme() {
        return {
            primary: cssVar('--primary', '#3498db'),
            textMuted: cssVar('--text-muted', '#8a94a6'),
            textBody: cssVar('--text-body', '#333'),
            border: cssVar('--border-default', '#ddd'),
            healthy: cssVar('--status-healthy-fg', '#27ae60'),
            warning: cssVar('--status-warning-fg', '#f39c12'),
            critical: cssVar('--status-critical-fg', '#e74c3c'),
            info: cssVar('--status-info-fg', '#3498db'),
            palette: [
                cssVar('--primary', '#3498db'),
                cssVar('--status-healthy-fg', '#27ae60'),
                cssVar('--status-warning-fg', '#f39c12'),
                cssVar('--status-critical-fg', '#e74c3c'),
                cssVar('--status-info-fg', '#9b59b6'),
                '#16a085', '#e67e22', '#7f8c8d', '#d35400', '#2980b9'
            ]
        };
    }

    // ============================================================
    // 图表实例管理（dispose 防泄漏）
    // ============================================================
    function getChart(id) {
        const el = document.getElementById(id);
        if (!el) return null;
        // 实例已 dispose（曾渲染空占位）时重新初始化
        if (charts[id] && !charts[id].isDisposed()) return charts[id];
        const c = echarts.init(el);
        charts[id] = c;
        return c;
    }

    function disposeAllCharts() {
        Object.keys(charts).forEach(id => {
            try { charts[id].dispose(); } catch (e) { /* 忽略 */ }
        });
        charts = {};
    }

    // 空数据占位：先 dispose 实例再替换为提示 DOM（避免残留已失效的 canvas 子节点）
    function renderEmpty(id, message) {
        const c = charts[id];
        if (c) {
            try { c.dispose(); } catch (e) { /* 忽略 */ }
            delete charts[id];
        }
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = `<div class="stats-empty"><span class="stats-empty-icon">${Utils.icon('bar-chart', 36)}</span><span>${message || '暂无数据'}</span></div>`;
    }

    // ============================================================
    // 通用图表封装
    // ============================================================
    function baseOption(t) {
        return {
            color: t.palette,
            tooltip: {
                trigger: 'item',
                textStyle: { color: t.textBody, fontSize: 12 }
            },
            textStyle: { fontFamily: 'inherit' }
        };
    }

    /** 环形图 */
    function renderPie(id, data, { showZero = false } = {}) {
        const t = theme();
        const items = (data || []).filter(x => showZero || x.count > 0);
        if (items.length === 0) { renderEmpty(id); return; }
        const c = getChart(id);
        if (!c) return;
        c.setOption({
            ...baseOption(t),
            tooltip: { trigger: 'item', formatter: '{b}: {c} 台 ({d}%)' },
            legend: { bottom: 0, type: 'scroll', textStyle: { color: t.textMuted, fontSize: 11 } },
            series: [{
                type: 'pie',
                radius: ['40%', '65%'],
                center: ['50%', '44%'],
                avoidLabelOverlap: true,
                itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
                label: { show: false },
                emphasis: { label: { show: true, fontSize: 13, fontWeight: 600 } },
                data: items.map(x => ({ name: x.label, value: x.count }))
            }]
        }, true);
    }

    /** 横向条形图（维度分布，条目多时自动限制高度滚动；窄卡片场景传小 labelWidth） */
    function renderBarH(id, data, { unit = '台', maxItems = 15, labelWidth = 110 } = {}) {
        const t = theme();
        const items = (data || []).filter(x => x.count > 0).slice(0, maxItems);
        if (items.length === 0) { renderEmpty(id); return; }
        const c = getChart(id);
        if (!c) return;
        const labels = items.map(x => x.label).reverse();
        const values = items.map(x => x.count).reverse();
        c.setOption({
            ...baseOption(t),
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => `${p[0].name}: <b>${p[0].value}</b> ${unit}` },
            grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
            xAxis: { type: 'value', minInterval: 1, axisLabel: { color: t.textMuted, fontSize: 11 }, splitLine: { lineStyle: { color: t.border, opacity: 0.4 } } },
            yAxis: {
                type: 'category',
                data: labels,
                axisLabel: { color: t.textBody, fontSize: 11, width: labelWidth, overflow: 'truncate' },
                axisTick: { show: false },
                axisLine: { show: false }
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: 18,
                itemStyle: { borderRadius: [0, 4, 4, 0] },
                label: { show: true, position: 'right', color: t.textMuted, fontSize: 11 }
            }]
        }, true);
    }

    /** 折线/面积图（双轴系列需在首次 setOption 就声明两个 yAxis，否则 ECharts 内部索引崩溃） */
    function renderLine(id, dates, seriesDefs, { smooth = true } = {}) {
        const t = theme();
        const c = getChart(id);
        if (!c) return;
        const hasData = seriesDefs.some(s => s.data.some(v => v > 0));
        if (!hasData || dates.length === 0) { renderEmpty(id); return; }
        const dual = seriesDefs.some(s => s.yAxisIndex === 1);
        const axisCount = { type: 'value', axisLabel: { color: t.textMuted, fontSize: 11 }, splitLine: { lineStyle: { color: t.border, opacity: 0.4 } } };
        const axisRate = { type: 'value', max: 100, axisLabel: { color: t.textMuted, fontSize: 11, formatter: '{value}%' }, splitLine: { show: false } };
        c.setOption({
            ...baseOption(t),
            tooltip: { trigger: 'axis' },
            legend: { bottom: 0, textStyle: { color: t.textMuted, fontSize: 11 } },
            grid: { left: 8, right: 16, top: 24, bottom: 40, containLabel: true },
            xAxis: {
                type: 'category',
                data: dates,
                boundaryGap: false,
                axisLabel: { color: t.textMuted, fontSize: 11, formatter: v => v.slice(5) },
                axisLine: { lineStyle: { color: t.border } },
                axisTick: { show: false }
            },
            yAxis: dual ? [axisCount, axisRate] : axisCount,
            series: seriesDefs.map(s => ({
                name: s.name,
                type: 'line',
                smooth,
                data: s.data,
                areaStyle: s.area ? { opacity: 0.15 } : undefined,
                yAxisIndex: s.yAxisIndex || 0,
                lineStyle: { width: 2 },
                symbol: 'circle',
                symbolSize: 4,
                connectNulls: true
            }))
        }, true);
    }

    /** 双轴趋势：每日执行次数 + 成功率 */
    function renderDailyTrend(daily) {
        if (!daily || !daily.dates || daily.dates.length === 0) {
            renderEmpty('chartDailyTrend', '所选时间范围内暂无执行记录');
            return;
        }
        const rates = daily.count.map((n, i) => (n > 0 ? +(daily.success[i] / n * 100).toFixed(1) : null));
        renderLine('chartDailyTrend', daily.dates, [
            { name: '执行次数', data: daily.count, area: true },
            { name: '成功率', data: rates, yAxisIndex: 1 }
        ]);
    }

    /** 按小时柱状 */
    function renderHourly(hourly) {
        const t = theme();
        const c = getChart('chartHourly');
        if (!c) return;
        const arr = hourly || [];
        if (arr.every(v => !v)) { renderEmpty('chartHourly', '暂无执行记录'); return; }
        const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + '时');
        c.setOption({
            ...baseOption(t),
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
            xAxis: { type: 'category', data: hours, axisLabel: { color: t.textMuted, fontSize: 10, interval: 1 }, axisTick: { show: false }, axisLine: { lineStyle: { color: t.border } } },
            yAxis: { type: 'value', minInterval: 1, axisLabel: { color: t.textMuted, fontSize: 11 }, splitLine: { lineStyle: { color: t.border, opacity: 0.4 } } },
            series: [{ type: 'bar', data: arr, barMaxWidth: 16, itemStyle: { borderRadius: [3, 3, 0, 0], color: t.primary } }]
        }, true);
    }

    // ============================================================
    // KPI 卡片
    // ============================================================
    function renderKpi(data) {
        const row = document.getElementById('statsKpiRow');
        if (!row) return;
        const hosts = data.hosts || {};
        const tasks = data.tasks || {};
        const ai = data.ai || {};
        const rangeName = { '7d': '近7天', '30d': '近30天', '90d': '近90天', 'all': '全部' }[currentRange] || '';

        const cards = [
            { label: '主机总数', value: hosts.total ?? 0, sub: `在线 ${hosts.online ?? 0} 台 · 在线率 ${hosts.onlineRate ?? 0}%` },
            { label: '脚本总数', value: data.scripts?.total ?? 0, sub: `内置 ${data.scripts?.builtin ?? 0} · 自定义 ${(data.scripts?.total ?? 0) - (data.scripts?.builtin ?? 0)}` },
            { label: `执行次数（${rangeName}）`, value: tasks.rangeTotal ?? 0, sub: `累计 ${tasks.allTotal ?? 0} 次` },
            { label: `执行成功率（${rangeName}）`, value: (tasks.successRate ?? 0) + '%', sub: `成功 ${tasks.rangeSuccess ?? 0} / ${tasks.rangeTotal ?? 0} 次` },
            { label: '平均执行耗时', value: formatMs(tasks.avgDurationMs), sub: `P95 ${formatMs(tasks.p95DurationMs)}` },
            { label: '工程任务数', value: data.projects?.total ?? 0, sub: `共 ${data.projects?.totalSteps ?? 0} 个步骤 · 均 ${(data.projects?.avgSteps ?? 0)} 步/工程` },
            { label: `AI Token（${rangeName}）`, value: formatNumber(ai.range?.totalTokens ?? 0), sub: `累计 ${formatNumber(ai.all?.totalTokens ?? 0)} tokens` },
            { label: `AI 请求成功率（${rangeName}）`, value: (ai.range?.successRate ?? 0) + '%', sub: `请求 ${ai.range?.requests ?? 0} 次 · 累计 ${ai.all?.requests ?? 0} 次` }
        ];
        row.innerHTML = cards.map(c => `
            <div class="stats-kpi-card">
                <div class="stats-kpi-label">${c.label}</div>
                <div class="stats-kpi-value">${c.value}</div>
                <div class="stats-kpi-sub">${c.sub}</div>
            </div>
        `).join('');
    }

    function formatMs(ms) {
        if (!ms) return '-';
        if (ms < 1000) return ms + 'ms';
        return (ms / 1000).toFixed(1) + 's';
    }

    function formatNumber(n) {
        return Number(n || 0).toLocaleString();
    }

    // ============================================================
    // 数据加载与渲染
    // ============================================================
    async function load() {
        const content = document.getElementById('statisticsContent');
        if (!window.require) {
            if (content) content.innerHTML = `<div class="stats-empty">统计看板需要在 Electron 环境中运行</div>`;
            return;
        }
        try {
            const { ipcRenderer } = window.require('electron');
            const r = await ipcRenderer.invoke('stats:getAll', currentRange);
            if (!r || !r.success) {
                showMessage((r && r.message) || '加载统计数据失败', 'error');
                return;
            }
            render(r.data);
        } catch (error) {
            console.error('加载统计数据失败:', error);
            showMessage('加载统计数据失败: ' + error.message, 'error');
        }
    }

    function render(data) {
        if (!data) return;
        renderKpi(data);

        const hosts = data.hosts || {};
        // 资产区 3 列卡片：适中标签宽度，兼顾类目可读性与条形空间
        const dimOpts = { labelWidth: 96 };
        renderBarH('chartDatacenter', hosts.byDatacenter, dimOpts);
        renderBarH('chartSystem', hosts.bySystem, dimOpts);
        renderBarH('chartApp', hosts.byApp, dimOpts);
        renderBarH('chartEnvironment', hosts.byEnvironment, dimOpts);
        renderBarH('chartOwner', hosts.byOwner, dimOpts);
        renderBarH('chartOsVersion', hosts.byOsVersion, dimOpts);

        renderDailyTrend(data.tasks?.daily);
        renderHourly(data.tasks?.hourly);

        const ai = data.ai || {};
        const daily = ai.daily || {};
        const s = daily.series || {};
        if ((daily.dates || []).length > 0) {
            renderLine('chartTokenTrend', daily.dates, [
                { name: 'Prompt Tokens', data: s.prompt || [], area: true },
                { name: 'Completion Tokens', data: s.completion || [], area: true },
                { name: '总 Tokens', data: s.total || [] }
            ]);
            renderLine('chartAiDuration', daily.dates, [
                { name: '平均耗时', data: s.avgDurationMs || [] },
                { name: '平均 TTFB', data: s.avgTtfbMs || [] }
            ]);
        } else {
            renderEmpty('chartTokenTrend', '暂无 AI 用量数据');
            renderEmpty('chartAiDuration', '暂无 AI 用量数据');
        }
        renderPie('chartAiPurpose', ai.purposeRatio);
        renderBarH('chartModelTokens', ai.modelTokens, { unit: 'tokens' });
    }

    // ============================================================
    // 事件绑定与生命周期
    // ============================================================
    function bindEvents() {
        if (initialized) return;
        initialized = true;

        const group = document.getElementById('statsRangeGroup');
        if (group) {
            group.addEventListener('click', e => {
                const btn = e.target.closest('.stats-range-btn');
                if (!btn) return;
                currentRange = btn.dataset.range;
                group.querySelectorAll('.stats-range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                load();
            });
        }
        const refreshBtn = document.getElementById('statsRefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', load);

        // 窗口 resize 时让全部图表重绘适配（ECharts 不监听容器尺寸，需手动 resize）
        window.addEventListener('resize', handleWindowResize);
    }

    // debounce：拖拽窗口过程中高频触发，仅最后一次生效后重绘
    function handleWindowResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            Object.values(charts).forEach(c => {
                if (!c.isDisposed()) c.resize();
            });
        }, 200);
    }

    function showMessage(message, type) {
        // 复用全局消息提示（utils.js 的 Utils.notify：success/error/warning/info）
        const notify = window.Utils && window.Utils.notify;
        if (notify && typeof notify[type] === 'function') {
            notify[type](message);
        } else {
            console.warn(message);
        }
    }

    // 页面进入
    async function init() {
        bindEvents();
        await load();
    }

    // 页面离开：解绑 resize 监听并销毁全部图表实例，防止内存泄漏
    function destroy() {
        clearTimeout(resizeTimer);
        window.removeEventListener('resize', handleWindowResize);
        disposeAllCharts();
    }

    window.Statistics = { init, destroy };
})();
