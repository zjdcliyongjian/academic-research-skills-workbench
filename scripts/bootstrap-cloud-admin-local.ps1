[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env.local'

function Read-SecretText {
  param([Parameter(Mandatory = $true)][string]$Prompt)

  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

if (-not (Test-Path -LiteralPath $envPath)) {
  throw 'The .env.local file does not exist. Copy .env.example or run scripts/setup-cloud-local.ps1 first.'
}

$config = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^([^#=]+)=(.*)$') {
    $config[$matches[1].Trim()] = $matches[2].Trim()
  }
}

$projectUrl = [string]$config['SUPABASE_URL']
$serviceKey = [string]$config['SUPABASE_SERVICE_ROLE_KEY']
if ($projectUrl -notmatch '^https://[a-z0-9]+\.supabase\.co$') {
  throw 'SUPABASE_URL is missing or invalid in .env.local.'
}
if (-not ($serviceKey.StartsWith('sb_secret_') -or $serviceKey.StartsWith('eyJ'))) {
  throw 'SUPABASE_SERVICE_ROLE_KEY is missing or invalid in .env.local.'
}

$adminPassword = Read-SecretText 'Set the admin password (8-12 characters with letters, numbers, and symbols; input is hidden)'
if ($adminPassword.Length -lt 8 -or $adminPassword.Length -gt 12 -or $adminPassword -notmatch '[A-Za-z]' -or $adminPassword -notmatch '\d' -or $adminPassword -notmatch '[^A-Za-z0-9\s]' -or $adminPassword -match '\s') {
  throw 'The admin password must be 8-12 characters and contain letters, numbers, and symbols.'
}

try {
  $env:SUPABASE_URL = $projectUrl
  $env:SUPABASE_SERVICE_ROLE_KEY = $serviceKey
  $env:ADMIN_ACCOUNT = 'admin'
  $env:ADMIN_PASSWORD = $adminPassword
  Push-Location $projectRoot
  try {
    npm run cloud:bootstrap-admin
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item Env:SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:ADMIN_ACCOUNT -ErrorAction SilentlyContinue
  Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $adminPassword = $null
  $serviceKey = $null
}

Write-Host 'Cloud admin bootstrap completed.'
