<#
NEXUS LAB 一键启动脚本（Windows / PowerShell）

用法:
  ./start.ps1                                  # 局域网 0.0.0.0:8000，自动备份(每60分钟)
  ./start.ps1 -Port 9000                       # 换端口
  ./start.ps1 -NoBackup                        # 关闭自动备份
  ./start.ps1 -DbPath .\data\nexus.db -UploadsPath .\data\uploads   # 自定义数据目录

首次投入使用:
  1) 先备份并退役旧的 nexuslab.db（含演示成员），让第一个真实注册者成为管理员:
       Rename-Item nexuslab.db nexuslab.db.demo-backup
  2) 运行本脚本启动服务。
  3) 第一个真实成员注册 -> 自动成为管理员；在 项目设置 里起名、可开启“仅限邀请注册”。
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
Write-Host "NEXUS LAB 启动中 ..." -ForegroundColor Green
Write-Host ("  本机访问:  http://127.0.0.1:{0}" -f $Port)
if ($lan) { Write-Host ("  局域网访问: http://{0}:{1}   <- 把这条发给队友" -f $lan, $Port) -ForegroundColor Cyan }
Write-Host "  第一个注册的成员会自动成为管理员（负责项目设置/角色/公告/邀请码）"
if (-not $NoBackup) { Write-Host "  自动备份已开启（每 $BackupMinutes 分钟，保留最近 24 份）" }
Write-Host "  队友连不上时(管理员身份): netsh advfirewall firewall add rule name=NexusLab dir=in action=allow protocol=TCP localport=$Port"
Write-Host ""

Set-Location $Root
py @serverArgs
