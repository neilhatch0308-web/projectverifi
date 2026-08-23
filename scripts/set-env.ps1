# set-env.ps1 - sets the environment variables used across all the gcloud
# commands in this project. Run this ONCE at the start of every new
# PowerShell session, using dot-sourcing (the leading ". " matters - it
# applies the variables to YOUR current shell instead of a throwaway one):
#
#   . .\set-env.ps1
#
# (Running it as plain ".\set-env.ps1" without the leading dot will NOT
# work - the variables would only exist inside the script's own throwaway
# session and vanish immediately after.)

$env:PROJECT_ID = "ledger-rpvf-prod"
$env:REGION     = "us-central1"
$env:DB_INSTANCE = "ledger-db"

Write-Host "PROJECT_ID  = $env:PROJECT_ID"
Write-Host "REGION      = $env:REGION"
Write-Host "DB_INSTANCE = $env:DB_INSTANCE"

# Pull the Cloud SQL connection name live from gcloud rather than
# hard-coding it, since it's derived from the two values above and this
# way it's always correct even if the instance gets recreated.
try {
    $env:INSTANCE_CONNECTION_NAME = gcloud sql instances describe $env:DB_INSTANCE `
        --project=$env:PROJECT_ID --format="value(connectionName)" 2>$null

    if ($env:INSTANCE_CONNECTION_NAME) {
        Write-Host "INSTANCE_CONNECTION_NAME = $env:INSTANCE_CONNECTION_NAME"
    } else {
        Write-Host "Could not look up INSTANCE_CONNECTION_NAME - is the instance running and gcloud authenticated?" -ForegroundColor Yellow
    }
} catch {
    Write-Host "Skipped INSTANCE_CONNECTION_NAME lookup (gcloud not reachable right now)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Environment ready for this session." -ForegroundColor Green