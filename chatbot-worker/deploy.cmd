@echo off
rem Chay trien-khai.ps1 (deploy Worker). Go: .\deploy.cmd
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0trien-khai.ps1"
