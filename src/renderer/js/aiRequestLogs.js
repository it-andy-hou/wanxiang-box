// AI 请求记录页面逻辑（chat() 层埋点的请求日志：成功/超时/网络错误/解析失败等）
(function() {
    'use strict';

    let aiService;
    let currentLogs = [];

    // 初始化
    async function init() {
        console.log('初始化 AI 请求记录页面...');
        aiService = new window.AiService();
        bindEvents();
        await loadLogs();
    }

    // 绑定事件
    function bindEvents() {
        const refreshBtn = document.getElementById('aiLogsRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadLogs);
        }

        const clearBtn = document.getElementById('aiLogsClearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearLogs);
        }

        const searchInput = document.getElementById('aiLogsSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(handleFilterChange, 300));
        }

        const purposeFilter = document.getElementById('aiLogsPurposeFilter');
        if (purposeFilter) {
            purposeFilter.addEventListener('change', handleFilterChange);
        }

        const statusFilter = document.getElementById('aiLogsStatusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', handleFilterChange);
        }
    }

    // 加载请求日志
    async function loadLogs() {
        try {
            const r = await aiService.getRequestLogs();
            if (!r || !r.success) {
                showMessage((r && r.message) || '加载失败', 'error');
                return;
            }
            currentLogs = r.data || [];
            console.log(`加载了 ${currentLogs.length} 条 AI 请求日志`);
            renderLogs();
        } catch (error) {
            console.error('加载 AI 请求日志失败:', error);
            showMessage('加载 AI 请求日志失败: ' + error.message, 'error');
        }
    }

    // 筛选
    function handleFilterChange() {
        renderLogs();
    }

    function applyFilters() {
        const searchInput = document.getElementById('aiLogsSearchInput');
        const purposeFilter = document.getElementById('aiLogsPurposeFilter');
        const statusFilter = document.getElementById('aiLogsStatusFilter');

        const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const purpose = purposeFilter ? purposeFilter.value : '';
        const status = statusFilter ? statusFilter.value : '';

        return currentLogs.filter(log => {
            if (purpose && log.purpose !== purpose) return false;
            if (status && log.status !== status) return false;
            if (keyword) {
                const haystack = [
                    log.script_name, log.model, log.error, log.endpoint_host
                ].map(s => String(s || '').toLowerCase()).join(' ');
                if (!haystack.includes(keyword)) return false;
            }
            return true;
        });
    }

    // 渲染列表
    function renderLogs() {
        const tbody = document.querySelector('#aiLogsTable tbody');
        if (!tbody) return;

        const filtered = applyFilters();
        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                        <p style="font-size: 1.125rem; margin-bottom: 0.5rem;">暂无 AI 请求记录</p>
                        <p style="font-size: 0.875rem;">执行脚本分析、AI 生成或测试连接后，这里会记录每次请求的完整过程</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map(log => createLogRow(log)).join('');
        bindRowEvents();
    }

    // 创建记录行
    function createLogRow(log) {
        const purposeText = { analyze: '脚本分析', generate: '脚本生成', test: '测试连接', other: '其他' }[log.purpose] || log.purpose;
        const scriptName = log.script_name || (log.script_id ? `#${log.script_id}` : '-');
        const status = log.status || 'unknown';
        const statusInfo = getStatusInfo(status);
        const httpStatus = log.http_status !== null && log.http_status !== undefined ? log.http_status : '-';
        const duration = formatDuration(log.duration_ms);
        // 耗时超过 10s 用警示色，接近超时的慢请求一眼可见
        const durationClass = log.duration_ms > 10000 ? 'style="color: var(--status-warning-fg); font-weight: 600;"' : '';
        const token = log.usage && log.usage.total ? log.usage.total.toLocaleString() : '-';
        const errorTitle = log.error ? ` title="${escapeHtml(log.error)}"` : '';

        return `
            <tr data-log-id="${log.id}">
                <td>${formatDateTime(log.created_at)}</td>
                <td>${purposeText}</td>
                <td title="${escapeHtml(scriptName)}">${escapeHtml(truncate(scriptName, 24))}</td>
                <td title="${escapeHtml(log.model || '')}">${escapeHtml(truncate(log.model || '-', 18))}</td>
                <td><span class="status-badge ${statusInfo.cls}"${errorTitle}>${statusInfo.text}</span></td>
                <td>${httpStatus}</td>
                <td ${durationClass}>${duration}</td>
                <td>${token}</td>
                <td><button class="btn btn-sm btn-primary btn-view-ai-log" data-log-id="${log.id}">详情</button></td>
            </tr>
        `;
    }

    // 绑定行事件
    function bindRowEvents() {
        document.querySelectorAll('.btn-view-ai-log').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const logId = e.currentTarget.dataset.logId;
                const log = currentLogs.find(l => l.id === logId);
                if (log) showLogDetail(log);
            });
        });
    }

    // 详情弹窗
    function showLogDetail(log) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const purposeText = { analyze: '脚本分析', generate: '脚本生成', test: '测试连接', other: '其他' }[log.purpose] || log.purpose;
        const statusInfo = getStatusInfo(log.status || 'unknown');
        const hasFullRequest = !!(log.request_body && log.request_body.length > 0);

        overlay.innerHTML = `
            <div class="modal" style="max-width: 900px; max-height: 90vh;">
                <div class="modal-header">
                    <h2>AI 请求详情</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body" style="overflow-y: auto; max-height: calc(90vh - 140px);">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">状态</div>
                            <span class="status-badge ${statusInfo.cls}">${statusInfo.text}</span>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">来源</div>
                            <div>${purposeText}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">时间</div>
                            <div>${formatDateTime(log.created_at)}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">模型</div>
                            <div>${escapeHtml(log.model || '-')}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">目标地址</div>
                            <div>${escapeHtml(log.endpoint_host || '-')}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">HTTP 状态</div>
                            <div>${log.http_status !== null && log.http_status !== undefined ? log.http_status : '-'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">耗时</div>
                            <div>${formatDuration(log.duration_ms)}（超时阈值 ${Math.round((log.timeout_ms || 0) / 1000)}s）</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">首字节耗时</div>
                            <div>${log.ttfb_ms !== null && log.ttfb_ms !== undefined ? formatDuration(log.ttfb_ms) : '未收到响应头'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">Token 消耗</div>
                            <div>${log.usage ? `${log.usage.total.toLocaleString()}（输入 ${log.usage.prompt.toLocaleString()} / 输出 ${log.usage.completion.toLocaleString()}）` : '-'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">关联脚本</div>
                            <div>${escapeHtml(log.script_name || (log.script_id ? `#${log.script_id}` : '-'))}</div>
                        </div>
                    </div>

                    ${log.status === 'timeout' ? `
                    <div style="margin-bottom: 1rem; padding: 0.75rem 1rem; background: var(--status-warning-bg); border-left: 3px solid var(--status-warning-fg, #b8860b); border-radius: 4px;">
                        <div style="font-size: 0.875rem; font-weight: 600; color: var(--status-warning-fg, #b8860b); margin-bottom: 0.25rem;">超时诊断参考</div>
                        <div style="font-size: 0.8125rem; line-height: 1.6;">
                            ${log.ttfb_ms === null || log.ttfb_ms === undefined
                                ? `超时期间未收到任何响应头，请求停留在「等待模型/网关计算」阶段。常见原因：模型推理慢（复杂脚本 + 大模型）、网关排队、后端过载。建议：换更快的模型、精简脚本、或在设置中调大超时。`
                                : `响应头已收到（${formatDuration(log.ttfb_ms)}），卡在响应体传输阶段。常见原因：网关转发中断、响应体被缓冲、网络链路不稳定。建议：检查网关日志与网络链路，而非模型本身。`}
                        </div>
                    </div>
                    ` : ''}

                    ${log.error ? `
                    <div style="margin-bottom: 1rem; padding: 0.75rem 1rem; background: var(--status-critical-bg); border-left: 3px solid var(--status-critical-fg, #e5484d); border-radius: 4px;">
                        <div style="font-size: 0.875rem; font-weight: 600; color: var(--status-critical-fg, #e5484d); margin-bottom: 0.25rem;">错误信息</div>
                        <div style="font-family: var(--font-mono); font-size: 0.8125rem; word-break: break-all;">${escapeHtml(log.error)}</div>
                    </div>
                    ` : ''}

                    <div style="margin-bottom: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <strong>响应预览</strong>
                            ${log.response_preview ? `<button class="btn btn-sm btn-secondary" id="aiLogCopyResponseBtn">${Utils.icon('copy', 12)} 复制</button>` : ''}
                        </div>
                        <pre id="aiLogResponseContent" style="background: var(--canvas-base); color: var(--text-body); padding: 1rem; border-radius: 6px; max-height: 250px; overflow: auto; font-family: var(--font-mono); font-size: 0.8125rem; margin: 0;">${escapeHtml(log.response_preview || '（无响应内容）')}</pre>
                    </div>

                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <strong>请求体（${log.request_chars ? log.request_chars.toLocaleString() + ' 字符' : '未记录'}）</strong>
                            ${hasFullRequest ? `<button class="btn btn-sm btn-secondary" id="aiLogCopyRequestBtn">${Utils.icon('copy', 12)} 复制</button>` : ''}
                        </div>
                        ${hasFullRequest ? `
                        <div style="background: var(--status-warning-bg); border: 1px solid var(--status-warning-border); border-radius: 6px; padding: 6px 12px; font-size: 12px; color: var(--status-warning-fg); margin-bottom: 0.5rem;">
                            ${Utils.icon('alert-triangle', 12)} 审计模式下记录的完整请求体，可能包含脚本内容等敏感信息，请注意数据安全。
                        </div>
                        <pre id="aiLogRequestContent" style="background: var(--canvas-base); color: var(--text-body); padding: 1rem; border-radius: 6px; max-height: 300px; overflow: auto; font-family: var(--font-mono); font-size: 0.8125rem; margin: 0;">${escapeHtml(log.request_body)}</pre>
                        ` : `
                        <div style="color: var(--text-muted); font-size: 0.875rem; padding: 0.75rem; background: var(--surface-subtle); border-radius: 6px;">
                            未记录完整请求体。如需审计每次发送的完整 Prompt，请在 设置 → 大模型接入 中开启「记录完整请求体」。
                        </div>
                        `}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            </div>
        `;

        overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const copyResponseBtn = overlay.querySelector('#aiLogCopyResponseBtn');
        if (copyResponseBtn) {
            copyResponseBtn.addEventListener('click', () => copyToClipboard(log.response_preview || ''));
        }
        const copyRequestBtn = overlay.querySelector('#aiLogCopyRequestBtn');
        if (copyRequestBtn) {
            copyRequestBtn.addEventListener('click', () => copyToClipboard(log.request_body || ''));
        }

        document.body.appendChild(overlay);
    }

    // 清空记录
    async function clearLogs() {
        if (currentLogs.length === 0) {
            showMessage('当前没有请求记录', 'info');
            return;
        }
        const confirmed = await Components.ConfirmDialog.show({
            title: '确认清空请求记录',
            message: `确定要清空全部 ${currentLogs.length} 条 AI 请求记录吗？此操作不可恢复。`,
            confirmText: '清空',
            cancelText: '取消'
        });
        if (!confirmed) return;

        try {
            const r = await aiService.clearRequestLogs();
            if (r && r.success) {
                showMessage('请求记录已清空', 'success');
                await loadLogs();
            } else {
                showMessage((r && r.message) || '清空失败', 'error');
            }
        } catch (error) {
            console.error('清空 AI 请求日志失败:', error);
            showMessage('清空失败: ' + error.message, 'error');
        }
    }

    // 状态映射（复用现有 status-badge 样式）
    function getStatusInfo(status) {
        const map = {
            success:        { cls: 'status-success', text: '成功' },
            timeout:        { cls: 'status-timeout', text: '超时' },
            network_error:  { cls: 'status-failed', text: '网络错误' },
            http_error:     { cls: 'status-failed', text: '接口错误' },
            bad_response:   { cls: 'status-unknown', text: '响应异常' },
            parse_error:    { cls: 'status-unknown', text: '解析失败' }
        };
        return map[status] || { cls: 'status-unknown', text: status || '未知' };
    }

    // ---------- 工具函数 ----------

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function truncate(text, max) {
        const s = String(text || '');
        return s.length > max ? s.slice(0, max) + '…' : s;
    }

    function formatDateTime(dateString) {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleString('zh-CN', { hour12: false });
    }

    function formatDuration(ms) {
        const v = Number(ms) || 0;
        if (v < 1000) return v + 'ms';
        if (v < 60000) return (v / 1000).toFixed(1) + 's';
        return Math.floor(v / 60000) + '分' + Math.round((v % 60000) / 1000) + '秒';
    }

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

    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                showMessage('已复制到剪贴板', 'success');
            } else {
                throw new Error('剪贴板不可用');
            }
        } catch (error) {
            showMessage('复制失败: ' + error.message, 'error');
        }
    }

    function showMessage(message, type = 'info') {
        if (window.Utils && window.Utils.showMessage) {
            window.Utils.showMessage(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    // 导出到全局
    window.AiRequestLogs = {
        init: function() {
            if (!this._initialized) {
                this._initialized = true;
                console.log('AiRequestLogs 初始化');
                init();
            } else {
                console.log('AiRequestLogs 重新加载数据');
                loadLogs();
            }
        },
        _initialized: false
    };
})();
