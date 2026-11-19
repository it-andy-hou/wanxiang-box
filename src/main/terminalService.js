// 交互式远程终端：主进程会话管理
// 设计说明见 docs/requirements/远程终端模块.md
//
// - 每个会话持有一个 ssh2 Client + PTY shell 流，渲染进程只负责显示（xterm.js）
// - 凭据只在主进程内使用：渲染进程只传 hostId
// - 输出合并（16ms / 64KB）后以原始字节发送，由 xterm 自行做 UTF-8 解码
// - 基于渲染端 ack 的流控：未确认字节超过高水位时暂停远端输出
// - 会话归属发起它的 webContents，窗口销毁/刷新时统一清理

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FLUSH_INTERVAL_MS = 16;
const FLUSH_BYTES = 64 * 1024;
const HIGH_WATER_BYTES = 2 * 1024 * 1024;
const LOW_WATER_BYTES = 512 * 1024;
const CONNECT_TIMEOUT_MS = 20000;      // TCP + 密钥交换阶段超时（用户输入提示期间暂停计时）
const READY_TIMEOUT_MS = 180000;       // ssh2 整体就绪超时：留出用户输入密码/验证码的时间
const KEEPALIVE_INTERVAL_MS = 15000;   // 15s × 3 次无响应 ≈ 45s 判定断线
const KEEPALIVE_COUNT_MAX = 3;
const MAX_PASSPHRASE_ATTEMPTS = 3;
const SESSION_LOG_MAX_BYTES = 5 * 1024 * 1024;

const PASSPHRASE_ERROR_RE = /no passphrase given|bad passphrase|bad decrypt|integrity check failed/i;

// ------------------------------------------------------------
// ZMODEM（rz/sz）：终端不支持该协议，检测到握手后立即取消并提示，避免用户卡在等待中
// ------------------------------------------------------------
// 十六进制帧头：ZPAD ZPAD ZDLE 'B' + 帧类型(2) + 标志(8) + CRC(4)，之后通常跟 CR、LF|0x80、XON
// 帧类型 00 = ZRQINIT（sz 发起发送），01 = ZRINIT（rz 等待接收）
const ZMODEM_HEADER_RE = /\*\*\x18B0([01])[0-9a-fA-F]{12}(?:\r?[\n\x8a])?\x11?/g;
// 与 lrzsz canit() 相同：10 个 CAN + 10 个退格（退格清掉残留到 shell 输入行的字符）
const ZMODEM_CANCEL = Buffer.from('\x18'.repeat(10) + '\x08'.repeat(10), 'latin1');
// 取消后远端可能还会重发几次握手，冷却期内只清理不重复取消/提示
const ZMODEM_COOLDOWN_MS = 3000;
// 帧头最长 4+14+3 字节，跨数据块检测时保留上一块的尾部
const ZMODEM_TAIL_BYTES = 24;

// ------------------------------------------------------------
// 主机指纹（TOFU）：首次连接记录，变化时阻断并询问用户
// ------------------------------------------------------------

/** 从 SSH 公钥 blob 中读取密钥类型（blob 以 uint32 长度 + 类型字符串开头） */
function parseKeyType(keyBlob) {
    try {
        const len = keyBlob.readUInt32BE(0);
        if (len > 0 && len < 64 && keyBlob.length >= 4 + len) {
            return keyBlob.subarray(4, 4 + len).toString('ascii');
        }
    } catch (e) { /* ignore */ }
    return 'unknown';
}

/** 与 OpenSSH `ssh-keygen -lf` 一致的 SHA256 指纹格式 */
function fingerprintOf(keyBlob) {
    return 'SHA256:' + crypto.createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '');
}

class KnownHostsStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.entries = null;
    }

    _load() {
        if (this.entries) return;
        this.entries = {};
        try {
            if (fs.existsSync(this.filePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                if (parsed && typeof parsed === 'object') this.entries = parsed;
            }
        } catch (e) {
            console.warn('[终端] 读取主机指纹库失败，按空库处理:', e.message);
        }
    }

    _save() {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const tmp = this.filePath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2), 'utf8');
            fs.renameSync(tmp, this.filePath);
        } catch (e) {
            console.warn('[终端] 保存主机指纹库失败:', e.message);
        }
    }

    static keyOf(ip, port) {
        return `${ip}:${port || 22}`;
    }

    get(ip, port) {
        this._load();
        return this.entries[KnownHostsStore.keyOf(ip, port)] || null;
    }

    set(ip, port, keyType, fingerprint) {
        this._load();
        const k = KnownHostsStore.keyOf(ip, port);
        const now = new Date().toISOString();
        const prev = this.entries[k];
        this.entries[k] = { keyType, fingerprint, addedAt: prev ? prev.addedAt : now, updatedAt: now };
        this._save();
    }
}

// ------------------------------------------------------------
// 会话元数据日志（不含任何输入/输出内容）
// ------------------------------------------------------------
function appendSessionLog(filePath, record) {
    if (!filePath) return;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        try {
            if (fs.statSync(filePath).size > SESSION_LOG_MAX_BYTES) {
                fs.renameSync(filePath, filePath + '.1');
            }
        } catch (e) { /* 文件不存在 */ }
        fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (e) {
        console.warn('[终端] 写入会话记录失败:', e.message);
    }
}

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

// ------------------------------------------------------------
// 单个终端会话
// ------------------------------------------------------------
class TerminalSession {
    /**
     * @param {Object} opts
     * @param {string} opts.id
     * @param {Object} opts.host - HostModel.formatHost 结果（含解密后的 password）
     * @param {Function} opts.send - (channel, payload) => void，发往归属窗口
     * @param {Function} opts.ClientClass - ssh2 Client 构造器（测试可注入）
     * @param {Object} opts.sshService - 提供 getCompatibilityAlgorithms / parseErrorMessage
     * @param {KnownHostsStore} [opts.knownHosts]
     * @param {Function} [opts.onFinish] - (session) => void
     * @param {boolean} [opts.promptPassword] - 忽略已存密码，强制询问（认证失败后重连）
     */
    constructor(opts) {
        this.id = opts.id;
        this.host = opts.host;
        this.send = opts.send;
        this.ClientClass = opts.ClientClass;
        this.sshService = opts.sshService;
        this.knownHosts = opts.knownHosts || null;
        this.onFinish = opts.onFinish || (() => {});
        this.promptPassword = !!opts.promptPassword;
        this.timers = opts.timers || { setTimeout, clearTimeout };

        this.state = 'idle';
        this.client = null;
        this.stream = null;
        this.cols = 80;
        this.rows = 24;

        this.outQueue = [];
        this.outQueueBytes = 0;
        this.flushTimer = null;
        this.unacked = 0;
        this.paused = false;
        this.zmodemTail = '';
        this.zmodemCooldownUntil = 0;
        this.now = opts.now || Date.now;

        this.connectTimer = null;
        this.pendingPrompts = new Map();
        this.passphrase = undefined;
        this.passphraseAttempts = 0;
        this.kiPasswordUsed = false;
        this.exitCode = null;

        this.meta = {
            sessionId: this.id,
            hostId: this.host.id,
            ip: this.host.ip,
            port: this.host.port || 22,
            username: this.host.username,
            startedAt: new Date().toISOString(),
            readyAt: null,
            endedAt: null,
            reason: null,
            bytesIn: 0,
            bytesOut: 0
        };
    }

    get label() {
        return `${this.host.username}@${this.host.ip}:${this.host.port || 22}`;
    }

    _status(payload) {
        this.send('terminal:status', { sessionId: this.id, state: this.state, ...payload });
    }

    _notice(text) {
        this._status({ notice: text });
    }

    async start({ cols, rows } = {}) {
        this.cols = clampInt(cols, 1, 1000, 80);
        this.rows = clampInt(rows, 1, 1000, 24);
        this.state = 'connecting';
        this._status({ message: `正在连接 ${this.label} ...` });

        const cfg = {
            host: this.host.ip,
            port: this.host.port || 22,
            username: this.host.username,
            algorithms: this.sshService.getCompatibilityAlgorithms(),
            readyTimeout: READY_TIMEOUT_MS,
            keepaliveInterval: KEEPALIVE_INTERVAL_MS,
            keepaliveCountMax: KEEPALIVE_COUNT_MAX,
            tryKeyboard: true
        };

        const keyPath = this.host.privateKeyPath || this.host.private_key_path;
        if (keyPath && fs.existsSync(keyPath)) {
            try {
                cfg.privateKey = fs.readFileSync(keyPath);
            } catch (e) {
                return this.finish('error', `读取私钥失败：${e.message}`);
            }
        }

        const storedPassword = (!this.promptPassword && !this.host.password_unreadable) ? this.host.password : '';
        if (storedPassword) {
            cfg.password = storedPassword;
        } else if (!cfg.privateKey || this.promptPassword) {
            const hint = this.host.password_unreadable
                ? '已保存的密码无法在本机解密，请临时输入（不会保存）'
                : (this.promptPassword ? '请重新输入密码（不会保存）' : '该主机未保存密码，请输入（不会保存）');
            const answers = await this.prompt({
                kind: 'password',
                title: '输入密码',
                instructions: hint,
                fields: [{ label: `${this.label} 的密码`, echo: false }]
            });
            if (this.state === 'closed') return;
            if (!answers) return this.finish('user', '已取消登录');
            cfg.password = answers[0] || '';
        }

        this._connect(cfg);
    }

    _connect(cfg) {
        if (this.state === 'closed') return;
        if (this.passphrase !== undefined) cfg.passphrase = this.passphrase;

        const client = new this.ClientClass();
        this.client = client;

        cfg.hostVerifier = (keyBlob, verify) => {
            this._verifyHostKey(keyBlob).then(ok => verify(ok), () => verify(false));
        };

        client.on('handshake', () => this._clearConnectTimer());

        client.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
            this._handleKeyboardInteractive(cfg, name, instructions, prompts, finish);
        });

        client.on('ready', () => {
            if (this.state === 'closed') return;
            this._clearConnectTimer();
            client.shell({ term: 'xterm-256color', cols: this.cols, rows: this.rows }, (err, stream) => {
                if (err) return this.finish('error', `打开终端失败：${err.message}`);
                if (this.state === 'closed') { try { stream.close(); } catch (e) { /* ignore */ } return; }
                this.stream = stream;
                stream.on('data', buf => this._enqueue(buf));
                if (stream.stderr) stream.stderr.on('data', buf => this._enqueue(buf));
                stream.on('exit', (code) => { if (typeof code === 'number') this.exitCode = code; });
                stream.on('close', () => this.finish('exit'));
                this.state = 'ready';
                this.meta.readyAt = new Date().toISOString();
                this._status({ message: '已连接' });
            });
        });

        client.on('error', (err) => {
            if (this.state === 'closed') return;
            const level = err && err.level;
            if (level === 'client-authentication') {
                return this.finish('auth_failed', '认证失败：用户名、密码或私钥不正确');
            }
            if (level === 'client-timeout') {
                return this.finish('timeout', '连接超时：长时间未收到服务器响应');
            }
            if (this.state === 'ready') {
                return this.finish('network', `连接中断：${err.message}`);
            }
            this.finish('error', this.sshService.parseErrorMessage(err));
        });

        client.on('close', () => {
            if (this.state === 'closed') return;
            this.finish(this.state === 'ready' ? 'network' : 'error',
                this.state === 'ready' ? '连接已断开' : '连接被关闭');
        });

        this._startConnectTimer();
        try {
            client.connect(cfg);
        } catch (err) {
            this._clearConnectTimer();
            if (PASSPHRASE_ERROR_RE.test(err.message) && this.passphraseAttempts < MAX_PASSPHRASE_ATTEMPTS) {
                return this._askPassphraseAndRetry(cfg, err);
            }
            this._disposeClient();
            this.finish('error', `连接失败：${err.message}`);
        }
    }

    async _askPassphraseAndRetry(cfg, err) {
        this._disposeClient();
        this.passphraseAttempts++;
        const answers = await this.prompt({
            kind: 'passphrase',
            title: '私钥口令',
            instructions: this.passphraseAttempts > 1 ? '口令不正确，请重新输入' : '私钥已加密，请输入口令（不会保存）',
            fields: [{ label: '口令', echo: false }]
        });
        if (this.state === 'closed') return;
        if (!answers) return this.finish('user', '已取消登录');
        this.passphrase = answers[0] || '';
        this._connect(cfg);
    }

    _handleKeyboardInteractive(cfg, name, instructions, prompts, finish) {
        if (!prompts || prompts.length === 0) return finish([]);
        // 典型 PAM 密码提示：只有一个不回显的输入，且我们有密码 → 自动回答一次
        if (cfg.password && !this.kiPasswordUsed && prompts.length === 1 && !prompts[0].echo) {
            this.kiPasswordUsed = true;
            return finish([cfg.password]);
        }
        this.prompt({
            kind: 'keyboard-interactive',
            title: name || '身份验证',
            instructions: instructions || '',
            fields: prompts.map(p => ({ label: String(p.prompt || '').trim() || '输入', echo: !!p.echo }))
        }).then(answers => {
            if (!answers) {
                finish([]);
                this.finish('user', '已取消登录');
                return;
            }
            finish(answers);
        });
    }

    async _verifyHostKey(keyBlob) {
        if (!this.knownHosts) return true;
        const keyType = parseKeyType(keyBlob);
        const fingerprint = fingerprintOf(keyBlob);
        const known = this.knownHosts.get(this.host.ip, this.host.port);

        if (!known) {
            this.knownHosts.set(this.host.ip, this.host.port, keyType, fingerprint);
            this._notice(`首次连接，已记录主机指纹 ${keyType} ${fingerprint}`);
            return true;
        }
        if (known.fingerprint === fingerprint) return true;

        const answers = await this.prompt({
            kind: 'hostkey-changed',
            title: '主机指纹已变化',
            instructions: '该主机的 SSH 指纹与上次记录不一致。可能是主机重装或更换了密钥，也可能存在中间人攻击。确认来源可信后再继续。',
            details: {
                address: KnownHostsStore.keyOf(this.host.ip, this.host.port),
                oldKey: `${known.keyType} ${known.fingerprint}`,
                newKey: `${keyType} ${fingerprint}`,
                recordedAt: known.updatedAt || known.addedAt
            },
            fields: []
        });
        if (this.state === 'closed') return false;
        if (!answers) {
            this.finish('hostkey_rejected', '主机指纹不一致，已拒绝连接');
            return false;
        }
        this.knownHosts.set(this.host.ip, this.host.port, keyType, fingerprint);
        this._notice(`已更新主机指纹 ${keyType} ${fingerprint}`);
        return true;
    }

    /** 向渲染端发起输入提示；返回 answers 数组，取消时为 null */
    prompt(promptDef) {
        if (this.state === 'closed') return Promise.resolve(null);
        const id = crypto.randomUUID();
        // 等待用户输入期间不计入连接超时
        const hadTimer = !!this.connectTimer;
        this._clearConnectTimer();
        const prevState = this.state;
        return new Promise(resolve => {
            this.pendingPrompts.set(id, resolve);
            this.state = 'prompt';
            this._status({ prompt: { id, ...promptDef } });
        }).then(answers => {
            if (this.state === 'prompt') {
                this.state = prevState;
                this._status({ promptDone: id });
            }
            if (hadTimer && this.state === 'connecting') this._startConnectTimer();
            return answers;
        });
    }

    handlePromptResponse(promptId, answers) {
        const resolve = this.pendingPrompts.get(promptId);
        if (!resolve) return;
        this.pendingPrompts.delete(promptId);
        resolve(Array.isArray(answers) ? answers.map(a => String(a == null ? '' : a)) : null);
    }

    _startConnectTimer() {
        this._clearConnectTimer();
        this.connectTimer = this.timers.setTimeout(() => {
            this.connectTimer = null;
            if (this.state === 'connecting') {
                this.finish('timeout', '连接超时：无法在指定时间内连接到主机');
            }
        }, CONNECT_TIMEOUT_MS);
    }

    _clearConnectTimer() {
        if (this.connectTimer) {
            this.timers.clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
    }

    // ---------------- 输出合并与流控 ----------------

    _enqueue(buf) {
        if (this.state === 'closed' || !buf || buf.length === 0) return;
        const zmodem = this._scanZmodem(buf);
        if (zmodem) buf = zmodem.buf;
        if (buf.length > 0) {
            this.outQueue.push(buf);
            this.outQueueBytes += buf.length;
        }
        if (zmodem) {
            this._handleZmodem(zmodem.mode);
        } else if (this.outQueueBytes >= FLUSH_BYTES) {
            this._flush();
        } else if (this.outQueueBytes > 0 && !this.flushTimer) {
            this.flushTimer = this.timers.setTimeout(() => {
                this.flushTimer = null;
                this._flush();
            }, FLUSH_INTERVAL_MS);
        }
    }

    /**
     * 检测输出中的 ZMODEM 握手帧头并从输出中移除（否则屏幕上会出现 **B0100... 乱码）
     * @returns {{buf: Buffer, mode: 'rz'|'sz'}|null}
     */
    _scanZmodem(buf) {
        const prevTail = this.zmodemTail;
        const tailOfBuf = buf.subarray(Math.max(0, buf.length - ZMODEM_TAIL_BYTES)).toString('latin1');
        this.zmodemTail = (prevTail + tailOfBuf).slice(-ZMODEM_TAIL_BYTES);
        // 快速路径：帧头必含 ZDLE(0x18)，绝大多数输出不含该字节
        if (!buf.includes(0x18) && !prevTail.includes('\x18')) return null;

        const text = prevTail + buf.toString('latin1');
        const offset = prevTail.length;
        const ranges = [];
        let mode = null;
        ZMODEM_HEADER_RE.lastIndex = 0;
        let m;
        while ((m = ZMODEM_HEADER_RE.exec(text)) !== null) {
            const end = m.index + m[0].length;
            if (end <= offset) continue;                // 完全位于上一块，已处理过
            if (!mode) mode = m[1] === '1' ? 'rz' : 'sz';
            ranges.push([Math.max(0, m.index - offset), end - offset]);
        }
        if (!mode) return null;

        const parts = [];
        let pos = 0;
        for (const [start, end] of ranges) {
            if (start > pos) parts.push(buf.subarray(pos, start));
            pos = end;
        }
        if (pos < buf.length) parts.push(buf.subarray(pos));
        return { buf: parts.length === 1 ? parts[0] : Buffer.concat(parts), mode };
    }

    _handleZmodem(mode) {
        // 先把 "rz waiting to receive." 等前置输出推给渲染端，保证提示出现在其后
        this._flush();
        const now = this.now();
        if (now < this.zmodemCooldownUntil) return;
        this.zmodemCooldownUntil = now + ZMODEM_COOLDOWN_MS;
        if (this.state === 'ready' && this.stream) {
            try { this.stream.write(ZMODEM_CANCEL); } catch (e) { /* 连接可能已断开 */ }
        }
        this._status({ zmodem: mode });
    }

    _flush() {
        if (this.flushTimer) {
            this.timers.clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.outQueue.length === 0) return;
        const chunk = this.outQueue.length === 1 ? this.outQueue[0] : Buffer.concat(this.outQueue, this.outQueueBytes);
        this.outQueue = [];
        this.outQueueBytes = 0;
        this.meta.bytesOut += chunk.length;
        this.unacked += chunk.length;
        this.send('terminal:data', { sessionId: this.id, chunk });
        if (!this.paused && this.unacked > HIGH_WATER_BYTES && this.stream) {
            this.paused = true;
            this.stream.pause();
        }
    }

    ack(bytes) {
        const n = parseInt(bytes, 10);
        if (!Number.isFinite(n) || n <= 0) return;
        this.unacked = Math.max(0, this.unacked - n);
        if (this.paused && this.unacked < LOW_WATER_BYTES && this.stream) {
            this.paused = false;
            this.stream.resume();
        }
    }

    // ---------------- 输入 / 尺寸 ----------------

    write(data, binary = false) {
        if (this.state !== 'ready' || !this.stream || typeof data !== 'string') return;
        const buf = Buffer.from(data, binary ? 'binary' : 'utf8');
        this.meta.bytesIn += buf.length;
        this.stream.write(buf);
    }

    resize(cols, rows) {
        this.cols = clampInt(cols, 1, 1000, this.cols);
        this.rows = clampInt(rows, 1, 1000, this.rows);
        if (this.state === 'ready' && this.stream) {
            try {
                this.stream.setWindow(this.rows, this.cols, 0, 0);
            } catch (e) { /* 连接可能已断开 */ }
        }
    }

    // ---------------- 结束 ----------------

    _disposeClient() {
        const client = this.client;
        if (!client) return;
        this.client = null;
        try {
            client.removeAllListeners();
            // 防止 end() 之后 ssh2 再发出 error 变成未捕获异常
            client.on('error', () => {});
            client.end();
        } catch (e) { /* ignore */ }
    }

    /** 幂等：多次调用只生效一次 */
    finish(reason, message) {
        if (this.state === 'closed') return;
        this._flush();
        this._clearConnectTimer();
        this.state = 'closed';

        for (const resolve of this.pendingPrompts.values()) resolve(null);
        this.pendingPrompts.clear();

        if (this.stream) {
            try { this.stream.removeAllListeners(); } catch (e) { /* ignore */ }
            this.stream = null;
        }
        this._disposeClient();

        if (reason === 'exit' && !message) {
            message = this.exitCode !== null ? `会话已结束（退出码 ${this.exitCode}）` : '会话已结束';
        }
        this.meta.endedAt = new Date().toISOString();
        this.meta.reason = reason;
        this._status({ reason, message: message || '', exitCode: this.exitCode });
        this.onFinish(this);
    }
}

// ------------------------------------------------------------
// 会话管理器
// ------------------------------------------------------------
class TerminalSessionManager {
    /**
     * @param {Object} opts
     * @param {Function} opts.ClientClass - ssh2 Client
     * @param {Object} opts.sshService
     * @param {Function} opts.loadHost - async (hostId) => host | null
     * @param {KnownHostsStore} [opts.knownHosts]
     * @param {string} [opts.sessionLogPath]
     * @param {Function} [opts.getMaxSessions] - () => number
     * @param {Function} [opts.onSessionOpened]
     * @param {Function} [opts.onSessionClosed]
     */
    constructor(opts) {
        this.opts = opts;
        this.sessions = new Map();          // sessionId -> { session, ownerId }
        this.trackedOwners = new Set();     // 已挂载生命周期监听的 webContents.id
    }

    _maxSessions() {
        const n = this.opts.getMaxSessions ? this.opts.getMaxSessions() : 20;
        return clampInt(n, 1, 100, 20);
    }

    activeCount() {
        let n = 0;
        for (const { session } of this.sessions.values()) {
            if (session.state !== 'closed') n++;
        }
        return n;
    }

    _trackOwner(webContents) {
        const ownerId = webContents.id;
        if (this.trackedOwners.has(ownerId)) return;
        this.trackedOwners.add(ownerId);
        const cleanup = (reason) => this.closeAllFor(ownerId, reason);
        webContents.once('destroyed', () => {
            this.trackedOwners.delete(ownerId);
            cleanup('window-closed');
        });
        webContents.on('render-process-gone', () => cleanup('renderer-gone'));
        // 页面刷新/跳转（hash 变化属于 in-place，不清理）
        // Electron 25+ 在 event 上提供 isMainFrame/isSameDocument，旧的位置参数已废弃，两者都兼容
        webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
            const mainFrame = event && typeof event.isMainFrame === 'boolean' ? event.isMainFrame : isMainFrame;
            const sameDoc = event && typeof event.isSameDocument === 'boolean' ? event.isSameDocument : isInPlace;
            if (mainFrame && !sameDoc) cleanup('reload');
        });
    }

    async open(webContents, { hostId, cols, rows, promptPassword } = {}) {
        if (this.activeCount() >= this._maxSessions()) {
            return { success: false, message: `终端会话数已达上限（${this._maxSessions()}），请先关闭部分标签` };
        }
        const host = await this.opts.loadHost(hostId);
        if (!host) return { success: false, message: '主机不存在或已被删除' };
        if (!host.ip || !host.username) return { success: false, message: '主机缺少 IP 或用户名' };

        this._trackOwner(webContents);
        const id = crypto.randomUUID();
        const send = (channel, payload) => {
            if (!webContents.isDestroyed()) webContents.send(channel, payload);
        };
        const session = new TerminalSession({
            id,
            host,
            send,
            ClientClass: this.opts.ClientClass,
            sshService: this.opts.sshService,
            knownHosts: this.opts.knownHosts,
            promptPassword,
            timers: this.opts.timers,
            onFinish: (s) => this._onFinish(s)
        });
        this.sessions.set(id, { session, ownerId: webContents.id });
        if (this.opts.onSessionOpened) this.opts.onSessionOpened(session);
        // 连接过程异步进行，进度通过 terminal:status 推送
        session.start({ cols, rows }).catch(err => session.finish('error', err.message));
        return { success: true, sessionId: id };
    }

    _onFinish(session) {
        if (!this.sessions.has(session.id)) return;
        this.sessions.delete(session.id);
        appendSessionLog(this.opts.sessionLogPath, session.meta);
        if (this.opts.onSessionClosed) this.opts.onSessionClosed(session);
        console.log(`[终端] 会话结束 ${session.label} 原因=${session.meta.reason} 输出=${session.meta.bytesOut}B`);
    }

    /** 取会话并校验归属，防止其他窗口操作 */
    get(sender, sessionId) {
        const entry = this.sessions.get(sessionId);
        if (!entry || !sender || entry.ownerId !== sender.id) return null;
        return entry.session;
    }

    close(sender, sessionId) {
        const s = this.get(sender, sessionId);
        if (s) s.finish('user', '已关闭');
        return !!s;
    }

    closeAllFor(ownerId, reason = 'window-closed') {
        for (const { session, ownerId: oid } of Array.from(this.sessions.values())) {
            if (oid === ownerId) session.finish(reason, '窗口已关闭');
        }
    }

    closeAll(reason = 'app-quit') {
        for (const { session } of Array.from(this.sessions.values())) {
            session.finish(reason, '应用退出');
        }
    }

    list(sender) {
        const out = [];
        for (const { session, ownerId } of this.sessions.values()) {
            if (sender && ownerId === sender.id) {
                out.push({ sessionId: session.id, hostId: session.host.id, state: session.state, label: session.label });
            }
        }
        return out;
    }
}

module.exports = {
    TerminalSession,
    TerminalSessionManager,
    KnownHostsStore,
    fingerprintOf,
    parseKeyType,
    appendSessionLog,
    constants: { FLUSH_INTERVAL_MS, FLUSH_BYTES, HIGH_WATER_BYTES, LOW_WATER_BYTES, CONNECT_TIMEOUT_MS }
};
