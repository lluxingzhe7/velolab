@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在桌面创建 VeloLab 快捷方式…
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\swap-shortcuts.ps1"
echo.
echo 完成：桌面上的 VeloLab 双击即启动服务并打开网页。
pause
