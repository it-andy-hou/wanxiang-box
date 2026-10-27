/**
 * 字体自检脚本（三端渲染统一）
 *
 * 离屏加载渲染端页面，验证内置字体（assets/fonts/ 下的 woff2）是否真实注册：
 *   - Inter Variable           （UI 拉丁）
 *   - Noto Sans SC Variable    （UI 中文 / 等宽区中文回退）
 *   - JetBrains Mono Variable  （等宽拉丁：终端/日志/IP/代码）
 *
 * 用法：npx electron scripts/test-fonts.js
 * 全部通过输出 OK 并以 0 退出；任一失败输出 FAIL 并以 1 退出。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  try {
    await win.loadFile(indexPath);

    // 显式触发三个字体族的加载（document.fonts.check 不会触发加载），
    // 中文/拉丁分别用对应文本命中 unicode-range 分片
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        await document.fonts.load('12px "Inter Variable"', 'A1');
        await document.fonts.load('12px "Noto Sans SC Variable"', '主机脚本执行');
        await document.fonts.load('12px "JetBrains Mono Variable"', '192.168.0.1');
        return {
          inter: document.fonts.check('12px "Inter Variable"', 'A'),
          notoSansSC: document.fonts.check('12px "Noto Sans SC Variable"', '主'),
          jetBrainsMono: document.fonts.check('12px "JetBrains Mono Variable"', '1'),
          loadedFaces: [...document.fonts].filter(f => f.status === 'loaded').length
        };
      })()
    `);

    console.log('--- 字体自检结果 ---');
    console.log(`Inter Variable          : ${result.inter ? 'OK' : 'FAIL'}`);
    console.log(`Noto Sans SC Variable   : ${result.notoSansSC ? 'OK' : 'FAIL'}`);
    console.log(`JetBrains Mono Variable  : ${result.jetBrainsMono ? 'OK' : 'FAIL'}`);
    console.log(`已加载字体分片数量      : ${result.loadedFaces}`);

    const allOk = result.inter && result.notoSansSC && result.jetBrainsMono;
    console.log(allOk ? '全部通过' : '存在失败项');
    app.exit(allOk ? 0 : 1);
  } catch (err) {
    console.error('字体自检运行出错:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => app.quit());
