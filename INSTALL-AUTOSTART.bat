@echo off
setlocal
title Install auto-start - Win/Lose Overlay
cd /d "%~dp0"

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

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_PATH=%STARTUP_DIR%\RocketLeague-Overlay.vbs"
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
echo Auto-start installed:
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
echo Note: if the server was already running, the new instance
echo exits on its own (no duplicates possible).
echo.
echo If you ever move this folder, run INSTALL-AUTOSTART.bat again.
echo To uninstall: UNINSTALL-AUTOSTART.bat
echo.
pause
