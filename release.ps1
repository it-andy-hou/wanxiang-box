# ============================================================
# 万象匣 - 一键发布脚本
# 功能：自动生成版本号 -> 更新 package.json -> 提交 -> 打 tag -> 推送 GitHub
# 触发：推送 v* tag 后，GitHub Actions 自动三平台打包并创建 Release
# 用法：powershell -ExecutionPolicy Bypass -File release.ps1
#       或直接双击 release.bat
# ============================================================
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Fail($msg) {
    Write-Host ""
    Write-Host "发布失败：$msg" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

Write-Host "===================================="
Write-Host "   万象匣 - 一键发布 (打 tag 推送)"
Write-Host "===================================="
Write-Host ""

# ---------- 0. 环境检查 ----------
$gitOk = git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0) { Fail "当前目录不是 git 仓库" }

$branch = git rev-parse --abbrev-ref HEAD
Write-Host "当前分支: $branch"

# ---------- 1. 计算新版本号 1.yyMMdd.N ----------
$today   = Get-Date -Format "yyMMdd"
$pkgRaw  = Get-Content package.json -Raw -Encoding UTF8
$current = [regex]::Match($pkgRaw, '"version":\s*"([^"]+)"').Groups[1].Value
if (-not $current) { Fail "无法从 package.json 读取版本号" }
Write-Host "当前版本: $current"

$patch = 0
if ($current -match "^1\.$today\.(\d+)$") {
    $patch = [int]$Matches[1] + 1
}

# 同步远程 tag 列表，避免与已推送的 tag 冲突
git fetch --tags --quiet 2>$null
$remoteTags = git ls-remote --tags origin 2>$null

do {
    $version = "1.$today.$patch"
    $tag     = "v$version"
    $patch++
    $localExists  = [bool](git tag -l $tag)
    $remoteExists = [bool]($remoteTags | Select-String "refs/tags/$tag$")
} while ($localExists -or $remoteExists)

Write-Host "新版本:   $version (tag: $tag)"
Write-Host ""

# ---------- 2. 确认 ----------
$confirm = Read-Host "确认发布 v$version 并推送到 GitHub？(Y/N)"
if ($confirm -notmatch '^[Yy]') {
    Write-Host "已取消。"
    Read-Host "按回车退出"
    exit 0
}

# ---------- 3. 提交未保存的变更 ----------
$pending = git status --porcelain
if ($pending) {
    Write-Host ""
    Write-Host "检测到未提交的变更：" -ForegroundColor Yellow
    git status --short
    Write-Host ""
    $msg = Read-Host "请输入本次迭代的提交信息 (留空则中止发布)"
    if ([string]::IsNullOrWhiteSpace($msg)) { Fail "未提供提交信息" }
    git add -A
    git commit -m "$msg" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "提交变更失败" }
    Write-Host "变更已提交: $msg"
}

# ---------- 4. 更新 package.json 版本号 ----------
$pkgRaw = $pkgRaw -replace '"version":\s*"[^"]+"', "`"version`": `"$version`""
[System.IO.File]::WriteAllText("$PSScriptRoot\package.json", $pkgRaw, (New-Object System.Text.UTF8Encoding($false)))
git add package.json
git commit -m "chore: release v$version" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "提交版本号失败" }
Write-Host ""
Write-Host "package.json 版本号已更新为 $version"

# ---------- 5. 打 tag ----------
git tag $tag
if ($LASTEXITCODE -ne 0) { Fail "创建 tag 失败" }
Write-Host "已创建 tag: $tag"

# ---------- 6. 推送代码和 tag ----------
Write-Host ""
Write-Host "正在推送分支 $branch ..."
git push origin $branch
if ($LASTEXITCODE -ne 0) { Fail "推送分支失败，请检查网络或远程权限" }

Write-Host "正在推送 tag $tag ..."
git push origin $tag
if ($LASTEXITCODE -ne 0) { Fail "推送 tag 失败" }

# ---------- 7. 完成提示 ----------
Write-Host ""
Write-Host "====================================" -ForegroundColor Green
Write-Host "   发布成功！v$version 已推送" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green
Write-Host ""
Write-Host "接下来："
Write-Host "  1. 查看打包进度: https://github.com/it-andy-hou/wanxiang-box/actions"
Write-Host "  2. 三平台打包完成后，到 Releases 页面发布 Draft（草稿）:"
Write-Host "     https://github.com/it-andy-hou/wanxiang-box/releases"
Write-Host "  3. 发布后 /releases/latest 下载链接会自动指向 v$version"
Write-Host ""

$open = Read-Host "是否现在打开 Actions 页面查看进度？(Y/N)"
if ($open -match '^[Yy]') {
    Start-Process "https://github.com/it-andy-hou/wanxiang-box/actions"
}

Read-Host "按回车退出"
