# 侧边栏功能迁移：快速操作 → 主机管理页，统计信息 → 全局底部状态栏

## 1. HTML 结构调整（src/renderer/index.html）

### 1.1 快速操作按钮迁入主机管理页面
- 删除 Sidebar 中"快速操作"区块（L48-56 的 sidebar-section：`#importCsvBtn`、`#exportCsvBtn`、`#batchConnectBtn`）
- 在主机管理页头 `page-actions`（L137-141，现有"添加主机/刷新列表/重置全部"之后）追加这三个按钮：
  - `#importCsvBtn`（导入Excel，btn-secondary）
  - `#exportCsvBtn`（导出Excel，btn-secondary）
  - `#batchConnectBtn`（批量连接测试，btn-success）
- 按钮保持原 id 不变 → JS 事件绑定（app.js 中已存在）无需改动

### 1.2 新建全局底部状态栏
- 在 `</main>`（L1113）之后、`</body>` 前插入 `<footer class="status-bar" id="statusBar">`
- 布局：左侧放主机统计（醒目、带状态色点），中间/右侧放资源统计，内容分两组：
  - **主机组（清晰展示）**：`🖥 主机 [id=totalHosts]`、`● 在线 [id=onlineHosts]`（绿点）、`● 离线 [id=offlineHosts]`（红点）、`● 未知 [id=unknownHosts]`（灰点）——沿用原统计元素 id
  - **资源组**：`脚本 [id=totalScripts]`、`工程任务 [id=totalProjectTasks]`、`定时任务 [id=totalScheduledTasks]`
- 数字使用等宽字体 + tabular-nums（遵循设计规范）

### 1.3 移除 Sidebar 统计区块
- 删除 L58-127 的"统计信息" sidebar-section（整个 .stats 结构）
- Sidebar 仅保留 `sidebar-nav`，`.sidebar-content` 整体删除

## 2. CSS 样式（src/renderer/css/main.css）

- 新增 `.status-bar` 样式：
  - 高度约 28px，`var(--surface-card)` 背景，顶部 1px `var(--border-subtle)` 分隔
  - flex 布局、水平排布、分组间用分隔符（竖线或间距）
  - 数值类 `font-family: var(--font-mono)` + `font-nums: tabular-nums`，标签用 `var(--text-muted)` 12px
  - 在线/离线/未知的状态点用现有 status token（`--status-healthy-*` / `--status-danger-*` / 中性色）
- 删除不再使用的 `.sidebar-section`、`.quick-actions`、`.stat-group`、`.stat-group-title`、`.stats`、`.stat-card`、`.stat-grid`、`.stat-row` 等样式（先 grep 确认无其他页面引用）
- 调整 `#app` / `.app-main` 布局确保 footer 固定在窗口底部、内容区不遮挡（.app-main 加 `padding-bottom` 或改为 flex column 结构）

## 3. JS 逻辑调整（src/renderer/js/app.js）

- `updateStats()`（L572）：保留 totalHosts/onlineHosts/offlineHosts 更新；可补充 `unknownHosts`（新增元素）
- `loadExtendedStats()`（L588）：删除执行统计三行（todayExecutions/successRate/pendingTasks），保留资源统计三项；保留 IPC 调用 `app:getDashboardStats`（数据仍返回，只是不再展示执行部分）
- 检查 `getStatistics()`（L611）等其他引用 sidebar 统计 DOM 的代码，清理对已删除元素的引用
- 事件绑定（importCsvBtn 等）不动 id 即无需改动，只需验证主机页按钮区域按钮不会重复绑定

## 4. 验证

- `GetProblems` 检查 index.html / main.css / app.js 无错误
- grep 确认：`totalHosts` 等 id 在 HTML 中仅存在于状态栏；无残留 `sidebar-section`/`quick-actions` CSS 死代码引用
- `npm start` 冒烟测试：三个按钮在主机页可用（导入/导出/批量测试）、底部状态栏常驻所有页面、统计数字正常刷新、Sidebar 折叠功能不受影响