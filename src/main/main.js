const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('../database/simple-db');
const { loadConfig, getConfig, setConfig } = require('../config/config');
const { HostModel, ScriptModel, TaskModel, TaskResultModel, ScriptCategoryModel, TagTypeModel, ScriptShortcutModel } = require('../database/models');
const { SSHService } = require('./sshService');
const { TaskExecutor } = require('./taskExecutor');
const { TaskScheduler } = require('./taskScheduler');
const { ProjectTaskService } = require('./projectTaskService');
const { ProjectTaskExecutor } = require('./projectTaskExecutor');
const { WechatNotifier } = require('./wechatNotifier');
const { BackupService } = require('./backupService');

// 全局连接池状态管理器
class ConnectionPoolMonitor {
  constructor() {
    this.activeConnections = 0;
    this.totalConnectionsCreated = 0;
    this.totalConnectionsClosed = 0;
    this.lastActivityTime = Date.now();
    this.connectionHistory = [];
    this.maxHistorySize = 100;
  }

  connectionOpened() {
    this.activeConnections++;
    this.totalConnectionsCreated++;
    this.lastActivityTime = Date.now();
    this.addHistory('open');
  }

  connectionClosed() {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.totalConnectionsClosed++;
    this.lastActivityTime = Date.now();
    this.addHistory('close');
  }

  addHistory(type) {
    this.connectionHistory.push({
      type,
      timestamp: Date.now(),
      activeCount: this.activeConnections
    });
    
    // 保持历史记录在限制范围内
    if (this.connectionHistory.length > this.maxHistorySize) {
      this.connectionHistory.shift();
    }
  }

  getStats() {
    return {
      activeConnections: this.activeConnections,
      totalConnectionsCreated: this.totalConnectionsCreated,
      totalConnectionsClosed: this.totalConnectionsClosed,
      lastActivityTime: this.lastActivityTime,
      uptime: Date.now() - global.appStartTime,
      connectionHistory: this.connectionHistory.slice(-20) // 最近20条记录
    };
  }

  reset() {
    this.activeConnections = 0;
    this.totalConnectionsCreated = 0;
    this.totalConnectionsClosed = 0;
    this.connectionHistory = [];
  }
}

// 创建全局连接池监控器实例
const connectionPoolMonitor = new ConnectionPoolMonitor();
global.appStartTime = Date.now();

// ============================================================
// 应用更名数据迁移：SSH工具箱 -> 万象匣
// 旧 userData 路径（生产）: AppData\Roaming\SSH工具箱
// 新 userData 路径（生产）: AppData\Roaming\万象匣
// ============================================================
async function migrateUserDataIfNeeded() {
  const os = require('os');
  const currentUserData = app.getPath('userData');
  
  // 生产环境旧路径
  const oldProductionPath = path.join(os.homedir(), 'AppData', 'Roaming', 'SSH工具箱');
  // 开发环境旧路径
  const oldDevPath = path.join(os.homedir(), 'AppData', 'Roaming', 'ssh-tools-box');
  
  // 新路径就是 currentUserData，检查是否已有数据
  const newDataFile = path.join(currentUserData, 'data', 'database.json');
  
  // 如果新路径已有数据库文件，说明已经迁移过或是全新安装，跳过
  if (fs.existsSync(newDataFile)) {
    return;
  }
  
  // 寻找存在的旧路径
  let oldPath = null;
  if (fs.existsSync(path.join(oldProductionPath, 'data', 'database.json'))) {
    oldPath = oldProductionPath;
  } else if (fs.existsSync(path.join(oldDevPath, 'data', 'database.json'))) {
    oldPath = oldDevPath;
  }
  
  if (!oldPath) {
    // 没有找到旧数据，全新安装，无需迁移
    return;
  }
  
  console.log(`[数据迁移] 检测到旧版数据，开始迁移: ${oldPath} -> ${currentUserData}`);
  
  try {
    // 递归复制目录
    function copyDirSync(src, dest) {
      if (!fs.existsSync(src)) return;
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          copyDirSync(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
    
    // 迁移 data 目录（数据库）
    copyDirSync(path.join(oldPath, 'data'), path.join(currentUserData, 'data'));
    // 迁移 task_logs 目录
    copyDirSync(path.join(oldPath, 'task_logs'), path.join(currentUserData, 'task_logs'));
    // 迁移 ssh_keys 目录
    copyDirSync(path.join(oldPath, 'ssh_keys'), path.join(currentUserData, 'ssh_keys'));
    // 迁移 config 目录
    copyDirSync(path.join(oldPath, 'config'), path.join(currentUserData, 'config'));
    
    console.log('[数据迁移] 迁移完成！所有历史数据已保留。');
  } catch (err) {
    console.error('[数据迁移] 迁移失败:', err);
  }
}

// 默认密钥路径
const DEFAULT_KEY_DIR = path.join(app.getPath('userData'), 'ssh_keys');
const DEFAULT_PRIVATE_KEY_PATH = path.join(DEFAULT_KEY_DIR, 'id_rsa');
const DEFAULT_PUBLIC_KEY_PATH = path.join(DEFAULT_KEY_DIR, 'id_rsa.pub');

// 确保默认密钥存在
async function ensureDefaultSSHKey() {
  try {
    // 确保密钥目录存在
    if (!fs.existsSync(DEFAULT_KEY_DIR)) {
      fs.mkdirSync(DEFAULT_KEY_DIR, { recursive: true });
    }
    
    // 检查是否已有默认密钥
    if (fs.existsSync(DEFAULT_PRIVATE_KEY_PATH) && fs.existsSync(DEFAULT_PUBLIC_KEY_PATH)) {
      console.log('默认SSH密钥已存在');
      return {
        success: true,
        privateKeyPath: DEFAULT_PRIVATE_KEY_PATH,
        publicKeyPath: DEFAULT_PUBLIC_KEY_PATH,
        message: '默认密钥已存在'
      };
    }
    
    console.log('生成默认SSH密钥对...');
    const keyResult = await sshService.generateKeyPair({
      keySize: 4096,
      comment: 'WanXiang Box Default Key'
    });
    
    if (keyResult.success) {
      // 保存密钥到默认位置
      fs.writeFileSync(DEFAULT_PRIVATE_KEY_PATH, keyResult.privateKey, { mode: 0o600 });
      fs.writeFileSync(DEFAULT_PUBLIC_KEY_PATH, keyResult.publicKey, { mode: 0o644 });
      
      console.log('默认SSH密钥生成成功');
      return {
        success: true,
        privateKeyPath: DEFAULT_PRIVATE_KEY_PATH,
        publicKeyPath: DEFAULT_PUBLIC_KEY_PATH,
        publicKey: keyResult.publicKey,
        privateKey: keyResult.privateKey,
        message: '默认密钥生成成功'
      };
    } else {
      throw new Error(keyResult.message);
    }
  } catch (error) {
    console.error('确保默认SSH密钥失败:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

// 设置Windows控制台UTF-8编码支持
if (process.platform === 'win32') {
  // 设置标准输出为UTF-8
  try {
    process.stdout.setEncoding && process.stdout.setEncoding('utf8');
    process.stderr.setEncoding && process.stderr.setEncoding('utf8');
  } catch (err) {
    // 忽略编码设置错误
  }
}

// 自定义日志函数，确保中文正常显示
const customLog = {
  log: (message) => {
    if (process.platform === 'win32') {
      // Windows下使用Buffer转换确保编码正确
      const buffer = Buffer.from(message, 'utf8');
      process.stdout.write(buffer + '\n');
    } else {
      console.log(message);
    }
  },
  error: (message) => {
    if (process.platform === 'win32') {
      const buffer = Buffer.from(message, 'utf8');
      process.stderr.write(buffer + '\n');
    } else {
      console.error(message);
    }
  }
};

// 替换默认的console函数
if (process.platform === 'win32') {
  console.log = customLog.log;
  console.error = customLog.error;
}

// 保持对窗口对象的全局引用，如果不这样做的话，当JavaScript对象被垃圾回收的时候，窗口会自动关闭
let mainWindow;

// 当前环境是否为开发环境
const isDev = process.argv.includes('--dev');

// SSH服务实例
let sshService;

// 任务执行器实例
let taskExecutor;

// 任务调度器实例
let taskScheduler;

// 工程任务服务实例
let projectTaskService;

// 工程任务执行器实例
let projectTaskExecutor;

// 数据备份服务实例
let backupService;

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 910,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, '../../docs/wanxianglogo-mini.ico'),
    show: false, // 先不显示，等页面加载完成后再显示
    titleBarStyle: 'default'
  });

  // 加载应用的index.html文件
  const indexPath = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(indexPath);

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // 开发模式下打开开发者工具
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // 当窗口被关闭时发出close事件
  mainWindow.on('closed', () => {
    // 取消引用window对象，如果你的应用支持多窗口的话，通常会把多个window对象存放在一个数组里面，与此同时，你应该删除相应的元素
    mainWindow = null;
  });

  // 设置菜单
  createMenu();
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '导入Excel',
          accelerator: 'CmdOrCtrl+I',
          click: () => {
            mainWindow.webContents.send('menu-import-excel');
          }
        },
        {
          label: '导出Excel',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            mainWindow.webContents.send('menu-export-excel');
          }
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectall', label: '全选' }
      ]
    },
    {
      label: '查看',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forcereload', label: '强制重新加载' },
        { role: 'toggledevtools', label: '切换开发者工具' },
        { type: 'separator' },
        { role: 'resetzoom', label: '实际大小' },
        { role: 'zoomin', label: '放大' },
        { role: 'zoomout', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于万象匣',
          click: () => {
            mainWindow.webContents.send('menu-about');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 禁用硬件加速以解决GPU相关错误
app.disableHardwareAcceleration();

// Windows 任务栏图标设置（必须在 ready 前设置）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.wanxiangbox.app');
}

// 添加更多命令行参数以彻底禁用GPU相关功能
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

// 添加字符集相关设置，确保中文正常显示
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('lang', 'zh-CN');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
}

// ============================================================
// 全局未捕获异常处理 - 防止 SSH 连接断开时弹出 Electron 原生错误对话框
// 场景：批量执行 shutdown/reboot 等命令时，远程主机关机导致 SSH 连接强制断开（ECONNRESET），
//      此时 ssh2 会向已无监听器的 Client 对象发出 error 事件，Node.js 将其视为未捕获异常，
//      Electron 默认会弹出原生错误对话框——此处全局拦截并静默处理。
// ============================================================
process.on('uncaughtException', (error) => {
  const isSSHConnError =
    error.code === 'ECONNRESET' ||
    error.code === 'EPIPE' ||
    (error.message && (
      error.message.includes('ECONNRESET') ||
      error.message.includes('read ECONNRESET') ||
      error.message.includes('write ECONNRESET') ||
      error.message.includes('Connection reset') ||
      error.message.includes('Broken pipe') ||
      error.message.includes('EPIPE')
    ));

  if (isSSHConnError) {
    // SSH 连接断开是执行关机/重启命令的正常结果，静默处理，不弹对话框
    console.log('[全局异常] SSH 连接意外断开（静默处理，通常由 shutdown/reboot 命令触发）:', error.message);
    return;
  }

  // 其他未捕获异常：记录日志
  console.error('[全局异常] 未预期的未捕获异常:', error.stack || error.message);
});

process.on('unhandledRejection', (reason) => {
  const isSSHConnError = reason && (
    reason.code === 'ECONNRESET' ||
    reason.code === 'EPIPE' ||
    (reason.message && (
      reason.message.includes('ECONNRESET') ||
      reason.message.includes('Connection reset') ||
      reason.message.includes('Broken pipe') ||
      reason.message.includes('EPIPE')
    ))
  );

  if (isSSHConnError) {
    console.log('[全局] SSH 连接断开引起的 Promise 拒绝（静默处理）:', reason.message);
    return;
  }

  console.error('[全局] 未处理的 Promise 拒绝:', reason);
});

// Electron会在初始化完成并且准备创建浏览器窗口时调用这个方法
// 部分API在ready事件触发后才能使用
app.whenReady().then(async () => {
  try {
    // 应用更名数据迁移：自动将旧版本(SSH工具箱)数据迁移到新目录(万象匣)
    await migrateUserDataIfNeeded();
    
    // 初始化配置
    await loadConfig();
    
    // 初始化数据库
    await initDatabase();
    
    // 标签类型种子数据初始化（首次运行时）
    await TagTypeModel.seedIfEmpty();
    
    // 清理废弃的模板数据
    await cleanupTemplateData();
    
    // 初始化SSH服务
    sshService = new SSHService();
    
    // 初始化任务执行器
    taskExecutor = new TaskExecutor({
      maxConcurrency: 10,
      timeout: 300000,
      retryTimes: 3
    });
    
    // 监听任务执行进度
    taskExecutor.on('progress', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`task:progress:${data.taskId}`, data);
      }
    });
    
    // 监听任务状态变化
    taskExecutor.on('taskComplete', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('task:statusChange', data);
      }
    });
    
    taskExecutor.on('taskError', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('task:statusChange', data);
      }
    });
    
    // 初始化工程任务服务
    projectTaskService = new ProjectTaskService();
    
    // 初始化工程任务执行器
    projectTaskExecutor = new ProjectTaskExecutor({ sshService });
    
    // 监听工程执行进度事件
    projectTaskExecutor.on('execution:progress', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project-execution:progress', data);
      }
    });
    projectTaskExecutor.on('execution:stepComplete', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project-execution:stepComplete', data);
      }
    });
    projectTaskExecutor.on('execution:complete', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project-execution:complete', data);
      }
    });
    projectTaskExecutor.on('execution:stopped', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project-execution:stopped', data);
      }
    });
    
    // 初始化任务调度器
    taskScheduler = new TaskScheduler();
    taskScheduler.start(taskExecutor, projectTaskExecutor);
    console.log('任务调度器已启动');
    
    // 初始化数据备份服务与调度器
    backupService = new BackupService();
    backupService.startScheduler();
    
    // 确保默认SSH密钥存在
    await ensureDefaultSSHKey();
    
    // 创建窗口
    createWindow();
    
    console.log('万象匣启动成功');
  } catch (error) {
    console.error('应用启动失败:', error);
  }
});

// 当全部窗口关闭时退出
app.on('window-all-closed', () => {
  // 在macOS上，除非用户用Cmd + Q确定地退出，否则绝大部分应用会保持激活状态，即使没有窗口
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 退出前：当天未做每日备份则补一次
let _backupOnQuitDone = false;
app.on('before-quit', async (event) => {
  if (_backupOnQuitDone || !backupService) return;
  try {
    event.preventDefault();
    _backupOnQuitDone = true;
    backupService.stopScheduler();
    await backupService.runOnQuitIfNeeded();
  } catch (e) {
    console.warn('退出前备份处理异常:', e && e.message);
  } finally {
    app.quit();
  }
});

app.on('activate', () => {
  // 在macOS上，当单击dock图标并且没有其他窗口打开时，通常在应用程序中重新创建一个窗口
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 清理废弃的模板数据
async function cleanupTemplateData() {
  try {
    console.log('开始检查模板数据...');
    const { getDatabase } = require('../database/simple-db');
    const db = getDatabase();
    
    if (!db) {
      console.error('数据库实例未初始化');
      return;
    }
    
    // 获取所有任务数据
    const tasks = db.getTable('project_tasks');
    console.log(`project_tasks 表共有 ${tasks.length} 条记录`);
    
    if (tasks.length > 0) {
      console.log('第一条记录:', { id: tasks[0].id, name: tasks[0].name, is_template: tasks[0].is_template, type: typeof tasks[0].is_template });
    }
    
    // 获取所有模板数据（支持数字1和字符串"1"）
    const templates = tasks.filter(t => t.is_template === 1 || t.is_template === '1' || t.is_template === true);
    
    if (templates.length === 0) {
      console.log('没有需要清理的模板数据');
      return;
    }
    
    console.log(`发现 ${templates.length} 条废弃的模板数据，开始清理...`);
    console.log('模板列表:', templates.map(t => ({ id: t.id, name: t.name, is_template: t.is_template })));
    
    // 删除模板及其关联的步骤
    for (const template of templates) {
      try {
        // 级联删除步骤
        const steps = db.getTable('project_steps').filter(s => s.project_task_id === template.id);
        for (const step of steps) {
          await db.delete('project_steps', step.id);
        }
        // 删除模板
        await db.delete('project_tasks', template.id);
        console.log(`已删除模板: ${template.name} (ID: ${template.id})`);
      } catch (e) {
        console.error(`删除模板 ${template.name} 失败:`, e);
      }
    }
    
    console.log('模板数据清理完成');
  } catch (error) {
    console.error('清理模板数据失败:', error);
  }
}

// IPC通信处理
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 打开外部链接（仅允许 http/https 协议，防止 file:// 等危险协议）
ipcMain.handle('open-external', async (event, url) => {
  try {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { success: false, message: '非法的链接地址' };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('打开外部链接失败:', error);
    return { success: false, message: error.message };
  }
});

// 版本号比较：a > b 返回正数，相等返回 0，a < b 返回负数（按 . 分段数值比较）
function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// 检查新版本（查询 GitHub Releases 最新发布，8 秒超时，失败静默返回 success: false）
ipcMain.handle('check-for-update', async () => {
  const currentVersion = app.getVersion();
  const releasesPage = 'https://github.com/it-andy-hou/wanxiang-box/releases';
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get({
      hostname: 'api.github.com',
      path: '/repos/it-andy-hou/wanxiang-box/releases/latest',
      headers: {
        'User-Agent': 'wanxiang-box-update-checker',
        'Accept': 'application/vnd.github+json'
      },
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return resolve({ success: false, currentVersion, message: `GitHub API 返回 ${res.statusCode}` });
          }
          const data = JSON.parse(body);
          const latestVersion = String(data.tag_name || '').replace(/^v/, '');
          if (!latestVersion) {
            return resolve({ success: false, currentVersion, message: '未获取到版本号' });
          }
          resolve({
            success: true,
            hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
            currentVersion,
            latestVersion,
            releaseUrl: data.html_url || releasesPage,
            releaseNotes: String(data.body || '').slice(0, 2000),
            publishedAt: data.published_at || ''
          });
        } catch (e) {
          resolve({ success: false, currentVersion, message: e.message });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, currentVersion, message: '请求超时' });
    });
    req.on('error', (e) => {
      resolve({ success: false, currentVersion, message: e.message });
    });
  });
});

// 获取执行设置（并发数、超时时间）
ipcMain.handle('get-execution-settings', () => {
  const concurrency = getConfig('execution.defaultConcurrency', 1);
  const timeout = getConfig('execution.defaultTimeout', 300);
  return { concurrency, timeout };
});

// 保存执行设置
ipcMain.handle('save-execution-settings', async (event, { concurrency, timeout }) => {
  try {
    // 验证并发数: 1-20
    const validConcurrency = Math.max(1, Math.min(20, parseInt(concurrency) || 1));
    // 验证超时时间: 最低10秒
    const validTimeout = Math.max(10, parseInt(timeout) || 300);
    
    await setConfig('execution.defaultConcurrency', validConcurrency);
    await setConfig('execution.defaultTimeout', validTimeout);
    
    return { success: true, concurrency: validConcurrency, timeout: validTimeout };
  } catch (error) {
    console.error('保存执行设置失败:', error);
    return { success: false, message: error.message };
  }
});

// ============================================================
// 数据备份 / 导入导出 IPC
// ============================================================
ipcMain.handle('backup:get-settings', async () => {
  try { return { success: true, data: backupService.getSettings() }; }
  catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('backup:save-settings', async (event, payload) => {
  try { return { success: true, data: await backupService.saveSettings(payload || {}) }; }
  catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('backup:list-history', async () => {
  try { return { success: true, data: await backupService.listHistory() }; }
  catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('backup:export', async () => {
  try {
    const defaultName = backupService.suggestExportFilename();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出全量数据',
      defaultPath: defaultName,
      filters: [{ name: '万象匣备份文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    const r = await backupService.exportTo(result.filePath);
    return { success: true, data: r };
  } catch (e) {
    console.error('导出备份失败:', e);
    return { success: false, message: e.message };
  }
});

ipcMain.handle('backup:parse-file', async (event, filePath) => {
  try {
    let target = filePath;
    if (!target) {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '选择要导入的备份文件',
        properties: ['openFile'],
        filters: [{ name: '万象匣备份文件', extensions: ['json'] }]
      });
      if (r.canceled || !r.filePaths || !r.filePaths[0]) {
        return { success: false, canceled: true };
      }
      target = r.filePaths[0];
    }
    const parsed = await backupService.parseImportFile(target);
    // 注意：不返回完整 _data（可能极大），仅返回摘要
    const { _data, ...summary } = parsed;
    return { success: true, data: { ...summary, filePath: target } };
  } catch (e) {
    console.error('解析备份文件失败:', e);
    return { success: false, message: e.message };
  }
});

ipcMain.handle('backup:import', async (event, filePath) => {
  if (!filePath) return { success: false, message: '未指定文件路径' };
  try {
    // 导入期间暂停任务调度器，避免脏写
    if (taskScheduler && typeof taskScheduler.stop === 'function') {
      try { taskScheduler.stop(); } catch (_) {}
    }
    const r = await backupService.importFrom(filePath);
    // 成功后同样需要重启调度器，否则定时任务直到重启应用前都不会再被检查
    try { taskScheduler && taskScheduler.start && taskScheduler.start(taskExecutor, projectTaskExecutor); } catch (_) {}
    return { success: true, data: r };
  } catch (e) {
    console.error('导入备份失败:', e);
    // 导入失败后试图重启调度器
    try { taskScheduler && taskScheduler.start && taskScheduler.start(taskExecutor, projectTaskExecutor); } catch (_) {}
    return { success: false, message: e.message };
  }
});

ipcMain.handle('backup:delete', async (event, filePath) => {
  try { return await backupService.deleteBackup(filePath); }
  catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('backup:show-in-folder', async (event, target) => {
  try {
    const p = target || (backupService && backupService.backupRoot);
    if (!p) return { success: false, message: '路径为空' };
    if (fs.existsSync(p)) {
      shell.showItemInFolder(p);
    } else {
      shell.openPath(path.dirname(p));
    }
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// 选择备份目录（弹系统目录选择框）
ipcMain.handle('backup:select-directory', async () => {
  try {
    const ret = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: backupService ? backupService.backupRoot : undefined
    });
    if (ret.canceled || !ret.filePaths || !ret.filePaths.length) {
      return { success: false, canceled: true };
    }
    return { success: true, path: ret.filePaths[0] };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// 探测备份路径是否可用（不实际切换）
ipcMain.handle('backup:probe-directory', async (event, targetPath) => {
  try {
    if (!backupService) return { success: false, message: '服务未初始化' };
    const r = await backupService.probeBackupPath(targetPath);
    if (!r.ok) return { success: false, message: r.reason };
    return { success: true, path: r.abs };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// 设置自定义备份目录（含历史迁移）
ipcMain.handle('backup:set-directory', async (event, payload) => {
  try {
    if (!backupService) return { success: false, message: '服务未初始化' };
    const targetPath = payload && payload.path;
    const migrate = !payload || payload.migrate !== false;
    const r = await backupService.setBackupRoot(targetPath, { migrate });
    return { success: true, ...r };
  } catch (e) {
    return { success: false, message: e.message, code: e.code };
  }
});

// 重置备份目录为默认路径
ipcMain.handle('backup:reset-directory', async (event, payload) => {
  try {
    if (!backupService) return { success: false, message: '服务未初始化' };
    const migrate = !payload || payload.migrate !== false;
    const r = await backupService.resetBackupRoot({ migrate });
    return { success: true, ...r };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// 获取备份目录统计信息
ipcMain.handle('backup:get-directory-info', async () => {
  try {
    if (!backupService) return { success: false, message: '服务未初始化' };
    const info = await backupService.getDirectoryInfo();
    return { success: true, info };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// 重启应用（用于导入后刷新内存状态）
ipcMain.handle('app:relaunch', async () => {
  try {
    // 避免 before-quit 重复补备份
    _backupOnQuitDone = true;
    if (backupService) backupService.stopScheduler();
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 300);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle('get-app-path', () => {
  return app.getAppPath();
});

// 文件对话框
ipcMain.handle('show-open-dialog', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  } catch (error) {
    console.error('文件对话框错误:', error);
    return { canceled: true };
  }
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
  } catch (error) {
    console.error('文件保存对话框错误:', error);
    return { canceled: true };
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf8');
    return content;
  } catch (error) {
    console.error('读取文件失败:', error);
    throw error;
  }
});

// 写入文件处理
ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    const fs = require('fs');
    
    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('文件写入成功:', filePath);
    return { success: true, path: filePath };
  } catch (error) {
    console.error('写入文件失败:', error);
    return { success: false, error: error.message };
  }
});

// 保存Excel文件并打开所在文件夹
ipcMain.handle('save-excel-file', async (event, excelBuffer, defaultFileName) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存Excel文件',
      defaultPath: path.join(app.getPath('downloads'), defaultFileName),
      filters: [
        { name: 'Excel文件', extensions: ['xlsx'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    
    if (result.canceled) {
      return { success: false, canceled: true };
    }
    
    // 保存文件
    fs.writeFileSync(result.filePath, Buffer.from(excelBuffer));
    console.log('Excel文件保存成功:', result.filePath);
    
    // 打开文件所在文件夹
    shell.showItemInFolder(result.filePath);
    
    return { 
      success: true, 
      filePath: result.filePath,
      fileName: path.basename(result.filePath)
    };
  } catch (error) {
    console.error('保存Excel文件失败:', error);
    return { success: false, error: error.message };
  }
});

// 保存CSV文件并打开所在文件夹
ipcMain.handle('save-csv-file', async (event, csvContent, defaultFileName) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存CSV文件',
      defaultPath: path.join(app.getPath('downloads'), defaultFileName),
      filters: [
        { name: 'CSV文件', extensions: ['csv'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    
    if (result.canceled) {
      return { success: false, canceled: true };
    }
    
    // 保存文件
    fs.writeFileSync(result.filePath, '\ufeff' + csvContent, 'utf8'); // 添加BOM以支持中文
    console.log('CSV文件保存成功:', result.filePath);
    
    // 打开文件所在文件夹
    shell.showItemInFolder(result.filePath);
    
    return { 
      success: true, 
      filePath: result.filePath,
      fileName: path.basename(result.filePath)
    };
  } catch (error) {
    console.error('保存CSV文件失败:', error);
    return { success: false, error: error.message };
  }
});

// 保存文本文件并打开所在文件夹
ipcMain.handle('save-text-file', async (event, textContent, defaultFileName) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存日志文件',
      defaultPath: path.join(app.getPath('downloads'), defaultFileName),
      filters: [
        { name: '文本文件', extensions: ['txt', 'log'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    
    if (result.canceled) {
      return { success: false, canceled: true };
    }
    
    // 保存文件
    fs.writeFileSync(result.filePath, textContent, 'utf8');
    console.log('日志文件保存成功:', result.filePath);
    
    // 打开文件所在文件夹
    shell.showItemInFolder(result.filePath);
    
    return { 
      success: true, 
      filePath: result.filePath,
      fileName: path.basename(result.filePath)
    };
  } catch (error) {
    console.error('保存日志文件失败:', error);
    return { success: false, error: error.message };
  }
});

// SSH密钥保存处理
ipcMain.handle('save-ssh-keys', async (event, options) => {
  try {
    const { privateKeyPath, publicKeyPath, privateKey, publicKey } = options;
    const fs = require('fs');
    
    const results = [];
    
    // 保存私钥
    if (privateKeyPath && privateKey) {
      const privateDir = path.dirname(privateKeyPath);
      if (!fs.existsSync(privateDir)) {
        fs.mkdirSync(privateDir, { recursive: true });
      }
      
      fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
      results.push({ type: 'private', path: privateKeyPath, success: true });
    }
    
    // 保存公钥
    if (publicKeyPath && publicKey) {
      const publicDir = path.dirname(publicKeyPath);
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      
      fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
      results.push({ type: 'public', path: publicKeyPath, success: true });
    }
    
    console.log('SSH密钥保存成功');
    return {
      success: true,
      results: results,
      message: 'SSH密钥保存成功'
    };
  } catch (error) {
    console.error('保存SSH密钥失败:', error);
    return {
      success: false,
      error: error.message,
      message: '保存SSH密钥失败'
    };
  }
});

// 主机管理IPC处理
ipcMain.handle('host-find-all', async () => {
  try {
    return await HostModel.findAll();
  } catch (error) {
    console.error('查询主机列表失败:', error);
    throw error;
  }
});

ipcMain.handle('host-find-by-id', async (event, id) => {
  try {
    return await HostModel.findById(id);
  } catch (error) {
    console.error('查询主机失败:', error);
    throw error;
  }
});

ipcMain.handle('host-create', async (event, hostData) => {
  try {
    return await HostModel.create(hostData);
  } catch (error) {
    console.error('创建主机失败:', error);
    throw error;
  }
});

// 批量导入主机（高性能）
// skipExisting 为 true 时（批量录入场景）：已有主机不更新，记入 skipped；
// 默认 false（Excel 导入场景）：已有主机执行更新，保持原有行为
ipcMain.handle('host-batch-import', async (event, { records, skipExisting = false }) => {
  const { getDatabase } = require('../database/simple-db');
  const db = getDatabase();
  const results = { added: 0, updated: 0, skipped: [], errors: [] };
  
  try {
    // 进入批量模式，所有操作不触发磁盘写入
    db.beginBatch();
    
    // 获取现有主机列表用于去重判断
    const existingHosts = db.getTable('hosts');
    // 批内已插入记录查重（key: ip+port+username）
    const seenKeys = new Set();
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        // 统一归一化端口：record.port 可能是 undefined 或字符串 "22"，
        // 与已存主机的数字 22 严格比较会不相等，导致重复导入
        const recordPort = parseInt(record.port, 10) || 22;
        const key = `${record.ip}|${recordPort}|${record.username}`;
        
        // 根据 IP + 端口 + 用户名 查找已有主机
        const existing = existingHosts.find(h => 
          h.ip === record.ip && 
          (parseInt(h.port, 10) || 22) === recordPort && 
          h.username === record.username
        );
        
        if (existing || seenKeys.has(key)) {
          if (skipExisting) {
            // 批量录入：跳过已有主机，不更新
            results.skipped.push({ ip: record.ip, reason: seenKeys.has(key) && !existing ? '批内重复' : '主机已存在' });
            continue;
          }
        }
        
        if (existing) {
          // 更新现有主机
          const updates = {};
          if (record.password !== undefined) updates.password = record.password;
          if (record.description !== undefined) updates.description = record.description;
          if (record.environment !== undefined) updates.environment = record.environment;
          if (record.system_name !== undefined) updates.system_name = record.system_name;
          if (record.app_name !== undefined) updates.app_name = record.app_name;
          if (record.datacenter !== undefined) updates.datacenter = record.datacenter;
          if (record.owner !== undefined) updates.owner = record.owner;
          if (record.hostname !== undefined) updates.hostname = record.hostname;
          
          await db.update('hosts', existing.id, updates);
          results.updated++;
        } else {
          // 新增主机
          const host = {
            hostname: record.hostname || record.ip,
            system_name: record.system_name || '',
            app_name: record.app_name || '',
            ip: record.ip,
            port: recordPort,
            username: record.username,
            password: record.password || '',
            private_key_path: record.private_key_path || '',
            public_key_path: record.public_key_path || '',
            description: record.description || '',
            tags: JSON.stringify(record.tags || []),
            status: 'unknown',
            cpu_info: '',
            memory_info: '',
            disk_info: '',
            os_info: '',
            datacenter: record.datacenter || '',
            environment: record.environment || '',
            owner: record.owner || '',
            last_info_collected_at: null,
            system_info_json: '',
            last_connected_at: null
          };
          
          await db.insert('hosts', host);
          seenKeys.add(key);
          results.added++;
        }
      } catch (error) {
        results.errors.push(`第${i + 1}行: ${error.message}`);
      }
    }
    
    // 一次性提交所有更改到磁盘
    await db.commit();
    console.log(`批量导入完成: 新增${results.added}, 更新${results.updated}, 跳过${results.skipped.length}, 失败${results.errors.length}`);
    return results;
  } catch (error) {
    // 出错回滚
    db.rollback();
    console.error('批量导入失败:', error);
    throw error;
  }
});

ipcMain.handle('host-update', async (event, id, hostData) => {
  try {
    console.log('更新主机:', id, hostData);
    
    // 确保正确处理tags字段
    if (hostData.tags && typeof hostData.tags !== 'string') {
      // 如果tags是数组，保持不变，让模型层处理
      // hostData.tags 保持不变
    }
    
    return await HostModel.update(id, hostData);
  } catch (error) {
    console.error('更新主机失败:', error);
    throw error;
  }
});

ipcMain.handle('host-delete', async (event, id) => {
  try {
    return await HostModel.delete(id);
  } catch (error) {
    console.error('删除主机失败:', error);
    throw error;
  }
});

ipcMain.handle('host-update-status', async (event, id, status) => {
  try {
    return await HostModel.updateStatus(id, status);
  } catch (error) {
    console.error('更新主机状态失败:', error);
    throw error;
  }
});

// 脚本管理IPC处理
ipcMain.handle('script:findAll', async () => {
  try {
    return await ScriptModel.findAll();
  } catch (error) {
    console.error('查询脚本列表失败:', error);
    throw error;
  }
});

ipcMain.handle('script:findById', async (event, id) => {
  try {
    return await ScriptModel.findById(id);
  } catch (error) {
    console.error('查询脚本失败:', error);
    throw error;
  }
});

ipcMain.handle('script:findByCategory', async (event, category) => {
  try {
    return await ScriptModel.findByCategory(category);
  } catch (error) {
    console.error('按分类查询脚本失败:', error);
    throw error;
  }
});

ipcMain.handle('script:create', async (event, scriptData) => {
  try {
    console.log('===== 创建脚本调试信息 =====');
    console.log('接收到的脚本数据 - name:', scriptData.name, 'id:', scriptData.id);
    const script = await ScriptModel.create(scriptData);
    console.log('脚本创建成功 - id:', script.id, 'name:', script.name);
    console.log('===========================');
    return script;
  } catch (error) {
    console.error('创建脚本失败:', error);
    throw error;
  }
});

ipcMain.handle('script:update', async (event, id, scriptData) => {
  try {
    console.log('更新脚本:', id, scriptData);
    return await ScriptModel.update(id, scriptData);
  } catch (error) {
    console.error('更新脚本失败:', error);
    throw error;
  }
});

ipcMain.handle('script:delete', async (event, id) => {
  try {
    return await ScriptModel.delete(id);
  } catch (error) {
    console.error('删除脚本失败:', error);
    throw error;
  }
});

ipcMain.handle('script:search', async (event, keyword) => {
  try {
    return await ScriptModel.search(keyword);
  } catch (error) {
    console.error('搜索脚本失败:', error);
    throw error;
  }
});

// =====================================================
// 脚本目录 IPC Handlers
// =====================================================
ipcMain.handle('category:getAll', async () => {
  try {
    return ScriptCategoryModel.getAll();
  } catch (error) {
    console.error('获取目录列表失败:', error);
    throw error;
  }
});

ipcMain.handle('category:getTree', async () => {
  try {
    return ScriptCategoryModel.buildTree();
  } catch (error) {
    console.error('获取目录树失败:', error);
    throw error;
  }
});

ipcMain.handle('category:create', async (event, data) => {
  try {
    return await ScriptCategoryModel.create(data);
  } catch (error) {
    console.error('创建目录失败:', error);
    throw error;
  }
});

ipcMain.handle('category:update', async (event, id, data) => {
  try {
    return await ScriptCategoryModel.update(id, data);
  } catch (error) {
    console.error('更新目录失败:', error);
    throw error;
  }
});

ipcMain.handle('category:delete', async (event, id) => {
  try {
    return await ScriptCategoryModel.delete(id);
  } catch (error) {
    console.error('删除目录失败:', error);
    throw error;
  }
});

// =====================================================
// 标签类型 / 标签值 IPC Handlers
// =====================================================
ipcMain.handle('tag:getTypes', async () => {
  try {
    return TagTypeModel.getAll();
  } catch (error) {
    console.error('获取标签类型失败:', error);
    throw error;
  }
});

ipcMain.handle('tag:getAllValues', async () => {
  try {
    const types = TagTypeModel.getAll();
    const values = TagTypeModel.getAllValues();
    return types.map(t => ({
      ...t,
      values: values.filter(v => v.type_id === t.id || v.type_id == t.id)
    }));
  } catch (error) {
    console.error('获取标签全量失败:', error);
    throw error;
  }
});

ipcMain.handle('tag:createValue', async (event, typeId, value) => {
  try {
    return await TagTypeModel.createValue(typeId, value);
  } catch (error) {
    console.error('创建标签值失败:', error);
    throw error;
  }
});

ipcMain.handle('tag:deleteValue', async (event, id) => {
  try {
    return await TagTypeModel.deleteValue(id);
  } catch (error) {
    console.error('删除标签值失败:', error);
    throw error;
  }
});

// =====================================================
// 快捷面板 IPC Handlers
// =====================================================
ipcMain.handle('shortcut:getAll', async () => {
  try {
    return ScriptShortcutModel.getAll();
  } catch (error) {
    console.error('获取快捷面板失败:', error);
    throw error;
  }
});

ipcMain.handle('shortcut:add', async (event, scriptId) => {
  try {
    return await ScriptShortcutModel.add(scriptId);
  } catch (error) {
    console.error('添加快捷失败:', error);
    throw error;
  }
});

ipcMain.handle('shortcut:remove', async (event, scriptId) => {
  try {
    return await ScriptShortcutModel.remove(scriptId);
  } catch (error) {
    console.error('移除快捷失败:', error);
    throw error;
  }
});

ipcMain.handle('shortcut:reorder', async (event, orderedScriptIds) => {
  try {
    return await ScriptShortcutModel.reorder(orderedScriptIds);
  } catch (error) {
    console.error('快捷排序失败:', error);
    throw error;
  }
});

// Ping探测处理
ipcMain.handle('ping-host', async (event, ip) => {
  return new Promise((resolve) => {
    // 使用 execFile 参数数组执行（不经 shell），并校验目标格式，杜绝命令注入
    const { execFile } = require('child_process');
    const isWin = process.platform === 'win32';
    // 仅允许字母/数字/点/连字符/下划线的 IP 或主机名
    const target = String(ip || '').trim();
    if (!/^[\w.-]{1,253}$/.test(target)) {
      return resolve({ success: false, message: 'IP 或主机名格式非法', duration: 0 });
    }
    // Windows: ping -n 1 -w 1000 IP
    // Linux/Mac: ping -c 1 -W 1 IP
    const args = isWin ? ['-n', '1', '-w', '1000', target] : ['-c', '1', '-W', '1', target];

    const startTime = Date.now();
    execFile('ping', args, (error, stdout, stderr) => {
      const duration = Date.now() - startTime;
      if (error) {
        resolve({
          success: false,
          message: '网络不可达 (Ping失败)',
          duration
        });
      } else {
        // 解析延迟（简单解析）
        let latency = duration;
        if (isWin) {
          // 匹配 "时间=Xms" 或 "时间<1ms"
          const match = stdout.match(/(?:时间|time)[=<](\d+)ms/i);
          if (match) latency = parseInt(match[1]);
        } else {
          const match = stdout.match(/time=(\d+\.?\d*) ms/i);
          if (match) latency = parseFloat(match[1]);
        }
        
        resolve({
          success: true,
          message: `在线 (延迟: ${latency}ms)`,
          latency,
          duration
        });
      }
    });
  });
});

// 批量Ping主机（TCP端口探测，高并发Worker池模式）
ipcMain.handle('batch-ping-hosts', async (event, { hostList, concurrency = 50, timeout = 1500 }) => {
  try {
    console.log(`开始批量Ping: ${hostList.length}台主机, 并发数: ${concurrency}, 超时: ${timeout}ms`);
    const startTime = Date.now();
    const net = require('net');
    
    const results = new Array(hostList.length);
    let completedCount = 0;
    let currentIndex = 0;
    
    // TCP端口探测单个主机
    const pingOne = (host) => {
      return new Promise((resolve) => {
        const ip = host.ip;
        const port = host.port || 22;
        const socket = new net.Socket();
        let resolved = false;
        
        const done = (success, latency) => {
          if (resolved) return;
          resolved = true;
          socket.destroy();
          resolve({ success, latency, ip, port });
        };
        
        const t0 = Date.now();
        
        socket.setTimeout(timeout);
        socket.on('connect', () => done(true, Date.now() - t0));
        socket.on('timeout', () => done(false, timeout));
        socket.on('error', () => done(false, Date.now() - t0));
        
        socket.connect(port, ip);
      });
    };
    
    // Worker池模式：每个worker完成后立即拿下一个任务
    const worker = async () => {
      while (currentIndex < hostList.length) {
        const index = currentIndex++;
        const host = hostList[index];
        
        try {
          results[index] = await pingOne(host);
        } catch (error) {
          results[index] = { success: false, latency: 0, ip: host.ip, port: host.port || 22 };
        }
        
        completedCount++;
        // 发送进度
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('batch-ping-progress', {
            completed: completedCount,
            total: hostList.length,
            index: index,
            result: results[index]
          });
        }
      }
    };
    
    // 启动并发workers
    const workerCount = Math.min(concurrency, hostList.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    
    const totalDuration = Date.now() - startTime;
    console.log(`批量Ping完成: ${hostList.length}台主机, 总耗时: ${totalDuration}ms`);
    
    return {
      success: true,
      results: results,
      totalDuration: totalDuration
    };
  } catch (error) {
    console.error('批量Ping失败:', error);
    return { success: false, message: error.message, results: [] };
  }
});

// SSH连接测试处理
ipcMain.handle('ssh-test-connection', async (event, hostData) => {
  try {
    console.log('开始测试SSH连接:', hostData.hostname || hostData.ip);
    connectionPoolMonitor.connectionOpened(); // 记录连接打开
    const result = await sshService.testConnection(hostData);
    connectionPoolMonitor.connectionClosed(); // 记录连接关闭
    console.log('SSH连接测试结果:', result.success ? '成功' : '失败');
    return result;
  } catch (error) {
    connectionPoolMonitor.connectionClosed(); // 即使失败也要记录
    console.error('SSH连接测试失败:', error);
    return {
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

// 批量并发SSH连接测试（性能优化版）
ipcMain.handle('ssh-batch-test-connection', async (event, { hostList, concurrency = 10 }) => {
  try {
    console.log(`开始批量连接测试: ${hostList.length}台主机, 并发数: ${concurrency}`);
    const startTime = Date.now();
    
    const results = await sshService.batchTestConnection(hostList, concurrency, (progress) => {
      // 通过事件发送进度更新给渲染进程
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('batch-test-progress', progress);
      }
    });
    
    const totalDuration = Date.now() - startTime;
    console.log(`批量连接测试完成: ${hostList.length}台主机, 总耗时: ${totalDuration}ms`);
    
    return {
      success: true,
      results: results,
      totalDuration: totalDuration
    };
  } catch (error) {
    console.error('批量连接测试失败:', error);
    return {
      success: false,
      message: error.message,
      results: []
    };
  }
});

// 主机信息收集
ipcMain.handle('ssh-collect-host-info', async (event, hostData) => {
  try {
    console.log('开始收集主机信息:', hostData.hostname || hostData.ip);
    const result = await sshService.collectHostInfo(hostData);
    return result;
  } catch (error) {
    console.error('收集主机信息失败:', error);
    return {
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

// 执行命令
ipcMain.handle('ssh-execute-command', async (event, hostData, command, options) => {
  try {
    console.log('执行命令:', command, '于主机:', hostData.hostname || hostData.ip);
    connectionPoolMonitor.connectionOpened();
    const result = await sshService.executeCommand(hostData, command, options);
    connectionPoolMonitor.connectionClosed();
    return result;
  } catch (error) {
    connectionPoolMonitor.connectionClosed();
    console.error('执行命令失败:', error);
    return {
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

// 获取连接池状态
ipcMain.handle('get-connection-pool-stats', async (event) => {
  try {
    const stats = connectionPoolMonitor.getStats();
    return {
      success: true,
      ...stats
    };
  } catch (error) {
    console.error('获取连接池状态失败:', error);
    return {
      success: false,
      message: error.message,
      activeConnections: 0,
      totalConnectionsCreated: 0,
      totalConnectionsClosed: 0
    };
  }
});

// 获取仪表盘统计数据
ipcMain.handle('app:getDashboardStats', async () => {
  try {
    const { getDatabase } = require('../database/simple-db');
    const db = getDatabase();
    
    // 获取今日日期范围
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();
    
    // 脚本数量
    const scripts = db.getTable('scripts');
    const scriptCount = scripts.length;
    
    // 工程任务数量（过滤模板数据）
    const projectTasks = db.getTable('project_tasks');
    const projectTaskCount = projectTasks.filter(t => t.is_template !== 1 && t.is_template !== '1' && t.is_template !== true).length;
    
    // 定时任务数量（普通任务 + 工程任务）
    const taskExecutions = db.getTable('task_executions');
    const projectExecutions = db.getTable('project_executions');
    const scheduledTasks = taskExecutions.filter(t => t.status === 'scheduled').length;
    const scheduledProjects = projectExecutions.filter(e => e.status === 'scheduled').length;
    const totalScheduled = scheduledTasks + scheduledProjects;
    
    // 今日执行次数
    const todayTaskExecutions = taskExecutions.filter(t => 
      t.start_time && new Date(t.start_time) >= today
    ).length;
    const todayProjectExecutions = projectExecutions.filter(e => 
      e.started_at && new Date(e.started_at) >= today
    ).length;
    const todayExecutions = todayTaskExecutions + todayProjectExecutions;
    
    // 计算成功率
    const taskResults = db.getTable('task_results');
    const stepExecutions = db.getTable('project_step_executions');
    
    const successfulTasks = taskResults.filter(r => r.status === 'success').length;
    const totalTasks = taskResults.length;
    
    const successfulSteps = stepExecutions.filter(s => s.status === 'success').length;
    const totalSteps = stepExecutions.length;
    
    const totalResults = totalTasks + totalSteps;
    const totalSuccess = successfulTasks + successfulSteps;
    const successRate = totalResults > 0 ? Math.round((totalSuccess / totalResults) * 100) : 0;
    
    // 待执行任务数
    const pendingTasks = taskExecutions.filter(t => 
      t.status === 'pending' || t.status === 'scheduled'
    ).length;
    const pendingProjects = projectExecutions.filter(e => 
      e.status === 'pending' || e.status === 'scheduled'
    ).length;
    const totalPending = pendingTasks + pendingProjects;
    
    return {
      success: true,
      data: {
        scripts: scriptCount,
        projectTasks: projectTaskCount,
        scheduledTasks: totalScheduled,
        todayExecutions: todayExecutions,
        successRate: successRate,
        pendingTasks: totalPending
      }
    };
  } catch (error) {
    console.error('获取仪表盘统计数据失败:', error);
    return {
      success: false,
      message: error.message,
      data: {
        scripts: 0,
        projectTasks: 0,
        scheduledTasks: 0,
        todayExecutions: 0,
        successRate: 0,
        pendingTasks: 0
      }
    };
  }
});

// SSH密钥生成处理
ipcMain.handle('ssh-generate-keypair', async (event, options) => {
  try {
    const { keySize = 2048, comment = '' } = options;
    console.log('生成SSH密钥对, 密钥大小:', keySize);
    
    // 使用SSH服务生成真实的密钥对
    const result = await sshService.generateKeyPair({ keySize, comment });
    
    if (result.success) {
      // 为SSH密钥添加适当的格式
      let publicKey = result.publicKey;
      let privateKey = result.privateKey;
      
      // 确保公钥格式正确（SSH格式）
      if (!publicKey.startsWith('ssh-rsa') && !publicKey.startsWith('ssh-ed25519')) {
        // 将PEM格式的公钥转换为SSH格式
        try {
          const crypto = require('crypto');
          const keyObject = crypto.createPublicKey(publicKey);
          publicKey = keyObject.export({
            type: 'spki',
            format: 'der'
          });
          // 转换为SSH格式
          const sshPublicKey = `ssh-rsa ${Buffer.from(publicKey).toString('base64')} ${comment}`;
          publicKey = sshPublicKey;
        } catch (convertError) {
          console.warn('公钥格式转换失败，使用原始格式:', convertError);
        }
      }
      
      // 确保私钥格式正确（OpenSSH格式）
      if (!privateKey.includes('BEGIN OPENSSH PRIVATE KEY') && !privateKey.includes('BEGIN RSA PRIVATE KEY')) {
        try {
          const crypto = require('crypto');
          const keyObject = crypto.createPrivateKey(privateKey);
          privateKey = keyObject.export({
            type: 'pkcs8',
            format: 'pem'
          });
        } catch (convertError) {
          console.warn('私钥格式转换失败，使用原始格式:', convertError);
        }
      }
      
      return {
        success: true,
        publicKey,
        privateKey,
        keySize,
        timestamp: new Date().toISOString(),
        message: 'SSH密钥对生成成功'
      };
    } else {
      return result;
    }
  } catch (error) {
    console.error('生成SSH密钥对失败:', error);
    return {
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

// SSH密钥配置处理
ipcMain.handle('ssh-configure-key', async (event, options) => {
  try {
    console.log('开始配置SSH密钥:', options.host.ip);
    const { host, publicKey } = options;
    
    // 使用SSH服务配置密钥
    const result = await sshService.configurePublicKey(host, publicKey);
    
    return {
      success: result.success,
      message: result.message || (result.success ? 'SSH密钥配置成功' : '配置失败'),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('SSH密钥配置失败:', error);
    return {
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

// 获取默认SSH密钥
ipcMain.handle('get-default-ssh-key', async () => {
  try {
    if (fs.existsSync(DEFAULT_PUBLIC_KEY_PATH)) {
      const publicKey = fs.readFileSync(DEFAULT_PUBLIC_KEY_PATH, 'utf8');
      return {
        success: true,
        publicKey: publicKey.trim(),
        privateKeyPath: DEFAULT_PRIVATE_KEY_PATH,
        publicKeyPath: DEFAULT_PUBLIC_KEY_PATH
      };
    } else {
      // 如果默认密钥不存在，尝试重新生成
      const result = await ensureDefaultSSHKey();
      if (result.success && result.publicKey) {
        return {
          success: true,
          publicKey: result.publicKey,
          privateKeyPath: result.privateKeyPath,
          publicKeyPath: result.publicKeyPath
        };
      } else {
        return {
          success: false,
          message: '默认密钥不存在且生成失败'
        };
      }
    }
  } catch (error) {
    console.error('获取默认SSH密钥失败:', error);
    return {
      success: false,
      message: error.message
    };
  }
});

// 重新生成默认SSH密钥
ipcMain.handle('regenerate-default-ssh-key', async () => {
  try {
    // 删除现有的默认密钥
    if (fs.existsSync(DEFAULT_PRIVATE_KEY_PATH)) {
      fs.unlinkSync(DEFAULT_PRIVATE_KEY_PATH);
    }
    if (fs.existsSync(DEFAULT_PUBLIC_KEY_PATH)) {
      fs.unlinkSync(DEFAULT_PUBLIC_KEY_PATH);
    }
    
    // 重新生成
    const result = await ensureDefaultSSHKey();
    return result;
  } catch (error) {
    console.error('重新生成默认SSH密钥失败:', error);
    return {
      success: false,
      message: error.message
    };
  }
});

// ========== 任务执行 IPC 处理 ==========

// 创建任务
ipcMain.handle('task:create', async (event, taskData) => {
  try {
    console.log('===== 创建任务调试信息 =====');
    console.log('接收到的任务数据:', JSON.stringify(taskData, null, 2));
    const task = await TaskModel.create(taskData);
    console.log('任务创建成功，返回任务:', JSON.stringify(task, null, 2));
    console.log('===========================');
    return task;
  } catch (error) {
    console.error('创建任务失败:', error);
    throw error;
  }
});

// 执行任务
ipcMain.handle('task:execute', async (event, taskId, options) => {
  try {
    console.log(`开始执行任务 ${taskId}`);
    const result = await taskExecutor.executeTask(taskId, options);
    return result;
  } catch (error) {
    console.error(`执行任务 ${taskId} 失败:`, error);
    throw error;
  }
});

// 获取所有任务
ipcMain.handle('task:getAll', async () => {
  try {
    return await TaskModel.findAll();
  } catch (error) {
    console.error('获取任务列表失败:', error);
    throw error;
  }
});

// 获取任务详情
ipcMain.handle('task:getById', async (event, taskId) => {
  try {
    return await TaskModel.findById(taskId);
  } catch (error) {
    console.error('获取任务详情失败:', error);
    throw error;
  }
});

// 获取任务结果
ipcMain.handle('task:getResults', async (event, taskId) => {
  try {
    const results = await TaskResultModel.findByTaskId(taskId);
    
    // 关联查询主机信息，添加主机IP地址
    const enrichedResults = await Promise.all(results.map(async (result) => {
      const host = await HostModel.findById(result.host_id);
      // 加载外部日志内容
      const populatedResult = await TaskResultModel.populateLogs(result);
      return {
        ...populatedResult,
        host_ip: host?.ip || null,
        host_name: host?.hostname || null
      };
    }));
    
    return enrichedResults;
  } catch (error) {
    console.error('获取任务结果失败:', error);
    throw error;
  }
});

// 停止任务
ipcMain.handle('task:stop', async (event, taskId) => {
  try {
    console.log(`停止任务 ${taskId}`);
    const result = await taskExecutor.stopTask(taskId);
    return result;
  } catch (error) {
    console.error(`停止任务 ${taskId} 失败:`, error);
    throw error;
  }
});

// 删除任务
ipcMain.handle('task:delete', async (event, taskId) => {
  try {
    return await TaskModel.delete(taskId);
  } catch (error) {
    console.error('删除任务失败:', error);
    throw error;
  }
});

// 导出任务结果
ipcMain.handle('task:exportResults', async (event, taskId, format) => {
  try {
    const task = await TaskModel.findById(taskId);
    const results = await TaskResultModel.findByTaskId(taskId);
    
    if (!task || !results) {
      throw new Error('任务或结果不存在');
    }
    
    // 获取主机信息
    const enrichedResults = await Promise.all(results.map(async (result) => {
      const host = await HostModel.findById(result.host_id);
      return {
        ...result,
        hostInfo: host
      };
    }));
    
    // 根据格式导出
    if (format === 'csv') {
      return await exportToCSV(task, enrichedResults);
    } else if (format === 'json') {
      return await exportToJSON(task, enrichedResults);
    } else {
      throw new Error(`不支持的导出格式: ${format}`);
    }
  } catch (error) {
    console.error('导出任务结果失败:', error);
    throw error;
  }
});

// 导出为CSV格式
async function exportToCSV(task, results) {
  const createCsvWriter = require('csv-writer').createObjectCsvWriter;
  const os = require('os');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `task_${task.id}_${timestamp}.csv`;
  const filePath = path.join(os.tmpdir(), filename);
  
  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
      { id: 'host_ip', title: '主机IP' },
      { id: 'host_name', title: '主机名' },
      { id: 'status', title: '状态' },
      { id: 'exit_code', title: '退出码' },
      { id: 'duration', title: '执行时间(ms)' },
      { id: 'stdout', title: '输出' },
      { id: 'stderr', title: '错误输出' },
      { id: 'error_message', title: '错误消息' }
    ]
  });
  
  const records = results.map(result => ({
    host_ip: result.hostInfo?.ip || '',
    host_name: result.hostInfo?.hostname || '',
    status: result.status,
    exit_code: result.exit_code || '',
    duration: result.duration || '',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error_message: result.error_message || ''
  }));
  
  await csvWriter.writeRecords(records);
  return filePath;
}

// 导出为JSON格式
async function exportToJSON(task, results) {
  const os = require('os');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `task_${task.id}_${timestamp}.json`;
  const filePath = path.join(os.tmpdir(), filename);
  
  const data = {
    task: task,
    results: results,
    exportedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

// ========== 工程任务 IPC 处理 ==========

// 创建工程任务
ipcMain.handle('project-task:create', async (event, data) => {
  try { return await projectTaskService.createProjectTask(data); }
  catch (e) { console.error('创建工程任务失败:', e); throw e; }
});

// 更新工程任务
ipcMain.handle('project-task:update', async (event, id, data) => {
  try { return await projectTaskService.updateProjectTask(id, data); }
  catch (e) { console.error('更新工程任务失败:', e); throw e; }
});

// 原子化保存工程任务（性能优化版本）
ipcMain.handle('project-task:save-all', async (event, data) => {
  try { 
    const { id, ...taskData } = data;
    return await projectTaskService.saveProjectTaskAtomic(taskData, id || null); 
  }
  catch (e) { console.error('原子保存工程任务失败:', e); throw e; }
});

// 删除工程任务
ipcMain.handle('project-task:delete', async (event, id) => {
  try { return await projectTaskService.deleteProjectTask(id); }
  catch (e) { console.error('删除工程任务失败:', e); throw e; }
});

// 获取工程任务详情
ipcMain.handle('project-task:getById', async (event, id) => {
  try { return await projectTaskService.getProjectTaskById(id); }
  catch (e) { console.error('获取工程任务失败:', e); throw e; }
});

// 获取全部工程任务
ipcMain.handle('project-task:getAll', async (event, options) => {
  try { return await projectTaskService.getAllProjectTasks(options || {}); }
  catch (e) { console.error('获取工程任务列表失败:', e); throw e; }
});

// 复制工程
ipcMain.handle('project-task:duplicate', async (event, projectTaskId) => {
  try { return await projectTaskService.duplicateProjectTask(projectTaskId); }
  catch (e) { console.error('复制工程失败:', e); throw e; }
});

// ---- 步骤管理 ----

ipcMain.handle('project-step:add', async (event, projectTaskId, stepData) => {
  try { return await projectTaskService.addStep(projectTaskId, stepData); }
  catch (e) { console.error('添加步骤失败:', e); throw e; }
});

ipcMain.handle('project-step:update', async (event, stepId, stepData) => {
  try { return await projectTaskService.updateStep(stepId, stepData); }
  catch (e) { console.error('更新步骤失败:', e); throw e; }
});

ipcMain.handle('project-step:delete', async (event, stepId) => {
  try { return await projectTaskService.deleteStep(stepId); }
  catch (e) { console.error('删除步骤失败:', e); throw e; }
});

ipcMain.handle('project-step:reorder', async (event, projectTaskId, stepOrders) => {
  try { return await projectTaskService.reorderSteps(projectTaskId, stepOrders); }
  catch (e) { console.error('排序步骤失败:', e); throw e; }
});

// ---- 执行控制 ----

ipcMain.handle('project-execution:execute', async (event, projectTaskId, options) => {
  try { return await projectTaskExecutor.execute(projectTaskId, options || {}); }
  catch (e) { console.error('执行工程任务失败:', e); throw e; }
});

ipcMain.handle('project-execution:stop', async (event, executionId) => {
  try { return await projectTaskExecutor.stopExecution(executionId); }
  catch (e) { console.error('停止工程执行失败:', e); throw e; }
});

ipcMain.handle('project-execution:getHistory', async (event, projectTaskId) => {
  try { return await projectTaskService.getExecutionHistory(projectTaskId); }
  catch (e) { console.error('获取执行历史失败:', e); throw e; }
});

ipcMain.handle('project-execution:getDetails', async (event, executionId) => {
  try { return await projectTaskService.getExecutionDetails(executionId); }
  catch (e) { console.error('获取执行详情失败:', e); throw e; }
});

// ---- 定时执行 ----

ipcMain.handle('project-execution:schedule', async (event, projectTaskId, scheduledTime) => {
  try { return await projectTaskService.scheduleExecution(projectTaskId, scheduledTime); }
  catch (e) { console.error('创建定时工程失败:', e); throw e; }
});

ipcMain.handle('project-execution:cancelSchedule', async (event, executionId) => {
  try { return await projectTaskService.cancelSchedule(executionId); }
  catch (e) { console.error('取消定时工程失败:', e); throw e; }
});

ipcMain.handle('project-execution:getScheduled', async () => {
  try { return await projectTaskService.getScheduledExecutions(); }
  catch (e) { console.error('获取定时工程列表失败:', e); throw e; }
});

// Webhook 测试
ipcMain.handle('project-task:testWebhook', async (event, webhookUrl) => {
  try {
    const notifier = new WechatNotifier();
    return await notifier.testWebhook(webhookUrl);
  } catch (e) { return { success: false, error: e.message }; }
});


// 获取定时任务列表
ipcMain.handle('task:getScheduled', async () => {
  try {
    const allTasks = await TaskModel.findAll();
    // 筛选出 scheduled 状态的任务
    return allTasks.filter(task => task.status === 'scheduled');
  } catch (error) {
    console.error('获取定时任务列表失败:', error);
    throw error;
  }
});

// 更新定时任务
ipcMain.handle('task:updateScheduled', async (event, taskId, taskData) => {
  try {
    console.log(`更新定时任务 ${taskId}:`, taskData);
    const task = await TaskModel.update(taskId, taskData);
    return task;
  } catch (error) {
    console.error('更新定时任务失败:', error);
    throw error;
  }
});

// 调整定时任务执行时间
ipcMain.handle('task:updateScheduledTime', async (event, taskId, scheduledTime) => {
  try {
    console.log(`调整任务 ${taskId} 执行时间为: ${scheduledTime}`);
    const task = await TaskModel.update(taskId, { scheduled_time: scheduledTime });
    return task;
  } catch (error) {
    console.error('调整执行时间失败:', error);
    throw error;
  }
});

// 立即执行定时任务
ipcMain.handle('task:executeScheduledNow', async (event, taskId) => {
  try {
    console.log(`立即执行定时任务 ${taskId}`);
    
    // 更新任务状态为 pending
    await TaskModel.update(taskId, { status: 'pending' });
    
    // 获取任务配置
    const task = await TaskModel.findById(taskId);
    const parameters = task.parameters || {};
    const concurrency = parameters.concurrency || 1;
    const timeout = parameters.timeout || 300000;
    const useSudo = parameters.useSudo || false;
    
    // 执行任务
    const result = await taskExecutor.executeTask(taskId, { concurrency, timeout, useSudo });
    return result;
  } catch (error) {
    console.error('立即执行定时任务失败:', error);
    throw error;
  }
});

// ========== 文件上传功能 IPC 处理 ==========

// 文件选择对话框
ipcMain.handle('select-files', async (event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections'], // 支持多文件选择
      filters: [
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    
    if (result.canceled) {
      return null;
    }
    
    return result.filePaths;
  } catch (error) {
    console.error('选择文件失败:', error);
    throw error;
  }
});

// 执行文件上传任务
ipcMain.handle('execute-file-upload', async (event, uploadOptions) => {
  try {
    console.log('===== 文件上传任务开始 =====');
    console.log('上传配置:', JSON.stringify(uploadOptions, null, 2));
    
    const { taskId, files, targetPath, hostIds, conflictStrategy, pathCreateStrategy, concurrency, timeout } = uploadOptions;
    
    if (!files || files.length === 0) {
      throw new Error('未指定要上传的文件');
    }
    
    if (!targetPath) {
      throw new Error('未指定目标路径');
    }
    
    if (!hostIds || hostIds.length === 0) {
      throw new Error('未选择目标主机');
    }
    
    // 更新任务状态
    await TaskModel.update(taskId, {
      status: 'running',
      start_time: new Date().toISOString()
    });
    
    // 获取主机信息
    const hosts = await Promise.all(hostIds.map(id => HostModel.findById(id)));
    
    let successCount = 0;
    let failedCount = 0;
    const totalHosts = hosts.length;
    
    // 向渲染进程发送初始进度
    mainWindow.webContents.send('task-progress', {
      taskId: taskId,
      progress: 0,
      successCount: 0,
      failedCount: 0,
      log: `开始上传 ${files.length} 个文件到 ${totalHosts} 台主机...`,
      logType: 'info'
    });
    
    // 逐个主机上传
    const maxConcurrency = Math.max(1, parseInt(concurrency, 10) || 1);
    const uploadTimeout = parseInt(timeout, 10) || 300000;
    let processedCount = 0;
    let cancelled = false;

    const isUploadCancelled = async () => {
      const latestTask = await TaskModel.findById(taskId);
      return latestTask && latestTask.status === 'cancelled';
    };

    const uploadToHost = async (host, index) => {
      if (await isUploadCancelled()) { cancelled = true; return; }
      if (!host) {
        console.error(`Host ID ${hostIds[index]} not found`);
        failedCount++; processedCount++; return;
      }
      try {
        mainWindow.webContents.send('task-progress', { taskId, log: `[${host.ip}] upload started: ${targetPath}`, logType: 'info' });
        const result = await sshService.uploadFiles(host, files, targetPath, {
          conflictStrategy: conflictStrategy || 'backup',
          pathCreateStrategy: pathCreateStrategy || 'error',
          timeout: uploadTimeout,
          continueOnError: true,
          shouldCancel: isUploadCancelled,
          onProgress: (percent) => {
            mainWindow.webContents.send('task-progress', { taskId, log: `[${host.ip}] upload progress: ${percent}%`, logType: 'info' });
          }
        });
        if (await isUploadCancelled()) {
          cancelled = true;
          await TaskResultModel.create({ task_execution_id: taskId, host_id: host.id, status: 'cancelled', stdout: '', stderr: 'Task cancelled', exit_code: -1, error_message: 'Task cancelled', start_time: new Date().toISOString(), end_time: new Date().toISOString() });
          return;
        }
        if (result.results && result.results.length > 0) {
          result.results.forEach(fileResult => {
            if (fileResult.backupCreated && fileResult.backupSuccess) {
              const fileName = require('path').basename(fileResult.localPath);
              mainWindow.webContents.send('task-progress', { taskId, log: `[${host.ip}] backup created: ${fileName} => ${fileResult.backupPath}`, logType: 'info' });
            }
          });
        }
        if (result.success) {
          successCount++;
          mainWindow.webContents.send('task-progress', { taskId, log: `[${host.ip}] upload success (${result.successCount}/${result.total})`, logType: 'success', successCount, failedCount });
          await TaskResultModel.create({ task_execution_id: taskId, host_id: host.id, status: 'success', stdout: `Upload success: ${result.successCount} files`, stderr: '', exit_code: 0, start_time: new Date().toISOString(), end_time: new Date().toISOString(), duration: result.results.reduce((sum, r) => sum + (r.duration || 0), 0) });
        } else {
          failedCount++;
          const errorMsg = result.results.filter(r => !r.success).map(r => r.error).join('; ');
          mainWindow.webContents.send('task-progress', { taskId, log: `[${host.ip}] upload failed: ${errorMsg}`, logType: 'error', successCount, failedCount });
          await TaskResultModel.create({ task_execution_id: taskId, host_id: host.id, status: 'failed', stdout: '', stderr: errorMsg, exit_code: -1, error_message: errorMsg, start_time: new Date().toISOString(), end_time: new Date().toISOString() });
        }
      } catch (error) {
        if (await isUploadCancelled()) {
          cancelled = true;
          await TaskResultModel.create({ task_execution_id: taskId, host_id: host.id, status: 'cancelled', stdout: '', stderr: 'Task cancelled', exit_code: -1, error_message: 'Task cancelled', start_time: new Date().toISOString(), end_time: new Date().toISOString() });
          return;
        }
        console.error(`Host ${host.ip} upload failed:`, error);
        failedCount++;
        mainWindow.webContents.send('task-progress', { taskId, log: `[${host.ip}] upload failed: ${error.message}`, logType: 'error', successCount, failedCount });
        await TaskResultModel.create({ task_execution_id: taskId, host_id: host.id, status: 'failed', stdout: '', stderr: error.message, exit_code: -1, error_message: error.message, start_time: new Date().toISOString(), end_time: new Date().toISOString() });
      } finally {
        processedCount++;
        const progress = Math.round((processedCount / totalHosts) * 100);
        mainWindow.webContents.send('task-progress', { taskId, progress, successCount, failedCount });
      }
    };

    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(maxConcurrency, hosts.length) }, async () => {
      while (nextIndex < hosts.length) {
        if (cancelled || await isUploadCancelled()) { cancelled = true; break; }
        const currentIndex = nextIndex++;
        await uploadToHost(hosts[currentIndex], currentIndex);
      }
    });
    await Promise.all(workers);
    cancelled = cancelled || await isUploadCancelled();
    const taskStatus = cancelled ? 'cancelled' : (failedCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'completed'));
    await TaskModel.update(taskId, {
      status: taskStatus,
      end_time: new Date().toISOString(),
      success_hosts: successCount,
      failed_hosts: failedCount
    });
    
    // 发送完成事件
    mainWindow.webContents.send('task-progress', {
      taskId: taskId,
      completed: true,
      success: !cancelled && failedCount === 0,
      log: `任务完成: 成功 ${successCount} 台, 失败 ${failedCount} 台`,
      logType: cancelled ? 'warning' : (failedCount === 0 ? 'success' : 'warning')
    });
    
    console.log('===== 文件上传任务完成 =====');
    
    return {
      success: !cancelled && failedCount === 0,
      cancelled: cancelled,
      totalHosts: totalHosts,
      successCount: successCount,
      failedCount: failedCount
    };
    
  } catch (error) {
    console.error('文件上传任务失败:', error);
    
    // 更新任务状态为失败
    if (uploadOptions.taskId) {
      const latestTask = await TaskModel.findById(uploadOptions.taskId);
      if (!latestTask || latestTask.status !== 'cancelled') {
        await TaskModel.update(uploadOptions.taskId, {
          status: 'failed',
          end_time: new Date().toISOString()
        });
      }
    }
    
    throw error;
  }
});

