@echo off
echo ==============================================
echo Preparando envio do FiscoBot para o GitHub...
echo ==============================================

echo Instalando o bloqueador de IPs (express-ipfilter)...
call npm install express-ipfilter --save

echo Inicializando o Git...
git init
git add .
git commit -m "feat: bloqueio de IP e deploy options"
git branch -M main

echo Removendo origem antiga se existir...
git remote remove origin 2>nul

echo Configurando o link do seu GitHub...
git remote add origin https://github.com/jefersonederson48-png/fiscobot.git

echo Enviando os arquivos para a nuvem...
git push -u origin main

echo ==============================================
echo Sucesso! Tudo foi enviado para o GitHub.
echo ==============================================
pause
