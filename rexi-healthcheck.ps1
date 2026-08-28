# rexi-healthcheck.ps1 - Kiem tra nhanh trang thai backend AI REXI tren Render
# Chay: powershell -ExecutionPolicy Bypass -File D:\AI REXI\rexi-healthcheck.ps1

$url = "https://ai-rexi-backend.onrender.com"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI REXI Backend Health Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Kiem tra DNS + Connection
Write-Host "[1/5] Kiem tra DNS & Connection..." -ForegroundColor Yellow
try {
    $dns = Resolve-DnsName "ai-rexi-backend.onrender.com" -ErrorAction Stop
    $dnsIp = $dns[0].IPAddress
    Write-Host "  OK DNS: $dnsIp" -ForegroundColor Green
} catch {
    Write-Host "  DNS LOI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 2. Ping server
Write-Host "[2/5] Ping server..." -ForegroundColor Yellow
try {
    $ping = Test-Connection "ai-rexi-backend.onrender.com" -Count 1 -TimeoutSeconds 5 -ErrorAction Stop
    $pingMs = $ping.ResponseTime
    Write-Host "  OK Ping: ${pingMs}ms" -ForegroundColor Green
} catch {
    Write-Host "  Ping fail (co the bi block) - tiep tuc..." -ForegroundColor Yellow
}

# 3. Check root endpoint
Write-Host "[3/5] Check root endpoint ($url)..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri $url -TimeoutSec 15 -UseBasicParsing
    $rootCode = $r.StatusCode
    Write-Host "  OK Root: HTTP $rootCode" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $msg = $_.Exception.Message
    if ($code -eq 404) {
        Write-Host "  FAIL Root: 404 Not Found - SERVER KHONG TON TAI tren Render!" -ForegroundColor Red
    } elseif ($code -eq 503 -or $code -eq 502) {
        Write-Host "  WARN Root: HTTP $code - Server DANG SLEEP, can 30-60s de wake up" -ForegroundColor Yellow
    } else {
        Write-Host "  FAIL Root: HTTP $code - $msg" -ForegroundColor Red
    }
}

# 4. Check health endpoint
Write-Host "[4/5] Check health endpoint ($url/api/health)..." -ForegroundColor Yellow
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $r = Invoke-WebRequest -Uri "$url/api/health" -TimeoutSec 30 -UseBasicParsing
    $sw.Stop()
    $body = $r.Content | ConvertFrom-Json
    $healthCode = $r.StatusCode
    $healthMs = $sw.ElapsedMilliseconds
    $dbStatus = $body.db
    $dbType = $body.db_type
    $uptime = $body.uptime_seconds
    $respMs = $body.response_ms
    Write-Host "  OK Health - HTTP $healthCode | ${healthMs}ms" -ForegroundColor Green
    Write-Host "     DB: $dbStatus | Type: $dbType" -ForegroundColor DarkGray
    Write-Host "     Uptime: ${uptime}s | Response: ${respMs}ms" -ForegroundColor DarkGray
} catch {
    $sw.Stop()
    $code = $_.Exception.Response.StatusCode.value__
    $msg = $_.Exception.Message
    $elapsed = $sw.ElapsedMilliseconds
    if ($code -eq 404) {
        Write-Host "  FAIL Health: 404 Not Found" -ForegroundColor Red
        Write-Host "     NGUYEN NHAN: Backend da bi xoa/tam dung tren Render!" -ForegroundColor Red
        Write-Host "     HANH DONG: Vao https://dashboard.render.com kiem tra service." -ForegroundColor Yellow
    } elseif ($code -eq 503 -or $code -eq 502) {
        Write-Host "  WARN Health: HTTP $code - Server dang sleep (${elapsed}ms)" -ForegroundColor Yellow
        Write-Host "     Thu lai sau 30-60s..." -ForegroundColor Yellow
    } else {
        Write-Host "  FAIL Health: HTTP $code - $msg" -ForegroundColor Red
    }
}

# 5. Check Render headers
Write-Host "[5/5] Check Render headers..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri $url -TimeoutSec 10 -UseBasicParsing -Method Head
    $renderHeader = $r.Headers['x-render-routing']
    $serverHeader = $r.Headers['Server']
    Write-Host "  Server: $serverHeader" -ForegroundColor DarkGray
    Write-Host "  x-render-routing: $renderHeader" -ForegroundColor DarkGray
    if ($renderHeader -eq 'no-server') {
        Write-Host "  FAIL: 'no-server' = KHONG CO SERVER nao dang chay tren Render!" -ForegroundColor Red
    } elseif ($renderHeader -eq 'ok') {
        Write-Host "  OK: Server dang chay binh thuong" -ForegroundColor Green
    }
} catch {
    Write-Host "  WARN: Khong the lay headers" -ForegroundColor Yellow
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Neu thay '404 Not Found' o bat ky endpoint nao:" -ForegroundColor Yellow
Write-Host "  -> Backend da bi TAT/XOA tren Render" -ForegroundColor White
Write-Host "  -> Vao https://dashboard.render.com" -ForegroundColor White
Write-Host "  -> Tim service 'ai-rexi-backend'" -ForegroundColor White
Write-Host "  -> Click 'Resume' neu co, hoac 'Manual Deploy' de deploy lai" -ForegroundColor White
Write-Host ""
Write-Host "Neu thay '503/502' (sleep):" -ForegroundColor Yellow
Write-Host "  -> Dung lo, server dang wake up (30-60s)" -ForegroundColor White
Write-Host "  -> KeepAlive se giu no song khi da wake" -ForegroundColor White
Write-Host ""
