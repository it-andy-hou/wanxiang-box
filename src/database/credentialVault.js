// 凭据加密存储：基于 Electron safeStorage（macOS 钥匙串 / Windows DPAPI / Linux libsecret）
// 存储格式：'enc:v1:' + base64(密文)。不带前缀的值视为旧版明文，读取时原样返回，启动时批量迁移。
// safeStorage 不可用（非 Electron 环境、Linux 无钥匙串）时降级为明文存储，与 AI Key 策略一致。

const PREFIX = 'enc:v1:';

let _safeStorage = null; // null = 未探测；false = 不可用

function getSafeStorage() {
    if (_safeStorage !== null) return _safeStorage;
    try {
        const { safeStorage } = require('electron');
        _safeStorage = (safeStorage && typeof safeStorage.encryptString === 'function') ? safeStorage : false;
    } catch (e) {
        _safeStorage = false;
    }
    return _safeStorage;
}

/** 测试注入用：传入 mock 对象或 false */
function _setSafeStorageForTest(mock) {
    _safeStorage = mock;
}

function isEncryptionAvailable() {
    const ss = getSafeStorage();
    if (!ss) return false;
    try {
        return !!ss.isEncryptionAvailable();
    } catch (e) {
        return false;
    }
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * 加密明文。空值、已加密值原样返回；加密不可用时返回明文（降级）。
 */
function encryptSecret(plain) {
    if (plain === undefined || plain === null) return plain;
    const text = String(plain);
    if (text === '' || isEncrypted(text)) return text;
    if (!isEncryptionAvailable()) return text;
    return PREFIX + getSafeStorage().encryptString(text).toString('base64');
}

/**
 * 解密。返回 { ok, value }：
 * - 明文 / 空值：ok=true，value 原样
 * - 密文解密成功：ok=true，value 为明文
 * - 密文无法解密（换了机器、钥匙串不可用）：ok=false，value=''
 */
function decryptSecret(stored) {
    if (!isEncrypted(stored)) {
        return { ok: true, value: stored === undefined || stored === null ? '' : String(stored) };
    }
    if (!isEncryptionAvailable()) return { ok: false, value: '' };
    try {
        const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
        return { ok: true, value: getSafeStorage().decryptString(buf) };
    } catch (e) {
        return { ok: false, value: '' };
    }
}

module.exports = {
    encryptSecret,
    decryptSecret,
    isEncrypted,
    isEncryptionAvailable,
    _setSafeStorageForTest
};
