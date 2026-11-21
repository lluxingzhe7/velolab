@echo off
chcp 65001 >nul
cd /d "%~dp0"
set CODE=7577
set "NODE_BIN="
where node >nul 2>nul && set "NODE_BIN=node"
if not defined NODE_BIN if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_BIN if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_BIN if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_BIN=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_BIN if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_BIN=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_BIN (
  echo [x] 这台电脑没找到 node.exe。
  echo     1. 到 https://nodejs.org 下载 LTS 版安装（一路下一步即可），装完关掉本窗口重新双击我；
  echo     2. 或者把本文件第 10 行的 NODE_BIN 改成 node.exe 的实际路径。
  pause
  exit /b 1
)
echo.
echo ============================================================
echo  VeloLab 本机服务启动中（房间码固定 7577）
echo  - 电脑端页面：http://127.0.0.1:4173/
echo  - 手机端地址：https://电脑局域网IP:4173/phone.html（下面会打印可用的 IP）
echo    房间码会自动同步，不用手抄；换电脑就换成那台电脑的 IP
echo  - 手机打不开先双击「开启手机访问.bat」放行防火墙（每台电脑都要做一次）
echo  - 关掉这个窗口即停止服务
echo ============================================================
echo.
start "" http://127.0.0.1:4173/
"%NODE_BIN%" server.mjs
echo.
echo 服务已停止。
pause
