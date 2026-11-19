// 远程终端会话测试：在本机回环地址启动 ssh2 Server，端到端验证 TerminalSessionManager
// 覆盖：密码/键盘交互/临时密码认证、PTY 尺寸与 resize、输出合并、流控、退出码、
//       主机指纹 TOFU、认证失败、窗口销毁清理、会话上限
// 用法：node scripts/test-terminal-session.js
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { EventEmitter } = require('events');
const { Server, Client, utils } = require('ssh2');
const { SSHService } = require('../src/main/sshService');
const {
    TerminalSessionManager, KnownHostsStore, fingerprintOf, parseKeyType, constants
} = require('../src/main/terminalService');

let passed = 0;
function ok(cond, name) {
    assert.ok(cond, name);
    passed++;
    console.info(`  ✓ ${name}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-term-test-'));
const BIG_BYTES = 6 * 1024 * 1024;

// ---------------- 测试用 SSH 服务器 ----------------
function startServer(hostKeyPem) {
    const serverState = { ptys: [], windowChanges: [] };
    const server = new Server({ hostKeys: [hostKeyPem] }, (conn) => {
        conn.on('error', () => {});
        conn.on('authentication', (ctx) => {
            if (ctx.username === 'u' && ctx.method === 'password') {
                return ctx.password === 'pw' ? ctx.accept() : ctx.reject();
            }
            if (ctx.username === 'otp') {
                if (ctx.method !== 'keyboard-interactive') return ctx.reject(['keyboard-interactive']);
                return ctx.prompt([{ prompt: '验证码: ', echo: true }], '二次验证', '请输入动态验证码', (answers) => {
                    answers[0] === '123456' ? ctx.accept() : ctx.reject();
                });
            }
            ctx.reject(['password', 'keyboard-interactive']);
        });
        conn.on('ready', () => {
            conn.on('session', (accept) => {
                const session = accept();
                session.on('pty', (acceptPty, reject, info) => {
                    serverState.ptys.push({ cols: info.cols, rows: info.rows, term: info.term });
                    acceptPty && acceptPty();
                });
                session.on('window-change', (acceptWc, reject, info) => {
                    serverState.windowChanges.push({ cols: info.cols, rows: info.rows });
                    acceptWc && acceptWc();
                });
                session.on('shell', (acceptShell) => {
                    const stream = acceptShell();
                    stream.write('welcome\r\n');
                    let line = '';
                    stream.on('data', (d) => {
                        // 模拟 lrzsz：收到连续 5 个 CAN 即取消传输并回到 shell
                        if (d.toString('latin1').includes('\x18'.repeat(5))) {
                            serverState.zmodemCancels = (serverState.zmodemCancels || 0) + 1;
                            line = '';
                            stream.write('\r\nCANCELLED\r\n');
                            return;
                        }
                        line += d.toString('utf8');
                        if (!line.includes('\r')) return;
                        const cmd = line.split('\r')[0];
                        line = '';
                        if (cmd === 'exit') {
                            stream.exit(3);
                            stream.end();
                        } else if (cmd === 'big') {
                            writeBig(stream, BIG_BYTES);
                        } else if (cmd === 'rz') {
                            stream.write(Buffer.from('rz waiting to receive.**\x18B0100000023be50\r\x8a\x11', 'latin1'));
                        } else if (cmd === 'sz') {
                            // 帧头跨两个数据块到达
                            stream.write(Buffer.from('rz\r**\x18B00', 'latin1'));
                            setTimeout(() => stream.write(Buffer.from('000000000000\r\x8a\x11', 'latin1')), 30);
                        } else if (cmd === 'burst') {
                            for (let i = 0; i < 50; i++) stream.write(`b${i} `);
                        } else {
                            stream.write(`echo:${cmd}\r\n`);
                        }
                    });
                });
            });
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, serverState }));
    });
}

// 按背压写出大量数据：模拟误 cat 大文件
function writeBig(stream, total) {
    const chunk = Buffer.alloc(32 * 1024, 'x');
    let sent = 0;
    const pump = () => {
        while (sent < total) {
            sent += chunk.length;
            if (!stream.write(chunk)) return stream.once('drain', pump);
        }
        stream.write('\r\nBIG-END\r\n');
    };
    pump();
}

// ---------------- 测试替身：渲染进程 webContents ----------------
let wcSeq = 1;
function fakeWebContents() {
    const wc = new EventEmitter();
    wc.id = wcSeq++;
    wc.destroyed = false;
    wc.isDestroyed = () => wc.destroyed;
    wc.messages = [];
    wc.send = (channel, payload) => {
        wc.messages.push({ channel, payload });
        wc.emit('msg', channel, payload);
    };
    return wc;
}

function waitFor(wc, predicate, timeoutMs = 8000, label = '') {
    return new Promise((resolve, reject) => {
        for (const m of wc.messages) if (predicate(m.channel, m.payload)) return resolve(m.payload);
        const t = setTimeout(() => {
            wc.off('msg', handler);
            reject(new Error(`等待超时: ${label}`));
        }, timeoutMs);
        const handler = (channel, payload) => {
            if (predicate(channel, payload)) {
                clearTimeout(t);
                wc.off('msg', handler);
                resolve(payload);
            }
        };
        wc.on('msg', handler);
    });
}
const statusIs = (sid, state) => (ch, p) => ch === 'terminal:status' && p.sessionId === sid && p.state === state && !p.prompt && !p.notice;
const promptOf = (sid) => (ch, p) => ch === 'terminal:status' && p.sessionId === sid && p.prompt;
const outputText = (wc, sid) => Buffer.concat(wc.messages
    .filter(m => m.channel === 'terminal:data' && m.payload.sessionId === sid)
    .map(m => Buffer.from(m.payload.chunk))).toString('utf8');
const dataContains = (wc, sid, text) => () => outputText(wc, sid).includes(text);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    console.info('[0] 指纹工具函数');
    const keyBlob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.alloc(36, 1)]);
    ok(parseKeyType(keyBlob) === 'ssh-ed25519', '解析公钥类型');
    ok(/^SHA256:[A-Za-z0-9+/]+$/.test(fingerprintOf(keyBlob)), '指纹为 OpenSSH SHA256 格式且无填充');

    const hostKey = utils.generateKeyPairSync('ed25519');
    const { server, port, serverState } = await startServer(hostKey.private);

    const hosts = {
        1: { id: 1, ip: '127.0.0.1', port, username: 'u', password: 'pw' },
        2: { id: 2, ip: '127.0.0.1', port, username: 'u', password: 'wrong' },
        3: { id: 3, ip: '127.0.0.1', port, username: 'u', password: '' },
        4: { id: 4, ip: '127.0.0.1', port, username: 'otp', password: '' },
        5: { id: 5, ip: '127.0.0.1', port, username: 'u', password: 'x', password_unreadable: true }
    };
    const knownHostsPath = path.join(tmpDir, 'known_hosts.json');
    const sessionLogPath = path.join(tmpDir, 'sessions.jsonl');
    const knownHosts = new KnownHostsStore(knownHostsPath);
    let opened = 0, closed = 0, maxSessions = 20;
    const manager = new TerminalSessionManager({
        ClientClass: Client,
        sshService: new SSHService(),
        loadHost: async (id) => hosts[id] || null,
        knownHosts,
        sessionLogPath,
        getMaxSessions: () => maxSessions,
        onSessionOpened: () => opened++,
        onSessionClosed: () => closed++
    });
    const origLog = console.log;
    console.log = () => {}; // 静默会话结束日志

    // [1] 密码登录、PTY 尺寸、输入回显、resize
    console.info('[1] 密码登录与基本交互');
    const wc = fakeWebContents();
    const r1 = await manager.open(wc, { hostId: 1, cols: 100, rows: 30 });
    ok(r1.success && typeof r1.sessionId === 'string', 'open 返回 sessionId');
    const sid = r1.sessionId;
    const notice = await waitFor(wc, (ch, p) => ch === 'terminal:status' && p.sessionId === sid && p.notice, 8000, '指纹记录提示');
    ok(/首次连接，已记录主机指纹 ssh-ed25519 SHA256:/.test(notice.notice), '首次连接记录指纹并提示');
    await waitFor(wc, statusIs(sid, 'ready'), 8000, 'ready');
    ok(serverState.ptys[0].cols === 100 && serverState.ptys[0].rows === 30, 'PTY 尺寸为 100×30');
    ok(serverState.ptys[0].term === 'xterm-256color', 'TERM=xterm-256color');
    const s1 = manager.get(wc, sid);
    s1.write('hello 中文\r');
    await waitFor(wc, dataContains(wc, sid, 'echo:hello 中文'), 5000, '回显');
    ok(true, '输入经 shell 回显，中文 UTF-8 正确');
    s1.resize(120, 40);
    await sleep(200);
    const wcLast = serverState.windowChanges[serverState.windowChanges.length - 1];
    ok(wcLast && wcLast.cols === 120 && wcLast.rows === 40, 'resize 触发远端 window-change 120×40');
    ok(manager.get(fakeWebContents(), sid) === null, '其他窗口无法获取该会话');

    // [2] 输出合并
    console.info('[2] 输出合并');
    const before = wc.messages.filter(m => m.channel === 'terminal:data').length;
    s1.write('burst\r');
    await waitFor(wc, dataContains(wc, sid, 'b49 '), 5000, 'burst');
    await sleep(50);
    const burstMsgs = wc.messages.filter(m => m.channel === 'terminal:data').length - before;
    ok(burstMsgs < 10, `50 次小写入合并为 ${burstMsgs} 条 IPC 消息`);

    // [2b] ZMODEM：检测 rz/sz 握手后自动取消并提示
    console.info('[2b] rz/sz 自动取消');
    const zmodemStatus = (mode) => (ch, p) => ch === 'terminal:status' && p.sessionId === sid && p.zmodem === mode;
    s1.write('rz\r');
    await waitFor(wc, zmodemStatus('rz'), 5000, 'rz 提示');
    await waitFor(wc, dataContains(wc, sid, 'CANCELLED'), 5000, 'rz 取消');
    ok(serverState.zmodemCancels === 1, 'rz：检测到 ZRINIT 后自动发送取消序列');
    ok(outputText(wc, sid).includes('rz waiting to receive.'), 'rz：保留前置提示文字');
    ok(!outputText(wc, sid).includes('**\x18B01'), 'rz：握手帧头不显示为乱码');

    s1.zmodemCooldownUntil = 0;
    s1.write('sz\r');
    await waitFor(wc, zmodemStatus('sz'), 5000, 'sz 提示');
    await waitFor(wc, () => serverState.zmodemCancels === 2, 5000, 'sz 取消');
    ok(serverState.zmodemCancels === 2, 'sz：帧头跨数据块时也能识别并取消');
    ok(!/000000000000\r/.test(outputText(wc, sid)), 'sz：后半段帧头被移除');

    // 冷却期内远端重发握手：只清理，不重复取消/提示
    const zBefore = wc.messages.filter(m => m.channel === 'terminal:status' && m.payload.zmodem).length;
    s1.write('rz\r');
    await sleep(300);
    const zAfter = wc.messages.filter(m => m.channel === 'terminal:status' && m.payload.zmodem).length;
    ok(zAfter === zBefore && serverState.zmodemCancels === 2, '冷却期内不重复取消和提示');
    s1.zmodemCooldownUntil = 0;

    // [3] 流控：不 ack 时暂停，ack 后恢复并收齐
    console.info('[3] 流控');
    s1.ack(s1.unacked); // 清零之前的未确认量
    s1.write('big\r');
    await sleep(1500);
    const receivedWhilePaused = s1.meta.bytesOut;
    ok(s1.paused === true, '未确认字节超过高水位后暂停远端输出');
    ok(s1.unacked <= constants.HIGH_WATER_BYTES + 512 * 1024, `暂停时未确认字节受控（${(s1.unacked / 1048576).toFixed(2)}MB）`);
    await sleep(500);
    ok(s1.meta.bytesOut - receivedWhilePaused < 256 * 1024, '暂停期间不再持续接收');
    // 模拟渲染端逐步确认
    const acker = setInterval(() => s1.ack(s1.unacked), 10);
    await waitFor(wc, dataContains(wc, sid, 'BIG-END'), 20000, 'BIG-END');
    clearInterval(acker);
    ok(s1.meta.bytesOut >= BIG_BYTES, `ack 后恢复并收齐全部输出（${(s1.meta.bytesOut / 1048576).toFixed(1)}MB）`);

    // [4] 远端退出码
    console.info('[4] 远端 exit');
    s1.write('exit\r');
    const closedStatus = await waitFor(wc, statusIs(sid, 'closed'), 5000, 'closed');
    ok(closedStatus.reason === 'exit' && closedStatus.exitCode === 3, '会话结束原因为 exit，退出码 3');
    ok(manager.get(wc, sid) === null, '结束后从管理器移除');
    const logLines = fs.readFileSync(sessionLogPath, 'utf8').trim().split('\n');
    const rec = JSON.parse(logLines[logLines.length - 1]);
    ok(rec.sessionId === sid && rec.reason === 'exit' && rec.bytesIn > 0 && !('password' in rec), '会话元数据已记录且不含凭据');
    const logText = fs.readFileSync(sessionLogPath, 'utf8');
    ok(!logText.includes('hello'), '会话记录不包含输入内容');

    // [5] 认证失败
    console.info('[5] 认证失败');
    const r5 = await manager.open(wc, { hostId: 2, cols: 80, rows: 24 });
    const st5 = await waitFor(wc, statusIs(r5.sessionId, 'closed'), 8000, 'auth closed');
    ok(st5.reason === 'auth_failed', '错误密码 → auth_failed');

    // [6] 未保存密码 → 提示输入；取消 → user
    console.info('[6] 临时密码输入');
    const r6 = await manager.open(wc, { hostId: 3, cols: 80, rows: 24 });
    const p6 = (await waitFor(wc, promptOf(r6.sessionId), 5000, 'password prompt')).prompt;
    ok(p6.kind === 'password' && p6.fields.length === 1 && p6.fields[0].echo === false, '未保存密码时弹出密码输入');
    manager.get(wc, r6.sessionId).handlePromptResponse(p6.id, ['pw']);
    await waitFor(wc, statusIs(r6.sessionId, 'ready'), 8000, 'r6 ready');
    ok(true, '输入密码后登录成功');
    manager.close(wc, r6.sessionId);

    const r6b = await manager.open(wc, { hostId: 5, cols: 80, rows: 24 });
    const p6b = (await waitFor(wc, promptOf(r6b.sessionId), 5000, 'unreadable prompt')).prompt;
    ok(/无法在本机解密/.test(p6b.instructions), 'password_unreadable 时提示临时输入');
    manager.get(wc, r6b.sessionId).handlePromptResponse(p6b.id, null);
    const st6b = await waitFor(wc, statusIs(r6b.sessionId, 'closed'), 5000, 'cancel closed');
    ok(st6b.reason === 'user', '取消输入 → 会话关闭');

    const r6c = await manager.open(wc, { hostId: 1, cols: 80, rows: 24, promptPassword: true });
    const p6c = (await waitFor(wc, promptOf(r6c.sessionId), 5000, 'force prompt')).prompt;
    ok(p6c.kind === 'password', 'promptPassword=true 时忽略已存密码并询问');
    manager.get(wc, r6c.sessionId).handlePromptResponse(p6c.id, null);
    await waitFor(wc, statusIs(r6c.sessionId, 'closed'), 5000, 'r6c closed');

    // [7] 键盘交互（OTP）
    console.info('[7] keyboard-interactive');
    const r7 = await manager.open(wc, { hostId: 4, cols: 80, rows: 24 });
    // otp 用户没有密码，先弹密码框；空密码提交后进入 keyboard-interactive
    const p7a = (await waitFor(wc, promptOf(r7.sessionId), 5000, 'otp pw prompt')).prompt;
    manager.get(wc, r7.sessionId).handlePromptResponse(p7a.id, ['']);
    const p7 = (await waitFor(wc, (ch, p) => promptOf(r7.sessionId)(ch, p) && p.prompt.kind === 'keyboard-interactive', 8000, 'otp prompt')).prompt;
    ok(p7.title === '二次验证' && p7.fields[0].label === '验证码:' && p7.fields[0].echo === true, '服务器提示透传到渲染端');
    manager.get(wc, r7.sessionId).handlePromptResponse(p7.id, ['123456']);
    await waitFor(wc, statusIs(r7.sessionId, 'ready'), 8000, 'otp ready');
    ok(true, '验证码正确后登录成功');

    // [8] 窗口销毁 → 清理该窗口所有会话
    console.info('[8] 窗口销毁清理');
    wc.destroyed = true;
    wc.emit('destroyed');
    await sleep(100);
    ok(manager.activeCount() === 0, '窗口销毁后无残留会话');
    ok(opened === closed, `打开/关闭计数一致（${opened}/${closed}）`);

    // [9] 主机指纹变化
    console.info('[9] 主机指纹变化');
    const store = JSON.parse(fs.readFileSync(knownHostsPath, 'utf8'));
    const k = `127.0.0.1:${port}`;
    ok(store[k] && store[k].keyType === 'ssh-ed25519', '指纹已持久化到 known_hosts.json');
    store[k].fingerprint = 'SHA256:tampered';
    fs.writeFileSync(knownHostsPath, JSON.stringify(store));
    knownHosts.entries = null; // 重新加载

    const wc2 = fakeWebContents();
    const r9 = await manager.open(wc2, { hostId: 1, cols: 80, rows: 24 });
    const p9 = (await waitFor(wc2, promptOf(r9.sessionId), 8000, 'hostkey prompt')).prompt;
    ok(p9.kind === 'hostkey-changed' && p9.details.oldKey.includes('tampered'), '指纹不一致时阻断并询问');
    manager.get(wc2, r9.sessionId).handlePromptResponse(p9.id, null);
    const st9 = await waitFor(wc2, statusIs(r9.sessionId, 'closed'), 5000, 'hostkey reject');
    ok(st9.reason === 'hostkey_rejected', '拒绝后不建立会话');

    const r9b = await manager.open(wc2, { hostId: 1, cols: 80, rows: 24 });
    const p9b = (await waitFor(wc2, promptOf(r9b.sessionId), 8000, 'hostkey prompt 2')).prompt;
    manager.get(wc2, r9b.sessionId).handlePromptResponse(p9b.id, []);
    await waitFor(wc2, statusIs(r9b.sessionId, 'ready'), 8000, 'hostkey accept ready');
    ok(JSON.parse(fs.readFileSync(knownHostsPath, 'utf8'))[k].fingerprint !== 'SHA256:tampered', '接受后更新指纹并登录');

    // [10] 会话上限
    console.info('[10] 会话上限');
    maxSessions = 1;
    const r10 = await manager.open(wc2, { hostId: 1, cols: 80, rows: 24 });
    ok(r10.success === false && /上限/.test(r10.message), '超过上限时拒绝新会话');
    maxSessions = 20;
    const r10b = await manager.open(wc2, { hostId: 999 });
    ok(r10b.success === false && /不存在/.test(r10b.message), '主机不存在时返回错误');

    // [11] closeAll + finish 幂等
    console.info('[11] 退出清理');
    const s9b = manager.get(wc2, r9b.sessionId);
    manager.closeAll('app-quit');
    s9b.finish('error', 'again');
    const closes = wc2.messages.filter(m => m.channel === 'terminal:status' && m.payload.sessionId === r9b.sessionId && m.payload.state === 'closed');
    ok(closes.length === 1 && closes[0].payload.reason === 'app-quit', 'finish 幂等：只推送一次 closed');
    ok(manager.activeCount() === 0, 'closeAll 后无活跃会话');

    console.log = origLog;
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.info(`\n全部通过：${passed} 项`);
    process.exit(0);
})().catch(e => {
    console.log = console.info;
    console.error('测试失败:', e);
    process.exit(1);
});
