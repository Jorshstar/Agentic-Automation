<#
.SYNOPSIS
  Registers (or removes) the studio autostart task so it runs at Windows logon.

.DESCRIPTION
  Creates a Scheduled Task that launches scripts\studio-autostart.ps1 hidden at
  logon, which in turn keeps the Telegram agent and the clip worker alive.

  Run it from a normal PowerShell window in the project folder:

      powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1

  To remove it again:

      powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall

  No administrator rights are needed: the task runs as you, at your logon, which
  is also what it needs in order to reach your user-level yt-dlp install.

.PARAMETER Uninstall
  Remove the task instead of creating it.

.PARAMETER Visible
  Show the window instead of hiding it. Useful while debugging.
#>
param(
    [switch]$Uninstall,
    [switch]$Visible
)

$ErrorActionPreference = 'Stop'

$TaskName    = 'AgenticStudioAutostart'
$ProjectDir  = Split-Path -Parent $PSScriptRoot
$Supervisor  = Join-Path $PSScriptRoot 'studio-autostart.ps1'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Yellow
    } else {
        Write-Host "No scheduled task named '$TaskName' - nothing to remove."
    }
    return
}

if (-not (Test-Path $Supervisor)) { throw "Supervisor not found at $Supervisor" }
if (-not (Test-Path (Join-Path $ProjectDir '.env'))) {
    Write-Warning "No .env in $ProjectDir - the studio will not authenticate until you add one."
}

$windowStyle = if ($Visible) { 'Normal' } else { 'Hidden' }
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle $windowStyle -File `"$Supervisor`"" `
    -WorkingDirectory $ProjectDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Deliberate settings, each for a reason:
#  - no execution time limit: this is a long-running supervisor, not a batch job
#  - do not stop on battery: a laptop on battery should still answer Telegram
#  - restart on failure: covers the supervisor itself dying, not just a child
#  - IgnoreNew: never start a second copy, which would mean two consumers of the
#    same Telegram bot stealing each other's messages
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Keeps the Agentic Studio Telegram agent and clip worker running.' `
    -Force | Out-Null

Write-Host ""
Write-Host "Installed '$TaskName' - it will start at every logon ($windowStyle)." -ForegroundColor Green
Write-Host "  project : $ProjectDir"
Write-Host "  logs    : $(Join-Path $ProjectDir 'logs')"
Write-Host ""
Write-Host "Start it now without rebooting:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Check it:  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "Stop it :  Stop-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Warning "Telegram allows only ONE consumer of a bot's updates. If the cloud 'telegram-ingest' schedule is deployed and active, pause it - otherwise the two will steal each other's messages."
