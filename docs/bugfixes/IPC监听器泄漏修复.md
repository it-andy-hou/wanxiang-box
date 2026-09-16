# IPC 监听器泄漏修复

## 问题描述

在 Electron 应用中，如果 `ipcRenderer.on` 在组件多次初始化时被重复调用，且没有对应的 `removeListener`，会导致监听器叠加，造成以下问题：

1. **重复执行回调**：接收到一次后端事件，前端会执行多次回调
2. **内存泄漏**：监听器无法被垃圾回收
3. **性能下降**：随着监听器数量增加，事件处理变慢
4. **日志重复打印**：同一条日志被打印多次

## 影响场景

用户在不同 Tab 之间来回切换时，每次切换都可能注册新的监听器：
- "任务历史" 和 "执行任务" Tab 切换
- "文件上传" 页面的多次进入
- 应用菜单的重复触发

## 修复内容

### 1. TaskService.js - 任务进度监听器泄漏

**文件位置**：`src/renderer/js/services/taskService.js`

**问题代码**：
```javascript
onTaskProgress(taskId, callback) {
    if (this.ipc) {
        this.ipc.on(`task:progress:${taskId}`, (event, data) => {
            callback(data);
        });
    }
}
```

**修复方案**：
```javascript
onTaskProgress(taskId, callback) {
    if (this.ipc) {
        // 先移除已有的监听器，避免重复监听
        this.ipc.removeAllListeners(`task:progress:${taskId}`);
        this.ipc.on(`task:progress:${taskId}`, (event, data) => {
            callback(data);
        });
    }
}
```

**同样修复了**：
- `onTaskStatusChange` 方法

### 2. fileUpload.js - 全局监听器泄漏

**文件位置**：`src/renderer/js/fileUpload.js`

**问题代码**：
```javascript
const { ipcRenderer } = require('electron');
ipcRenderer.on('task-progress', (event, data) => {
    // ... 处理逻辑
});
```

**修复方案**：
```javascript
const { ipcRenderer } = require('electron');

// 先移除可能存在的旧监听器，避免重复监听
ipcRenderer.removeAllListeners('task-progress');

ipcRenderer.on('task-progress', (event, data) => {
    // ... 处理逻辑
});
```

### 3. app.js - 菜单事件监听器泄漏

**文件位置**：`src/renderer/js/app.js`

**问题代码**：
```javascript
if (window.require) {
    const { ipcRenderer } = window.require('electron');
    
    ipcRenderer.on('menu-import-excel', () => this.importExcel());
    ipcRenderer.on('menu-export-excel', () => this.exportExcel());
    ipcRenderer.on('menu-about', () => this.showAbout());
}
```

**修复方案**：
```javascript
if (window.require) {
    const { ipcRenderer } = window.require('electron');
    
    // 先移除可能存在的旧监听器，避免重复监听
    ipcRenderer.removeAllListeners('menu-import-excel');
    ipcRenderer.removeAllListeners('menu-export-excel');
    ipcRenderer.removeAllListeners('menu-about');
    
    ipcRenderer.on('menu-import-excel', () => this.importExcel());
    ipcRenderer.on('menu-export-excel', () => this.exportExcel());
    ipcRenderer.on('menu-about', () => this.showAbout());
}
```

## 更优的解决方案建议

### 使用 `ipcRenderer.invoke` 替代 `send/on` 模式

对于请求-响应类型的通信，推荐使用 Promise 风格的 `invoke`：

**优点**：
- 单次请求响应，不存在监听器泄漏问题
- 代码更简洁，易于理解
- 自动处理错误传递

**示例**：
```javascript
// 渲染进程
const result = await ipcRenderer.invoke('task:execute', taskId, options);

// 主进程
ipcMain.handle('task:execute', async (event, taskId, options) => {
    // 执行任务
    return result;
});
```

### 使用 `once` 替代 `on`（适用于单次事件）

对于只需要执行一次的监听器：

```javascript
ipcRenderer.once('event-name', (event, data) => {
    // 只会执行一次，自动移除监听器
});
```

## 验证方法

### 1. 手动测试

1. 打开应用开发者工具
2. 在控制台输入以下代码查看监听器数量：
   ```javascript
   const { ipcRenderer } = require('electron');
   console.log('监听器数量:', ipcRenderer.listenerCount('task-progress'));
   ```
3. 在不同 Tab 之间切换多次
4. 再次检查监听器数量，应该保持为 1

### 2. 内存监控

1. 打开 Chrome DevTools 的 Memory 面板
2. 执行多次 Tab 切换操作
3. 拍摄内存快照，检查是否有持续增长的趋势

## 测试清单

- [ ] 在"执行任务"和"任务历史"之间切换 10 次，确认监听器数量正常
- [ ] 在"文件上传"页面多次进入和退出，确认没有重复日志
- [ ] 执行任务时切换 Tab，确认进度更新正常
- [ ] 长时间运行应用，监控内存使用是否稳定
- [ ] 检查菜单操作（导入/导出/关于）执行正常

## 相关文件

- `src/renderer/js/services/taskService.js` - 任务服务层修复
- `src/renderer/js/fileUpload.js` - 文件上传页面修复
- `src/renderer/js/app.js` - 主应用类修复

## 修复时间

2024-12-22

## 修复人员

AI Assistant
