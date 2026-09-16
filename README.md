# 万象匣 (WanXiang Box)

> 🌐 官网宣传页：**https://it-andy-hou.github.io/wanxiang-box/**（含在线界面 Demo；也支持自定义域名 **https://hi-andy.com/wanxiang-box/** 访问）

万象匣是一款基于 Electron 开发的跨平台运维自动化管控平台，专注于批量 SSH 主机管理、脚本批量执行与工程化任务编排。

## 功能特性

- **主机管理** — 主机增删改查、标签分类、Excel/CSV 批量导入导出、批量连接测试、Ping 探测
- **脚本管理** — 在线编辑器、目录树分类、参数模板化、快捷面板、语法高亮
- **任务执行** — 批量并发执行、实时进度监控、并发数/超时自定义、支持 sudo
- **工程任务** — 多步骤任务编排（脚本 + 文件上传混合）、定时执行、Webhook 通知（企业微信）
- **文件传输** — 批量文件上传、冲突策略（覆盖/备份/跳过）、断点进度反馈
- **执行历史** — 详细执行日志、结果筛选分析、CSV/JSON 导出
- **数据备份** — 自动定时备份、全量导入导出、自定义备份目录
- **仪表盘** — 主机统计、今日执行次数、成功率、待办任务一览

## 技术栈

- **Electron 27** — 跨平台桌面应用框架（Windows / macOS / Linux）
- **Node.js 18+** — 运行环境
- **node-ssh (ssh2)** — SSH 连接与 SFTP 传输
- **JSON 文件数据库** — 轻量级本地数据存储（无需外部数据库）
- **xlsx / csv-parser** — Excel 与 CSV 导入导出

## 项目结构

```
ssh_tools_box/
├── src/
│   ├── main/                # Electron 主进程
│   │   ├── main.js          # 主进程入口 + IPC 通信
│   │   ├── sshService.js    # SSH 连接/命令/文件传输服务
│   │   ├── taskExecutor.js  # 任务执行引擎
│   │   ├── projectTaskExecutor.js  # 工程任务执行器
│   │   ├── taskScheduler.js # 定时任务调度器
│   │   ├── backupService.js # 数据备份服务
│   │   └── wechatNotifier.js# 企业微信通知
│   ├── renderer/            # 渲染进程（前端界面）
│   │   ├── index.html       # 主界面
│   │   ├── css/             # 样式（tokens 化设计系统）
│   │   ├── js/              # 页面逻辑与服务层
│   │   └── lib/             # 第三方库（highlight.js / mermaid）
│   ├── database/            # 数据层（JSON 数据库 + 模型）
│   └── config/              # 配置管理
├── .github/workflows/       # GitHub Actions 自动打包 + 官网部署
├── docs/                    # 项目文档
├── website/                 # GitHub Pages 官网宣传页（主页 + 在线 Demo）
├── build.bat                # Windows 一键打包
├── build-mac.sh             # macOS 一键打包（需在 Mac 上运行）
└── package.json
```

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 安装与启动

```bash
npm install
npm run dev        # 开发模式（自动打开 DevTools）
npm start          # 正常启动
```

### 打包

**Windows（本机直接打包）：**

双击 `build.bat`，或执行：

```bash
npm run build
```

产物：`dist/` 目录下的 zip 与免安装目录。

**macOS（云端自动打包，无需 Mac 实机）：**

```bash
git tag v1.x.x && git push --tags
```

GitHub Actions 自动构建 x64 + arm64 两个 dmg，完成后在仓库 Actions 页面下载。详见 [GitHub 托管与跨平台自动打包指南](docs/GitHub托管与跨平台自动打包指南.md)。

**macOS（有 Mac 实机）：**

```bash
chmod +x build-mac.sh && ./build-mac.sh
```

## 数据存储

用户数据保存在系统应用数据目录（Windows: `%APPDATA%/万象匣`，macOS: `~/Library/Application Support/万象匣`），包括：

- `data/database.json` — 主机、脚本、任务等全部业务数据
- `ssh_keys/` — 自动生成的默认 SSH 密钥对
- `task_logs/` — 任务执行日志
- 备份目录（可在设置中自定义）

## 文档

- [GitHub 托管与跨平台自动打包指南](docs/GitHub托管与跨平台自动打包指南.md)
- [需求文档](docs/requirements/)
- [Bug 修复记录](docs/bugfixes/)

## 许可证

UNLICENSED（私有项目，保留所有权利）

---

**作者**: 侯金刚 (andy@hi-andy.com)
**仓库**: https://github.com/it-andy-hou/wanxiang-box
