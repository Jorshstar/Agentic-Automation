<#
.SYNOPSIS
  Keeps the two always-on studio processes alive.

.DESCRIPTION
  Supervises:
    * Telegram agent (studio:agent)      — the chat brain; answers you and queues clip jobs
    * Clip worker    (studio:clip-worker) — drains the queue and actually renders the clips

  Both are needed. The agent only ENQUEUES a clip job; the worker does the work.
  Running just one looks like the bot accepting requests and never delivering.

  If either process exits it is restarted after a short delay, with a longer
  backoff if it keeps failing immediately. That matters because the agent is the
  only consumer of the bot's Telegram updates: when it dies unnoticed, messages
  queue up silently and the bot appears dead with no error anywhere.

  Logs go to logs\telegram-agent.log and logs\clip-worker.log, with logs\autostart.log
  recording starts, exits and restarts. Each log is rotated once it passes 10 MB.

.NOTES
  Telegram allows only ONE consumer of a bot's updates. Do not run this while the
  cloud `telegram-ingest` schedule is deployed and active, or the two will steal
  each other's messages.
#>

$ErrorActionPreference = 'Continue'

$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogDir     = Join-Path $ProjectDir 'logs'
$MaxLogBytes = 10MB
$RestartDelaySeconds = 5
$SlowDelaySeconds    = 60
$MaxFastRestarts     = 5

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $ProjectDir

function Write-Stamp([string]$Message, [string]$File) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $File -Value $line -Encoding utf8
}

function Invoke-LogRotation([string]$File) {
    if ((Test-Path $File) -and ((Get-Item $File).Length -gt $MaxLogBytes)) {
        Move-Item $File "$File.1" -Force
    }
}

$AutostartLog = Join-Path $LogDir 'autostart.log'

# --- locate npm ------------------------------------------------------------
# Prefer whatever is on PATH; fall back to the standard install location, since
# a task started at logon does not always inherit the interactive PATH.
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = 'C:\Program Files\nodejs\npm.cmd' }
if (-not (Test-Path $npm)) {
    Write-Stamp "FATAL: npm not found (looked on PATH and at 'C:\Program Files\nodejs\npm.cmd')." $AutostartLog
    exit 1
}

# --- make the external tools findable -------------------------------------
# yt-dlp installs into the per-user Python scripts folder, and a common ffmpeg
# install is an unzipped folder nothing adds to PATH. src/lib/binaries.ts also
# searches these, but putting them on PATH keeps child processes simple.
$extraPaths = @(
    'C:\ffmpeg\bin',
    (Join-Path $env:APPDATA 'Python\Python313\Scripts'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
) | Where-Object { Test-Path $_ }
if ($extraPaths) { $env:PATH = ($env:PATH, ($extraPaths -join ';')) -join ';' }

# --- preflight -------------------------------------------------------------
# Fail loudly here rather than letting each child die a confusing death later.
if (-not (Test-Path (Join-Path $ProjectDir '.env'))) {
    Write-Stamp "FATAL: no .env in $ProjectDir - the studio cannot authenticate." $AutostartLog
    exit 1
}
if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
    # The agent can still chat, but no clip will ever render, so say so plainly.
    Write-Stamp "WARNING: ffmpeg not found - clipping WILL fail. Install it or set FFMPEG_PATH." $AutostartLog
}

Write-Stamp "=== studio autostart starting (project: $ProjectDir) ===" $AutostartLog

# --- supervision -----------------------------------------------------------
$jobs = @()
foreach ($svc in @(
    @{ Name = 'telegram-agent'; Script = 'studio:agent' },
    @{ Name = 'clip-worker';    Script = 'studio:clip-worker' }
)) {
    $jobs += Start-Job -Name $svc.Name -ArgumentList $ProjectDir, $LogDir, $npm, $svc.Name, $svc.Script,
                                                     $RestartDelaySeconds, $SlowDelaySeconds, $MaxFastRestarts, $MaxLogBytes -ScriptBlock {
        param($ProjectDir, $LogDir, $npm, $Name, $Script, $RestartDelay, $SlowDelay, $MaxFastRestarts, $MaxLogBytes)

        Set-Location $ProjectDir

        # A child writing to stderr is NORMAL (npm notices, our own warnings).
        # PowerShell otherwise turns each line into a NativeCommandError record
        # and fills the log with stack traces around ordinary output.
        $ErrorActionPreference = 'Continue'
        # Force UTF-8 both ways. Without this the console hands back UTF-16 and
        # every logged line comes out as 's p a c e d   t e x t'.
        $OutputEncoding = [System.Text.UTF8Encoding]::new()
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

        $logFile  = Join-Path $LogDir "$Name.log"
        $autostart = Join-Path $LogDir 'autostart.log'
        $failures = 0

        function Stamp($msg, $file) {
            Add-Content -Path $file -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding utf8
        }

        while ($true) {
            if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt $MaxLogBytes)) {
                Move-Item $logFile "$logFile.1" -Force
            }
            Stamp "starting $Name" $autostart
            Stamp "===== $Name start =====" $logFile

            $started = Get-Date
            # Merge stderr into the pipeline, flatten each record to plain text,
            # and append as UTF-8. `*>> $logFile` looks simpler but writes UTF-16
            # and preserves error records verbatim, which is what produced the
            # unreadable logs this replaced.
            & $npm run --silent $Script 2>&1 |
                ForEach-Object { $_.ToString() } |
                Out-File -FilePath $logFile -Append -Encoding utf8
            $ran = [int]((Get-Date) - $started).TotalSeconds

            # A process that ran a while hit a fresh problem; one that died
            # instantly is probably misconfigured, so stop hammering it.
            if ($ran -gt 60) { $failures = 0 } else { $failures++ }

            if ($failures -ge $MaxFastRestarts) {
                Stamp "$Name failed $failures times quickly - backing off ${SlowDelay}s (see $logFile)" $autostart
                Start-Sleep -Seconds $SlowDelay
                $failures = 0
            } else {
                Stamp "$Name exited after ${ran}s - restarting in ${RestartDelay}s" $autostart
                Start-Sleep -Seconds $RestartDelay
            }
        }
    }
}

try {
    # Block forever; the jobs restart their children on their own.
    Wait-Job -Job $jobs | Out-Null
} finally {
    Write-Stamp "shutting down - stopping child processes" $AutostartLog
    $jobs | Stop-Job -ErrorAction SilentlyContinue
    $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
}
