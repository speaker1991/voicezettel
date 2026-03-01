# VoiceZettel - Self-Hosted Launcher with cloudflared tunnel
# Starts Next.js dev server + cloudflared tunnel in parallel

param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VoiceZettel - Self-Hosted Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -- Find cloudflared --
$cfExe = $null
$cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cfCmd) {
    $cfExe = $cfCmd.Source
}

if (-not $cfExe) {
    $tryPaths = @(
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
    )
    foreach ($tp in $tryPaths) {
        if (Test-Path $tp) {
            $cfExe = $tp
            break
        }
    }
}

if (-not $cfExe) {
    Write-Host "[!] cloudflared not found!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Install with:" -ForegroundColor White
    Write-Host "  winget install Cloudflare.cloudflared" -ForegroundColor Green
    exit 1
}

Write-Host "[OK] cloudflared: $cfExe" -ForegroundColor Green

# -- Start Next.js --
Write-Host ""
Write-Host "[1/2] Starting Next.js on port $Port..." -ForegroundColor Cyan

$nextJob = Start-Job -ScriptBlock {
    param($WorkDir, $DevPort)
    Set-Location $WorkDir
    & npm run dev -- --port $DevPort 2>&1
} -ArgumentList (Get-Location).Path, $Port

Write-Host "      Waiting for server..." -ForegroundColor Gray
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:$Port" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        $ready = $true
        break
    } catch {
        Write-Host "." -NoNewline -ForegroundColor Gray
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "[!] Server failed to start" -ForegroundColor Red
    Stop-Job $nextJob
    Remove-Job $nextJob
    exit 1
}

Write-Host ""
Write-Host "[OK] Next.js at http://localhost:$Port" -ForegroundColor Green

# -- Start cloudflared tunnel --
Write-Host ""
Write-Host "[2/2] Starting cloudflared tunnel..." -ForegroundColor Cyan

$tunnelJob = Start-Job -ScriptBlock {
    param($Exe, $TunnelPort)
    & $Exe tunnel --url "http://localhost:$TunnelPort" 2>&1
} -ArgumentList $cfExe, $Port

$tunnelUrl = $null
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    $out = Receive-Job $tunnelJob 2>&1 | Out-String
    if ($out -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
        $tunnelUrl = $matches[1]
        break
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

if ($tunnelUrl) {
    Write-Host "  Local:  http://localhost:$Port" -ForegroundColor White
    Write-Host "  Phone:  $tunnelUrl" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Open the Phone URL on your mobile!" -ForegroundColor Cyan
} else {
    Write-Host "  Local:  http://localhost:$Port" -ForegroundColor White
    Write-Host "  Tunnel: waiting... check output below" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

# -- Main loop --
try {
    while ($true) {
        $nOut = Receive-Job $nextJob 2>&1
        if ($nOut) {
            $nOut | ForEach-Object { Write-Host "[next] $_" -ForegroundColor DarkGray }
        }

        if (-not $tunnelUrl) {
            $tOut = Receive-Job $tunnelJob 2>&1 | Out-String
            if ($tOut -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
                $tunnelUrl = $matches[1]
                Write-Host ""
                Write-Host "  Phone:  $tunnelUrl" -ForegroundColor Yellow
                Write-Host ""
            }
        }

        if ($nextJob.State -eq "Failed" -or $nextJob.State -eq "Completed") {
            Write-Host "[!] Next.js crashed" -ForegroundColor Red
            break
        }

        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host ""
    Write-Host "Stopping..." -ForegroundColor Yellow
    Stop-Job $nextJob -ErrorAction SilentlyContinue
    Stop-Job $tunnelJob -ErrorAction SilentlyContinue
    Remove-Job $nextJob -ErrorAction SilentlyContinue
    Remove-Job $tunnelJob -ErrorAction SilentlyContinue
    Write-Host "[OK] All stopped" -ForegroundColor Green
}
