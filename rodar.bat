@echo off
cd /d "%~dp0"
set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"

:: Instala dependências se ainda não existirem
if not exist "node_modules\.bin\electron.cmd" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host 'Instalando dependencias...' -ForegroundColor Yellow"
  npm install --no-fund --no-audit >nul 2>&1
)

:: Inicia Electron sem janela de console (Normal, não Hidden)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "Start-Process -FilePath '%DIR%\node_modules\.bin\electron.cmd' ^
  -ArgumentList '.' ^
  -WorkingDirectory '%DIR%'"
