@echo off
title FiscoBot Pro - Debug
cd /d "%~dp0"
echo Iniciando FiscoBot Pro...
node_modules\.bin\electron.cmd . --dev
pause
