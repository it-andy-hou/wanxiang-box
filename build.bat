@echo off
chcp 65001 > nul
echo ====================================
echo    万象匣 - 一键打包脚本
echo ====================================
echo.

echo [1/3] 检查依赖...
if not exist "node_modules\" (
    echo 未找到依赖，正在安装...
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败！
        pause
        exit /b 1
    )
)

echo.
echo [2/3] 清理旧的打包文件...
if exist "dist\" (
    rmdir /s /q dist
    echo 已清理 dist 目录
)

REM 移除可选原生依赖 cpu-features，避免在没有 MSVC 编译器的机器上重建失败
REM cpu-features 是 ssh2 的可选依赖，删除后 ssh2/node-ssh 仍能正常工作
if exist "node_modules\cpu-features\" (
    echo 移除可选原生依赖 cpu-features（避免 MSVC 编译报错）...
    rmdir /s /q "node_modules\cpu-features"
)

echo.
echo [3/3] 开始打包...
echo 正在构建 Windows 应用程序，请稍候...
echo.

call npm run build

if errorlevel 1 (
    echo.
    echo ====================================
    echo    打包失败！请查看错误信息
    echo ====================================
    pause
    exit /b 1
) else (
    echo.
    echo ====================================
    echo    打包成功！
    echo ====================================
    echo.
    echo 输出目录: dist\
    echo.
    if exist "dist\万象匣-*.zip" (
        echo 已生成: 万象匣-*.zip
    )
    if exist "dist\win-unpacked\" (
        echo 已生成: win-unpacked\ (可直接运行)
    )
    echo.
    echo 是否打开打包目录？(Y/N)
    choice /c YN /n
    if errorlevel 2 goto end
    if errorlevel 1 explorer dist
)

:end
echo.
pause
