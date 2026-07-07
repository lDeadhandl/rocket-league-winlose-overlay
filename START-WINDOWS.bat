@echo off
setlocal
title Rocket League Win/Lose Overlay
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo.
    echo Node.js is not installed.
    echo Installing Node.js LTS with winget...
    echo.
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
      echo.
      echo Node.js installation via winget failed.
      echo Install the LTS version from here: https://nodejs.org/
      echo Then run this file again.
      echo.
      pause
      exit /b 1
    )
    echo.
    echo Node.js has been installed.
    echo Close this window and run START-WINDOWS.bat again to reload the PATH.
    echo.
    pause
    exit /b 0
  )
  echo.
  echo Node.js is not installed.
  echo Install the LTS version from here: https://nodejs.org/
  echo Then run this file again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo npm was not found even though Node.js is installed.
  echo Reinstall Node.js LTS with the npm option enabled, then run this file again.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo Rocket League Win/Lose Overlay
echo.

set "NEED_INSTALL=0"
if not exist "node_modules\ws\package.json" set "NEED_INSTALL=1"
node -e "require('ws')" >nul 2>nul
if errorlevel 1 set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" (
  echo Installing dependencies...
  if exist package-lock.json (
    call npm ci --omit=dev
  ) else (
    call npm install --omit=dev
  )
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    echo Check your internet connection, then run this file again.
    pause
    exit /b 1
  )
  echo Dependencies OK.
)

echo Configuring the Rocket League Stats API...
node scripts\configure-stats-api.js
if errorlevel 2 (
  echo.
  echo The Stats API config may require admin rights.
  echo If the panel stays on connecting, run START-WINDOWS.bat as administrator.
)

start "" "http://localhost:5177/control.html"
echo.
echo OBS overlay started.
echo Panel: http://localhost:5177/control.html
echo OBS:   http://localhost:5177/overlay.html
echo.
npm start
pause
