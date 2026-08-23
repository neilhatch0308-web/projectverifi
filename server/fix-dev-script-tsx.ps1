# fix-dev-script-tsx.ps1 - switches the dev script from ts-node-dev to tsx
# Run FROM INSIDE server\, after: npm install -D tsx

$ErrorActionPreference = "Stop"

if (-not (Test-Path "package.json")) {
    Write-Host "package.json not found in the current folder. cd into server\ first." -ForegroundColor Red
    exit 1
}

$json = Get-Content "package.json" -Raw | ConvertFrom-Json
$json.scripts | Add-Member -NotePropertyName "dev" -NotePropertyValue "tsx watch src/index.ts" -Force

$json | ConvertTo-Json -Depth 10 | Out-File -FilePath "package.json" -Encoding ascii

Write-Host "dev script now uses tsx:" -ForegroundColor Green
Get-Content "package.json" | Select-String '"dev"'