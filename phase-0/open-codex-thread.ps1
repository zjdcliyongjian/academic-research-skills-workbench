param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
    [string]$ThreadId
)

$protocolPath = 'Registry::HKEY_CLASSES_ROOT\codex'
if (-not (Test-Path -LiteralPath $protocolPath)) {
    throw 'Codex URL protocol is not registered. Install or repair the Codex desktop app first.'
}

$uri = "codex://threads/$ThreadId"
Start-Process $uri

[pscustomobject]@{
    opened = $true
    threadId = $ThreadId
    uri = $uri
} | ConvertTo-Json -Compress
