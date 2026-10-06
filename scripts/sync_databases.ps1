param(
    [string]$From = "sqlite",
    [string]$To = "sqlserver",
    [switch]$All,
    [switch]$Quiet
)

$RepoRoot = Split-Path $PSScriptRoot -Parent

if (!$Quiet) {
    Write-Host "=== Rexi AI Database Sync ===" -ForegroundColor Cyan
    Write-Host "From: $From -> To: $To" -ForegroundColor DarkGray
}

$env:NODE_PATH = "$RepoRoot\Backend\node_modules"
$cmd = "node `"$PSScriptRoot\sync_databases.js`" --from=$From --to=$To"
if ($All) { $cmd = "node `"$PSScriptRoot\sync_databases.js`" --all" }

& cmd /c "$cmd 2>&1"
