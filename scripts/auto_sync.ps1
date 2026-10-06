param([int]$IntervalSeconds = 300)

$ErrorActionPreference = 'Continue'
$SyncScript = Join-Path $PSScriptRoot 'sync_databases.ps1'
$LogDir = Join-Path $PSScriptRoot '..\logs'
$LogFile = Join-Path $LogDir 'auto-sync.log'

if ($IntervalSeconds -lt 30) { throw 'Interval must be >= 30 seconds' }
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

Write-Host "=== Rexi AI Auto Sync ===" -ForegroundColor Green
Write-Host "Interval: $IntervalSeconds seconds" -ForegroundColor DarkGray
Write-Host "Log: $LogFile" -ForegroundColor DarkGray
Write-Host "Close this window to stop." -ForegroundColor Yellow

while ($true) {
    $startedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    try {
        "[$startedAt] sync started" | Tee-Object -FilePath $LogFile -Append | Out-Host
        & powershell -NoProfile -ExecutionPolicy Bypass -File $SyncScript -All -Quiet 2>&1 |
            Tee-Object -FilePath $LogFile -Append | Out-Host
        $finishedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        "[$finishedAt] sync finished" | Tee-Object -FilePath $LogFile -Append | Out-Host
    } catch {
        $failedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        "[$failedAt] FAILED: $($_.Exception.Message)" | Tee-Object -FilePath $LogFile -Append | Out-Host
    }
    Start-Sleep -Seconds $IntervalSeconds
}
