@echo off
chcp 65001 >nul
title Voyage Voyage Rally
cd /d "%~dp0"

echo ============================================
echo   VOYAGE VOYAGE RALLY
echo   Preparation du serveur de course...
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe.
  echo.
  echo 1. Ouvrez https://nodejs.org
  echo 2. Telechargez la version LTS ^(bouton verte a gauche^)
  echo 3. Installez-la ^(options par defaut^), puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] Installation des composants ^(premiere fois seulement^)...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo [ERREUR] L'installation a echoue. Verifiez votre connexion internet.
    pause
    exit /b 1
  )
  echo.
)

if not exist "packages\server\dist\index.js" (
  echo [2/3] Compilation du jeu ^(premiere fois seulement^)...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [ERREUR] La compilation a echoue.
    pause
    exit /b 1
  )
  echo.
)

echo [3/3] Demarrage du serveur de course...
echo.
echo ============================================
echo   Le navigateur va s'ouvrir sur la page
echo   de connexion du jeu.
echo.
echo   CODE D'ACCES PAR DEFAUT : rally
echo.
echo   Gardez cette fenetre OUVERTE pendant
echo   la course - c'est le serveur du jeu.
echo   Pour arreter : fermez cette fenetre.
echo ============================================
echo.

start "" http://localhost:8080
call node packages\server\dist\index.js

echo.
echo Serveur arrete. Appuyez sur une touche pour fermer.
pause >nul
