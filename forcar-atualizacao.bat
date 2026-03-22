@echo off
echo ==============================================
echo Enviando o arquivo Docker para a nuvem...
echo ==============================================

git add Dockerfile
git add .dockerignore
git add .
git commit -m "feat: adicionado arquivo Dockerfile"
git push -u origin main

echo ==============================================
echo Prontinho! O arquivo Dockerfile esta no GitHub.
echo Va la no seu site da hospedagem e tente de novo.
echo ==============================================
pause
