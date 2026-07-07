@echo off
setlocal
title Auto-start toggle - Win/Lose Overlay
cd /d "%~dp0"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_PATH=%STARTUP_DIR%\RocketLeague-Overlay.vbs"

if exist "%VBS_PATH%" goto uninstall

rem ---------- Not installed -> install ----------

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Run START-WINDOWS.bat once first, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws\package.json" (
  echo.
  echo Dependencies are not installed.
  echo Run START-WINDOWS.bat once first, then run this file again.
  echo.
  pause
  exit /b 1
)

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

> "%VBS_PATH%" echo Set shell = CreateObject("WScript.Shell")
>> "%VBS_PATH%" echo shell.CurrentDirectory = "%PROJECT_DIR%"
>> "%VBS_PATH%" echo shell.Run "cmd /c node scripts\configure-stats-api.js >nul 2>&1 & node server.js", 0, False

if not exist "%VBS_PATH%" (
  echo.
  echo Failed: could not create the startup file.
  echo   %VBS_PATH%
  echo.
  pause
  exit /b 1
)

echo.
echo Auto-start INSTALLED:
echo   %VBS_PATH%
echo.
echo The server will now start in the background (invisible)
echo every time you log into Windows.
echo.
echo Starting the server now...
wscript "%VBS_PATH%"
echo.
echo Control panel : http://localhost:5177/control.html
echo OBS overlay   : http://localhost:5177/overlay.html
echo.
echo Run this file again to uninstall.
echo After code changes: run it twice (uninstall + install) to
echo restart the server with the new code.
echo If you ever move this folder, do the same to refresh the path.
echo.
pause
exit /b 0

:uninstall

del "%VBS_PATH%"
echo.
echo Auto-start REMOVED.
echo.
echo Stopping the running server (if any)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Output ('Server stopped (PID ' + $_ + ').') } catch {} }"
echo.
echo Done. The server will no longer start automatically.
echo Run this file again to reinstall, or use START-WINDOWS.bat
echo to run it manually.
echo.
pause
exit /b 0
