// 远程终端增强功能的主进程部分：历史命令存储、快捷命令与高亮规则校验
// 设计说明见 docs/requirements/远程终端模块.md 第 12 节

const fs = require('fs');
const path = require('path');

// ============================================================
// 历史命令（全局共享）
// 单独存放在 userData/terminal/history.json：每次回车都可能写入，
// 不放进 database.json，避免频繁重写主数据文件
// ============================================================
const HISTORY_MAX_ENTRIES = 5000;
const HISTORY_MAX_COMMAND_LENGTH = 500;
const HISTORY_SAVE_DELAY_MS = 2000;
const HISTORY_HOSTS_PER_ENTRY = 20;
const DAY = 86400000;

function historyScore(e, now) {
    const ageDays = Math.max(0, (now - (e.t || 0)) / DAY);
    return Math.log2((e.n || 1) + 1) * 2 + 3 / (1 + ageDays / 3);
}

class CommandHistoryStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.map = new Map();
        this.timer = null;
        this._load();
    }

    _load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.entries) ? raw.entries : []);
            for (const e of list) {
                if (!e || typeof e.c !== 'string' || !e.c || e.c.length > HISTORY_MAX_COMMAND_LENGTH) continue;
                this.map.set(e.c, {
                    c: e.c,
                    n: Number.isFinite(e.n) && e.n > 0 ? Math.floor(e.n) : 1,
                    t: Number.isFinite(e.t) ? e.t : 0,
                    h: Array.isArray(e.h) ? e.h.slice(0, HISTORY_HOSTS_PER_ENTRY) : []
                });
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.warn('[终端] 读取历史命令失败:', e.message);
        }
    }

    list() {
        return Array.from(this.map.values());
    }

    get size() {
        return this.map.size;
    }

    add(command, hostId) {
        if (typeof command !== 'string') return false;
        const cmd = command.trim();
        // eslint-disable-next-line no-control-regex
        if (!cmd || cmd.length > HISTORY_MAX_COMMAND_LENGTH || /[\x00-\x1f\x7f]/.test(cmd)) return false;
        const now = Date.now();
        let e = this.map.get(cmd);
        if (!e) {
            e = { c: cmd, n: 0, t: now, h: [] };
            this.map.set(cmd, e);
        }
        e.n += 1;
        e.t = now;
        if (hostId !== undefined && hostId !== null && (typeof hostId === 'number' || typeof hostId === 'string')) {
            e.h = [hostId, ...e.h.filter(x => x !== hostId)].slice(0, HISTORY_HOSTS_PER_ENTRY);
        }
        this._prune(now);
        this._scheduleSave();
        return true;
    }

    remove(command) {
        const ok = this.map.delete(command);
        if (ok) this._scheduleSave();
        return ok;
    }

    clear() {
        this.map.clear();
        this._scheduleSave();
    }

    _prune(now) {
        if (this.map.size <= HISTORY_MAX_ENTRIES) return;
        // 超出上限时一次淘汰 10%，避免每条新命令都排序
        const keep = Math.floor(HISTORY_MAX_ENTRIES * 0.9);
        const sorted = this.list().sort((a, b) => historyScore(b, now) - historyScore(a, now));
        this.map = new Map(sorted.slice(0, keep).map(e => [e.c, e]));
    }

    _scheduleSave() {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, HISTORY_SAVE_DELAY_MS);
    }

    /** 立即写盘（退出时调用） */
    flush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const tmp = this.filePath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: this.list() }), 'utf8');
            fs.renameSync(tmp, this.filePath);
        } catch (e) {
            console.warn('[终端] 保存历史命令失败:', e.message);
        }
    }
}

// ============================================================
// 关键词高亮配置
// ============================================================
const HIGHLIGHT_COLORS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'gray'];
const HIGHLIGHT_BUILTIN_IDS = [
    'url', 'prompt', 'ipv4', 'ipv6', 'mac', 'datetime', 'percent', 'error', 'warn', 'success', 'info',
    'string', 'keyvalue', 'path', 'number'
];
const HIGHLIGHT_MAX_CUSTOM = 50;
// 配置版本：2 起"绝对路径""数字"默认开启，旧配置里保存的这两项关闭状态不再沿用
const HIGHLIGHT_CONFIG_VERSION = 2;
const HIGHLIGHT_V2_RESET_IDS = ['path', 'number'];

function normalizeHighlightConfig(input) {
    const src = input && typeof input === 'object' ? input : {};
    const builtin = {};
    const b = src.builtin && typeof src.builtin === 'object' ? src.builtin : {};
    const legacy = !(src.version >= HIGHLIGHT_CONFIG_VERSION);
    for (const id of HIGHLIGHT_BUILTIN_IDS) {
        if (legacy && HIGHLIGHT_V2_RESET_IDS.includes(id)) continue;
        if (typeof b[id] === 'boolean') builtin[id] = b[id];
    }
    const custom = [];
    const errors = [];
    const list = Array.isArray(src.custom) ? src.custom.slice(0, HIGHLIGHT_MAX_CUSTOM) : [];
    list.forEach((r, i) => {
        if (!r || typeof r !== 'object') return;
        const name = String(r.name || '').trim().slice(0, 40) || `规则 ${i + 1}`;
        const pattern = typeof r.pattern === 'string' ? r.pattern : '';
        const caseSensitive = !!r.caseSensitive;
        let err = null;
        if (!pattern.trim()) err = '正则不能为空';
        else if (pattern.length > 500) err = '正则长度不能超过 500';
        else {
            try {
                if (new RegExp(pattern, caseSensitive ? 'g' : 'gi').test('')) err = '正则不能匹配空字符串';
            } catch (e) {
                err = `正则无效：${e.message}`;
            }
        }
        if (err) {
            errors.push(`「${name}」${err}`);
            return;
        }
        custom.push({
            id: String(r.id || `r${Date.now().toString(36)}${i}`).slice(0, 40),
            name,
            pattern,
            caseSensitive,
            color: HIGHLIGHT_COLORS.includes(r.color) ? r.color : 'yellow',
            enabled: r.enabled !== false
        });
    });
    return { config: { version: HIGHLIGHT_CONFIG_VERSION, enabled: src.enabled !== false, builtin, custom }, errors };
}

// ============================================================
// 快捷命令（存主数据库，随全量备份）
// ============================================================
const QC_MAX_GROUPS = 50;
const QC_MAX_COMMANDS = 1000;
const QC_NAME_MAX = 50;
const QC_CONTENT_MAX = 10000;
const QC_DESC_MAX = 200;
const QC_EXPORT_TYPE = 'wxbox-terminal-quick-commands';

const QC_SEED = [
    {
        name: '常用',
        commands: [
            { name: '磁盘', content: 'df -h' },
            { name: '内存', content: 'free -h' },
            { name: '负载', content: 'uptime' },
            { name: '进程', content: 'top -c' },
            { name: '监听端口', content: 'ss -lntp' },
            { name: '系统版本', content: 'cat /etc/os-release' }
        ]
    }
];

function genId(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 校验并规范化渲染端提交的完整快捷命令数据。
 * 返回 { groups, commands }；校验失败抛出 Error（消息直接展示给用户）。
 */
function normalizeQuickCommands(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const rawGroups = Array.isArray(src.groups) ? src.groups : [];
    const rawCommands = Array.isArray(src.commands) ? src.commands : [];
    if (rawGroups.length > QC_MAX_GROUPS) throw new Error(`分组最多 ${QC_MAX_GROUPS} 个`);
    if (rawCommands.length > QC_MAX_COMMANDS) throw new Error(`快捷命令最多 ${QC_MAX_COMMANDS} 条`);

    const groups = [];
    const ids = new Set();
    rawGroups.forEach((g, i) => {
        const name = String((g && g.name) || '').trim();
        if (!name) throw new Error('分组名称不能为空');
        if (name.length > QC_NAME_MAX) throw new Error(`分组名称不能超过 ${QC_NAME_MAX} 个字符`);
        let id = String((g && g.id) || '').slice(0, 40) || genId('g');
        if (ids.has(id)) id = genId('g');
        ids.add(id);
        groups.push({ id, name, sort_order: i });
    });

    const groupIds = new Set(groups.map(g => g.id));
    const commands = [];
    const cmdIds = new Set();
    const order = {};
    rawCommands.forEach((c) => {
        if (!c || !groupIds.has(String(c.group_id))) return;   // 所属分组已删除
        const name = String(c.name || '').trim();
        const content = typeof c.content === 'string' ? c.content : '';
        if (!name) throw new Error('命令名称不能为空');
        if (name.length > QC_NAME_MAX) throw new Error(`命令名称不能超过 ${QC_NAME_MAX} 个字符`);
        if (!content.trim()) throw new Error(`「${name}」的命令内容不能为空`);
        if (content.length > QC_CONTENT_MAX) throw new Error(`「${name}」的命令内容不能超过 ${QC_CONTENT_MAX} 个字符`);
        let id = String(c.id || '').slice(0, 40) || genId('c');
        if (cmdIds.has(id)) id = genId('c');
        cmdIds.add(id);
        const gid = String(c.group_id);
        order[gid] = (order[gid] || 0) + 1;
        commands.push({
            id,
            group_id: gid,
            name,
            content,
            description: String(c.description || '').trim().slice(0, QC_DESC_MAX),
            sort_order: order[gid] - 1
        });
    });
    return { groups, commands };
}

function seedQuickCommands() {
    const groups = [];
    const commands = [];
    QC_SEED.forEach((g) => {
        const gid = genId('g');
        groups.push({ id: gid, name: g.name });
        g.commands.forEach(c => commands.push({ id: genId('c'), group_id: gid, name: c.name, content: c.content }));
    });
    return normalizeQuickCommands({ groups, commands });
}

/** 导出为按分组嵌套的 JSON，便于阅读和手工编辑 */
function exportQuickCommands({ groups, commands }) {
    return {
        type: QC_EXPORT_TYPE,
        version: 1,
        exported_at: new Date().toISOString(),
        groups: groups.map(g => ({
            name: g.name,
            commands: commands
                .filter(c => c.group_id === g.id)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(c => ({ name: c.name, content: c.content, description: c.description || '' }))
        }))
    };
}

/**
 * 把导入文件合并进现有数据：按分组名合并，同组内同名命令覆盖内容。
 * 返回 { data: { groups, commands }, stats: { groups, added, updated } }
 */
function mergeQuickCommandsImport(current, imported) {
    if (!imported || typeof imported !== 'object' || imported.type !== QC_EXPORT_TYPE || !Array.isArray(imported.groups)) {
        throw new Error('文件格式不正确，请选择由万象匣导出的快捷命令文件');
    }
    const groups = current.groups.map(g => ({ ...g }));
    const commands = current.commands.map(c => ({ ...c }));
    const stats = { groups: 0, added: 0, updated: 0 };
    for (const ig of imported.groups) {
        const gname = String((ig && ig.name) || '').trim();
        if (!gname) continue;
        let g = groups.find(x => x.name === gname);
        if (!g) {
            g = { id: genId('g'), name: gname };
            groups.push(g);
            stats.groups++;
        }
        for (const ic of (Array.isArray(ig.commands) ? ig.commands : [])) {
            const name = String((ic && ic.name) || '').trim();
            const content = ic && typeof ic.content === 'string' ? ic.content : '';
            if (!name || !content.trim()) continue;
            const exist = commands.find(c => c.group_id === g.id && c.name === name);
            if (exist) {
                exist.content = content;
                exist.description = String(ic.description || '');
                stats.updated++;
            } else {
                commands.push({ id: genId('c'), group_id: g.id, name, content, description: String(ic.description || ''), sort_order: 1e9 });
                stats.added++;
            }
        }
    }
    // 维持原有顺序，新增的排在组内末尾
    commands.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return { data: normalizeQuickCommands({ groups, commands }), stats };
}

module.exports = {
    CommandHistoryStore,
    normalizeHighlightConfig,
    normalizeQuickCommands,
    seedQuickCommands,
    exportQuickCommands,
    mergeQuickCommandsImport,
    QC_EXPORT_TYPE
};
