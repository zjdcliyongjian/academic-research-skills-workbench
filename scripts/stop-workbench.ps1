$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StateFile = Join-Path $ProjectRoot "data\server.json"
$LocalEntry = (Resolve-Path (Join-Path $ProjectRoot "server\index.mjs")).Path

if (-not (Test-Path $StateFile)) {
  Write-Host "没有找到本工作台的服务记录，无需停止。"
  exit 0
}

$state = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
$targets = @()
if ($state.mode -eq "cloud" -and $state.processes) {
  $targets = @($state.processes)
} elseif ($state.pid) {
  $targets = @(@{ pid = [int]$state.pid; entry = $LocalEntry; label = "local-server" })
}

foreach ($target in $targets) {
  $pidValue = [int]$target.pid
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
  if (-not $process) { continue }
  $entry = [string]$target.entry
  if ($process.CommandLine -notlike "*$entry*") { throw "PID $pidValue 已属于其他程序，出于安全原因未停止。" }
  Stop-Process -Id $pidValue -ErrorAction Stop
}

Remove-Item -LiteralPath $StateFile -Force
Write-Host "AI 科研工作台已停止。"
