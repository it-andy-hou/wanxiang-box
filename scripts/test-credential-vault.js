// 主机密码加密存储冒烟测试（mock electron safeStorage + 临时数据目录，不污染真实数据）
// 用法：node scripts/test-credential-vault.js
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const assert = require('assert');

// mock safeStorage：可逆变换 + 机器标识，模拟“换机器无法解密”
let machine = 'A';
let available = true;
const mockSafeStorage = {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(machine + '|' + Buffer.from(s, 'utf8').toString('hex'), 'utf8'),
    decryptString: (buf) => {
        const [m, hex] = buf.toString('utf8').split('|');
        if (m !== machine) throw new Error('Error while decrypting the ciphertext');
        return Buffer.from(hex, 'hex').toString('utf8');
    }
};

const tmpDir = path.join(os.tmpdir(), 'vault-test-' + Date.now());
const origLoad = Module._load;
Module._load = function (request) {
    if (request === 'electron') {
        return { app: { getPath: () => tmpDir }, safeStorage: mockSafeStorage };
    }
    return origLoad.apply(this, arguments);
};

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); }

(async () => {
    const sdb = require('../src/database/simple-db');
    await sdb.initDatabase();
    const db = sdb.getDatabase();
    const { HostModel } = require('../src/database/models');
    const vault = require('../src/database/credentialVault');

    console.log('[1] 新建主机：库内密文，读取明文');
    const created = await HostModel.create({ hostname: 'h1', ip: '10.0.0.1', username: 'root', password: 'P@ss w0rd' });
    ok(created.password === 'P@ss w0rd', 'create 返回明文密码');
    const raw1 = db.findById('hosts', created.id);
    ok(vault.isEncrypted(raw1.password) && !raw1.password.includes('P@ss'), '库内为 enc:v1: 密文');
    const read1 = await HostModel.findById(created.id);
    ok(read1.password === 'P@ss w0rd' && read1.password_unreadable === false, 'findById 解密成功');

    console.log('[2] 更新密码 / 不传密码');
    await HostModel.update(created.id, { password: 'new-pass' });
    ok((await HostModel.findById(created.id)).password === 'new-pass', '更新后读取为新密码');
    const before = db.findById('hosts', created.id).password;
    await HostModel.update(created.id, { description: 'x' });
    ok(db.findById('hosts', created.id).password === before, '未传 password 时密文不变');

    console.log('[3] 旧版明文迁移');
    db.getTable('hosts').push({ id: 99, hostname: 'legacy', ip: '10.0.0.9', username: 'root', password: 'legacy-pw', tags: '[]' });
    db.getTable('hosts').push({ id: 100, hostname: 'nopw', ip: '10.0.0.10', username: 'root', password: '', tags: '[]' });
    ok((await HostModel.findById(99)).password === 'legacy-pw', '迁移前明文可直接读取');
    const n = await HostModel.encryptLegacyPasswords();
    ok(n === 1, '仅迁移 1 条非空明文');
    ok(vault.isEncrypted(db.findById('hosts', 99).password), '迁移后为密文');
    ok(db.findById('hosts', 100).password === '', '空密码保持为空');
    ok((await HostModel.findById(99)).password === 'legacy-pw', '迁移后解密一致');
    ok(await HostModel.encryptLegacyPasswords() === 0, '重复迁移幂等');

    console.log('[4] 换机器：无法解密');
    machine = 'B';
    const read4 = await HostModel.findById(99);
    ok(read4.password === '' && read4.password_unreadable === true, '无法解密时返回空串并标记');
    ok(HostModel.countUndecryptablePasswords() === 2, '统计到 2 条无法解密的密码');
    const cipherA = db.findById('hosts', 99).password;
    await HostModel.update(99, { password: '', description: 'edited' });
    ok(db.findById('hosts', 99).password === cipherA, '回传空串不覆盖无法解密的原密文');
    await HostModel.update(99, { password: 'typed-on-B' });
    ok((await HostModel.findById(99)).password === 'typed-on-B', '重新填写后可在本机解密');
    machine = 'A';

    console.log('[5] safeStorage 不可用：降级明文');
    available = false;
    ok(vault.encryptSecret('plain') === 'plain', '加密不可用时返回明文');
    ok(await HostModel.encryptLegacyPasswords() === 0, '加密不可用时跳过迁移');
    available = true;

    console.log(`\n全部通过：${passed} 项`);
    process.exit(0);
})().catch(e => { console.error('测试失败:', e); process.exit(1); });
