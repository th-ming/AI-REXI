# rexi-keepalive-task.ps1 - Dang ky Windows Scheduled Task chay keepalive nen vinh vien
# Chay 1 lan:  powershell -ExecutionPolicy Bypass -File D:\AI REXI\rexi-keepalive-task.ps1

$script = "D:\AI REXI\rexi-keepalive.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask -TaskName "RexiKeepAlive" -Action $action -Trigger $trigger -Settings $settings -Force

Start-ScheduledTask -TaskName "RexiKeepAlive"
Get-ScheduledTask -TaskName "RexiKeepAlive" | Select-Object TaskName, State
Write-Host "Dang ky xong. Keepalive chay moi 60s, backend Render se khong bao gio ngu." -ForegroundColor Green