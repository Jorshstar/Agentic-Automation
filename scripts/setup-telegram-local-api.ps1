<#
.SYNOPSIS
  Starts a local Telegram Bot API server so the bot can receive files up to 2 GB.

.DESCRIPTION
  Telegram's own Bot API refuses to give a bot any file over 20 MB. Running
  Telegram's telegram-bot-api server yourself raises that to 2000 MB.

  This script does the fiddly parts:
    1. reads TELEGRAM_API_ID / TELEGRAM_API_HASH from .env
    2. logs the bot OUT of Telegram's cloud servers  <- the step people miss
    3. starts the container with its data bind-mounted so the worker can read it
    4. waits for the server to answer
    5. tells you the two lines to add to .env

  A bot can talk to exactly ONE Bot API server. Without the logOut in step 2 the
  local server cannot take it over, and the bot simply goes quiet with no error.

.PARAMETER Revert
  Undo: stop the container, log the bot out of the LOCAL server, and tell you
  which lines to remove so the bot returns to Telegram's cloud.
#>
param([switch]$Revert)

$ErrorActionPreference = 'Stop'

$ProjectDir   = Split-Path -Parent $PSScriptRoot
$EnvFile      = Join-Path $ProjectDir '.env'
$ContainerName = 'telegram-bot-api'
$HostDataDir  = 'C:\telegram-bot-api'
$ContainerDataDir = '/var/lib/telegram-bot-api'
$Port         = 8081

function Get-EnvValue([string]$Key) {
    if (-not (Test-Path $EnvFile)) { return $null }
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match "^\s*$Key\s*=\s*(.*)$") { return $Matches[1].Trim() }
    }
    return $null
}

$token = Get-EnvValue 'TELEGRAM_BOT_TOKEN'
if (-not $token) { throw "TELEGRAM_BOT_TOKEN not found in $EnvFile" }

if ($Revert) {
    Write-Host "Logging the bot out of the LOCAL server..." -ForegroundColor Cyan
    try { Invoke-RestMethod "http://localhost:$Port/bot$token/logOut" -TimeoutSec 20 | Out-Null } catch { }
    docker rm -f $ContainerName 2>&1 | Out-Null
    Write-Host "Container stopped." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Now REMOVE these lines from .env so the bot goes back to Telegram's cloud:"
    Write-Host "  TELEGRAM_API_BASE=..."
    Write-Host "  TELEGRAM_LOCAL_FILES_MAP=..."
    Write-Host "Then restart the studio:  Stop-ScheduledTask -TaskName AgenticStudioAutostart; Start-ScheduledTask -TaskName AgenticStudioAutostart"
    return
}

$apiId   = Get-EnvValue 'TELEGRAM_API_ID'
$apiHash = Get-EnvValue 'TELEGRAM_API_HASH'
if (-not $apiId -or -not $apiHash) {
    Write-Host ""
    Write-Warning "TELEGRAM_API_ID and TELEGRAM_API_HASH are not in .env yet."
    Write-Host ""
    Write-Host "Get them once, from your own Telegram account:" -ForegroundColor Cyan
    Write-Host "  1. Sign in at https://my.telegram.org with your phone number"
    Write-Host "  2. Open 'API development tools' and create an application (any name)"
    Write-Host "  3. Copy the api_id and api_hash"
    Write-Host ""
    Write-Host "Add them to .env (they are secrets - .env is git-ignored):"
    Write-Host "  TELEGRAM_API_ID=12345678"
    Write-Host "  TELEGRAM_API_HASH=abc123..."
    Write-Host ""
    Write-Host "Then run this script again."
    return
}

# Docker has to be up before anything else is worth trying.
try { docker info 2>&1 | Out-Null } catch { throw "Docker is not running. Start Docker Desktop and try again." }

Write-Host "1/4  Logging the bot out of Telegram's cloud servers..." -ForegroundColor Cyan
# A bot can only be bound to one Bot API server. 429 here is normal: logOut is
# rate limited to once every 10 minutes, and an already-logged-out bot is fine.
try {
    $result = Invoke-RestMethod "https://api.telegram.org/bot$token/logOut" -TimeoutSec 30
    Write-Host "     done (ok=$($result.ok))"
} catch {
    Write-Host "     $($_.Exception.Message)" -ForegroundColor DarkYellow
    Write-Host "     (fine if the bot was already logged out; if it says 'too many requests', wait 10 minutes)"
}

Write-Host "2/4  Starting the server container..." -ForegroundColor Cyan
docker rm -f $ContainerName 2>&1 | Out-Null
New-Item -ItemType Directory -Force -Path $HostDataDir | Out-Null

# The data directory is BIND-MOUNTED rather than a named volume so the worker,
# which runs on the host, can read the files the server writes. Without this the
# server reports container paths the worker cannot open.
docker run -d --name $ContainerName --restart unless-stopped `
    -p "${Port}:8081" `
    -v "${HostDataDir}:${ContainerDataDir}" `
    -e "TELEGRAM_API_ID=$apiId" `
    -e "TELEGRAM_API_HASH=$apiHash" `
    aiogram/telegram-bot-api:latest `
    --local --http-port=8081 --dir=$ContainerDataDir | Out-Null

Write-Host "3/4  Waiting for it to answer..." -ForegroundColor Cyan
$ready = $false
foreach ($attempt in 1..30) {
    Start-Sleep -Seconds 2
    try {
        $me = Invoke-RestMethod "http://localhost:$Port/bot$token/getMe" -TimeoutSec 5
        if ($me.ok) { $ready = $true; Write-Host "     up: @$($me.result.username)"; break }
    } catch { }
}
if (-not $ready) {
    Write-Host ""
    Write-Warning "The server did not answer in 60s. Its log:"
    docker logs --tail 30 $ContainerName
    return
}

Write-Host "4/4  Add these two lines to .env, then restart the studio:" -ForegroundColor Green
Write-Host ""
Write-Host "  TELEGRAM_API_BASE=http://localhost:$Port"
Write-Host "  TELEGRAM_LOCAL_FILES_MAP=$ContainerDataDir=$HostDataDir"
Write-Host ""
Write-Host "  Stop-ScheduledTask -TaskName AgenticStudioAutostart"
Write-Host "  Start-ScheduledTask -TaskName AgenticStudioAutostart"
Write-Host ""
Write-Host "Then send the bot a video over 20 MB." -ForegroundColor Cyan
Write-Host "Undo any time with:  powershell -ExecutionPolicy Bypass -File scripts\setup-telegram-local-api.ps1 -Revert"
