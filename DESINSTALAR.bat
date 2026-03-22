@echo off
title FiscoBot Pro - Desinstalador
color 0C
cd /d "%~dp0"
set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"

cls
echo.
echo  ============================================
echo    FiscoBot Pro - Desinstalador
echo  ============================================
echo.
echo  Isso vai remover o FiscoBot Pro do computador.
echo  Pressione qualquer tecla para continuar
echo  ou feche esta janela para cancelar.
echo.
pause >nul

:: 1. Encerra o processo se estiver rodando
echo  [1/5] Encerrando FiscoBot Pro...
taskkill /F /IM electron.exe /T >nul 2>&1
taskkill /F /IM "FiscoBot Pro.exe" /T >nul 2>&1
taskkill /F /IM node.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul
echo  OK

:: 2. Remove atalho da Area de Trabalho
echo.
echo  [2/5] Removendo atalho da Area de Trabalho...
if exist "%USERPROFILE%\Desktop\FiscoBot Pro.lnk" (
  del /f /q "%USERPROFILE%\Desktop\FiscoBot Pro.lnk" >nul 2>&1
  echo  OK - Atalho removido
) else (
  echo  OK - Atalho nao encontrado
)

:: 3. Remove atalho do Menu Iniciar
echo.
echo  [3/5] Removendo atalho do Menu Iniciar...
set "SM=%APPDATA%\Microsoft\Windows\Start Menu\Programs\FiscoBot Pro"
if exist "%SM%" (
  rmdir /s /q "%SM%" >nul 2>&1
  echo  OK
) else (
  echo  OK - Nao encontrado
)

:: 4. Remove registro (autostart)
echo.
echo  [4/5] Limpando registro do Windows...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FiscoBot Pro" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\FiscoBotPro" /f >nul 2>&1
echo  OK

:: 5. Pergunta sobre dados do usuario
echo.
echo  [5/5] Dados salvos (macros, perfis, certificados, API Key)...
echo.
set /p DADOS="  Remover dados? (s/N): "
if /i "%DADOS%"=="s" (
  if exist "%APPDATA%\.fiscobot" (
    rmdir /s /q "%APPDATA%\.fiscobot" >nul 2>&1
    echo  OK - Dados removidos de %APPDATA%\.fiscobot
  ) else (
    echo  OK - Pasta de dados nao encontrada
  )
) else (
  echo  OK - Dados mantidos em %APPDATA%\.fiscobot
)

:: Pergunta sobre node_modules
echo.
set /p MODS="  Remover node_modules (~300MB)? (s/N): "
if /i "%MODS%"=="s" (
  if exist "%DIR%\node_modules" (
    echo  Removendo node_modules (aguarde)...
    rmdir /s /q "%DIR%\node_modules" >nul 2>&1
    echo  OK
  )
)

echo.
echo  ============================================
echo    FiscoBot Pro desinstalado com sucesso!
echo.
echo    A pasta do programa ainda existe em:
echo    %DIR%
echo    Voce pode excluir ela manualmente.
echo  ============================================
echo.
pause
