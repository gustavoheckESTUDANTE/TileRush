@echo off
setlocal
title Tile Rush - Link Cloudflare
cd /d "%~dp0"

if not exist "tools\cloudflared.exe" (
    echo Baixando Cloudflare Tunnel...
    if not exist "tools" mkdir "tools"
    powershell.exe -NoProfile -Command "Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'tools\cloudflared.exe'"
    if errorlevel 1 goto :error
)

echo Compilando o jogo...
call npm.cmd run build
if errorlevel 1 goto :error

echo Iniciando o servidor...
start "Tile Rush - Servidor" /min /D "%~dp0" npm.cmd start
timeout /t 3 /nobreak >nul

echo.
echo LINK PUBLICO DO JOGO:
echo O endereco trycloudflare.com aparecera abaixo.
echo Mantenha esta janela aberta enquanto estiver jogando.
echo.

tools\cloudflared.exe tunnel --url http://127.0.0.1:3001 --protocol http2

echo.
echo O tunel foi encerrado.
pause
exit /b 0

:error
echo.
echo Nao foi possivel iniciar o jogo online.
pause
exit /b 1
