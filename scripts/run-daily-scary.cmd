@echo off
REM Daily scary video — launched by Windows Task Scheduler at 08:00 WAT.
REM Produces one true-history scary short with the current pipeline and delivers
REM it to Telegram. Logs to logs\daily-scary.log.
cd /d "C:\Users\hp\Desktop\agentic-automation"
if not exist logs mkdir logs
echo ===== %DATE% %TIME% daily scary run ===== >> logs\daily-scary.log
"C:\Program Files\nodejs\npm.cmd" run studio:daily >> logs\daily-scary.log 2>&1
echo ===== %DATE% %TIME% done (exit %ERRORLEVEL%) ===== >> logs\daily-scary.log
