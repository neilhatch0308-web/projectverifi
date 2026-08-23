# fix-package-scripts.ps1 - adds the dev/build/start scripts to server\package.json
# Run this FROM INSIDE the server\ folder:
#   cd C:\Users\hatch\Project-Realisation\server
#   ..\fix-package-scripts.ps1   (or wherever you save this file)

$ErrorActionPreference = "Stop"

if (-not (Test-Path "package.json")) {
    Write-Host "package.json not found in the current folder. cd into server\ first." -ForegroundColor Red
    exit 1
}

$json = Get-Content "package.json" -Raw | ConvertFrom-Json

# Add/overwrite the scripts we need, keeping anything else already there
$json.scripts | Add-Member -NotePropertyName "dev" -NotePropertyValue "ts-node-dev --respawn --transpile-only src/index.ts" -Force
$json.scripts | Add-Member -NotePropertyName "build" -NotePropertyValue "tsc" -Force
$json.scripts | Add-Member -NotePropertyName "start" -NotePropertyValue "node dist/index.js" -Force

$json | ConvertTo-Json -Depth 10 | Out-File -FilePath "package.json" -Encoding ascii

Write-Host "Updated scripts in package.json:" -Foregroud sr ndColor Green
Get-Content "package.json" | Select-String '"dev"|"build"|"start"'