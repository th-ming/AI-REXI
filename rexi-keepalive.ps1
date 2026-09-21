# rexi-keepalive.ps1 - Giu backend Render cua AI REXI luon tinh (chong sleep)
# Render free tier ngu sau 15 phut idle, goi moi 60s de no khong bao gio ngu.
# Chay nen: dang ky Windows Scheduled Task (xem rexi-keepalive-task.ps1)
# ──────────────────────────────────────────────────────────────
# UPDATE: Them phan biet Sleep vs Dead + alert khi backend chet
# UPDATE 2: Chay 1 lan roi thoat (task PT1M spawn lai moi phut — khong chong instance)
# ──────────────────────────────────────────────────────────────

$urls = @(
    "https://ai-rexi-backend.onrender.com/api/health"
)

$failCount = 0        # Dem so lan fail lien tiep
$deadThreshold = 5    # Sau 5 lan fail lien tiep = backend chet (khong phai sleep)
$lastAlertTime = $null
$alertCooldown = 300  # Alert moi 5 phut (300s) tranh spam

function Show-Alert {
    param([string]$Message, [string]$Type)
    $ts = Get-Date -Format 'HH:mm:ss'
    if ($Type -eq 'DEAD') {
        Write-Host "`n[$ts] ======== ALERT ========" -ForegroundColor Red
        Write-Host "[$ts] $Message" -ForegroundColor Red
        Write-Host "[$ts] =========================`n" -ForegroundColor Red
        # Hien thi notification Windows neu co the
        try {
            [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
            $balloon = New-Object System.Windows.Forms.NotifyIcon
            $balloon.Icon = [System.Drawing.SystemIcons]::Warning
            $balloon.BalloonTipTitle = 'AI REXI Backend DEAD!'
            $balloon.BalloonTipText = $Message
            $balloon.BalloonTipIcon = 'Warning'
            $balloon.Visible = $true
            $balloon.ShowBalloonTip(10000)
        } catch { }
    } elseif ($Type -eq 'SLEEP') {
        Write-Host "[$ts] ⚠️  Backend DANG SLEEP — dang wake up... (lan fail #$failCount)" -ForegroundColor Yellow
    } elseif ($Type -eq 'RECOVERED') {
        Write-Host "[$ts] ✅ Backend DA KHOI PHUC — hoat dong binh thuong!" -ForegroundColor Green
    } else {
        Write-Host "[$ts] $Message" -ForegroundColor DarkGray
    }
}

# ── Banner khi bat dau ──
$ts = Get-Date -Format 'HH:mm:ss'
Write-Host "[$ts] 🚀 AI REXI KeepAlive v2 — Dang giu backend song..." -ForegroundColor Cyan
Write-Host "[$ts]    URL: $($urls[0])" -ForegroundColor DarkGray
Write-Host "[$ts]    Interval: 60s | Dead threshold: $deadThreshold fail" -ForegroundColor DarkGray
Write-Host "[$ts]    Log file: $(Join-Path $PSScriptRoot 'rexi-keepalive.log')" -ForegroundColor DarkGray
Write-Host ""

$logFile = Join-Path $PSScriptRoot 'rexi-keepalive.log'

foreach ($u in $urls) {
        try {
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $r = Invoke-WebRequest -Uri $u -TimeoutSec 30 -UseBasicParsing
            $sw.Stop()
            $ts = Get-Date -Format 'HH:mm:ss'
            $respTime = $sw.ElapsedMilliseconds
            
            # Kiem tra response co hop le khong
            $body = $r.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
            $dbStatus = if ($body.db) { $body.db } else { 'unknown' }
            $uptime = if ($body.uptime_seconds) { $body.uptime_seconds } else { '?' }
            
            Show-Alert "[$ts] KEEPALIVE OK ($($r.StatusCode)) ${respTime}ms | DB: $dbStatus | Uptime: ${uptime}s : $u"
            
            # Neu truoc do dang fail -> bao khoei phuc
            if ($failCount -ge 2) {
                Show-Alert -Message '' -Type 'RECOVERED'
            }
            $failCount = 0
            
            # Log vao file
            "$ts OK $($r.StatusCode) ${respTime}ms db=$dbStatus uptime=$uptime" | Out-File -Append $logFile
            
        } catch {
            $failCount++
            $ts = Get-Date -Format 'HH:mm:ss'
            $errMsg = $_.Exception.Message
            
            # Phan biet 404 (server dead) vs timeout (server sleep)
            if ($errMsg -match '404') {
                # 404 = Render khong tim thay server = backend DA CHET/BI XOA
                Show-Alert -Message "Backend 404 NOT FOUND — Render khong tim thay server! Can vao Render Dashboard kiem tra." -Type 'DEAD'
                Write-Host "[$ts]   Error: $errMsg" -ForegroundColor Red
                "`n$ts FAIL 404 DEAD — $errMsg" | Out-File -Append $logFile
                
            } elseif ($errMsg -match 'timeout|timed out|503|502') {
                # Timeout/503 = Server dang sleep, can thoi gian wake up
                Show-Alert -Type 'SLEEP'
                "`n$ts FAIL $errMsg (sleep/wake)" | Out-File -Append $logFile
                
            } else {
                # Loi khac
                Write-Host "[$ts] ❌ Keepalive FAIL (lan #$failCount): $errMsg" -ForegroundColor Yellow
                "`n$ts FAIL $errMsg" | Out-File -Append $logFile
            }
            
            # Alert neu fail nhieu lan lien tiep
            if ($failCount -eq $deadThreshold) {
                $now = Get-Date
                if (-not $lastAlertTime -or ($now - $lastAlertTime).TotalSeconds -gt $alertCooldown) {
                    Show-Alert -Message "Backend da fail $failCount lan lien tiep! Kiem tra Render Dashboard NGAY." -Type 'DEAD'
                    $lastAlertTime = $now
                }
            }
        }
    }