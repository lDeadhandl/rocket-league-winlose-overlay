@echo off
setlocal
title Uninstall auto-start - Win/Lose Overlay

set "VBS_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RocketLeague-Overlay.vbs"

if exist "%VBS_PATH%" (
  del "%VBS_PATH%"
  echo Auto-start removed.
) else (
  echo Auto-start was not installed.
)

echo Stopping the running server (if any)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Output ('Server stopped (PID ' + $_ + ').') } catch {} }"

echo.
echo Done. The server will no longer start automatically.
echo You can still start it manually with START-WINDOWS.bat.
echo.
pause
