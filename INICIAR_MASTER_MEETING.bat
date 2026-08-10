@echo off
chcp 65001 >nul
title Master Meeting - Inicializador
cd /d "%~dp0"

echo ============================================================
echo MASTER MEETING
echo ============================================================
echo.

echo Iniciando servicos do Master Meeting...

docker compose ^
  --env-file "%~dp0deploy\compose\.env" ^
  -f "%~dp0deploy\compose\docker-compose.yml" ^
  up -d

if errorlevel 1 (
    echo.
    echo ERRO ao iniciar os servicos.
    pause
    exit /b 1
)

echo.
echo Servicos iniciados.
echo Abrindo painel da API...

timeout /t 2 /nobreak >nul

REM Abre especificamente no Google Chrome
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "http://localhost:13000"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "http://localhost:13000"
) else (
    REM Caso o Chrome esteja instalado em outro local, usa o navegador padrao
    start "" "http://localhost:13000"
)

echo.
echo Abrindo captura do Google Meet...

start "Master Meeting - Captura" powershell.exe ^
  -NoLogo ^
  -NoProfile ^
  -ExecutionPolicy Bypass ^
  -NoExit ^
  -File "%~dp0scripts\master-meeting-cli.ps1" ^
  -RepoRoot "%~dp0."

exit /b 0
