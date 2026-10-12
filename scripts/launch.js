// ============================================================
// 万象匣 - 跨平台启动脚本
// Windows 下先切换控制台代码页为 UTF-8（对应原 chcp 65001），
// 再启动 Electron，保证 macOS / Linux / Windows 均可正常运行
// ============================================================
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);

// Windows 控制台默认 GBK 编码，切到 UTF-8 避免中文乱码
if (process.platform === 'win32') {
  spawn('chcp', ['65001'], { shell: true, stdio: 'ignore' });
}

// 在普通 Node 进程中 require('electron') 返回 electron 可执行文件路径
const electronPath = require('electron');

const child = spawn(electronPath, [path.join(__dirname, '..')].concat(args), {
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code) => process.exit(code == null ? 0 : code));
