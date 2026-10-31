$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$archive = Join-Path $dist 'SillyTavern-Relationship-Engine.zip'
if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null
$items = Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -notin @('.git', 'dist', 'node_modules') }
Compress-Archive -Path $items.FullName -DestinationPath $archive -CompressionLevel Optimal
Write-Output $archive
