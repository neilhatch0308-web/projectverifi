# Deploy frontend to Firebase Hosting
# Run from project root: .\scripts\deploy-frontend.ps1
# Assumes client/.env.production is already configured with correct VITE_API_BASE_URL

param(
    [string]$Project = "ledger-rpvf-prod"
)

$Green = "`e[32m"
$Red = "`e[31m"
$Yellow = "`e[33m"
$Reset = "`e[0m"

Write-Host "${Green}=== Project Verifi Frontend Deploy ===${Reset}"
Write-Host "Project: $Project"
Write-Host ""

# ============================================================================
# 1. Verify Firebase CLI is installed
# ============================================================================
Write-Host "${Yellow}Checking Firebase CLI...${Reset}"
$firebaseCheck = firebase --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "${Red}ERROR: Firebase CLI not installed. Run: npm install -g firebase-tools${Reset}"
    exit 1
}
Write-Host "${Green}Firebase CLI: $firebaseCheck${Reset}"
Write-Host ""

# ============================================================================
# 2. Verify .env.production exists and has VITE_API_BASE_URL
# ============================================================================
Write-Host "${Yellow}Checking client/.env.production...${Reset}"
if (-not (Test-Path "client/.env.production")) {
    Write-Host "${Red}ERROR: client/.env.production not found${Reset}"
    exit 1
}

# Read lines and find VITE_API_BASE_URL
$envLines = @(Get-Content "client/.env.production")
$apiBaseUrlLine = $null
foreach ($line in $envLines) {
    if ($line -match "^VITE_API_BASE_URL=") {
        $apiBaseUrlLine = $line
        break
    }
}

if (-not $apiBaseUrlLine) {
    Write-Host "${Red}ERROR: VITE_API_BASE_URL not set in client/.env.production${Reset}"
    exit 1
}

# Extract value after the equals sign
$apiBaseUrl = $apiBaseUrlLine -replace "^VITE_API_BASE_URL=", ""
$apiBaseUrl = $apiBaseUrl.Trim()

Write-Host "${Green}API Base URL: $apiBaseUrl${Reset}"
Write-Host ""

# ============================================================================
# 3. Build frontend
# ============================================================================
Write-Host "${Yellow}Building frontend...${Reset}"
Push-Location client
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "${Red}Build failed.${Reset}"
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "${Green}Build complete.${Reset}"
Write-Host ""

# ============================================================================
# 4. Confirm deployment
# ============================================================================
Write-Host "${Yellow}About to deploy to Firebase Hosting:${Reset}"
Write-Host "  Project: $Project"
Write-Host "  Source: client/dist"
Write-Host ""

$confirm = Read-Host "Continue with deployment? (y/n)"
if ($confirm -ne 'y') {
    Write-Host "${Yellow}Deploy cancelled.${Reset}"
    exit 0
}
Write-Host ""

# ============================================================================
# 5. Deploy to Firebase Hosting
# ============================================================================
Write-Host "${Yellow}Deploying to Firebase Hosting...${Reset}"
firebase deploy --project $Project --only hosting

if ($LASTEXITCODE -ne 0) {
    Write-Host "${Red}Deploy failed.${Reset}"
    exit 1
}

Write-Host ""
Write-Host "${Green}=== Frontend Deploy Complete ===${Reset}"
Write-Host ""
Write-Host "${Green}Your frontend is now live at: https://project.we-verifi.co.uk${Reset}"
Write-Host ""