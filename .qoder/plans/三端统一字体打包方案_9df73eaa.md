# 三端统一字体打包（方案 B）

## 背景与根因
- 当前 `--font-ui: 'Inter', ...'` / `--font-mono: 'JetBrains Mono', ...'` 但**未打包任何字体文件**，Windows 上没装 Inter/JetBrains Mono → 拉丁字符回退 Segoe UI、中文回退微软雅黑/宋体，混排基线与字重不一致，观感差。
- 方案 B：将拉丁 + 中文字体全部随应用打包，三端像素级一致。

## 字体选型（已验证可用，走 npmmirror 镜像）
| 用途 | 字体 | 来源（版本已验证存在） |
|---|---|---|
| UI 拉丁 | Inter 可变字重 (wght 100-900) | `@fontsource-variable/inter@5.3.0` |
| UI 中文（兼等宽区中文回退） | Noto Sans SC 可变字重 | `@fontsource-variable/noto-sans-sc@5.3.1` |
| 等宽拉丁（终端/日志/IP/代码） | JetBrains Mono 可变字重 | `@fontsource-variable/jetbrains-mono@5.3.0` |

说明：
- Noto Sans SC（思源黑体 Google 版）含完整拉丁+中日韩，可变字重单套文件覆盖 100-900，授权 OFL 可商用；等宽场景的中文字形为全角等宽，日志对齐不受影响（`@fontsource-variable/noto-sans-mono-sc` 已确认不存在，不引入额外 CJK mono 字体以免再增 10MB）。
- 不把 fontsource 写进 package.json dependencies：`build.files` 已包含 `node_modules/**/*`，写依赖会导致字体在安装包里双份（+12MB）。用 `npm pack` 拉取后拷贝文件入库，仅在 index.html 注释中标注来源与版本。

## 实施步骤

### 1. 获取字体文件入库（产物提交到 git）
- 临时目录 `npm pack` 三个包 → 解压 → 拷贝每个包的 `index.css` + `files/*.woff2` 到：
  ```
  src/renderer/assets/fonts/inter/
  src/renderer/assets/fonts/noto-sans-sc/
  src/renderer/assets/fonts/jetbrains-mono/
  ```
- fontsource 的 CJK css 自带 `unicode-range` 分片（约百余个 woff2），运行时按需加载分片，首屏只加载用到的分片。
- 预估增量：Noto Sans SC 约 8-12MB + Inter/JBM 各约 1-2MB（已获用户接受）。
- electron-builder 的 `files: ["src/**/*"]` 已覆盖字体目录，**无需改打包配置**；asar 内 woff2 子资源加载无问题。

### 2. `src/renderer/index.html` 引入字体 CSS
在 `tokens.css` 之前加三个 `<link>`，并注释来源与版本号。

### 3. 修改 `src/renderer/css/tokens.css`（L101-102）
```css
--font-ui: 'Inter', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Noto Sans SC', 'Consolas', monospace;
```
打包字体优先保证三端一致；系统字体仅作为极端情况的兜底。中文标点/字符统一走 Noto Sans SC，不再随机掉宋体。

### 4. 清理硬编码字体栈 `src/renderer/css/components.css`（L3279、L3301）
`font-family: "JetBrains Mono", SF Mono, Consolas, monospace;` → `font-family: var(--font-mono);`

### 5. 渲染细节 `src/renderer/css/main.css` body 块
补 `-webkit-font-smoothing: antialiased;` 与 `text-rendering: optimizeLegibility;`（Windows 无副作用，macOS 优化小字号）。

### 6. 同步 demo 与官网演示页（CDN 方式，不向网站仓库塞 12MB 字体）
- `demo/css/tokens.css`、`website/demo/css/tokens.css`：同步步骤 3 的字体栈。
- `demo/index.html`、`website/demo/index.html`：`tokens.css` 前加 jsdelivr CDN 字体链接（`@fontsource-variable/*` 固定版本 `index.min.css`），CDN 失败时按字体栈回退系统字体，不影响可用性。

### 7. 新增自检脚本 `scripts/test-fonts.js`
复用仓库既有 scripts/test-*.js 模式：离屏 BrowserWindow 加载 index.html → 等 `document.fonts.ready` → `document.fonts.check()` 验证 Inter / Noto Sans SC / JetBrains Mono 是否真实注册，输出结果后退出。作为打包前三端字体的自动化校验。

### 8. 验证
1. 静态完整性：校验三个 index.css 中所有 `url()` 引用的 woff2 文件均存在（写一次性 node 检查，不入库）。
2. 运行 `node scripts/test-fonts.js` 确认三个字体全部注册成功。
3. 统计字体目录体积并报告安装包增量预估。
4. `npm run dev` 启动确认无异常。

### 9. 交付说明
- 向用户说明 Windows 版重新打包后即生效（`build-win.sh` 无需改动）。
- 提示：若后续想缩减安装包体积，可裁剪 Noto Sans SC 的非简体分片（暂不做，保持完整覆盖）。

## 不改动的内容
- package.json（不加依赖、不动 build.files）
- 主进程 main.js / 各业务 JS
- debug.html / simple.html（调试用途，继续走系统字体）