@echo off
REM Local clip worker — drains queued clip jobs and delivers to Telegram.
REM Keep this window open while you want clipping to work. Uses your home IP so
REM YouTube allows the download (the cloud can't). Ctrl+C to stop.
cd /d "C:\Users\hp\Desktop\agentic-automation"
if not exist logs mkdir logs
REM Put the pip-installed yt-dlp on PATH for this session.
set "PATH=%PATH%;C:\Users\hp\AppData\Roaming\Python\Python313\Scripts"
echo ===== %DATE% %TIME% clip worker start ===== >> logs\clip-worker.log
"C:\Program Files\nodejs\npm.cmd" run studio:clip-worker >> logs\clip-worker.log 2>&1
echo ===== %DATE% %TIME% clip worker exited (code %ERRORLEVEL%) ===== >> logs\clip-worker.log
