# GitHub 托管与跨平台自动打包指南（可复用）

> 适用场景：Electron（或其他有构建脚本的项目）需要托管到 GitHub，并通过 GitHub Actions 在云端自动打包 macOS / Windows / Linux 安装包。
>
> 本文以「万象匣」项目为实例，其他项目复用时只需替换仓库名、产物路径等少量内容。

---

## 目录

1. [总体架构](#1-总体架构)
2. [首次接入：从本地项目到 GitHub](#2-首次接入从本地项目到-github)
3. [必备文件清单（复制即可复用）](#3-必备文件清单复制即可复用)
4. [日常使用：如何提交与推送代码](#4-日常使用如何提交与推送代码)
5. [触发自动打包](#5-触发自动打包)
6. [下载打包产物](#6-下载打包产物)
7. [常见问题与排查](#7-常见问题与排查)
8. [安全清单（每次新项目必查）](#8-安全清单每次新项目必查)
9. [官网宣传页（GitHub Pages）](#9-官网宣传页github-pages)

---

## 1. 总体架构

```
本地开发机 (Windows/Mac)
    │  git push
    ▼
GitHub 仓库（私有仓库即可，Actions 免费额度足够）
    │  触发条件：推送 v* tag 或网页手动 Run workflow
    ▼
GitHub Actions 云端构建机（macos-latest / windows-latest / ubuntu-latest）
    │
    ▼
Artifacts（构建产物，dmg / zip / AppImage，保留 30 天）
```

**核心结论**：

- **不需要开源**。私有仓库一样能用 Actions（免费账户每月 2000 分钟，macOS 机器按 10 倍计费 ≈ 200 分钟/月，一次打包约 10~15 分钟，个人使用足够）。
- **dmg 只能在 macOS 上打包**（依赖 macOS 的 hdiutil 工具链），Windows 机器无法产出 dmg，所以 Mac 包交给 GitHub 的云端 Mac 机器打。
- **三平台云端打包**：工作流采用矩阵（matrix）方案，`macos-latest` / `windows-latest` / `ubuntu-latest` 三个 runner 并行构建，一次触发同时产出 mac dmg、win zip、linux AppImage。Windows 包也可以继续本地用 `build.bat` 打。

---

## 2. 首次接入：从本地项目到 GitHub

### 2.1 前置条件

| 项目 | 检查命令 | 说明 |
|------|---------|------|
| Git | `git --version` | 没有则到 git-scm.com 下载安装 |
| Git 身份 | `git config user.name` / `git config user.email` | 为空则先配置 |
| GitHub 账号 | — | 网页注册即可 |
| 网络 | — | 国内访问 GitHub 建议准备代理（见 7.1） |

### 2.2 GitHub 网页创建仓库

1. github.com → 右上角 **+** → **New repository**
2. 填写仓库名 → 选择 **Private**
3. **Add README / .gitignore / license 全部保持关闭**（勾了会导致远程与本地历史不一致，首次推送冲突）
4. 点击 **Create repository**

### 2.3 本地初始化并推送

在项目根目录执行（PowerShell 用分号 `;` 分隔命令）：

```powershell
git init
git add .
git commit -m "初始提交"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> ⚠️ 执行 `git add .` 之前，**务必先配好 `.gitignore`**（见 3.1），否则敏感文件一旦提交进历史，仅删除文件是不够的。

### 2.4 验证

- GitHub 网页刷新仓库，确认代码已上传
- **逐条确认敏感文件不存在**（如 `id_rsa`、导出的数据文件等）

---

## 3. 必备文件清单（复制即可复用)

### 3.1 `.gitignore`（项目根目录）

```gitignore
# 依赖与构建产物
node_modules/
dist/

# 敏感文件：密钥类，绝不能上传
id_rsa
id_rsa.pub
*.pem
*.key

# 本地数据与配置（可能包含真实密码）
database/
config/
*.xlsx
*.zip

# 系统与编辑器
.DS_Store
Thumbs.db
.vscode/
.idea/
```

> 按项目实际情况增删。原则：**任何含密钥、密码、真实业务数据的文件都不进仓库**。

### 3.2 `.gitattributes`（项目根目录）

```gitattributes
# 保证 shell 脚本在任何平台 checkout 都是 LF 换行，否则 macOS/Linux 下无法执行
*.sh text eol=lf
```

### 3.3 GitHub Actions 工作流 `.github/workflows/build-all.yml`

采用矩阵（matrix）方案，一个工作流文件同时覆盖三平台并行打包：

```yaml
name: Build All Platforms

on:
  push:
    tags:
      - 'v*'            # 推送 v 开头的 tag 触发
  workflow_dispatch:    # 支持网页手动触发

# 必须显式授权写权限，否则 electron-builder 创建 GitHub Release 时报 403
permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false   # 单个平台失败不取消其他平台
      matrix:
        include:
          - os: macos-latest
            script: build:mac
            artifact: my-app-mac
            files: |
              dist/*.dmg
              dist/*.zip
          - os: windows-latest
            script: build:win
            artifact: my-app-win
            files: dist/*.zip
          - os: ubuntu-latest
            script: build:linux
            artifact: my-app-linux
            files: dist/*.AppImage

    runs-on: ${{ matrix.os }}

    steps:
      - name: 检出代码
        uses: actions/checkout@v4

      - name: 安装 Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: 安装依赖
        run: npm install

      # Electron+ssh2 项目特有，其他项目可删；仅 macOS 需要
      - name: 移除可选原生依赖 cpu-features
        if: runner.os == 'macOS'
        run: rm -rf node_modules/cpu-features

      - name: 打包
        run: npm run ${{ matrix.script }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}   # 无需手动创建，Actions 自动注入

      - name: 上传打包产物
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: ${{ matrix.files }}
          retention-days: 30
```

**三平台产物一览**：

| 平台 | Runner | 产物格式 | Artifact 名称 |
|------|--------|---------|---------------|
| macOS | macos-latest | dmg × 2（x64 + arm64） | my-app-mac |
| Windows | windows-latest | zip | my-app-win |
| Linux | ubuntu-latest | AppImage | my-app-linux |

### 3.4 package.json 需要的配置（Electron 项目）

```json
{
  "scripts": {
    "build": "electron-builder",
    "build:mac": "electron-builder --mac",
    "build:win": "electron-builder --win",
    "build:linux": "electron-builder --linux"
  },
  "build": {
    "appId": "com.example.app",
    "productName": "应用名",
    "directories": { "output": "dist" },
    "files": ["src/**/*", "node_modules/**/*"],
    "win":   { "target": "zip", "icon": "docs/icon.ico" },
    "mac":   { "target": { "target": "dmg", "arch": ["x64", "arm64"] }, "icon": "docs/icon.png" },
    "linux": { "target": "AppImage", "icon": "docs/icon.png" }
  }
}
```

**注意**：

- Mac 图标要求 **≥512×512 的 PNG**（electron-builder 会自动转 icns）或直接用 `.icns`
- `arch: ["x64", "arm64"]` 会同时产出 Intel 和 Apple Silicon 两个 dmg

### 3.5 本地 Mac 打包脚本 `build-mac.sh`（可选，有真机时使用）

本项目根目录已有 [build-mac.sh](../build-mac.sh)，可直接拷贝。使用方式：

```bash
chmod +x build-mac.sh && ./build-mac.sh
```

---

## 4. 日常使用：如何提交与推送代码

日常开发完成后，标准三步：

```powershell
git add .                  # 1. 暂存所有改动（或 git add 指定文件）
git commit -m "说明文字"    # 2. 提交到本地仓库
git push                   # 3. 推送到 GitHub
```

**如果 push 卡住或超时（国内网络常见）**，走本机代理（端口以你的代理软件为准，常见 7890）：

```powershell
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push
```

> 这种 `-c` 写法只对本次命令生效，不会修改全局配置、不影响其他项目。

**其他常用命令**：

```powershell
git status                 # 查看哪些文件有改动
git log --oneline -5       # 查看最近 5 条提交
git pull                   # 拉取远程最新代码（多人/多机协作时）
```

---

## 5. 触发自动打包

两种方式任选：

**方式 A：打 tag（推荐，用于正式发版）**

```powershell
git tag v1.0.0
git push --tags
# 网络不好时：
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push --tags
```

**方式 B：网页手动触发**

GitHub 仓库页 → **Actions** 标签 → 左侧选 **Build All Platforms** → 右侧 **Run workflow** 按钮。

---

## 6. 下载打包产物

1. 打开 `https://github.com/<用户名>/<仓库名>/actions`
2. 点进对应的那次运行记录（黄色圆点=运行中，绿色勾=成功，红色叉=失败）
3. 页面底部 **Artifacts** 区域下载压缩包，三个平台的产物分别对应 `*-mac` / `*-win` / `*-linux` 三个 Artifact
4. 约 10~15 分钟构建完成（三平台并行，总时长取决于最慢的平台）

**Mac 用户首次打开未签名应用**：右键应用图标 → 打开 → 再点「打开」确认（绕过 Gatekeeper 警告，只需一次）。

---

## 7. 常见问题与排查

### 7.1 `Failed to connect to github.com port 443: Timed out`

国内网络访问 GitHub 不稳定。确认本机代理已开启，然后 push 时加 `-c http.proxy=...` 参数（见 4 节）。

### 7.2 `Invalid username or token. Password authentication is not supported`

GitHub 已禁止密码认证。解决：

```powershell
# 启用 Git 自带的凭据管理器（一次即可）
git config --global credential.helper manager-core

# 清除可能缓存的错误凭据
"protocol=https`nhost=github.com`n" | git credential-manager-core erase

# 重新 push，会弹出浏览器授权窗口，登录 GitHub 授权即可
git push
```

### 7.3 Actions 构建失败

- 点进失败的运行记录 → 点红色的 job → 展开红色步骤查看日志
- Electron 项目常见原因：
  - 图标尺寸不足 512×512
  - 原生依赖（如 cpu-features）编译失败 → 加 `rm -rf node_modules/cpu-features` 步骤
  - `npm install` 网络超时 → 重跑即可（job 页面右上角 Re-run failed jobs）

### 7.4 打包成功但报 `403 Resource not accessible by integration`

**现象**：dmg 构建成功，最后上传 Release 时报 403，日志含 `Resource not accessible by integration`。

**原因**：GitHub Actions 的 `GITHUB_TOKEN` 默认只有只读权限，electron-builder 在 tag 触发时会自动创建 Release 并上传产物，需要写权限。

**修复**：在工作流 yml 中添加：

```yaml
permissions:
  contents: write
```

然后删除旧 tag 并重新推送以触发重新构建：

```powershell
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0
git tag v1.0.0
git push --tags
```

### 7.5 私有仓库额度不够用

GitHub 免费账户私有仓库 2000 分钟/月，macOS 按 10 倍计。用量查看：**Settings → Billing → Usage**。超出后可将仓库转 Public（开源），Actions 即免费不限量——前提是代码中没有敏感信息。

---

## 8. 安全清单（每次新项目必查）

- [ ] `.gitignore` 已配置，且在**首次 `git add` 之前**就创建好
- [ ] 仓库中不存在私钥/证书文件（`id_rsa`、`*.pem`、`*.key`）
- [ ] 仓库中不存在含真实密码的数据文件（导出的 Excel、数据库文件、本地 config）
- [ ] 敏感文件**如果曾经误提交**：删除文件后仍需清理历史（`git filter-repo`），且相关密钥**视为已泄露，必须重新生成**
- [ ] 工作流中的 `GH_TOKEN` 是 Actions 自动注入的临时凭证，无需也不应手动创建密钥

---

## 9. 官网宣传页（GitHub Pages）

除自动打包外，仓库还附带一个静态官网宣传页，方便对外展示与分发：

### 9.1 目录与工作流

- 页面源码：`website/index.html`（宣传主页，样式遵循项目 DESIGN.md 设计系统）
- 在线 Demo：`website/demo/index.html`（完整交互式界面演示，与 `demo/` 同步）
- Logo 素材：`website/assets/logo.png`
- 部署工作流：`.github/workflows/website.yml`，触发条件：
  - 推送 `main` 分支且 `website/` 目录有改动
  - 网页手动 Run workflow

### 9.2 首次启用（一次性）

1. GitHub 仓库 → **Settings → Pages** → **Build and deployment** → Source 选 **GitHub Actions**
2. 推送 `website/` 目录后自动触发部署，或在 Actions 页面手动运行 "Deploy Workflow"
3. 部署完成后访问：`https://<用户名>.github.io/<仓库名>/`

本项目地址：**https://it-andy-hou.github.io/wanxiang-box/**

### 9.3 注意事项

- 私有仓库同样支持 Pages，但**访问者需要登录且有权限**，对外宣传请将仓库设为 Public
- Pages 流量免费额度：软限 100GB/月，静态宣传页远达不到
- 页面内链接使用相对路径（`./assets/...`、`./demo/`），因此部署在项目子路径下也不会失效
- 修改官网后无需手动发布，push 到 `main` 即自动更新

---

**文档版本**：v1.1  
**适用项目**：万象匣（wanxiang-box）及后续 Electron 项目  
**最后更新**：2026-09-16
