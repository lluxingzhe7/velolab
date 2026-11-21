@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lnk=Join-Path ([Environment]::GetFolderPath('Startup')) 'VeloLab.lnk'; if (Test-Path $lnk) { Remove-Item $lnk; Write-Output '已移除开机自启' } else { Write-Output '没有找到开机自启项' }"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output ('已停止后台服务 pid=' + $_.ProcessId) }"
pause
