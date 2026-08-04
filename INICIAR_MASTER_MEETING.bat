@echo off
chcp 65001 >nul
title Master Meeting - Captura Provisoria
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit ^
  -File "%~dp0scripts\master-meeting-cli.ps1" ^
  -RepoRoot "%~dp0."
