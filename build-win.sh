#!/bin/bash
# ============================================================
# 万象匣 - Windows 版打包脚本
# 用途：在 macOS 上交叉打包 Windows 版（zip），拷到 Windows
#       机器解压后即可本地测试；也可直接在 Windows 的
#       Git Bash 中运行（等价于 build.bat）
#
# 说明：
#   1. Windows 构建目标为 zip（见 package.json 的 build.win.target），
#      不依赖 wine，可在 macOS 上交叉打包。
#   2. 交叉打包时禁用 npmRebuild（非 Windows 环境无法为 win32 重编译
#      原生模块）。ssh2 的原生加密绑定在 Windows 上加载失败时会自动
#      回退到纯 JS 实现，功能不受影响。
#   3. cpu-features 是 ssh2 的可选原生依赖，移除后不影响使用。
# ============================================================

set -e

echo "===================================="
echo "   万象匣 - Windows 版打包脚本"
echo "===================================="
echo

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
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        # Windows 环境可直接为 win32 重编译原生模块
        echo "检测到 Windows 环境，执行原生构建..."
        npm run build:win
        ;;
    *)
        # macOS/Linux 交叉打包：禁用原生重编译，打包后 ssh2 自动回退纯 JS
        echo "非 Windows 环境，交叉打包 Windows 版（禁用原生重编译）..."
        npx electron-builder --win --config.npmRebuild=false
        ;;
esac

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
    ls -lh dist/*.zip 2>/dev/null || true
    echo
    echo "测试方法：把 dist/ 下的 zip 拷贝到 Windows 机器，"
    echo "解压后运行 win-unpacked/万象匣.exe 即可。"
    echo
fi
