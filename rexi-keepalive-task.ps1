# rexi-keepalive-task.ps1 - Dang ky Windows Scheduled Task chay keepalive nen
# Chay 1 lan:  powershell -ExecutionPolicy Bypass -File D:\Rexi AI\rexi-keepalive-task.ps1
# 2/10/2026: interval 1 phut -> 10 phut. Ly do: Render free sleep sau 15 phut (10' van giu am)
#   nhung Neon scale-to-zero sau ~5 phut -> de Neon NGU giua cac lan, tiet kiem quota free (191.9 CU-h/thang).

$script = "D:\Rexi AI\rexi-keepalive.ps1"
# Chay qua wscript + VBS (window=0) de AN THAT, khong nhay conhost/powershell (task chay powershell truc tiep se nhay 1 tich tac).
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"D:\Rexi AI\rexi-keepalive-hidden.vbs"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask -TaskName "RexiKeepAlive" -Action $action -Trigger $trigger -Settings $settings -Force

Start-ScheduledTask -TaskName "RexiKeepAlive"
Get-ScheduledTask -TaskName "RexiKeepAlive" | Select-Object TaskName, State
Write-Host "Dang ky xong. Keepalive chay moi 10 phut, backend Render khong ngu ma Neon van scale-to-zero." -ForegroundColor Green