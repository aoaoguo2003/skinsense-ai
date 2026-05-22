# SkinSense AI - 一键启动（公网可访问）
$root = $PSScriptRoot

Write-Host "正在启动 SkinSense AI..." -ForegroundColor Cyan

# 启动后端
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\backend'; .\venv\Scripts\Activate.ps1; uvicorn main:app --host 0.0.0.0 --port 8000 --reload" -WindowStyle Normal

Start-Sleep -Seconds 3

# 启动后端隧道，捕获 URL
$backendTunnelLog = "$env:TEMP\cloudflare_backend.log"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --url http://localhost:8000 2>&1 | Tee-Object -FilePath '$backendTunnelLog'" -WindowStyle Normal

Write-Host "等待后端隧道建立..." -ForegroundColor Yellow
$backendUrl = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $backendTunnelLog) {
        $content = Get-Content $backendTunnelLog -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
            $backendUrl = $Matches[0]
            break
        }
    }
}

if ($backendUrl) {
    Write-Host "后端公网地址: $backendUrl" -ForegroundColor Green
    # 更新前端 .env.local
    "NEXT_PUBLIC_API_URL=$backendUrl" | Set-Content "$root\frontend\.env.local" -Encoding utf8
} else {
    Write-Host "未能自动获取后端隧道地址，请手动更新 frontend\.env.local" -ForegroundColor Red
}

# 启动前端
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 5

# 启动前端隧道
$frontendTunnelLog = "$env:TEMP\cloudflare_frontend.log"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --url http://localhost:3000 2>&1 | Tee-Object -FilePath '$frontendTunnelLog'" -WindowStyle Normal

Write-Host "等待前端隧道建立..." -ForegroundColor Yellow
$frontendUrl = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $frontendTunnelLog) {
        $content = Get-Content $frontendTunnelLog -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
            $frontendUrl = $Matches[0]
            break
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " SkinSense AI 启动完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 电脑访问:  http://localhost:3000" -ForegroundColor White
if ($frontendUrl) {
    Write-Host " 手机访问:  $frontendUrl" -ForegroundColor Yellow
    Write-Host " (手机扫码或输入上方地址，无需同一 WiFi)" -ForegroundColor Gray
}
Write-Host "========================================" -ForegroundColor Cyan
