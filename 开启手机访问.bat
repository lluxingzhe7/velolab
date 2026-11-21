@echo off
chcp 65001 >nul
title VeloLab 放行手机访问（TCP 4173）
if /i "%~1"=="elev" goto run
echo 正在请求管理员权限，请在弹窗里点【是】。
powershell -NoProfile -Command "Start-Process -Verb RunAs -Wait -FilePath '%~f0' -ArgumentList 'elev'"
exit /b

:run
echo ---- 添加防火墙入站规则 ----
netsh advfirewall firewall add rule name=VeloLab-4173 dir=in action=allow protocol=TCP localport=4173
echo.
echo ---- 检查结果 ----
netsh advfirewall firewall show rule name=VeloLab-4173 | findstr /i "VeloLab-4173"
echo.
echo 出现 VeloLab-4173 这一行 = 已生效，回手机刷新页面即可。
echo 没出现 = 规则没加上，请重新双击本文件并确认点的是【是】。
pause