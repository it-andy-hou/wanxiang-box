// 远程终端：关键词高亮
// 设计说明见 docs/requirements/远程终端模块.md 第 12.2 节
//
// - 流式解析 ANSI 转义序列，只给"默认前景色"的纯文本插入颜色码，远端已着色的文本不覆盖
// - 备用屏幕（vim/top/less 等全屏程序）期间不高亮
// - 输出速率过高时暂停高亮，避免大日志卡顿
// - 只插入 SGR 颜色码（零宽），不改变光标位置与文本内容
// 渲染进程通过 window.TerminalHighlighter 使用；Node 环境下可 require（便于离线验证）

(function (root) {
    // 颜色名 -> SGR 前景色代码（使用终端调色板中的亮色，与深色主题协调）
    const COLORS = {
        red: '91',
        green: '92',
        yellow: '93',
        blue: '94',
        magenta: '95',
        cyan: '96',
        gray: '90'
    };
    const COLOR_LABELS = {
        red: '红', green: '绿', yellow: '黄', blue: '蓝', magenta: '品红', cyan: '青', gray: '灰'
    };
    // 与 terminalView.js 中 TERMINAL_THEME 的亮色保持一致，用于设置界面预览
    const COLOR_PREVIEW = {
        red: '#ff7b72', green: '#a5e075', yellow: '#f0d48a', blue: '#6cb6ff',
        magenta: '#d68ef0', cyan: '#5fd7e0', gray: '#7f848e'
    };

    // 内置规则专用色（24 位真彩色，接近 WindTerm 观感，不受调色板限制）
    const PALETTE = {
        error: '#ff6b6b',
        warn: '#e5c07b',
        success: '#89d185',
        info: '#61afef',
        ip: '#c678dd',
        time: '#56b6c2',
        url: '#e5c07b',
        number: '#d19a66',
        string: '#98c379',
        key: '#8ab4f8',
        path: '#7fb4ca',
        promptUser: '#89d185',
        promptPath: '#61afef',
        promptSign: '#e5c07b'
    };

    /** 百分比按数值分级：≥90 红，≥70 黄，其余绿（df、free、top 等占用率一眼可辨） */
    function percentColor(text) {
        const v = parseFloat(text);
        if (v >= 90) return PALETTE.error;
        if (v >= 70) return PALETTE.warn;
        return PALETTE.success;
    }

    // 内置规则：数组顺序即优先级（重叠时靠前的规则胜出）
    // 可选字段：bold / underline；groups（按捕获分组分别着色，null 表示该组不着色）；pick（按匹配文本决定颜色）
    const BUILTIN_RULES = [
        {
            id: 'url', name: 'URL', color: PALETTE.url, underline: true, enabled: true,
            pattern: "\\b(?:https?|ftp)://[^\\s'\"<>()\\[\\]{}]+"
        },
        {
            // [root@host ~]#  或  user@host:~/dir$
            id: 'prompt', name: '命令提示符', color: PALETTE.promptUser, enabled: true,
            pattern: '([\\w.-]+@[\\w.-]+)([: ])([^\\s\\]#$]*)(\\]?)([#$])(?=\\s|$)',
            groups: [
                { color: PALETTE.promptUser, bold: true },
                null,
                { color: PALETTE.promptPath },
                null,
                { color: PALETTE.promptSign, bold: true }
            ]
        },
        {
            id: 'ipv4', name: 'IPv4 地址', color: PALETTE.ip, enabled: true,
            pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?::\\d{1,5})?(?:/\\d{1,2})?\\b'
        },
        {
            // 完整 8 段，或含 :: 的压缩写法；可带 %网卡 和 /前缀长度
            // 不匹配 12:30:45、MAC 地址（段数不足且无 ::），也不匹配 std::vector 这类标识符
            id: 'ipv6', name: 'IPv6 地址', color: PALETTE.ip, enabled: true,
            pattern: '(?<![\\w:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{0,4}::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?)(?:%[\\w.-]+)?(?:/\\d{1,3})?(?![\\w:]|\\.\\d)'
        },
        {
            id: 'mac', name: 'MAC 地址', color: PALETTE.ip, enabled: true,
            pattern: '\\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\\b'
        },
        {
            id: 'datetime', name: '日期时间', color: PALETTE.time, enabled: true,
            pattern: '\\b\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}(?:[T ]\\d{1,2}:\\d{2}(?::\\d{2})?(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?\\b|\\b\\d{1,2}:\\d{2}:\\d{2}(?:[.,]\\d+)?\\b'
        },
        {
            id: 'percent', name: '百分比（按数值分级）', color: PALETTE.success, enabled: true,
            pattern: '(?<![\\w.])\\d{1,3}(?:\\.\\d+)?%',
            pick: percentColor
        },
        {
            id: 'error', name: '错误', color: PALETTE.error, bold: true, enabled: true,
            pattern: "\\b(?:errors?|fail(?:s|ed|ure|ures)?|fatal|critical|crit|emerg|panic|denied|refused|exceptions?|traceback|timeout|timed out|unreachable|not found|no such file or directory|segmentation fault|killed|aborted|invalid|unable|cannot|can't|inactive|dead|offline)\\b"
        },
        {
            id: 'warn', name: '警告', color: PALETTE.warn, enabled: true,
            pattern: '\\b(?:warn(?:s|ing|ings)?|deprecated|retry(?:ing)?|skipped|pending)\\b'
        },
        {
            id: 'success', name: '成功', color: PALETTE.success, enabled: true,
            pattern: '\\b(?:ok|success(?:ful|fully)?|succeed(?:s|ed)?|done|passed|active|running|enabled|online|started|completed?|accepted|listen)\\b'
        },
        {
            id: 'info', name: '信息', color: PALETTE.info, enabled: true,
            pattern: '\\b(?:info|notice|debug|trace|verbose)\\b'
        },
        {
            id: 'string', name: '引号字符串', color: PALETTE.string, enabled: true,
            pattern: "\"[^\"\\r\\n]{0,300}\"|(?<![\\w'])'[^'\\r\\n]{0,300}'(?![\\w'])"
        },
        {
            // KEY=value 中的 KEY
            id: 'keyvalue', name: '键值对的键', color: PALETTE.key, enabled: true,
            pattern: '(?<![\\w./:-])[A-Za-z_][\\w.]*(?==)'
        },
        {
            id: 'path', name: '绝对路径', color: PALETTE.path, enabled: true,
            pattern: '(?<![\\w.~-])(?:/[\\w.@%+-]+)+/?'
        },
        {
            // 数字与容量单位：1024、3.14、3.8G、396M、6.5MiB
            id: 'number', name: '数字与容量', color: PALETTE.number, enabled: true,
            pattern: '(?<![\\w.])\\d+(?:\\.\\d+)?(?:[KMGTPE](?:i?B)?)?\\b'
        }
    ];

    const MAX_MATCHES_PER_RUN = 2000;
    const THROTTLE_WINDOW_MS = 1000;
    const THROTTLE_CHARS = 2 * 1024 * 1024;   // 每秒超过约 2M 字符时暂停高亮

    // 与 src/main/terminalExtras.js 的 HIGHLIGHT_CONFIG_VERSION 保持一致
    const CONFIG_VERSION = 2;

    function defaultConfig() {
        return { version: CONFIG_VERSION, enabled: true, builtin: {}, custom: [] };
    }

    /** 校验正则，返回错误信息或 null */
    function validatePattern(pattern, caseSensitive) {
        if (typeof pattern !== 'string' || !pattern.trim()) return '正则不能为空';
        if (pattern.length > 500) return '正则长度不能超过 500';
        try {
            const re = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
            if (re.test('')) return '正则不能匹配空字符串';
        } catch (e) {
            return `正则无效：${e.message}`;
        }
        return null;
    }

    /** 颜色名（调色板）或 #rrggbb -> SGR 前景色参数；无效返回 null */
    function colorParam(color) {
        if (COLORS[color]) return COLORS[color];
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color || '');
        if (!m) return null;
        return `38;2;${parseInt(m[1], 16)};${parseInt(m[2], 16)};${parseInt(m[3], 16)}`;
    }

    /** 设置界面预览用的 CSS 颜色 */
    function previewColor(color) {
        return COLOR_PREVIEW[color] || color || '';
    }

    /**
     * 生成一段样式的开/关转义序列。
     * flags.noBold / noUnderline：远端已开启粗体/下划线时不插入，避免关闭码把远端样式一并清掉
     */
    function wrapStyle(style, text, flags) {
        const fg = colorParam(style.color);
        if (!fg) return text;
        const open = [fg];
        const close = ['39'];
        if (style.bold && !flags.noBold) { open.push('1'); close.push('22'); }
        if (style.underline && !flags.noUnderline) { open.push('4'); close.push('24'); }
        return `\x1b[${open.join(';')}m${text}\x1b[${close.join(';')}m`;
    }

    /**
     * 把配置编译为规则列表。自定义规则在前（优先），内置规则在后。
     * 返回 [{ id, re, style, groups, pick }]；无效规则跳过。
     */
    function compileRules(config) {
        const cfg = config || defaultConfig();
        const out = [];
        const add = (id, rule, caseSensitive) => {
            if (!colorParam(rule.color) || validatePattern(rule.pattern, caseSensitive)) return;
            const groups = Array.isArray(rule.groups) ? rule.groups : null;
            // 分组着色需要 d 标志拿到各分组的位置
            const flags = 'g' + (caseSensitive ? '' : 'i') + (groups ? 'd' : '');
            out.push({
                id,
                re: new RegExp(rule.pattern, flags),
                style: { color: rule.color, bold: !!rule.bold, underline: !!rule.underline },
                groups,
                pick: typeof rule.pick === 'function' ? rule.pick : null
            });
        };
        for (const r of (cfg.custom || [])) {
            if (r && r.enabled !== false) add(`custom:${r.id}`, { pattern: r.pattern, color: r.color }, !!r.caseSensitive);
        }
        const overrides = cfg.builtin || {};
        for (const r of BUILTIN_RULES) {
            const on = typeof overrides[r.id] === 'boolean' ? overrides[r.id] : r.enabled;
            if (on) add(r.id, r, false);
        }
        return out;
    }

    /** 渲染单个匹配：整段着色，或按捕获分组分别着色 */
    function renderMatch(rule, sp, text, flags) {
        const whole = text.slice(sp.s, sp.e);
        if (!rule.groups || !sp.indices) {
            const style = rule.pick ? { ...rule.style, color: rule.pick(whole) } : rule.style;
            return wrapStyle(style, whole, flags);
        }
        let out = '';
        let pos = sp.s;
        rule.groups.forEach((style, gi) => {
            const range = sp.indices[gi + 1];
            if (!style || !range || range[0] === range[1] || range[0] < pos) return;
            out += text.slice(pos, range[0]) + wrapStyle(style, text.slice(range[0], range[1]), flags);
            pos = range[1];
        });
        return out + text.slice(pos, sp.e);
    }

    /**
     * 对一段纯文本应用规则，按规则优先级挑选不重叠的匹配并包裹颜色码
     * @param {Object} [flags] { noBold, noUnderline }
     */
    function highlightText(text, rules, flags = {}) {
        if (text.length < 2 || !rules.length) return text;
        const spans = [];
        for (let p = 0; p < rules.length; p++) {
            const re = rules[p].re;
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
                if (m[0].length === 0) {
                    re.lastIndex++;
                    continue;
                }
                spans.push({ s: m.index, e: m.index + m[0].length, p, indices: m.indices || null });
                if (spans.length >= MAX_MATCHES_PER_RUN) break;
            }
            if (spans.length >= MAX_MATCHES_PER_RUN) break;
        }
        if (!spans.length) return text;

        // 优先级高的先占位，后面的规则只能用未被占用的区间
        spans.sort((a, b) => a.p - b.p || a.s - b.s);
        const taken = new Uint8Array(text.length);
        const chosen = [];
        for (const sp of spans) {
            let free = true;
            for (let i = sp.s; i < sp.e; i++) {
                if (taken[i]) { free = false; break; }
            }
            if (!free) continue;
            taken.fill(1, sp.s, sp.e);
            chosen.push(sp);
        }
        chosen.sort((a, b) => a.s - b.s);

        let out = '';
        let pos = 0;
        for (const sp of chosen) {
            out += text.slice(pos, sp.s) + renderMatch(rules[sp.p], sp, text, flags);
            pos = sp.e;
        }
        return out + text.slice(pos);
    }

    // 解析器状态
    const S_TEXT = 0;
    const S_ESC = 1;        // 收到 ESC
    const S_CSI = 2;        // ESC [ ... 等待终止字节
    const S_STR = 3;        // OSC/DCS/PM/APC/SOS 字符串，直到 BEL 或 ST
    const S_STR_ESC = 4;    // 字符串内收到 ESC（可能是 ST 的开始）
    const S_ESC_INT = 5;    // ESC + 中间字节（如 ESC ( B），等待终止字节

    class Highlighter {
        constructor(rules) {
            this.rules = rules || [];
            this.reset();
        }

        setRules(rules) {
            this.rules = rules || [];
        }

        /** 重置解析状态。alt：当前是否处于备用屏幕（中途开启高亮时由 xterm 当前状态初始化） */
        reset({ alt = false } = {}) {
            this.state = S_TEXT;
            this.params = '';
            this.alt = !!alt;
            this.fgSet = false;       // 远端是否设置了非默认前景色
            this.inverse = false;
            this.bold = false;        // 远端开启的粗体/下划线（此时不插入对应码，避免误关）
            this.underline = false;
            this.winStart = 0;
            this.winChars = 0;
            this.throttled = false;
        }

        _canHighlight() {
            return !this.alt && !this.fgSet && !this.inverse && !this.throttled && this.rules.length > 0;
        }

        _applySgr(params) {
            const parts = params === '' ? ['0'] : params.split(';');
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const code = parseInt(part.split(':')[0] || '0', 10);
                if (code === 0) {
                    this.fgSet = false;
                    this.inverse = false;
                    this.bold = false;
                    this.underline = false;
                } else if (code === 1) {
                    this.bold = true;
                } else if (code === 22) {
                    this.bold = false;
                } else if (code === 4 || code === 21) {
                    this.underline = !(part.includes(':') && part.split(':')[1] === '0');
                } else if (code === 24) {
                    this.underline = false;
                } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
                    this.fgSet = true;
                } else if (code === 39) {
                    this.fgSet = false;
                } else if (code === 7) {
                    this.inverse = true;
                } else if (code === 27) {
                    this.inverse = false;
                } else if (code === 38 || code === 48) {
                    if (code === 38) this.fgSet = true;
                    if (part.includes(':')) continue;             // 冒号子参数形式已自包含
                    const mode = parts[i + 1];
                    if (mode === '5') i += 2;
                    else if (mode === '2') i += 4;
                }
            }
        }

        _finishCsi(final) {
            const params = this.params;
            if (final === 'm') {
                // 带私有前缀的 SGR（如 CSI > 4 m）不是颜色设置
                if (!/^[<=>?]/.test(params)) this._applySgr(params);
            } else if ((final === 'h' || final === 'l') && params.charAt(0) === '?') {
                const modes = params.slice(1).split(';');
                if (modes.some(m => m === '47' || m === '1047' || m === '1049')) {
                    this.alt = final === 'h';
                }
            }
        }

        _track(len) {
            const now = Date.now();
            if (now - this.winStart > THROTTLE_WINDOW_MS) {
                this.winStart = now;
                this.winChars = 0;
            }
            this.winChars += len;
            this.throttled = this.winChars > THROTTLE_CHARS;
        }

        /** 处理一段已解码的输出文本，返回插入颜色码后的文本 */
        process(str) {
            if (!str) return str;
            this._track(str.length);
            let out = '';
            let textStart = -1;

            const flushText = (end) => {
                if (textStart < 0) return;
                const seg = str.slice(textStart, end);
                out += this._canHighlight()
                    ? highlightText(seg, this.rules, { noBold: this.bold, noUnderline: this.underline })
                    : seg;
                textStart = -1;
            };

            for (let i = 0; i < str.length; i++) {
                const ch = str.charCodeAt(i);
                switch (this.state) {
                    case S_TEXT:
                        if (ch === 0x1b) {
                            flushText(i);
                            out += '\x1b';
                            this.state = S_ESC;
                        } else if (textStart < 0) {
                            textStart = i;
                        }
                        break;
                    case S_ESC:
                        out += str[i];
                        if (ch === 0x5b) {                          // [
                            this.state = S_CSI;
                            this.params = '';
                        } else if (ch === 0x5d || ch === 0x50 || ch === 0x5e || ch === 0x5f || ch === 0x58) {
                            this.state = S_STR;                     // ] P ^ _ X
                        } else if (ch >= 0x20 && ch <= 0x2f) {
                            this.state = S_ESC_INT;
                        } else {
                            if (ch === 0x63) this.reset({ alt: false });   // ESC c 完全重置
                            this.state = S_TEXT;
                        }
                        break;
                    case S_CSI:
                        out += str[i];
                        if (ch >= 0x40 && ch <= 0x7e) {
                            this._finishCsi(str[i]);
                            this.state = S_TEXT;
                        } else if (ch === 0x1b) {
                            this.state = S_ESC;                     // 被新序列打断
                        } else if (ch >= 0x20 && ch <= 0x3f) {
                            if (this.params.length < 256) this.params += str[i];
                        }
                        break;
                    case S_STR:
                        out += str[i];
                        if (ch === 0x07) this.state = S_TEXT;
                        else if (ch === 0x1b) this.state = S_STR_ESC;
                        break;
                    case S_STR_ESC:
                        out += str[i];
                        this.state = ch === 0x5c ? S_TEXT : (ch === 0x1b ? S_STR_ESC : S_STR);
                        break;
                    case S_ESC_INT:
                        out += str[i];
                        if (ch >= 0x30 && ch <= 0x7e) this.state = S_TEXT;
                        break;
                    default:
                        this.state = S_TEXT;
                        out += str[i];
                }
            }
            flushText(str.length);
            return out;
        }
    }

    const api = {
        COLORS,
        COLOR_LABELS,
        COLOR_PREVIEW,
        BUILTIN_RULES,
        CONFIG_VERSION,
        previewColor,
        defaultConfig,
        validatePattern,
        compileRules,
        highlightText,
        Highlighter
    };

    if (typeof window !== 'undefined') window.TerminalHighlighter = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
