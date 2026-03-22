@echo off
setlocal
echo ==============================================
echo FORCANDO ENVIO DO FISCOBOT-ELECTRON (SUPER FORCE)
echo ==============================================

:: Abre na pasta atual
cd /d "%~dp0"

echo [1/4] Adicionando todos os arquivos (incluindo o Dockerfile)...
git add . --all

echo [2/4] Gravando as mundancas...
git commit -m "feat: forcar deploy com docker" --allow-empty

echo [3/4] Garantindo que o endereco do GitHub esta correto...
git remote remove origin 2>nul
git remote add origin https://github.com/jefersonederson48-png/fiscobot.git

echo [4/4] Empurrando para o GitHub "A FORCA"...
git push -u origin main --force

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] ERRO: O Git nao conseguiu enviar. 
    echo Verifique se voce esta logado no GitHub ou se o link esta certo.
) else (
    echo.
    echo [OK] SUCESSO! O Dockerfile agora deve estar no seu GitHub.
)

echo ==============================================
pause
