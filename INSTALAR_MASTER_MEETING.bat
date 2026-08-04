@echo off
chcp 65001 >nul
title Master Meeting - Instalador
cd /d "%~dp0"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Solicitando permissao de administrador...
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0scripts\install-master-meeting.ps1" ^
  -InstallerRoot "%~dp0."

set "INSTALL_EXIT=%errorlevel%"
echo.
if "%INSTALL_EXIT%"=="0" (
    echo Instalacao finalizada.
) else (
    echo O instalador terminou com o codigo %INSTALL_EXIT%.
)
echo.
pause
exit /b %INSTALL_EXIT%
