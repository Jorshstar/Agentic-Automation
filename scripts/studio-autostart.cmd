@echo off
REM Starts the studio supervisor (Telegram agent + clip worker) in this window.
REM For unattended start at logon use scripts\install-autostart.ps1 instead,
REM which registers a hidden Scheduled Task. Ctrl+C here stops both processes.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0studio-autostart.ps1"
