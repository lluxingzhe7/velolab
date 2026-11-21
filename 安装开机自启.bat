@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在把 VeloLab 加入「开机自启」…
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell); $lnk=Join-Path ([Environment]::GetFolderPath('Startup')) 'VeloLab.lnk'; $sc=$s.CreateShortcut($lnk); $sc.TargetPath='wscript.exe'; $sc.Arguments='\"' + (Join-Path $PWD '静默启动.vbs') + '\"'; $sc.WorkingDirectory=$PWD.Path; $sc.WindowStyle=7; $sc.Save(); Write-Output ('OK ' + $lnk)"
if errorlevel 1 (
  echo [x] 创建快捷方式失败，可以手动把「静默启动.vbs」的快捷方式拖进 shell:startup
  pause
  exit /b 1
)
echo 现在就在后台启动一份…
start "" wscript.exe "%~dp0静默启动.vbs"
timeout /t 3 >nul
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/api/info -TimeoutSec 4; Write-Output ('服务已就绪 ' + $r.StatusCode) } catch { Write-Output '[!] 服务还没起来：可能端口被占用或 node 安装位置特殊，看 README 排查' }"
echo.
echo 完成：以后开机登录后会自动在后台运行，不弹窗。
echo 电脑上直接打开 http://127.0.0.1:4173/ ，手机打开 https://本机IP:4173/phone.html
pause
