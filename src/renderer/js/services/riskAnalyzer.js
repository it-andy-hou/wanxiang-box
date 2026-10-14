// 脚本风险自动评估引擎（纯静态分析，零依赖）
// 判定标准 = 可逆性：高危=不可逆损失（全盘删除、块设备覆写），中危=可恢复但影响大，普通=其余
// 流程：剥离注释 → 规则匹配 → 取命中最高等级；findings 结构化输出供 UI 展示与后续 AI 二次判定复用
// 规则来源：docs/features/shell.md

const RiskAnalyzer = (() => {
    const LEVELS     = { HIGH: 'high', MEDIUM: 'medium', NORMAL: 'normal' };
    const LEVEL_NAMES = { high: '高危', medium: '中危', normal: '普通' };
    const LEVEL_ORDER = { normal: 0, medium: 1, high: 2 };

    // --------------------------------------------------------
    // 预处理：剥离注释（保留 shebang），返回与原文行数一致的数组
    // --------------------------------------------------------
    function stripComments(content) {
        const rawLines = content.split(/\r?\n/);
        return rawLines.map(line => {
            if (/^\s*#!/.test(line)) return line;
            let state = 0; // 0=普通 1=单引号 2=双引号
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (state === 2 && ch === '\\') { i++; continue; }   // 双引号内转义
                if (state === 1 && ch === "'") { state = 0; continue; }
                if (state === 2 && ch === '"') { state = 0; continue; }
                if (state === 0) {
                    if (ch === "'") { state = 1; continue; }
                    if (ch === '"') { state = 2; continue; }
                    // # 前是行首/空白/; 时为注释起点
                    if (ch === '#' && (i === 0 || /[\s;]/.test(line[i - 1]))) {
                        return line.slice(0, i).replace(/\s+$/, '');
                    }
                }
            }
            return line;
        });
    }

    // --------------------------------------------------------
    // 规则匹配辅助
    // --------------------------------------------------------
    // 去引号的路径目标（如 "/etc" → /etc）
    function unquote(t) {
        return t.replace(/^(["'])|(["'])$/g, '');
    }

    // rm -rf 递归强制删除的系统目录目标
    const SYS_PATH_RE = /^\/(bin|boot|dev|etc|lib|lib32|lib64|proc|root|run|sbin|sys|usr|var|home)(\/.*)?$|^\/\*?$/;

    // rm 命令中是否同时包含递归(-r/-R)与强制(-f)
    function rmHasRecursiveForce(tokens) {
        const flags = tokens.filter(t => /^-/.test(t)).join(' ');
        if (!flags) return false;
        const hasR = /(^|\s)-{1,2}[a-zA-Z]*[rR]/.test(' ' + flags) || /--recursive/.test(flags);
        const hasF = /(^|\s)-{1,2}[a-zA-Z]*f/.test(' ' + flags) || /--force/.test(flags);
        return hasR && hasF;
    }

    const RULES = [
        {
            id: 'H1', level: LEVELS.HIGH,
            message: '递归强制删除系统目录（不可逆）',
            check(text) {
                const out = [];
                const re = /\brm\b([^\n&;|<>]*)/g;
                let m;
                while ((m = re.exec(text)) !== null) {
                    const tokens = m[1].trim().split(/\s+/).filter(Boolean);
                    if (!rmHasRecursiveForce(tokens)) continue;
                    // 目标 = 非选项参数（跳过 -- 之后全部视为目标）
                    const dd = tokens.indexOf('--');
                    const targets = (dd >= 0 ? tokens.slice(dd + 1) : tokens.filter(t => !/^-/.test(t)));
                    for (const raw of targets) {
                        const t = unquote(raw);
                        if (SYS_PATH_RE.test(t)) { out.push(m.index); break; }
                    }
                }
                return out;
            }
        },
        {
            id: 'H2', level: LEVELS.HIGH,
            message: 'rm -rf 删除变量路径且未做空值防护（变量为空时等价于全盘删除）',
            check(text) {
                const out = [];
                const re = /\brm\b([^\n&;|<>]*)/g;
                let m;
                while ((m = re.exec(text)) !== null) {
                    const tokens = m[1].trim().split(/\s+/).filter(Boolean);
                    if (!rmHasRecursiveForce(tokens)) continue;
                    const dd = tokens.indexOf('--');
                    const targets = (dd >= 0 ? tokens.slice(dd + 1) : tokens.filter(t => !/^-/.test(t)));
                    for (const raw of targets) {
                        const t = unquote(raw);
                        // 形如 $DIR/*、${DIR}/*、$DIR/、"$DIR/*"；${DIR:?...} 防护写法本身不匹配
                        const vm = t.match(/^(?:\$\{?(\w+)\}?|\$\{(\w+):[^}]*\}[\w/${}*]*)(\/\*|\/)?$/);
                        if (!vm) continue;
                        const varName = vm[1] || vm[2];
                        if (vm[2]) continue; // 带 :? 防护的目标，已安全
                        // 同行或脚本任意位置存在 ${VAR:?} 断言则豁免
                        const guarded = text.includes(`\${${varName}:?`)
                            || (() => {
                                const lineStart = text.lastIndexOf('\n', m.index) + 1;
                                const lineEnd   = text.indexOf('\n', m.index);
                                const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
                                return line.includes(`\${${varName}:?`);
                            })();
                        if (guarded) continue;
                        out.push(m.index);
                        break;
                    }
                }
                return out;
            }
        },
        {
            id: 'H3', level: LEVELS.HIGH,
            message: '文件系统/块设备级破坏操作（mkfs/fdisk/parted/wipefs/shred，不可逆）',
            check(text) {
                const out = [];
                const re = /(^|[\s;&|(=`])((?:mkfs(?:\.\w+)?|fdisk|parted|wipefs|shred))\b/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index + m[1].length);
                return out;
            }
        },
        {
            id: 'H4', level: LEVELS.HIGH,
            message: 'dd 直接覆写块设备（不可逆）',
            check(text) {
                const out = [];
                const re = /\bdd\b[^\n;&|]*\bof=(["']?)\/dev\/(sd|nvme|vd|mmcblk)/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'H5', level: LEVELS.HIGH,
            message: '网络脚本管道直接执行（curl/wget 下载内容未校验即运行）',
            check(text) {
                const out = [];
                const re = /\b(?:curl|wget|fetch)\b[^;&|]*\|\s*(?:sudo\s+)?(?:[a-z]*sh|python\d?)\b/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'H6', level: LEVELS.HIGH,
            message: 'eval/sh -c 直接执行不可信外部输入（$1/$@/$* 等命令行参数）',
            check(text) {
                const out = [];
                const re = /\beval\s+["']?\$(?:[0-9]+|@|\*)(?![\w])|\b(?:ba|z|da)?sh\s+-c\s+["']\$\w+/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'M1', level: LEVELS.MEDIUM,
            message: 'chmod 777 权限泛滥',
            check(text) {
                const out = [];
                const re = /\bchmod\s+(?:-{1,2}[\w-]+\s+)*777\b/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'M2', level: LEVELS.MEDIUM,
            message: '强制终止进程（kill -9 1 / killall / pkill -9）',
            check(text) {
                const out = [];
                const re = /\bkill\s+(?:-{1,2}[\w-]+\s+)*-9\s+(?:-)?1\b|\bkillall\b|\bpkill\s+(?:-{1,2}[\w-]+\s+)*-9\b/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'M3', level: LEVELS.MEDIUM,
            message: '关闭防火墙（iptables -F / firewalld / ufw）',
            check(text) {
                const out = [];
                const re = /\biptables\b(?:\s+\S+)*?\s+-F\b|\bsystemctl\s+(?:stop|disable|restart)\s+firewalld\b|\bufw\s+disable\b|\bsystemctl\s+(?:stop|disable)\s+iptables\b/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'M4', level: LEVELS.MEDIUM,
            message: '主机关机/重启',
            check(text) {
                const out = [];
                const re = /(^|[\s;&|(=`])(shutdown|reboot|halt|poweroff)\b|\binit\s+[06]\b/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'M5', level: LEVELS.MEDIUM,
            message: '修改 sudoers / NOPASSWD 提权',
            check(text) {
                const out = [];
                const re = /\/etc\/sudoers|\bNOPASSWD\b/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'M6', level: LEVELS.MEDIUM,
            message: '脚本内明文写入敏感凭据（password/token/secret 等）',
            check(text) {
                const out = [];
                const re = /\b(password|passwd|secret|token|api_key|apikey|private_key)\s*=\s*['"][^'"]{3,}['"]/gi;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        },
        {
            id: 'M7', level: LEVELS.MEDIUM,
            message: '使用 eval 动态执行（存在注入风险，请确认内容来源可信）',
            check(text) {
                // H6 已单独报告的行不再重复报 M7
                const h6Lines = new Set();
                const reH6 = /\beval\s+["']?\$(?:[0-9]+|@|\*)(?![\w])/g;
                let m6;
                while ((m6 = reH6.exec(text)) !== null) {
                    h6Lines.add(text.slice(0, m6.index).split('\n').length);
                }
                const out = [];
                const re = /\beval\b/g;
                let m;
                while ((m = re.exec(text)) !== null) {
                    const lineNo = text.slice(0, m.index).split('\n').length;
                    if (!h6Lines.has(lineNo)) out.push(m.index);
                }
                return out;
            }
        },
        {
            id: 'M8', level: LEVELS.MEDIUM,
            message: '停止/重启 sshd 服务（会断开自身连接）',
            check(text) {
                const out = [];
                const re = /\bsystemctl\s+(?:stop|restart|disable)\s+sshd?\b/g;
                let m;
                while ((m = re.exec(text)) !== null) out.push(m.index);
                return out;
            }
        }
    ];

    // --------------------------------------------------------
    // 主入口
    // --------------------------------------------------------
    function analyzeRisk(content) {
        const empty = { level: LEVELS.NORMAL, findings: [] };
        if (!content || typeof content !== 'string' || !content.trim()) return empty;

        const rawLines = content.split(/\r?\n/);
        const codeLines = stripComments(content);
        const code = codeLines.join('\n');

        // 行首偏移表：由剥离后文本偏移反查原始行号（剥注释不删行，行号一一对应）
        const lineStarts = [];
        for (let i = 0, off = 0; i < codeLines.length; i++) {
            lineStarts.push(off);
            off += codeLines[i].length + 1;
        }
        const lineAt = (offset) => {
            let lo = 0, hi = lineStarts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
            }
            return lo; // 0-based
        };

        const findings = [];
        for (const rule of RULES) {
            let offsets;
            try { offsets = rule.check(code) || []; } catch (e) { console.warn(`[RiskAnalyzer] 规则 ${rule.id} 执行异常:`, e); continue; }
            const seenLines = new Set();
            for (const off of offsets) {
                const li = lineAt(off);
                if (seenLines.has(li)) continue; // 同规则同去重（含折行场景）
                seenLines.add(li);
                findings.push({
                    level: rule.level,
                    ruleId: rule.id,
                    message: rule.message,
                    line: li + 1,
                    snippet: (rawLines[li] || '').trim().slice(0, 120)
                });
            }
        }

        let level = LEVELS.NORMAL;
        for (const f of findings) {
            if (LEVEL_ORDER[f.level] > LEVEL_ORDER[level]) level = f.level;
        }
        findings.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || a.line - b.line);
        return { level, findings };
    }

    return { analyzeRisk, LEVELS, LEVEL_NAMES, LEVEL_ORDER };
})();

// --------------------------------------------------------
// 执行前风险拦截门禁（RiskGate）
// confirm(items, opts) → Promise<boolean>，true=放行
// items: [{ name, content }]
// --------------------------------------------------------
const RiskGate = (() => {
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function collect(items) {
        const results = items.map(it => {
            const r = (typeof RiskAnalyzer !== 'undefined' ? RiskAnalyzer : window.RiskAnalyzer).analyzeRisk(it.content || '');
            return { name: it.name, ...r };
        });
        let level = 'normal';
        for (const r of results) {
            if (RiskAnalyzer.LEVEL_ORDER[r.level] > RiskAnalyzer.LEVEL_ORDER[level]) level = r.level;
        }
        return { level, results };
    }

    function findingsHtml(results) {
        return results.filter(r => r.findings.length > 0).map(r => `
            <div style="margin-bottom:10px;">
                <div style="font-weight:600;color:var(--text-heading);margin-bottom:4px;">${escapeHtml(r.name)}</div>
                ${r.findings.map(f => `
                    <div style="display:flex;gap:8px;align-items:baseline;margin:2px 0;font-size:12.5px;">
                        <span style="flex-shrink:0;font-family:var(--font-mono,monospace);color:var(--text-muted);">L${f.line}</span>
                        <span style="flex-shrink:0;font-weight:600;color:${f.level === 'high' ? 'var(--status-critical-fg)' : 'var(--status-warning-fg)'};">[${f.ruleId}]</span>
                        <span style="color:var(--text-body);">${escapeHtml(f.message)}</span>
                    </div>
                    ${f.snippet ? `<div style="margin:2px 0 6px 44px;font-family:var(--font-mono,monospace);font-size:12px;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.snippet)}</div>` : ''}
                `).join('')}
            </div>
        `).join('');
    }

    // 高危强确认弹窗：需勾选知晓 + 手动输入名称，两者齐备才可确认
    function strongConfirm({ results, confirmName }) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: var(--surface-overlay); display: flex;
                align-items: center; justify-content: center; z-index: 3000;
            `;
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: var(--surface-float); border-radius: 8px; padding: 24px;
                border: 1px solid var(--status-critical-fg);
                max-width: 640px; width: 90%; max-height: 85vh; overflow-y: auto;
                box-shadow: var(--shadow-modal);
            `;
            dialog.innerHTML = `
                <h3 style="margin:0 0 8px;color:var(--status-critical-fg);font-size:1.05rem;">高危操作确认</h3>
                <p style="margin:0 0 14px;color:var(--text-muted);font-size:13px;">
                    以下脚本包含<strong>可能造成不可逆损失</strong>的操作，请逐条核对命中明细：
                </p>
                <div style="background:var(--surface-subtle);border:1px solid var(--border-subtle);border-radius:6px;padding:12px;margin-bottom:14px;">
                    ${findingsHtml(results)}
                </div>
                <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:13px;color:var(--text-body);cursor:pointer;">
                    <input type="checkbox" id="riskAckCheckbox" style="margin-top:2px;">
                    <span>我已知晓此操作可能造成<strong style="color:var(--status-critical-fg);">不可逆损失</strong>，并已确认目标主机与路径无误</span>
                </label>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
                    <span style="font-size:13px;color:var(--text-body);flex-shrink:0;">请输入 <strong>${escapeHtml(confirmName)}</strong> 以确认执行：</span>
                    <input type="text" class="form-control form-control-sm" id="riskNameInput" style="flex:1;min-width:0;" autocomplete="off" spellcheck="false">
                </div>
                <div style="display:flex;gap:12px;justify-content:flex-end;">
                    <button class="btn btn-secondary" id="riskCancelBtn">取消</button>
                    <button class="btn btn-danger" id="riskConfirmBtn" disabled>确认执行</button>
                </div>
            `;
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const checkbox = dialog.querySelector('#riskAckCheckbox');
            const nameInput = dialog.querySelector('#riskNameInput');
            const confirmBtn = dialog.querySelector('#riskConfirmBtn');
            const update = () => {
                confirmBtn.disabled = !(checkbox.checked && nameInput.value.trim() === confirmName);
            };
            checkbox.addEventListener('change', update);
            nameInput.addEventListener('input', update);
            nameInput.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click();
            });
            setTimeout(() => nameInput.focus(), 50);

            const cleanup = (result) => { overlay.remove(); resolve(result); };
            dialog.querySelector('#riskCancelBtn').addEventListener('click', () => cleanup(false));
            overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
            confirmBtn.addEventListener('click', () => cleanup(true));
        });
    }

    async function confirm(items, opts = {}) {
        const list = Array.isArray(items) ? items : [items];
        if (!list.length) return true;
        const { level, results } = collect(list);

        if (level === 'normal') return true;

        if (level === 'high') {
            const confirmName = opts.confirmName || list[0].name || '';
            return await strongConfirm({ results, confirmName });
        }

        // 中危：普通确认
        const names = list.map(it => it.name).join('、');
        const topFindings = results.flatMap(r => r.findings).slice(0, 5)
            .map(f => `[${f.ruleId}] L${f.line} ${f.message}`).join('<br>');
        const ConfirmDialog = window.Components && window.Components.ConfirmDialog;
        if (!ConfirmDialog) return window.confirm(`「${names}」包含中危操作，确认继续执行？`);
        return await ConfirmDialog.show({
            title: '中危操作确认',
            message: `「${escapeHtml(names)}」包含中危操作：<br><span style="font-size:12.5px;color:var(--text-faint);">${topFindings}</span><br>确认继续执行？`,
            confirmText: '继续执行',
            cancelText: '取消'
        });
    }

    return { confirm };
})();

// 挂载全局（浏览器/Electron 渲染进程），并兼容 Node 环境（用于规则用例测试）
if (typeof window !== 'undefined') {
    window.RiskAnalyzer = RiskAnalyzer;
    window.RiskGate = RiskGate;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiskAnalyzer, RiskGate };
}
