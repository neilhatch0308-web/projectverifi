# stop-db.ps1 - stops the Cloud SQL instance so it stops billing for compute
# Only storage cost remains while stopped (a few pence). Run this whenever
# you're done working, not just at end of day.
# Usage: .\stop-db.ps1

$ErrorActionPreference = "Stop"

$Instance = "ledger-db"
$Project  = $env:PROJECT_ID

if (-not $Project) {
    Write-Host "PROJECT_ID isn't set in this session." -ForegroundColor Yellow
    $Project = Read-Host "Enter your GCP project ID"
}

Write-Host "Stopping Cloud SQL instance '$Instance'..." -ForegroundColor Cyan
gcloud sql instances patch $Instance --project=$Project --activation-policy=NEVER --quiet

Write-Host "Instance stop requested. Only storage is billed while it's stopped." -ForegroundColor Green
Write-Host "Also close any running cloud-sql-proxy.exe window - it'll just sit" -ForegroundColor Yellow
Write-Host "there failing to connect otherwise." -ForegroundColor Yellow