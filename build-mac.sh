#!/bin/bash
# ============================================================
# 万象匣 - macOS 一键打包脚本
# 注意：本脚本只能在 macOS 上运行（dmg 打包依赖 macOS 工具链）
# 不影响 Windows 的 build.bat 打包流程
# ============================================================

set -e

echo "===================================="
echo "   万象匣 - macOS 一键打包脚本"
echo "===================================="
echo

# 检查运行环境
if [ "$(uname)" != "Darwin" ]; then
    echo "错误：本脚本只能在 macOS 上运行！"
    echo "Windows 用户请使用 build.bat"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误：未找到 Node.js，请先安装 Node.js 18+"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

echo "[1/3] 检查依赖..."
if [ ! -d "node_modules" ]; then
    echo "未找到依赖，正在安装..."
    npm install
    if [ $? -ne 0 ]; then
        echo "依赖安装失败！"
        exit 1
    fi
fi

echo
echo "[2/3] 清理旧的打包文件..."
if [ -d "dist" ]; then
    rm -rf dist
    echo "已清理 dist 目录"
fi

# 移除可选原生依赖 cpu-features，避免跨平台编译问题
# cpu-features 是 ssh2 的可选依赖，删除后 ssh2/node-ssh 仍能正常工作
if [ -d "node_modules/cpu-features" ]; then
    echo "移除可选原生依赖 cpu-features（避免编译报错）..."
    rm -rf node_modules/cpu-features
fi

echo
echo "[3/3] 开始打包..."
echo "正在构建 macOS 应用程序（x64 + arm64），请稍候..."
echo

npm run build:mac

if [ $? -ne 0 ]; then
    echo
    echo "===================================="
    echo "   打包失败！请查看错误信息"
    echo "===================================="
    exit 1
else
    echo
    echo "===================================="
    echo "   打包成功！"
    echo "===================================="
    echo
    echo "输出目录: dist/"
    ls -lh dist/*.dmg 2>/dev/null || true
    ls -lh dist/*.zip 2>/dev/null || true
    echo
    echo "提示：未签名的应用在用户首次打开时可能被 Gatekeeper 拦截，"
    echo "     请提示用户：右键点击应用 -> 打开，或在"
    echo "     系统设置 -> 隐私与安全性 中允许运行。"
    echo
    # 自动打开输出目录
    open dist
fi
