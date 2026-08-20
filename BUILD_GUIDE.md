# Ledger — Build & Configuration Guide

Region used throughout: **europe-west2 (London)** — lowest latency for you, keeps data in-region.
Replace `YOUR_PROJECT_ID` everywhere with your actual GCP project ID.

Cost target with this configuration: **~£1.50–2.50/month** for demo-level use (30 min/day database
uptime, no public IP anywhere, no always-on VPC connector). See the cost notes at the end.

---

## 0. Prerequisites

```bash
# Install/verify tools
gcloud --version
firebase --version   # npm install -g firebase-tools if missing

# Authenticate
gcloud auth login
firebase login

# Set your project as default
gcloud config set project YOUR_PROJECT_ID
```

Make sure billing is linked to your GCP account with the credit, and that Firestore/Firebase is on
the **Blaze** plan (required for Cloud Functions and any outbound network calls).

---

## 1. Enable required APIs

```bash
gcloud services enable \
  sqladmin.googleapis.com \
  run.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  servicenetworking.googleapis.com \
  vpcaccess.googleapis.com \
  cloudscheduler.googleapis.com \
  aiplatform.googleapis.com \
  compute.googleapis.com \
  firebase.googleapis.com
```

---

## 2. Network setup — VPC + Private Services Access

This lets Cloud SQL have a **private IP only** (no public IP, avoiding the ~£7.50/month idle charge).

```bash
# Create a VPC network (skip if you already have one you want to use)
gcloud compute networks create ledger-vpc --subnet-mode=auto

# Reserve an internal IP range for the private services connection
gcloud compute addresses create ledger-private-ip-range \
  --global \
  --purpose=VPC_PEERING \
  --prefixlength=16 \
  --network=ledger-vpc

# Create the private connection Cloud SQL will use
gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=ledger-private-ip-range \
  --network=ledger-vpc
```

---

## 3. Create the Cloud SQL instance — private IP only, no public IP

```bash
gcloud sql instances create ledger-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=europe-west2 \
  --network=ledger-vpc \
  --no-assign-ip \
  --storage-size=10 \
  --storage-type=SSD \
  --storage-auto-increase \
  --backup-start-time=02:00
```

`--no-assign-ip` is the important flag — it means **no public IPv4 address is ever created**, so the
idle-IP charge never applies.

```bash
# Set a strong password for the default postgres user
gcloud sql users set-password postgres \
  --instance=ledger-db \
  --password='CHOOSE_A_STRONG_PASSWORD_HERE'

# Create the application database
gcloud sql databases create ledger --instance=ledger-db
```

Note the instance connection name for later steps:
```bash
gcloud sql instances describe ledger-db --format='value(connectionName)'
# -> YOUR_PROJECT_ID:europe-west2:ledger-db
```

---

## 4. Apply the schema

The `schema/` folder contains eight files, numbered in the order they must be applied (later files
depend on tables created in earlier ones).

Easiest path: use **Cloud SQL Studio** in the console (no local proxy needed), or connect via
Cloud Shell, which has network access to your project's private IP range:

```bash
# From Cloud Shell (has VPC access to your project)
gcloud sql connect ledger-db --user=postgres --database=ledger
```

Then, at the `psql` prompt, run each file in order:

```sql
\i schema/01_benefits_tracker_core.sql
\i schema/02_demand_management.sql
\i schema/03_demand_scoring_matrix.sql
\i schema/04_workflow_stage_ownership.sql
\i schema/05_decision_reasons.sql
\i schema/06_project_kpi_similarity.sql
\i schema/07_demand_wizard.sql
\i schema/08_rbac_and_security.sql
```

(If you're on a laptop rather than Cloud Shell, you'll need the Cloud SQL Auth Proxy running
locally first — see step 4a below.)

### 4a. (Optional) Connecting from your laptop instead of Cloud Shell

```bash
# Download the proxy (macOS example — see cloud.google.com/sql/docs/postgres/sql-proxy for other OS)
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.darwin.amd64
chmod +x cloud-sql-proxy

# Run it — connects to the private IP on your behalf
./cloud-sql-proxy --private-ip YOUR_PROJECT_ID:europe-west2:ledger-db

# In another terminal:
psql "host=127.0.0.1 port=5432 dbname=ledger user=postgres"
```

---

## 5. Firebase setup — Hosting + Auth

```bash
firebase init hosting
# Choose: use an existing project -> YOUR_PROJECT_ID
# Public directory: build (or wherever your React build output lands)
# Configure as single-page app: Yes

firebase init auth
```

In the [Firebase Console](https://console.firebase.google.com/) → **Authentication** → Sign-in
method, enable **Email/Password** (simplest for a small internal user base) or **Google** if you
want SSO with your own Google Workspace account.

Deploy:
```bash
firebase deploy --only hosting
```

Your app will be reachable at the default URL:
```
https://YOUR_PROJECT_ID.web.app
```

---

## 6. Deploy the Cloud SQL control function

```bash
cd functions

# Grant the function's runtime service account permission to manage Cloud SQL
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/cloudsql.admin"

gcloud functions deploy sql-control \
  --gen2 \
  --runtime=nodejs20 \
  --region=europe-west2 \
  --source=. \
  --entry-point=sqlControl \
  --trigger-http \
  --no-allow-unauthenticated \
  --set-env-vars=PROJECT_ID=YOUR_PROJECT_ID,INSTANCE_ID=ledger-db
```

This function does **not** need Direct VPC egress — it only calls the public Cloud SQL Admin REST
API (control-plane), never the database itself, so it works identically whether the instance is
running or stopped.

Note the function URL from the deploy output — this is what your admin toggle page calls:
```
https://europe-west2-YOUR_PROJECT_ID.cloudfunctions.net/sql-control
```

---

## 7. Auto-stop safety net — Cloud Scheduler

Belt-and-braces so a forgotten demo never runs unattended overnight.

```bash
gcloud scheduler jobs create http auto-stop-ledger-db \
  --location=europe-west2 \
  --schedule="0 22 * * *" \
  --time-zone="Europe/London" \
  --uri="https://europe-west2-YOUR_PROJECT_ID.cloudfunctions.net/sql-control" \
  --http-method=POST \
  --message-body='{"action":"stop"}' \
  --oidc-service-account-email=YOUR_PROJECT_ID@appspot.gserviceaccount.com
```

This calls the same function at 10pm every day and forces a stop, regardless of what the toggle
page last did.

---

## 8. (Future) Backend API on Cloud Run — Direct VPC egress

You don't need this yet for the static prototype, but when you build the real backend that queries
Postgres, deploy it like this so it can reach the private-IP database **without** an always-on VPC
connector:

```bash
gcloud run deploy ledger-api \
  --region=europe-west2 \
  --source=. \
  --network=ledger-vpc \
  --subnet=ledger-vpc \
  --vpc-egress=private-ranges-only \
  --set-env-vars=DB_HOST=<ledger-db private IP>,DB_NAME=ledger \
  --no-allow-unauthenticated
```

`--vpc-egress=private-ranges-only` is what keeps this cheap — traffic to the internet still goes
the normal serverless route; only traffic to your private IP range (i.e. the database) goes over
the VPC connection, and there's no connector VM billing 24/7 in the background.

Expect a startup delay of up to a minute on cold start when using Direct VPC egress — worth
reflecting in the UI as a loading state, same as the database wake-up.

---

## 9. AI similarity checks — Vertex AI

```bash
# No separate deploy step — called directly from your backend via the Vertex AI SDK
# Model for embeddings: text-embedding-004
# Model for comparison rationale: gemini-2.0-flash (fast, cheap, sufficient for this use case)
```

Cost is per-call, fractions of a cent at demo volume — comfortably inside your GCP credit.

---

## 10. Quick reference — URLs and commands you'll use often

| What | Where |
|---|---|
| Firebase app | `https://YOUR_PROJECT_ID.web.app` |
| Control function | `https://europe-west2-YOUR_PROJECT_ID.cloudfunctions.net/sql-control` |
| Cloud SQL console | `https://console.cloud.google.com/sql/instances/ledger-db/overview?project=YOUR_PROJECT_ID` |
| Firebase console | `https://console.firebase.google.com/project/YOUR_PROJECT_ID` |
| Manually start DB | `gcloud sql instances patch ledger-db --activation-policy=ALWAYS` |
| Manually stop DB | `gcloud sql instances patch ledger-db --activation-policy=NEVER` |
| Check DB state | `gcloud sql instances describe ledger-db --format='value(state)'` |
| Connect via Cloud Shell | `gcloud sql connect ledger-db --user=postgres --database=ledger` |

---

## 11. Cost checklist before you walk away from this

- [ ] Cloud SQL instance created with `--no-assign-ip` (confirm: `gcloud sql instances describe ledger-db --format='value(ipAddresses)'` should show nothing, or only a `PRIVATE` type entry — never `PRIMARY`)
- [ ] No Serverless VPC Access connector created (Direct VPC egress only, per step 8)
- [ ] Cloud Scheduler auto-stop job is active
- [ ] `db-f1-micro` tier (not a dedicated-core tier, which bills per-vCPU even when small)
- [ ] Storage auto-increase is on but starting size is small (10GB) — keep an eye on it as demo data grows
