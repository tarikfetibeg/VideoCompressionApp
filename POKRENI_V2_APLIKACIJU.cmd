@echo off
setlocal
cd /d "%~dp0"
title Aplikacija v2 - Desktop klijent

echo ============================================================
echo  APLIKACIJA V2 - DESKTOP KLIJENT
echo  Vite i Tauri, bez pokretanja backenda
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 goto :node_missing

where npm >nul 2>&1
if errorlevel 1 goto :npm_missing

if not exist "package.json" goto :wrong_folder
if not exist "node_modules" goto :dependencies_missing
if not exist "node_modules\.bin\tauri.cmd" goto :dependencies_missing

for /f "delims=" %%V in ('node --version') do set "NODE_VERSION=%%V"
echo Node.js: %NODE_VERSION%

if /i "%~1"=="--check" goto :check_ok

echo.
echo Ova skripta ne pokrece server.
echo Prvo pokreni POKRENI_V2_SERVER.cmd na server racunaru.
echo Desktop klijent ostaje aktivan dok je ovaj prozor otvoren.
echo.

call npm run v2:app
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Desktop klijent je zaustavljen uz gresku. Kod: %EXIT_CODE%
  pause
)

endlocal & exit /b %EXIT_CODE%

:check_ok
echo npm, Tauri CLI i projektne zavisnosti su dostupni.
echo Provjera je zavrsena bez pokretanja aplikacije.
endlocal & exit /b 0

:node_missing
echo GRESKA: Node.js nije pronadjen u PATH-u.
echo Instaliraj Node.js 20 i ponovo pokreni skriptu.
pause
endlocal & exit /b 1

:npm_missing
echo GRESKA: npm nije pronadjen u PATH-u.
echo Provjeri Node.js 20 instalaciju.
pause
endlocal & exit /b 1

:wrong_folder
echo GRESKA: package.json nije pronadjen pored ove skripte.
echo Skripta mora ostati u glavnom folderu aplikacije.
pause
endlocal & exit /b 1

:dependencies_missing
echo GRESKA: Tauri ili node_modules nisu pronadjeni.
echo U ovom folderu prvo pokreni: npm install
pause
endlocal & exit /b 1
