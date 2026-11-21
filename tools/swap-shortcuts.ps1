$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $PSScriptRoot
$vbs = Get-ChildItem -LiteralPath $Dir -Filter '*.vbs' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $vbs) { Write-Output 'NO_VBS'; exit 1 }
Write-Output ('VBS ' + $vbs.Name)
$startup = [Environment]::GetFolderPath('Startup')
$oldLnk = Join-Path $startup 'VeloLab.lnk'
if (Test-Path $oldLnk) { Remove-Item -LiteralPath $oldLnk -Force; Write-Output 'STARTUP_REMOVED' } else { Write-Output 'STARTUP_NONE' }
$desk = [Environment]::GetFolderPath('Desktop')
Write-Output ('DESKTOP_DIR ' + $desk)
$oldUrl = Join-Path $desk 'VeloLab.url'
if (Test-Path $oldUrl) { Remove-Item -LiteralPath $oldUrl -Force; Write-Output 'URL_REMOVED' }
$lnk = Join-Path $desk 'VeloLab.lnk'
$sh = New-Object -ComObject WScript.Shell
$sc = $sh.CreateShortcut($lnk)
$sc.TargetPath = Join-Path ([Environment]::GetFolderPath('System')) 'wscript.exe'
$sc.Arguments = '"' + $vbs.FullName + '"'
$sc.WorkingDirectory = $Dir
$sc.WindowStyle = 7
$sc.Description = 'VeloLab - start local server and open page'
$edge86 = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'
if (Test-Path $edge86) { $sc.IconLocation = $edge86 + ',0' } else { $sc.IconLocation = (Join-Path ([Environment]::GetFolderPath('System')) 'SHELL32.dll') + ',13' }
$sc.Save()
if (Test-Path $lnk) { Write-Output 'DESK_LNK_OK' } else { Write-Output 'DESK_LNK_FAILED' }
