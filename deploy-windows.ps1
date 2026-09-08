<#
NEXUS LAB deployment helper for Windows Server 2022 (run from an ELEVATED PowerShell).
Requires: Python 3.11+ installed (with "Add python.exe to PATH"), project code already copied to $AppDir,
and (optionally) an ngrok authtoken for the public HTTPS URL.

Steps it performs:
  1) ensure Python present
  2) install waitress (optional production server)
  3) set up NSSM service "NexusLab" (auto start + restart on crash) on 127.0.0.1:$Port
  4) optionally install ngrok as a service "NgrokTunnel" -> https static URL
Usage:
  .\deploy-windows.ps1
  .\deploy-windows.ps1 -NgrokToken <your-token>
#>
param(
    [string]$Python   = "C:\Python312\python.exe",
    [string]$AppDir   = "C:\nexuslab",
    [int]$Port        = 8000,
    [string]$NgrokToken = "",
    [string]$NgrokExe = "C:\ngrok\ngrok.exe"
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path "$AppDir\server.py")) {
    Write-Host "!! $AppDir\server.py not found. Copy the project folder there first, e.g.:"
    Write-Host "   scp -r .\Default Project\*  user@SERVER-IP:C:/nexuslab/"
    Write-Host "   (or zip the folder and Expand-Archive on the server into C:\nexuslab)"
    exit 1
}
if (-not (Test-Path $Python)) {
    Write-Host "!! Python not found at $Python . Download python-3.12.x-amd64.exe from python.org"
    Write-Host "   and tick 'Add python.exe to PATH' during install."
    exit 1
}
Write-Host "==> Python  : $Python" -ForegroundColor Green
Write-Host "==> AppDir  : $AppDir"

Write-Host "==> [1/4] install waitress (production server, optional)"
& $Python -m pip install --upgrade pip
& $Python -m pip install waitress | Out-Null
Write-Host "    done."

Write-Host "==> [2/4] NSSM service: NexusLab"
$nssm = "C:\nssm\nssm-2.24\win64\nssm.exe"
if (-not (Test-Path $nssm)) {
    Write-Host "    downloading NSSM ..."
    New-Item -ItemType Directory -Force -Path C:\nssm | Out-Null
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile C:\nssm\nssm.zip
    Expand-Archive -Path C:\nssm\nssm.zip -DestinationPath C:\nssm -Force
}
& $nssm install NexusLab $Python "server.py --host 127.0.0.1 --port $Port --backup-minutes 60"
& $nssm set NexusLab AppDirectory $AppDir
& $nssm set NexusLab AppExit Default Restart
& $nssm set NexusLab AppRestartDelay 3000
& $nssm set NexusLab Start SERVICE_AUTO_START
& $nssm start NexusLab
Write-Host "    NexusLab service started."

Write-Host "==> [3/4] local check"
Start-Sleep -Seconds 2
try {
    $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/session" -TimeoutSec 5
    Write-Host ("    OK -> " + $r.StatusCode) -ForegroundColor Green
} catch {
    Write-Host "    !! not ready; check event log or run python server.py manually to see errors."
}

if ($NgrokToken -ne "") {
    Write-Host "==> [4/4] ngrok tunnel service: NgrokTunnel"
    if (-not (Test-Path $NgrokExe)) {
        Write-Host "    downloading ngrok ..."
        New-Item -ItemType Directory -Force -Path C:\ngrok | Out-Null
        Invoke-WebRequest -Uri "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip" -OutFile C:\ngrok\ngrok.zip
        Expand-Archive -Path C:\ngrok\ngrok.zip -DestinationPath C:\ngrok -Force
    }
    & $NgrokExe config add-authtoken $NgrokToken | Out-Null
    & $nssm install NgrokTunnel $NgrokExe "http $Port"
    & $nssm set NgrokTunnel AppExit Default Restart
    & $nssm set NgrokTunnel AppRestartDelay 3000
    & $nssm set NgrokTunnel Start SERVICE_AUTO_START
    & $nssm start NgrokTunnel
    Start-Sleep -Seconds 5
    Write-Host "    ngrok running. See your public URL with:" -ForegroundColor Cyan
    Write-Host "      & $NgrokExe http 8000   (run once to read the forwarding URL)"
    Write-Host "      or open https://dashboard.ngrok.com/endpoints"
} else {
    Write-Host "==> [4/4] no ngrok token given. For a public HTTPS URL run ngrok manually:" -ForegroundColor Yellow
    Write-Host "      ngrok http $Port"
}

Write-Host ""
Write-Host "Done. Reminders:"
Write-Host "  - keep this server 'always on':  powercfg /change standby-timeout-ac 0"
Write-Host "  - logs:  Get-WinEvent -LogName Application | Where-Object {$_.ProviderName -like '*Nexus*'}"
Write-Host "  - stop/start:  nssm stop NexusLab / nssm start NexusLab ; restart on crash is automatic"
Write-Host "  - first registrant = admin; then enable 'invite only' in Project Settings."
