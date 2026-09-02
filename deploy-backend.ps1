# Deploy backend to Cloud Run with all required environment variables and secrets
# Run from project root: .\scripts\deploy-backend.ps1
# Or: .\deploy-backend.ps1 if placed in root

param(
    [string]$Project = "ledger-rpvf-prod",
    [string]$Region = "us-central1",
    [string]$Service = "ledger-api",
    [switch]$SkipSource  # Use --image instead of source deploy (for CI/CD)
)

# Colors for output
$Green = "`e[32m"
$Red = "`e[31m"
$Yellow = "`e[33m"
$Reset = "`e[0m"

Write-Host "${Green}=== Project Verifi Backend Deploy ===${Reset}"
Write-Host "Project: $Project"
Write-Host "Region: $Region"
Write-Host "Service: $Service"
Write-Host ""

# ============================================================================
# 1. Verify gcloud is authenticated
# ============================================================================
Write-Host "${Yellow}Checking gcloud authentication...${Reset}"
$authCheck = gcloud auth list --filter=status:ACTIVE --format="value(account)"
if (-not $authCheck) {
    Write-Host "${Red}ERROR: Not authenticated with gcloud. Run: gcloud auth login${Reset}"
    exit 1
}
Write-Host "${Green}Authenticated as: $authCheck${Reset}"
Write-Host ""

# ============================================================================
# 2. Verify secrets exist
# ============================================================================
Write-Host "${Yellow}Verifying secrets exist...${Reset}"
$secrets = @(
    "ledger-db-password",
    "ledger-db-connection-name"
)

foreach ($secret in $secrets) {
    $secretCheck = gcloud secrets describe $secret --project $Project 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "${Red}ERROR: Secret '$secret' not found in project '$Project'${Reset}"
        exit 1
    }
    Write-Host "${Green}Secret found: OK: $secret${Reset}"
}
Write-Host ""

# ============================================================================
# 3. Show current secret values (latest versions only, no exposure)
# ============================================================================
Write-Host "${Yellow}Current secret versions:${Reset}"
foreach ($secret in $secrets) {
    $version = gcloud secrets versions list $secret --project $Project --limit=1 --format="value(name)"
    Write-Host "  $secret -> version $version"
}
Write-Host ""

# ============================================================================
# 4. Confirm deployment
# ============================================================================
Write-Host "${Yellow}About to deploy with:${Reset}"
Write-Host "  DB_USER=postgres"
Write-Host "  DB_NAME=postgres"
Write-Host "  DB_PASSWORD=ledger-db-password:latest"
Write-Host "  INSTANCE_CONNECTION_NAME=ledger-db-connection-name:latest"
Write-Host "  ALLOWED_ORIGINS=https://projects.we-verifi.co.uk,https://we-verifi.co.uk"
Write-Host ""

$confirm = Read-Host "Continue with deployment? (y/n)"
if ($confirm -ne 'y') {
    Write-Host "${Yellow}Deploy cancelled.${Reset}"
    exit 0
}
Write-Host ""

# ============================================================================
# 5. Deploy to Cloud Run
# ============================================================================
Write-Host "${Yellow}Deploying to Cloud Run...${Reset}"
Write-Host "(This may take 2-5 minutes)"
Write-Host ""

if ($SkipSource) {
    # For CI/CD: use existing image instead of building from source
    Write-Host "${Yellow}Note: Using --image flag (CI/CD mode). Make sure image is already built.${Reset}"
    # You would normally construct this with a recent image URI, e.g.:
    # gcloud run deploy $Service `
    #   --project $Project `
    #   --region $Region `
    #   --image "us-central1-docker.pkg.dev/$Project/cloud-run-source-deploy/ledger-api:latest" `
    #   --set-env-vars DB_USER=postgres,DB_NAME=postgres `
    #   --update-secrets DB_PASSWORD=ledger-db-password:latest `
    #   --update-secrets INSTANCE_CONNECTION_NAME=ledger-db-connection-name:latest
} else {
    # Local development: build from source (backend is in ./server directory)
    gcloud run deploy $Service `
      --project $Project `
      --region $Region `
      --source ./server `
      --set-env-vars "^;^DB_USER=postgres;DB_NAME=postgres;EMAIL_FROM=noreply@we-verifi.co.uk;EMAIL_FROM_NAME=Project Verifi;ALLOWED_ORIGINS=https://projects.we-verifi.co.uk,https://we-verifi.co.uk" `
      --update-secrets DB_PASSWORD=ledger-db-password:latest `
      --update-secrets BREVO_API_KEY=ledger-brevo-api-key:latest `
      --update-secrets INSTANCE_CONNECTION_NAME=ledger-db-connection-name:latest
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "${Red}Deploy failed.${Reset}"
    exit 1
}

Write-Host ""
Write-Host "${Green}=== Deploy Complete ===${Reset}"
Write-Host ""

# ============================================================================
# 6. Show deployment info
# ============================================================================
Write-Host "${Yellow}Service Info:${Reset}"
$serviceInfo = gcloud run services describe $Service --project $Project --region $Region --format="value(status.url)"
Write-Host "URL: $serviceInfo"
Write-Host ""

Write-Host "${Green}Next steps:${Reset}"
Write-Host "1. Update client/.env.production:"
Write-Host "   VITE_API_BASE_URL=$serviceInfo"
Write-Host "2. Rebuild frontend: cd client && npm run build"
Write-Host "3. Deploy frontend to Firebase Hosting"
Write-Host ""