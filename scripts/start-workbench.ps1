param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StateDir = Join-Path $ProjectRoot "data"
$StateFile = Join-Path $StateDir "server.json"
$EnvFile = Join-Path $ProjectRoot ".env.local"
$LocalEntry = (Resolve-Path (Join-Path $ProjectRoot "server\index.mjs")).Path
$ViteEntry = (Resolve-Path (Join-Path $ProjectRoot "node_modules\vite\bin\vite.js") -ErrorAction SilentlyContinue).Path

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

function Get-Listener([int]$Port) {
  return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Get-ValidatedListener([int]$Port, [string]$CommandPattern, [string]$Label) {
  $listener = Get-Listener $Port
  if (-not $listener) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $process -or $process.CommandLine -notlike "*$CommandPattern*") {
    throw "$Label 端口 $Port 已被其他程序占用；未停止或覆盖该程序。"
  }
  return $process
}

function Wait-Http([string]$Url, [int[]]$AcceptedStatus, [int]$Attempts = 60) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($AcceptedStatus -contains [int]$response.StatusCode) { return $true }
    } catch {
      $status = $null
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $status = [int]$_.Exception.Response.StatusCode }
      if ($null -ne $status -and $AcceptedStatus -contains $status) { return $true }
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  & npm install --prefix $ProjectRoot
  if ($LASTEXITCODE -ne 0) { throw "依赖安装失败。" }
}

$cloudMode = $false
if (Test-Path $EnvFile) {
  $cloudMode = [bool](Select-String -LiteralPath $EnvFile -Pattern '^\s*VITE_DEPLOYMENT_MODE\s*=\s*cloud\s*$' -Quiet)
}
$node = (Get-Command node.exe -ErrorAction Stop).Source

if ($cloudMode) {
  if (-not $ViteEntry) { $ViteEntry = (Resolve-Path (Join-Path $ProjectRoot "node_modules\vite\bin\vite.js")).Path }
  $apiPort = 4317
  $uiPort = 4318
  $apiProcess = Get-ValidatedListener $apiPort "cloud/dev-server.mjs" "云端 API"
  if (-not $apiProcess) {
    $apiProcess = Start-Process -FilePath $node -ArgumentList @("--use-env-proxy", "--env-file=.env.local", "cloud/dev-server.mjs") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
  }
  $uiProcess = Get-ValidatedListener $uiPort "vite" "前端"
  if (-not $uiProcess) {
    $uiProcess = Start-Process -FilePath $node -ArgumentList @("node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", [string]$uiPort) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
  }

  if (-not (Wait-Http "http://127.0.0.1:$apiPort/api/session" @(200, 401))) { throw "云端 API 未在预期时间内响应。" }
  if (-not (Wait-Http "http://127.0.0.1:$uiPort/" @(200))) { throw "前端未在预期时间内响应。" }
  $apiPid = if ($apiProcess.ProcessId) { [int]$apiProcess.ProcessId } else { [int]$apiProcess.Id }
  $uiPid = if ($uiProcess.ProcessId) { [int]$uiProcess.ProcessId } else { [int]$uiProcess.Id }

  $state = @{
    mode = "cloud"
    appUrl = "http://127.0.0.1:$uiPort"
    startedAt = (Get-Date).ToString("o")
    processes = @(
      @{ pid = $apiPid; entry = "cloud/dev-server.mjs"; port = $apiPort; label = "cloud-api" },
      @{ pid = $uiPid; entry = "vite"; port = $uiPort; label = "frontend" }
    )
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StateFile -Encoding UTF8
  $AppUrl = $state.appUrl
} else {
  $Port = $null
  $listener = $null
  if (Test-Path $StateFile) {
    $saved = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
    if ($saved.mode -eq "local" -or $saved.serverEntry) {
      $savedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($saved.pid)" -ErrorAction SilentlyContinue
      if ($savedProcess -and $savedProcess.CommandLine -like "*$LocalEntry*") {
        $Port = [int]$saved.port
        $listener = Get-Listener $Port
      }
    }
  }
  if (-not $listener) {
    $candidates = if ($env:AI_RESEARCH_PORT) { @([int]$env:AI_RESEARCH_PORT) } else { 4317..4327 }
    foreach ($candidate in $candidates) { if (-not (Get-Listener $candidate)) { $Port = $candidate; break } }
    if ($null -eq $Port) { throw "候选端口均被占用；未停止或覆盖其他程序。" }
    $env:AI_RESEARCH_PORT = [string]$Port
    if (-not (Test-Path (Join-Path $ProjectRoot "dist\index.html"))) {
      & npm run build --prefix $ProjectRoot
      if ($LASTEXITCODE -ne 0) { throw "前端构建失败。" }
    }
    $process = Start-Process -FilePath $node -ArgumentList @("server/index.mjs") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
    @{ mode = "local"; pid = $process.Id; serverEntry = $LocalEntry; port = $Port; appUrl = "http://127.0.0.1:$Port"; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
  }
  $AppUrl = "http://127.0.0.1:$Port"
  if (-not (Wait-Http "$AppUrl/api/health" @(200))) { throw "本地服务未在预期时间内通过健康检查。" }
}

if (-not $NoBrowser) {
  $chrome = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue).'(default)'
  if (-not $chrome) { $chrome = (Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue).'(default)' }
  if ($chrome -and (Test-Path $chrome)) { Start-Process -FilePath $chrome -ArgumentList @($AppUrl) } else { Start-Process $AppUrl }
}

Write-Host "AI 科研工作台已启动：$AppUrl"
