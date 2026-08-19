@echo off
setlocal
title Tile Rush - Jogo em LAN

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-lan.ps1"

set "EXIT_CODE=%ERRORLEVEL%"
echo.

if not "%EXIT_CODE%"=="0" (
    echo Nao foi possivel iniciar o jogo em LAN.
) else (
    echo O jogo esta ativo. Esta janela pode ser fechada.
)

pause
exit /b %EXIT_CODE%
