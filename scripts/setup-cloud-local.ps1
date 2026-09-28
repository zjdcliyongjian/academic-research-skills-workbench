[CmdletBinding()]
param(
  [switch]$SkipAdminBootstrap,
  [string]$PublishableKey = '',
  [Parameter(Mandatory = $true)]
  [string]$ProjectUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectUrl = $ProjectUrl.Trim().TrimEnd('/')
$envPath = Join-Path $projectRoot '.env.local'

if ($projectUrl -notmatch '^https://[a-z0-9]+\.supabase\.co$') {
  throw 'ProjectUrl must be a valid Supabase project URL.'
}

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

function Assert-SingleLine {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw "$Name must not be empty or contain a newline."
  }
}

$publishableKey = $PublishableKey.Trim()
if ([string]::IsNullOrWhiteSpace($publishableKey)) {
  $publishableKey = Read-SecretText 'Paste Supabase publishable key (input is hidden)'
}
$secretKey = Read-SecretText 'Paste Supabase secret key (input is hidden)'

Assert-SingleLine -Name 'Supabase publishable key' -Value $publishableKey
Assert-SingleLine -Name 'Supabase secret key' -Value $secretKey

if (-not ($publishableKey.StartsWith('sb_publishable_') -or $publishableKey.StartsWith('eyJ'))) {
  throw 'The publishable key format is invalid.'
}
if (-not ($secretKey.StartsWith('sb_secret_') -or $secretKey.StartsWith('eyJ'))) {
  throw 'The secret key format is invalid.'
}

$byokBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($byokBytes)
$random.Dispose()
$byokMasterKey = [Convert]::ToBase64String($byokBytes)
[Array]::Clear($byokBytes, 0, $byokBytes.Length)

$envLines = @(
  'VITE_DEPLOYMENT_MODE=cloud'
  "VITE_SUPABASE_URL=$projectUrl"
  "VITE_SUPABASE_ANON_KEY=$publishableKey"
  "SUPABASE_URL=$projectUrl"
  "SUPABASE_SERVICE_ROLE_KEY=$secretKey"
  "BYOK_MASTER_KEY=$byokMasterKey"
  'ALLOW_SYNCHRONOUS_DEMO_RUNS=true'
)
$envContent = [string]::Join([Environment]::NewLine, $envLines) + [Environment]::NewLine

$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($envPath, $envContent, $utf8NoBom)
Write-Host 'Local .env.local was written and is excluded by .gitignore.'

if ($SkipAdminBootstrap) {
  Write-Host 'Admin bootstrap was skipped.'
  exit 0
}

$adminPassword = Read-SecretText 'Set the admin password (8-12 characters with letters, numbers, and symbols; input is hidden)'
if ($adminPassword.Length -lt 8 -or $adminPassword.Length -gt 12 -or $adminPassword -notmatch '[A-Za-z]' -or $adminPassword -notmatch '\d' -or $adminPassword -notmatch '[^A-Za-z0-9\s]' -or $adminPassword -match '\s') {
  throw 'The admin password must be 8-12 characters and contain letters, numbers, and symbols.'
}

try {
  $env:SUPABASE_URL = $projectUrl
  $env:SUPABASE_SERVICE_ROLE_KEY = $secretKey
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
  $secretKey = $null
  $publishableKey = $null
  $byokMasterKey = $null
}

Write-Host 'Local cloud configuration and admin bootstrap completed.'
