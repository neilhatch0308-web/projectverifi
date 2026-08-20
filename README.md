# Ledger — Demand & Benefits Platform

A demand intake, scoring, business case, and benefits realization platform, with peer review,
AI-assisted duplicate detection, and role-based access control.

## Folder contents

```
ledger-platform/
├── README.md                    <- you are here
├── BUILD_GUIDE.md                <- step-by-step GCP setup, in order, with real commands
├── schema/                       <- apply these in numeric order (dependencies matter)
│   ├── 01_benefits_tracker_core.sql
│   ├── 02_demand_management.sql
│   ├── 03_demand_scoring_matrix.sql
│   ├── 04_workflow_stage_ownership.sql
│   ├── 05_decision_reasons.sql
│   ├── 06_project_kpi_similarity.sql
│   ├── 07_demand_wizard.sql
│   └── 08_rbac_and_security.sql
├── functions/
│   ├── cloud_sql_control_function.js   <- start/stop/status admin control (control-plane only)
│   └── package.json
└── prototype/
    └── demand-register-prototype.jsx   <- clickable React prototype (register, drawer, scoring,
                                            peer review, business case, financial assessment, dashboard)
```

## Quick start

1. Read `BUILD_GUIDE.md` top to bottom — it's ordered as a runbook, not a reference doc
2. Stand up the GCP infrastructure (sections 1–3): VPC, private-IP-only Cloud SQL
3. Apply the schema files in `schema/`, in numeric order (section 4)
4. Deploy Firebase Hosting + Auth (section 5)
5. Deploy the control function (section 6) and Cloud Scheduler auto-stop (section 7)
6. The React prototype in `prototype/` can be dropped into a Create React App or Vite project as
   the main component to click through the flow before wiring it to the real API

## Architecture at a glance

- **Database**: Cloud SQL for PostgreSQL, private IP only, `db-f1-micro`
- **Frontend**: Firebase Hosting (default `.web.app` URL, no custom domain needed)
- **Auth**: Firebase Authentication
- **Admin control**: Cloud Function calling the Cloud SQL Admin API (works regardless of DB state)
- **Future backend**: Cloud Run with Direct VPC egress (no always-on connector cost)
- **AI similarity checks**: Vertex AI (embeddings + Gemini for rationale)
- **Cost target**: ~£1.50–2.50/month for 30 min/day demo use, no public IP anywhere

## Design principles carried through the schema

- Nothing asserts compliance or "done" without an evidence trail (`audit_log`, `realization_check`,
  `kpi_measurement`) — the platform tracks and surfaces, it doesn't make judgement calls
- AI-assisted similarity checks (`ai_similarity_check`) are advisory by default, but become a hard
  gate at the point a sponsor accepts a demand (`demand_pending_similarity_review`)
- Roles are scoped to organization *and* portfolio, not just a flat admin/user split
- Sensitivity classification (`business_case.sensitivity_level`) allows restricting visibility of
  commercially sensitive cases independent of the general role hierarchy
