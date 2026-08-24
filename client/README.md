# Ledger (Project Verifi) - Demand & Benefits Platform

A demand intake, weighted prioritisation, triage, and RACI-governed acceptance
platform, built against the Realistic Path Value Framework (RPVF): preserved
original criteria, gated re-basing, mandatory attribution, and a capped,
lifecycle-managed strategic goal register. This is the real product behind
"Project Verifi" on we-verifi.co.uk.

## Current state (accurate as of this file's last update)

This is a working, deployed-to-real-GCP application, not a prototype:

- Real GCP project, Cloud SQL (public IP + Cloud SQL Auth Proxy, no VPC -
  see "Deployment model" below), Firebase Auth
- Schema files `01` through `20` applied and verified against a live database
- Row-level security genuinely enforced (proven with a cross-tenant test,
  not just applied) - see `12_row_level_security.sql`
- Real Firebase-authenticated login, wired end to end to a real React
  frontend calling a real Express API
- A working demand lifecycle: Raise -> Triage (Accept/Reject) -> RACI
  naming -> criteria lock, each transition backed by a real endpoint,
  not a static mockup

## Folder contents

```
Project-Realisation/
├── README.md                     <- you are here
├── SETUP_GUIDE.md                 <- Windows/PowerShell GCP setup, no-VPC path
├── COMMAND_REFERENCE.md           <- every command, grouped by terminal, for a work session
├── set-env.ps1                    <- dot-source this first in every new terminal
├── start-db.ps1 / stop-db.ps1     <- Cloud SQL start/stop (only real always-on cost)
├── schema/                        <- apply in numeric order (dependencies matter)
│   ├── 01-08                        original build: core tracker, demand, scoring
│   │                                 matrix, workflow, decisions, KPI/similarity,
│   │                                 wizard, RBAC
│   ├── 09_rpvf_dimensions_and_governance.sql   RPVF alignment layer (see below)
│   ├── 10_seed_dummy_data.sql       Acme Holdings seed data (apply AFTER 11)
│   ├── 11_programme_layer.sql       groups one or more projects under a programme
│   ├── 12_row_level_security.sql    dynamic RLS across every organization_id table
│   ├── 13_firebase_uid.sql          links app_user to real Firebase identities
│   ├── 14_auth_lookup_function.sql  narrow RLS-bypass for the identity lookup itself
│   ├── 15_demand_acceptance.sql     RACI seats + real DB-level criteria lock trigger
│   ├── 16_seed_scoring_criteria.sql initial (now superseded) scoring set
│   ├── 17_weighted_scoring_and_demand_fields.sql   real 5-category weighted model
│   ├── 18_triage_decision.sql       accepted/rejected labels, complexity/cost tiers
│   ├── 19_strategic_goal_lifecycle.sql   active/suspended/completed goal status
│   └── 20_consolidate_strategy_tables.sql   retires strategy_objective, see below
├── server/                        <- Express + TypeScript API (tsx, not ts-node-dev)
│   └── src/
│       ├── db/pool.ts               loads its own dotenv - see note below
│       ├── middleware/auth.ts       Firebase token verify -> org lookup -> RLS context
│       └── routes/                  demand, users, portfolio, strategicGoals, scoringCriteria
├── client/                        <- React + Vite, real brand assets from we-verifi
│   └── src/
│       ├── assets/                  project-verifi-logo.svg, project-verifi-icon.svg
│       ├── styles/                  we-verifi-brand.css (source) + ledger-app.css (built on it)
│       ├── components/AppShell.tsx  sidebar nav + persistent "+ Raise demand" entry point
│       └── pages/                   Login, AllDemand, RaiseDemand, DemandDetail,
│                                     AcceptDemand, StrategicGoals
├── functions/                     <- original Cloud SQL start/stop control function
│                                     (superseded locally by start-db.ps1/stop-db.ps1,
│                                     kept as the eventual in-app admin control)
└── prototype/                     <- original clickable React prototype (superseded
                                       by the real client/ app; kept for reference)
```

## Deployment model: no VPC (deliberate cost decision)

Cloud SQL runs with a **public IP**, reached via the Cloud SQL Auth Proxy
(IAM-authenticated, not a bare open port) both locally and from Cloud Run.
This was a deliberate choice to avoid the Serverless VPC Access connector's
always-on cost while three platforms are being built solo. See
`SETUP_GUIDE.md` section 9 for the migration path to private networking
(VPC + no public IP) once it's worth the spend - nothing in the schema or
app code needs to change, only the connection path.

The only always-on cost right now is the Cloud SQL instance itself
(`db-f1-micro`) - stop it with `stop-db.ps1` whenever not in use; only
storage is billed while stopped.

## What `09_rpvf_dimensions_and_governance.sql` added over the original build

Files `01-08` were the original build - a real, working demand tracker with
its own good ideas (duplicate detection, AI similarity checks, sensitivity
classification). `09` layered the RPVF framework's governance model on top,
additively, reusing existing tables where they already fit:

| RPVF concept | Where it lives |
|---|---|
| Division | Reuses `portfolio` |
| Original success criteria, preserved | Reuses `kpi_definition`, tagged with a `dimension` column |
| Gated re-basing | `kpi_definition_revision` |
| Strategic goals - corporate only, capped 5/year | `strategic_goal`, trigger-enforced cap, full lifecycle (`19`) |
| Mandatory attribution confidence | Added to `realization_check`, trigger-enforced |
| Cost-to-benefit flag | `cost_benefit_flag` (schema exists, not yet wired to a real flow) |
| Dis-benefits, separate lines | `dis_benefit` |

## The real demand lifecycle, as built

1. **Raise** (`RaiseDemand.tsx` / `POST /api/demands`) - conceiver, sponsor
   (a senior person who backed the idea - separate from the RACI sponsor
   named later), business group, problem statement, need-and-output
   statement, need-by date, optional link to a strategic goal, success
   measures per RPVF dimension (delivery/adoption/business/financial),
   and weighted priority scoring against 5 real categories (Financial 25%,
   Competitive 15%, Regulatory 20%, Risk 20%, Reputation 20% - see
   `17_weighted_scoring_and_demand_fields.sql` for the full level definitions).
2. **Triage** (`raised` status) - portfolio leads / PMO assess complexity
   and cost (high/medium/low each), then decide **Accepted** or **Rejected**.
   Both tiers are required before either decision can be recorded.
3. **RACI naming** (`accepted` status) - the 5 seats (accountable
   financial/scope/schedule, sponsor, benefit owner) are named. The
   moment this completes, `demand.accepted_at` is set and a real
   Postgres trigger blocks any further direct edit to that demand's
   success criteria - re-basing requires a gated process, not a plain
   UPDATE. Status becomes `promoted`.
4. **Business case, budgets, kickoff, ongoing monitoring** - schema exists
   (`business_case`, `investment`, `benefit`, `dis_benefit`) but has no
   real routes or screens yet. This is the next major piece of work.

## Deliberately deferred (by design, not by accident)

- **Duplicate / in-flight detection at Triage.** The tables exist
  (`demand_link`, `ai_similarity_check`) but aren't surfaced to the
  triage reviewer yet. Explicit decision: get the human triage process
  solid first, add AI-assisted similarity checking once there's real
  usage to tune it against.
- **Role-based enforcement of who can hold a governance seat** (sponsor,
  RACI seats). Currently a UI nudge only (senior roles sort first, shown
  with a role label) - anyone can technically be picked. Raising a demand
  itself is deliberately unrestricted, to encourage ideas broadly; the
  "spoken to a senior person" check is a documented business process,
  not an app-enforced gate.
- **`strategy_objective` / `demand_strategy_link`** - the original build's
  objectives table, superseded by `strategic_goal` /  `demand_goal_link`
  as of `20_consolidate_strategy_tables.sql`. Old rows preserved for
  audit, not deleted; nothing writes to them anymore.

## Known gaps still open

- `priority_score` in `02_demand_management.sql` was a hard-coded
  generated column; the real weighted-scoring model (`17`) supersedes it
  for actual prioritisation, but the old column/formula was never cleanly
  removed.
- Q9 from the framework doc (whether "overdue" should be its own
  `outcome_classification` value, or just a `realization_check` state) -
  not locked yet.
- `demand_priority_view`'s `weighted_score` and `total_score` are numeric
  types - `pg` returns these as strings, not JS numbers. Client code
  wraps every use in `Number(...)` before calling `.toFixed()`; watch for
  this if adding new numeric displays.

## Quick start (see SETUP_GUIDE.md and COMMAND_REFERENCE.md for full detail)

1. `. .\set-env.ps1` in every new terminal (dot-sourced, not just run)
2. `start-db.ps1`, then the Cloud SQL Auth Proxy, then `npm run dev` in
   both `server\` and `client\` - see `COMMAND_REFERENCE.md` for the
   exact five-terminal layout
3. Apply schema files `01` through `20` in order (note: `10` runs AFTER
   `11`, despite the numbering - it depends on the programme table existing)
4. `stop-db.ps1` when done - the only thing that actually costs money idle