@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windowsLauncher.ps1" %*
set "LAUNCHER_EXIT=%errorlevel%"
if not "%LAUNCHER_EXIT%"=="0" if "%~1"=="" pause
exit /b %LAUNCHER_EXIT%
