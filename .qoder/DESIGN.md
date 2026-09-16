---
version: 2.1.0
name: Pro-Platform-Dashboard-System-Light
description: High-density, precision-engineered light mode dashboard design system. Built for complex enterprise consoles, operations monitoring, and analytical workflows. Features clean paper-white surfaces, subtle borders, high-contrast readable typography, and strict tabular-data alignment.

colors:
  # Base Surface & Canvas (Clean Light Tone)
  canvas-base: "#f8fafc"         # 极浅灰底板，避免大面积纯白引起眼部疲劳
  surface-card: "#ffffff"        # 卡片/容器纯白底色，自然凸显内容
  surface-subtle: "#f1f5f9"      # 浅灰次级表面（表格 Header、输入框底色）
  surface-hover: "#f8fafc"       # 悬浮态轻微反馈
  surface-active: "#e2e8f0"      # 激活/选中态
  surface-overlay: "rgba(15, 23, 42, 0.45)" # 抽屉与模态遮罩

  # Precision Borders & Lines
  border-subtle: "#e2e8f0"       # 常规卡片边框、表格分割线
  border-default: "#cbd5e1"      # 控件外框、分割线强调
  border-strong: "#94a3b8"       # 深度交互边缘
  border-focus: "#0284c7"        # 聚焦外框蓝色

  # Typography Colors (High-Contrast Neutral)
  text-heading: "#0f172a"        # 接近纯黑的深蓝灰，字迹饱满清晰
  text-body: "#334155"           # 默认正文文本
  text-muted: "#64748b"          # 次级说明、卡片标签
  text-faint: "#94a3b8"          # 占位符、辅助快捷键提示
  text-inverse: "#ffffff"        # 反色文字（用于主按钮）

  # Interactive Primary (Cobalt / Deep Sky)
  primary: "#0284c7"             # 亮色下饱和度适中、清晰度极高的专业蓝
  primary-hover: "#0369a1"
  primary-active: "#075985"
  primary-glow: "rgba(2, 132, 199, 0.12)"
  on-primary: "#ffffff"

  # System Semantic Status Badges & Signals (Light Mode Adjusted)
  status-healthy-bg: "#f0fdf4"
  status-healthy-fg: "#15803d"
  status-healthy-border: "#bbf7d0"

  status-warning-bg: "#fefce8"
  status-warning-fg: "#a16207"
  status-warning-border: "#fef08a"

  status-critical-bg: "#fef2f2"
  status-critical-fg: "#b91c1c"
  status-critical-border: "#fecaca"

  status-info-bg: "#f0f9ff"
  status-info-fg: "#0369a1"
  status-info-border: "#bae6fd"

  status-neutral-bg: "#f1f5f9"
  status-neutral-fg: "#475569"
  status-neutral-border: "#e2e8f0"

  # Telemetry & Chart Series (High-Contrast for White Background)
  chart-1: "#0284c7" # Sky Blue
  chart-2: "#6366f1" # Indigo
  chart-3: "#8b5cf6" # Violet
  chart-4: "#10b981" # Emerald
  chart-5: "#f59e0b" # Amber

typography:
  metric-headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.02em
    fontFeatureSettings: '"tabular-nums" 1'
  heading-page:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.015em
  heading-section:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: -0.01em
  heading-card:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  body-default:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-compact:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  body-tiny:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.01em
  mono-code:
    fontFamily: "JetBrains Mono, SF Mono, Consolas, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    fontFeatureSettings: '"zero" 1'
  mono-metric:
    fontFamily: "JetBrains Mono, SF Mono, Consolas, monospace"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.2
    fontFeatureSettings: '"tabular-nums" 1'

rounded:
  none: 0px
  xs: 3px
  sm: 5px
  md: 8px
  lg: 12px
  pill: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  panel: 48px

components:
  # Navigation & Shell
  sidebar-nav:
    backgroundColor: "{colors.surface-card}"
    borderRight: "1px solid {colors.border-subtle}"
    width: "240px"
    collapsedWidth: "64px"
    itemHeight: "36px"
    itemHoverBg: "{colors.surface-subtle}"
    itemActiveBg: "{colors.primary-glow}"
    itemActiveText: "{colors.primary}"

  header-bar:
    backgroundColor: "rgba(255, 255, 255, 0.85)"
    borderBottom: "1px solid {colors.border-subtle}"
    height: "48px"
    padding: "0 16px"
    backdropBlur: "blur(12px)"

  # KPI & Metric Card
  stat-metric-card:
    backgroundColor: "{colors.surface-card}"
    border: "1px solid {colors.border-subtle}"
    rounded: "{rounded.md}"
    padding: "16px"
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.03)"

  # Data Table
  data-table:
    backgroundColor: "{colors.surface-card}"
    border: "1px solid {colors.border-subtle}"
    rounded: "{rounded.md}"
    headerBg: "{colors.surface-subtle}"
    headerHeight: "36px"
    rowHeight: "42px"
    rowHoverBg: "{colors.surface-hover}"
    rowSelectedBg: "{colors.surface-subtle}"
    divider: "1px solid {colors.border-subtle}"
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.02)"

  # Interactive Overlays
  command-palette:
    backgroundColor: "{colors.surface-card}"
    border: "1px solid {colors.border-default}"
    rounded: "{rounded.lg}"
    boxShadow: "0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.1)"
    width: "600px"
    maxHeight: "440px"

  slide-drawer:
    backgroundColor: "{colors.surface-card}"
    borderLeft: "1px solid {colors.border-subtle}"
    width: "500px"
    boxShadow: "-8px 0 24px -4px rgba(15, 23, 42, 0.08)"

  # Status & Chips
  status-badge:
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.body-tiny}"
    fontWeight: 500

  kbd-chip:
    backgroundColor: "{colors.surface-subtle}"
    border: "1px solid {colors.border-subtle}"
    color: "{colors.text-muted}"
    rounded: "{rounded.xs}"
    padding: "1px 5px"
    fontSize: "10px"
    fontFamily: "{typography.mono-code.fontFamily}"

  # Inputs & Controls
  input-base:
    backgroundColor: "{colors.surface-card}"
    border: "1px solid {colors.border-default}"
    focusBorder: "1px solid {colors.border-focus}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 10px"
    typography: "{typography.body-compact}"
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.02)"

  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    hoverBg: "{colors.primary-hover}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 12px"
    typography: "{typography.body-compact}"
    fontWeight: 500
    boxShadow: "0 1px 2px 0 rgba(2, 132, 199, 0.2)"

  button-secondary:
    backgroundColor: "{colors.surface-card}"
    border: "1px solid {colors.border-default}"
    hoverBg: "{colors.surface-subtle}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 12px"
    typography: "{typography.body-compact}"
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.02)"
---

# Dashboard & Console Design Guidelines (Light Edition)

## 1. 核心定位与原则 (Philosophy)
本套亮色控制台规范吸纳了现代化金融平台与 SaaS 运维平台的高端质感：
- **拒绝雪白眩光（Soft Parchment/Slate Base）**：全局底板使用 `#f8fafc`，卡片与面板使用纯白 `#ffffff`，形成清晰自然的“纸张悬浮感”。
- **精工微边框（Precision Hairlines）**：在亮色模式下，不依赖大面积阴影来区分区块，而是通过 `1px #e2e8f0` 细微边框保持严谨克制的工程质感。
- **信息密度与防疲劳平衡**：正文字号设定为 `12px ~ 13px`，通过字重（400/500/600）与灰阶差呈现清晰的信息树。

---

## 2. 界面层级体系 (Surfaces & Elevation)
1. **Layer 0 (画布 `canvas-base` - #f8fafc)**：全局背景。
2. **Layer 1 (工作卡片 `surface-card` - #ffffff)**：图表卡片、表格容器、侧边栏。边框为 `border-subtle` (#e2e8f0)，辅以超轻微柔和投影 `0 1px 2px rgba(0,0,0,0.03)`。
3. **Layer 2 (交互浮层 `surface-subtle` / Popover)**：表头底色、输入框底色、下拉菜单。
4. **Layer 3 (顶层抽屉与模态 `command-palette` / `slide-drawer`)**：悬浮在内容上方，右侧或居中弹出，搭配半透明深蓝灰遮罩（`rgba(15, 23, 42, 0.45)`）。

---

## 3. 字体规范与数据对齐 (Typography & Data Alignment)

### 3.1 字体栈选择
- **UI 字体**：优先使用 `Inter, system-ui, -apple-system`。
- **等宽数据字体**：使用 `JetBrains Mono, SF Mono, Consolas`。
  - **必用场景**：IP 地址、Port 端口、时间戳、JSON、调用栈、实时指标。

### 3.2 严禁数字抖动（Tabular Numbers）
动态变化的数据指标、计数器和表格数值必须启用等宽数字：
```css
font-feature-settings: "tabular-nums" 1;
font-variant-numeric: tabular-nums;