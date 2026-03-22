@echo off
title FiscoBot Pro 2.0 - Instalador
color 0A
cd /d "%~dp0"
set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"
set "PS1=%TEMP%\fiscobot_install.ps1"
set "PS2=%TEMP%\fiscobot_shortcut.ps1"
set "FLAG=%TEMP%\fiscobot_done.tmp"

cls
echo.
echo.

:: ── Logo ─────────────────────────────────────────
powershell -NoProfile -Command "Write-Host '  _____ _                 ____        _    ' -ForegroundColor DarkYellow"
powershell -NoProfile -Command "Write-Host ' |  ___(_)___  ___ ___  | __ )  ___ | |_ ' -ForegroundColor DarkYellow"
powershell -NoProfile -Command "Write-Host ' | |_  | / __|/ __/ _ \ |  _ \ / _ \| __|' -ForegroundColor Yellow"
powershell -NoProfile -Command "Write-Host ' |  _| | \__ \ (_| (_) || |_) | (_) | |_ ' -ForegroundColor Green"
powershell -NoProfile -Command "Write-Host ' |_|   |_|___/\___\___/ |____/ \___/ \__|' -ForegroundColor Green"
powershell -NoProfile -Command "Write-Host '               P R O  2 . 0' -ForegroundColor Cyan"
echo.

:: ── Node.js ───────────────────────────────────────
powershell -NoProfile -Command "Write-Host '  Verificando Node.js...' -ForegroundColor DarkGray"
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  powershell -NoProfile -Command "Write-Host '  ERRO: Node.js nao encontrado!' -ForegroundColor Red"
  powershell -NoProfile -Command "Write-Host '  Abrindo download...' -ForegroundColor DarkGray"
  start https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi
  echo.
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do (
  powershell -NoProfile -Command "Write-Host '  OK  Node.js %%v' -ForegroundColor Green"
)
echo.

:: ── Instalando ────────────────────────────────────
powershell -NoProfile -Command "Write-Host '  Instalando...' -ForegroundColor White"
echo.

if exist "%FLAG%" del /f /q "%FLAG%" >nul 2>&1
if exist "%PS1%"  del /f /q "%PS1%"  >nul 2>&1

:: Escreve o .ps1 usando [string][char] para multiplicação funcionar
(
  echo $flag = '%FLAG%'
  echo $n    = 38
  echo $blk  = [string][char]9608
  echo $i    = 0
  echo while ^(-not ^(Test-Path $flag^)^) {
  echo   $f   = [math]::Min^($i, $n^)
  echo   $pct = [math]::Min^([math]::Round^($f / $n * 100^), 99^)
  echo   $bar = '  instalando  [' + ^($blk * $f^) + ^(' ' * ^($n - $f^)^) + ']  ' + $pct + '%%'
  echo   Write-Host $bar -NoNewline -ForegroundColor Cyan
  echo   Write-Host '          ' -NoNewline
  echo   [Console]::SetCursorPosition^(0, [Console]::CursorTop^)
  echo   Start-Sleep -Milliseconds 120
  echo   if ^($i -lt $n^) { $i++ }
  echo }
  echo $bar = '  instalando  [' + ^($blk * $n^) + ']  100%%'
  echo Write-Host $bar -ForegroundColor Cyan
) > "%PS1%"

:: npm install em background no diretório correto
start /B cmd /c "cd /d "%DIR%" && npm install --no-fund --no-audit >nul 2>&1 && echo done > "%FLAG%""

:: Barra de progresso
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"

:: Aguarda npm terminar
:WAIT
if not exist "%FLAG%" ( timeout /t 1 /nobreak >nul & goto WAIT )
del /f /q "%FLAG%" >nul 2>&1
del /f /q "%PS1%"  >nul 2>&1

echo.
powershell -NoProfile -Command "Write-Host '  v  Aplicativo instalado com sucesso!' -ForegroundColor Green"
echo.

:: ── Atalho ────────────────────────────────────────
(
  echo $ws  = New-Object -ComObject WScript.Shell
  echo $lnk = [Environment]::GetFolderPath^('Desktop'^) + '\FiscoBot Pro.lnk'
  echo $s   = $ws.CreateShortcut^($lnk^)
  echo $s.TargetPath       = '%DIR%\rodar.bat'
  echo $s.WorkingDirectory = '%DIR%'
  echo $s.WindowStyle      = 7
  echo $s.Save^(^)
  echo Write-Host '  Atalho criado na Area de Trabalho' -ForegroundColor DarkGray
) > "%PS2%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS2%"
del /f /q "%PS2%" >nul 2>&1

:: ── Inicia Electron ───────────────────────────────
echo.
powershell -NoProfile -Command "Write-Host '  Iniciando FiscoBot Pro...' -ForegroundColor DarkGray"
echo.
start "" "%DIR%\node_modules\.bin\electron.cmd" .
timeout /t 4 /nobreak >nul
powershell -NoProfile -Command "Write-Host '  FiscoBot rodando! Pode fechar esta janela.' -ForegroundColor DarkGray"
powershell -NoProfile -Command "Write-Host '  Se nao abrir: http://localhost:3737' -ForegroundColor DarkGray"
echo.
pause
