# start-db.ps1 - starts the Cloud SQL instance so you can work
# Usage: .\start-db.ps1

$ErrorActionPreference = "Stop"

$Instance = "ledger-db"
$Project  = $env:PROJECT_ID   # must already be set in this session - run:  $env:PROJECT_ID = "your-project-id"

if (-not $Project) {
    Write-Host "PROJECT_ID isn't set in this session." -ForegroundColor Yellow
    $Project = Read-Host "Enter your GCP project ID"
}

Write-Host "Starting Cloud SQL instance '$Instance'..." -ForegroundColor Cyan
gcloud sql instances patch $Instance --project=$Project --activation-policy=ALWAYS --quiet

Write-Host "Waiting for it to come up (usually 1-2 minutes)..." -ForegroundColor Cyan
do {
    Start-Sleep -Seconds 10
    $state = gcloud sql instances describe $Instance --project=$Project --format="value(state)"
    Write-Host "  state: $state"
} while ($state -ne "RUNNABLE")

Write-Host "Instance is up. Start the Cloud SQL Auth Proxy now:" -ForegroundColor Green
Write-Host "  .\cloud-sql-proxy.exe `$env:INSTANCE_CONNECTION_NAME --port 5432" -ForegroundColor Green