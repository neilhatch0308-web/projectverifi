# Master deploy script - backend then frontend
# Run from project root: .\deploy-all.ps1

param(
    [string]$Project = "ledger-rpvf-prod",
    [string]$Region = "us-central1",
    [string]$Service = "ledger-api"
)

$Green = "`e[32m"
$Red = "`e[31m"
$Yellow = "`e[33m"
$Reset = "`e[0m"

Write-Host "${Green}=== Project Verifi - Full Deploy ===${Reset}"
Write-Host ""

# ============================================================================
# Deploy Backend
# ============================================================================
Write-Host "${Yellow}PHASE 1: Backend Deploy${Reset}"
Write-Host "----------------------------------------"
Write-Host ""

& ".\deploy-backend.ps1" -Project $Project -Region $Region -Service $Service

if ($LASTEXITCODE -ne 0) {
    Write-Host "${Red}Backend deploy failed. Aborting.${Reset}"
    exit 1
}

Write-Host ""
Write-Host "${Yellow}Waiting 10 seconds for backend to stabilize...${Reset}"
Start-Sleep -Seconds 10

# ============================================================================
# Deploy Frontend
# ============================================================================
Write-Host "${Yellow}PHASE 2: Frontend Deploy${Reset}"
Write-Host "----------------------------------------"
Write-Host ""

& ".\deploy-frontend.ps1" -Project $Project

if ($LASTEXITCODE -ne 0) {
    Write-Host "${Red}Frontend deploy failed.${Reset}"
    exit 1
}

# ============================================================================
# Complete
# ============================================================================
Write-Host ""
Write-Host "${Green}=== FULL DEPLOY COMPLETE ===${Reset}"
Write-Host ""
Write-Host "${Green}Your app is now live:${Reset}"
Write-Host "  Frontend: https://projects.we-verifi.co.uk"
Write-Host "  Backend:  https://$Service-357004644734.$Region.run.app"
Write-Host ""