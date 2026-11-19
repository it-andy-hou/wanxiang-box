// 远端进程终止冒烟测试：用本地 sh 模拟 sshd exec 通道（detached = setsid，与 sshd 行为一致）
// 验证停止 / 超时时脚本及其子进程被整组终止、临时文件被清理。
// 用法：node scripts/test-remote-terminate.js
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const assert = require('assert');

const origLoad = Module._load;
Module._load = function (request) {
    if (request === 'electron') return { app: { getPath: () => path.join(os.tmpdir(), 'term-test') } };
    return origLoad.apply(this, arguments);
};

// 模拟 node-ssh 连接：每次 execCommand 开一个独立会话（setsid）执行 sh -c
function fakeConnection() {
    return {
        execCommand(command, options = {}) {
            const full = options.cwd ? `cd '${options.cwd}' ; ${command}` : command;
            return new Promise((resolve) => {
                const p = spawn('sh', ['-c', full], { detached: true });
                let stdout = '', stderr = '';
                p.stdout.on('data', d => { stdout += d; });
                p.stderr.on('data', d => { stderr += d; });
                p.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
            });
        },
        dispose: async () => {}
    };
}

// 脚本把子进程 PID 写入文件，用 kill(pid, 0) 判断存活（不依赖 ps）
function pids(file) {
    try { return fs.readFileSync(file, 'utf8').split(/\s+/).filter(Boolean).map(Number); } catch (_) { return []; }
}
function anyAlive(file) {
    return pids(file).some(pid => { try { process.kill(pid, 0); return true; } catch (_) { return false; } });
}
function allAlive(file) {
    const list = pids(file);
    return list.length === 2 && list.every(pid => { try { process.kill(pid, 0); return true; } catch (_) { return false; } });
}
const mkScript = (f) => `rm -f ${f}\nsleep 300 &\necho $! >> ${f}\nbash -c 'echo $$ >> ${f}; sleep 300'\necho done`;
const pidFile1 = path.join(os.tmpdir(), 'wx-term-1.pids');
const pidFile2 = path.join(os.tmpdir(), 'wx-term-2.pids');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); }

(async () => {
    const { SSHService } = require('../src/main/sshService');
    const ssh = new SSHService();
    const silent = console.log; console.log = () => {};
    const restore = () => { console.log = silent; };


    // [1] 用户停止：执行中途调用 terminateRemoteProcess
    const conn1 = fakeConnection();
    const p1 = ssh.executeScript({ ip: 'local' }, mkScript(pidFile1), { connection: conn1, timeout: 60000 });
    await new Promise(r => setTimeout(r, 1500));
    restore();
    console.log('[1] 停止任务');
    ok(allAlive(pidFile1), '执行中：前台与后台子进程都在运行');
    const proc1 = { ...conn1._wxRemoteProc };
    ok(proc1.pidPath && fs.existsSync(proc1.pidPath), '已写入 pid 文件');
    console.log = () => {};
    const sent = await ssh.terminateRemoteProcess(conn1);
    const r1 = await p1;
    restore();
    ok(sent === true, '发出终止命令');
    ok(!anyAlive(pidFile1), '整个进程组已退出（含后台子进程）');
    ok(!fs.existsSync(proc1.pidPath) && !fs.existsSync(proc1.scriptPath), '临时脚本与 pid 文件已清理');
    ok(r1.success === false, '执行结果为失败');
    ok(await ssh.terminateRemoteProcess(conn1) === false, '重复调用为空操作');

    // [2] 超时：executeScript 内部自动终止
    console.log('[2] 执行超时');
    const conn2 = fakeConnection();
    console.log = () => {};
    const r2 = await ssh.executeScript({ ip: 'local' }, mkScript(pidFile2), { connection: conn2, timeout: 2000 });
    restore();
    ok(r2.success === false && /超时/.test(r2.error), '返回超时错误');
    ok(pids(pidFile2).length === 2 && !anyAlive(pidFile2), '超时后远端进程组已终止');

    // [3] 正常结束：不残留登记、文件已清理
    console.log('[3] 正常执行');
    const conn3 = fakeConnection();
    console.log = () => {};
    const r3 = await ssh.executeScript({ ip: 'local' }, 'echo hello', { connection: conn3, timeout: 10000 });
    restore();
    ok(r3.success === true && r3.stdout.trim() === 'hello', '输出与退出码正常');
    ok(conn3._wxRemoteProc === null, '结束后清除进程登记');

    console.log(`\n全部通过：${passed} 项`);
    process.exit(0);
})().catch(e => { console.log = console.info; console.error('测试失败:', e); process.exit(1); });
