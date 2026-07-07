@echo off
setlocal
title Rocket League Win/Lose Overlay
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo.
    echo Node.js n'est pas installe.
    echo Installation de Node.js LTS avec winget...
    echo.
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
      echo.
      echo Echec installation Node.js via winget.
      echo Installe la version LTS ici : https://nodejs.org/
      echo Puis relance ce fichier.
      echo.
      pause
      exit /b 1
    )
    echo.
    echo Node.js a ete installe.
    echo Ferme cette fenetre puis relance START-WINDOWS.bat pour charger le PATH.
    echo.
    pause
    exit /b 0
  )
  echo.
  echo Node.js n'est pas installe.
  echo Installe la version LTS ici : https://nodejs.org/
  echo Puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo npm est introuvable alors que Node.js est installe.
  echo Reinstalle Node.js LTS en cochant l'option npm, puis relance ce fichier.
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
  echo Installation des dependances...
  if exist package-lock.json (
    call npm ci --omit=dev
  ) else (
    call npm install --omit=dev
  )
  if errorlevel 1 (
    echo.
    echo Echec installation des dependances.
    echo Verifie ta connexion internet, puis relance ce fichier.
    pause
    exit /b 1
  )
  echo Dependances OK.
)

echo Configuration Stats API Rocket League...
node scripts\configure-stats-api.js
if errorlevel 2 (
  echo.
  echo La config Stats API demande peut-etre les droits admin.
  echo Si le panneau reste en connecting, relance START-WINDOWS.bat en administrateur.
)

start "" "http://localhost:5177/control.html"
echo.
echo Overlay OBS lance.
echo Panneau: http://localhost:5177/control.html
echo OBS:     http://localhost:5177/overlay.html
echo.
npm start
pause
