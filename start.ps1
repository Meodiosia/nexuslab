<#
NEXUS LAB one-command launcher (Windows PowerShell)

Usage:
  ./start.ps1                                  # LAN on 0.0.0.0:8000, auto backup every 60 min
  ./start.ps1 -Port 9000                       # different port
  ./start.ps1 -NoBackup                        # disable auto backup
  ./start.ps1 -DbPath .\data\nexus.db -UploadsPath .\data\uploads   # custom data dir

First real launch:
  1) Retire the demo DB so the first real registrant becomes admin:
       Rename-Item nexuslab.db nexuslab.db.demo-backup
  2) Run this script.
  3) The first registered member is admin automatically (see README for the full flow).
#>
param(
    [string]$HostAddr = "0.0.0.0",
    [int]$Port = 8000,
    [int]$BackupMinutes = 60,
    [switch]$NoBackup,
    [string]$DbPath = "",
    [string]$UploadsPath = ""
)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

$serverArgs = @("server.py", "--host", $HostAddr, "--port", "$Port")
$serverArgs += "--backup-minutes"
$serverArgs += $(if ($NoBackup) { "0" } else { "$BackupMinutes" })
if ($DbPath) { $serverArgs += @("--db", (Join-Path $Root $DbPath)) }
if ($UploadsPath) { $serverArgs += @("--uploads", (Join-Path $Root $UploadsPath)) }

$lan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ""
Write-Host "NEXUS LAB starting ..." -ForegroundColor Green
Write-Host ("  Local:   http://127.0.0.1:{0}" -f $Port)
if ($lan) { Write-Host ("  LAN:     http://{0}:{1}   <- share this with teammates" -f $lan, $Port) -ForegroundColor Cyan }
Write-Host "  The FIRST registered member becomes admin (project name, roles, invite code, announcements)"
if (-not $NoBackup) { Write-Host "  Auto backup ON (every $BackupMinutes min, keep last 24)" }
Write-Host "  If teammates cannot connect (run as admin): netsh advfirewall firewall add rule name=NexusLab dir=in action=allow protocol=TCP localport=$Port"
Write-Host ""

Set-Location $Root
py @serverArgs
