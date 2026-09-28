param(
  [Parameter(Mandatory = $true)][string]$InputDocx,
  [Parameter(Mandatory = $true)][string]$OutputPdf
)

$ErrorActionPreference = "Stop"
$inputPath = (Resolve-Path -LiteralPath $InputDocx).Path
$outputDir = Split-Path -Parent $OutputPdf
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$outputPath = [System.IO.Path]::GetFullPath($OutputPdf)

$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($inputPath, $false, $true)
  $document.ExportAsFixedFormat($outputPath, 17)
} finally {
  if ($document) { $document.Close($false) }
  if ($word) { $word.Quit() }
  if ($document) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($word) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

if (-not (Test-Path -LiteralPath $outputPath)) { throw "Word 未生成 PDF。" }
Write-Output $outputPath
