@echo off
title FiscoBot Pro - Gerando .exe
color 0A
cd /d "%~dp0"

cls
echo.
echo  ============================================
echo    FiscoBot Pro - Gerador de Instalador
echo    Gera: dist\FiscoBot Pro Setup 1.0.0.exe
echo  ============================================
echo.

echo  [1/3] Verificando dependencias...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 ( echo  ERRO: Node.js nao encontrado! & pause & exit /b 1 )
if not exist "node_modules\electron" (
  echo  Instalando dependencias primeiro...
  call npm install
  if %ERRORLEVEL% NEQ 0 ( echo  ERRO npm install! & pause & exit /b 1 )
)
echo  OK

echo.
echo  [2/3] Compilando FiscoBot Pro...
echo  (Isso pode levar 2-5 minutos)
echo.
call npx electron-builder --win --x64

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo  ERRO ao compilar!
  echo  Verifique a conexao com internet.
  pause & exit /b 1
)

echo.
echo  ============================================
echo    SUCESSO!
echo    Instalador: dist\FiscoBot Pro Setup 1.0.0.exe
echo    Distribua esse .exe para instalar em
echo    qualquer Windows sem precisar de Node.js!
echo  ============================================
echo.
explorer "%~dp0dist"
pause
