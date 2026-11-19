#!/usr/bin/env node
/**
 * 下载终端内置字体 Maple Mono NL CN（Regular + Bold）到 src/renderer/assets/fonts/maple-mono-cn/files/
 *
 * 用法：
 *   node scripts/fetch-terminal-font.js
 *   # 国内网络可通过镜像前缀加速下载 GitHub Release，例如：
 *   MAPLE_FONT_MIRROR=https://ghfast.top/ node scripts/fetch-terminal-font.js
 *
 * 说明：
 *   - 下载官方 Release 的 MapleMonoNL-CN.zip（约 140MB，含全部字重），只解压 Regular 与 Bold
 *   - 用官方 .sha256 校验压缩包
 *   - 本机装有 Python fontTools + brotli（pip install fonttools brotli）时转成 woff2（体积约减半），否则保留 ttf
 *   - 下载完成后请把 files/ 下的字体文件提交到仓库，CI 打包无需再下载
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = 'v7.9';
const ASSET = 'MapleMonoNL-CN.zip';
const BASE = `https://github.com/subframe7536/maple-font/releases/download/${VERSION}/`;
const MIRROR = process.env.MAPLE_FONT_MIRROR || '';
const OUT_DIR = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'fonts', 'maple-mono-cn', 'files');
const WANT = [
    { re: /(^|\/)MapleMonoNL-CN-Regular\.ttf$/, name: 'MapleMonoNL-CN-Regular.ttf' },
    { re: /(^|\/)MapleMonoNL-CN-Bold\.ttf$/, name: 'MapleMonoNL-CN-Bold.ttf' }
];
const LICENSE_RE = /(^|\/)(OFL|LICENSE)(\.txt)?$/i;

function url(file) {
    return MIRROR + BASE + file;
}

function download(src, dest, redirects = 0) {
    return new Promise((resolve, reject) => {
        const req = https.get(src, { headers: { 'User-Agent': 'ssh-tools-box-font-fetch' } }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.resume();
                if (redirects > 5) return reject(new Error('重定向次数过多'));
                const next = new URL(res.headers.location, src).toString();
                return resolve(download(next, dest, redirects + 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`下载失败 HTTP ${res.statusCode}: ${src}`));
            }
            const total = parseInt(res.headers['content-length'] || '0', 10);
            let got = 0;
            let lastPct = -1;
            const file = fs.createWriteStream(dest);
            res.on('data', (chunk) => {
                got += chunk.length;
                if (total) {
                    const pct = Math.floor((got / total) * 100);
                    if (pct !== lastPct && pct % 5 === 0) {
                        lastPct = pct;
                        process.stdout.write(`\r  ${pct}%  ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
                    }
                }
            });
            res.pipe(file);
            file.on('finish', () => {
                if (total) process.stdout.write('\n');
                file.close(() => resolve(dest));
            });
            file.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(60000, () => req.destroy(new Error('下载超时')));
    });
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 列出 zip 内文件：Windows 10+ 自带 bsdtar 可读 zip，其他平台用 unzip */
function listZip(zip) {
    const out = process.platform === 'win32'
        ? execFileSync('tar', ['-tf', zip], { encoding: 'utf8', maxBuffer: 16 << 20 })
        : execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 16 << 20 });
    return out.split(/\r?\n/).filter(Boolean);
}

function extractEntry(zip, entry, destFile) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maple-x-'));
    try {
        if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', tmp, entry]);
        else execFileSync('unzip', ['-o', '-q', zip, entry, '-d', tmp]);
        fs.copyFileSync(path.join(tmp, entry), destFile);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

/** 尝试用 fontTools 转 woff2，成功返回 true */
function toWoff2(ttf) {
    const woff2 = ttf.replace(/\.ttf$/, '.woff2');
    const code = 'import sys\nfrom fontTools.ttLib import woff2\nwoff2.compress(sys.argv[1], sys.argv[2])';
    for (const py of ['python3', 'python']) {
        try {
            execFileSync(py, ['-c', code, ttf, woff2], { stdio: 'ignore' });
            if (fs.existsSync(woff2) && fs.statSync(woff2).size > 0) return true;
        } catch (e) { /* 试下一个 */ }
    }
    return false;
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maple-'));
    const zip = path.join(tmpDir, ASSET);
    try {
        console.log(`下载 ${url(ASSET)}`);
        await download(url(ASSET), zip);

        try {
            const shaFile = path.join(tmpDir, `${ASSET}.sha256`);
            await download(url(ASSET.replace(/\.zip$/, '.sha256')), shaFile);
            const expected = (fs.readFileSync(shaFile, 'utf8').match(/[0-9a-f]{64}/i) || [])[0];
            const actual = sha256(zip);
            if (!expected) throw new Error('校验文件格式无法识别');
            if (expected.toLowerCase() !== actual) {
                throw new Error(`SHA256 不匹配：期望 ${expected}，实际 ${actual}`);
            }
            console.log('SHA256 校验通过');
        } catch (e) {
            if (/不匹配/.test(e.message)) throw e;
            console.warn(`⚠ 未能完成 SHA256 校验：${e.message}`);
        }

        const entries = listZip(zip);
        for (const w of WANT) {
            const entry = entries.find(e => w.re.test(e));
            if (!entry) throw new Error(`压缩包中未找到 ${w.name}`);
            const dest = path.join(OUT_DIR, w.name);
            extractEntry(zip, entry, dest);
            if (toWoff2(dest)) {
                fs.rmSync(dest);
                const out = dest.replace(/\.ttf$/, '.woff2');
                console.log(`✓ ${path.basename(out)}  ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
            } else {
                console.log(`✓ ${w.name}  ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB（未安装 fontTools，保留 ttf）`);
            }
        }

        const lic = entries.find(e => LICENSE_RE.test(e));
        const licDest = path.join(OUT_DIR, '..', 'OFL.txt');
        if (lic) extractEntry(zip, lic, licDest);
        else fs.writeFileSync(licDest, 'Maple Mono is licensed under the SIL Open Font License, Version 1.1.\nhttps://github.com/subframe7536/maple-font/blob/main/OFL.txt\n');
        console.log(`完成，字体位于 ${OUT_DIR}`);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

main().catch((e) => {
    console.error(`✗ ${e.message}`);
    console.error('可设置 MAPLE_FONT_MIRROR 使用镜像，或手动下载后把 Regular/Bold 的 ttf 放到上述 files/ 目录');
    process.exit(1);
});
