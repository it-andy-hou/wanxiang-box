# UI 布局与图标规范化改造计划

## 概述

实施需求记录.md L1406-1410 的五项改造。修改集中在 4 个文件：
`src/renderer/css/tokens.css`、`src/renderer/css/main.css`、`src/renderer/index.html`、`src/renderer/js/app.js`。
所有样式遵循 `.qoder/DESIGN.md` 浅色规范（Pro-Platform-Dashboard-System-Light），颜色一律引用 token 变量。

## 第一步：侧边栏收窄（需求1）

**文件：`src/renderer/css/tokens.css`**
- `--sidebar-width: 240px` → `200px`（L92），`--sidebar-collapsed-width: 64px` 保持不变
- 导航文字最长 4 个汉字 + 图标 20px + gap 12px + padding 24px ≈ 116px，200px 下仍有余量，`.nav-item` 样式无需调整

## 第二步：折叠按钮双状态图标（需求5）

**文件：`src/renderer/index.html`（L21）**
- `☰` 字符按钮替换为两个 Lucide 内联 SVG（`panel-left-close` 展开态 / `panel-left-open` 折叠态），包在 `<span class="toggle-icon-expand">` 和 `<span class="toggle-icon-collapse">` 中
- 顺带将设置按钮 `⚙️`（L29）替换为 Lucide `settings` 齿轮 SVG

**文件：`src/renderer/css/main.css`（`.sidebar-toggle` 附近，L565）**
- 新增状态样式：默认显示 expand 图标隐藏 collapse 图标；`.sidebar-toggle.is-collapsed` 反转
- 两图标叠加布局（grid 或 absolute）+ `opacity/rotate` 过渡动效 0.2s ease，实现折叠/展开切换时图标形态与动画均不同

**文件：`src/renderer/js/app.js`（toggleSidebar，L2353-2362）**
- 在现有 `sidebar.classList.toggle('collapsed')` 逻辑处同步 `toggleBtn.classList.toggle('is-collapsed', ...)`，保持移动端 show 逻辑不变

## 第三步：导航图标 Lucide 化（需求4）

**文件：`src/renderer/index.html`（L39-46）**
8 个 emoji 替换为 Lucide 内联 SVG（16px、`stroke="currentColor"`、`stroke-width="2"`、fill none、round cap/join）：

| 导航项 | 原 emoji | Lucide 图标 |
|---|---|---|
| 主机管理 | 🖥 | server |
| 工程任务 | 🗂 | folder-kanban |
| 脚本管理 | 📜 | file-code |
| 脚本执行 | ▶️ | play |
| 命令执行 | ⌨️ | terminal |
| 文件上传 | 📤 | upload |
| 任务调度 | ⏰ | clock |
| 任务记录 | 📋 | history |

**文件：`src/renderer/css/main.css`（`.nav-item-icon`，L160-165）**
- 调整为 flex 居中容器，SVG `color: currentColor` 自动跟随 `.nav-item` 的 `--text-muted` / `.active` 态 `--primary`，无需单独配色

## 第四步：列表高度自适应（需求2）

**文件：`src/renderer/css/main.css`**
- 删除三处魔法数字，让 flex 撑满：
  - `#page-hosts .table-container`（L291-299）：删除 `max-height: calc(100vh - 400px)`，保留 `flex: 1; min-height: 300px`（min-height 防止空列表塌陷）
  - `#page-scripts .table-container`（L314-320）：删除 `max-height: calc(100vh - 300px)`
  - `#page-history .table-container`（L331-337）：删除 `max-height: calc(100vh - 300px)`
- 统一外边距：删除 `#page-hosts .table-container` 的 `margin: 0 30px; margin-top: 10px` 覆盖，使其与全局 `.table-container` 的 `margin: 0 var(--space-xl); margin-top: var(--space-lg)` 一致

**文件：`src/renderer/index.html`**
- 移除三处 inline 样式（L287 脚本执行、L482 命令执行、L665 文件上传）：
  `style="max-height: calc(100vh - 180px); overflow-y: auto; padding-right: 0.5rem;"`
- 这三个页面内容（配置区 + 监控区 + 历史区）可能超出视口，`page-content` 保留整体滚动：在 main.css 补充 `.page-content--scroll` 修饰类（`overflow-y: auto`），替换 inline 样式

## 第五步：右侧列表风格统一（需求3）

统一基准为主机管理/任务记录页风格：**table-container 直铺、无 card 嵌套**。

**文件：`src/renderer/index.html`**
- 命令执行页（L627-653）、文件上传页（L867-894）、任务调度页（L907-934）：将执行历史/任务列表的 `.card > .card-header > .card-body > .table-container` 嵌套拍平为：
  ```html
  <div class="section-header"><h3>执行历史</h3></div>
  <div class="table-container">...表格原样保留...</div>
  ```
- 脚本执行页的执行历史区（L440-470 附近的同构 card）同样拍平
- 任务调度页只有一个列表，拍平后 `page-content` 内 `table-container` 以 `flex: 1` 撑满视口（配合第四步）

**文件：`src/renderer/css/main.css`**
- 新增 `.section-header` 样式（对齐 DESIGN.md heading-card：13px/600 字重、`--text-heading` 色、上下留白与 table-container 边距协调，可复用 `.card-header h3` 视觉参数）
- 新增 `.section-header + .table-container` 布局规则，保证表格填满 section 剩余高度
- 顺带删除 `#page-file-upload .file-upload-task-history-section .table-container` 的 `max-height: 400px`（L340-343，注意实际页面 id 是 `page-fileupload`，此选择器疑似死代码，验证后删除）

## 验证

1. `node --check src/renderer/js/app.js` 语法检查
2. grep 确认无残留：`calc(100vh - 180px)`、`calc(100vh - 400px)`、`calc(100vh - 300px)`、导航 emoji、`☰` toggle 字符
3. `npm start` 冒烟测试：逐页检查主机管理/脚本执行/命令执行/文件上传/任务调度/任务记录的表格高度自适应与风格一致性；测试折叠按钮两态图标切换与动效；确认折叠至 64px 后 SVG 图标居中显示

## 范围外（明确不做）

- `simple.html`、`debug.html` 调试页不同步改造
- 弹窗/模态内的 emoji 图标（如密码可见性 👁️、💡 提示符）不在本次导航图标需求范围内
- 侧边栏拖拽调宽（用户已确认固定 200px 方案）