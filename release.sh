#!/bin/bash
# ============================================================
# 万象匣 - macOS 一键发布脚本
# 功能：自动生成版本号 -> 更新 package.json -> 提交 -> 打 tag -> 推送 GitHub
# 触发：推送 v* tag 后，GitHub Actions 自动三平台打包并创建 Release
# 用法：./release.sh
# ============================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

pause() {
    read -r -p "按回车退出" _ || true
}

fail() {
    printf '\n发布失败：%s\n' "$1"
    pause
    exit 1
}

printf '====================================\n'
printf '   万象匣 - 一键发布 (打 tag 推送)\n'
printf '====================================\n\n'

# ---------- 0. 环境检查 ----------
if [ "$(uname)" != "Darwin" ]; then
    fail "本脚本只能在 macOS 上运行"
fi

command -v git >/dev/null 2>&1 || fail "未找到 Git，请先安装 Git"
command -v node >/dev/null 2>&1 || fail "未找到 Node.js，请先安装 Node.js"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "当前目录不是 git 仓库"

branch=$(git rev-parse --abbrev-ref HEAD) || fail "无法读取当前分支"
printf '当前分支: %s\n' "$branch"

# ---------- 1. 计算新版本号 1.yyMMdd.N ----------
today=$(date +%y%m%d)
current=$(node -p 'require("./package.json").version' 2>/dev/null) || fail "无法从 package.json 读取版本号"
[ -n "$current" ] || fail "无法从 package.json 读取版本号"
printf '当前版本: %s\n' "$current"

patch=0
if [[ "$current" =~ ^1\.$today\.([0-9]+)$ ]]; then
    patch=$((BASH_REMATCH[1] + 1))
fi

# 同步远程 tag 列表，避免与已推送的 tag 冲突
git fetch --tags --quiet 2>/dev/null || true
remote_tags=$(git ls-remote --tags origin 2>/dev/null || true)

while true; do
    version="1.$today.$patch"
    tag="v$version"
    patch=$((patch + 1))

    if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1 &&
       ! grep -Fq "refs/tags/$tag" <<<"$remote_tags"; then
        break
    fi
done

printf '新版本:   %s (tag: %s)\n\n' "$version" "$tag"

# ---------- 2. 确认 ----------
read -r -p "确认发布 v$version 并推送到 GitHub？(Y/N) " confirm || confirm=""
if [[ ! "$confirm" =~ ^[Yy] ]]; then
    printf '已取消。\n'
    pause
    exit 0
fi

# ---------- 3. 提交未保存的变更 ----------
pending=$(git status --porcelain) || fail "无法读取 Git 状态"
if [ -n "$pending" ]; then
    printf '\n检测到未提交的变更：\n'
    git status --short
    printf '\n'
    read -r -p "请输入本次迭代的提交信息 (留空则中止发布) " msg || msg=""
    [ -n "${msg//[[:space:]]/}" ] || fail "未提供提交信息"
    git add -A || fail "暂存变更失败"
    git commit -m "$msg" || fail "提交变更失败"
    printf '变更已提交: %s\n' "$msg"
fi

# ---------- 4. 更新 package.json 版本号 ----------
node -e '
const fs = require("fs");
const file = "package.json";
const raw = fs.readFileSync(file, "utf8");
const updated = raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${process.argv[1]}$2`);
if (updated === raw) process.exit(1);
fs.writeFileSync(file, updated, "utf8");
' "$version" || fail "更新 package.json 版本号失败"

git add package.json || fail "暂存版本号失败"
git commit -m "chore: release v$version" || fail "提交版本号失败"
printf '\npackage.json 版本号已更新为 %s\n' "$version"

# ---------- 5. 打 tag ----------
git tag "$tag" || fail "创建 tag 失败"
printf '已创建 tag: %s\n' "$tag"

# ---------- 6. 推送代码和 tag ----------
printf '\n正在推送分支 %s ...\n' "$branch"
git push origin "$branch" || fail "推送分支失败，请检查网络或远程权限"

printf '正在推送 tag %s ...\n' "$tag"
git push origin "$tag" || fail "推送 tag 失败"

# ---------- 7. 完成提示 ----------
printf '\n====================================\n'
printf '   发布成功！v%s 已推送\n' "$version"
printf '====================================\n\n'
printf '接下来：\n'
printf '  1. 查看打包进度: https://github.com/it-andy-hou/wanxiang-box/actions\n'
printf '  2. 三平台打包完成后，到 Releases 页面发布 Draft（草稿）:\n'
printf '     https://github.com/it-andy-hou/wanxiang-box/releases\n'
printf '  3. 发布后 /releases/latest 下载链接会自动指向 v%s\n\n' "$version"

read -r -p "是否现在打开 Actions 页面查看进度？(Y/N) " open_page || open_page=""
if [[ "$open_page" =~ ^[Yy] ]]; then
    open "https://github.com/it-andy-hou/wanxiang-box/actions" || printf '无法自动打开浏览器，请手动访问上述地址。\n'
fi

pause
