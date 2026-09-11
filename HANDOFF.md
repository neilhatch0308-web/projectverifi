# Project Handoff — Ledger / Project Verifi

Bring this document, plus `realistic-path-value-framework-v1_1.md`, to a new
chat. The framework doc is the *design* source of truth (what and why); this
is the *technical/operational* source of truth (how, and what to watch out
for). `DATABASE_SCHEMA_REFERENCE.md` is the authoritative schema record and
is maintained on its own cadence — it currently runs ahead of the framework
doc, deliberately. Point Claude at these, and at the private GitHub repo,
rather than relying on chat history.

---

## 1. What this is

A demand-to-outcome governance platform ("Ledger", the real product behind
"Project Verifi" on we-verifi.co.uk), built against the Realistic Path Value
Framework. Currently repositioned around annual planning as the primary use
case (v0.7/v0.8 direction), with P50/P75/P100 estimate confidence and an
anchored-claim principle as the mechanism that makes the framework's honesty
thesis pay off in year one rather than year two.

## 2. Where everything lives

- **Repo:** `github.com/neilhatch0308-web/projectverifi` (private)
- **Local machine:** Windows 11, PowerShell, VS Code, repo at
  `C:\Users\hatch\Project-Realisation`
- **GCP project:** `ledger-rpvf-prod`, region `us-central1`
- **Cloud SQL:** public IP + Cloud SQL Auth Proxy (no VPC — deliberate cost
  decision; see `SETUP_GUIDE.md` §9 for the migration path if that ever
  changes)
- **Auth:** Firebase Authentication
- **Frontend:** React + Vite, `client/`
- **Backend:** Express + TypeScript (using `tsx`, not `ts-node-dev`), `server/`
- **Schema:** `schema/01_*.sql` through `schema/56_*.sql`, apply in numeric
  order **except** `10_seed_dummy_data.sql`, which must run *after*
  `11_programme_layer.sql` despite the numbering, and `36_retire_dead_rbac_schema.sql`,
  which must run *before* `34_roles_and_permissions.sql` (36 drops the dead
  migration-08 RBAC tables whose names 34 then reuses)

Reference docs already in the repo: `SETUP_GUIDE.md` (GCP setup),
`COMMAND_REFERENCE.md` (every command, by terminal), `set-env.ps1`,
`start-db.ps1` / `stop-db.ps1`.

## 3. Session startup, every time

```powershell
cd C:\Users\hatch\Project-Realisation
. .\set-env.ps1          # note the leading ". " — dot-source, don't just run it
.\start-db.ps1
```

Then, separate terminals: the Cloud SQL Auth Proxy, `npm run dev` in
`server\`, `npm run dev` in `client\`. Full detail in `COMMAND_REFERENCE.md`.
`.\stop-db.ps1` when done — it's the only real always-on cost.

## 4. What's actually built (don't assume more than this)

- **Full auth chain**: Firebase → token verification → org lookup (via a
  narrow `SECURITY DEFINER` function, `resolve_app_user_by_firebase_uid`,
  since RLS blocks the identity lookup itself otherwise) → RLS-scoped queries
- **RLS**: applied across every `organization_id` table and verified at boot
  by `assert_rls_coverage()`. **Read the RLS gotcha in §6 before adding any
  new tenant table** — migration 12's coverage was a one-time scan, not a
  standing rule, and six tables silently missed it for months (closed by
  migration 56).
- **Demand lifecycle**: Raise (P50 claim, date driver, weighted priority
  scoring, mandatory success measures) → Triage (complexity/cost tier,
  Accept/Reject) → Assessment (P75, claimed-vs-assessed shown side by side) →
  Stopped (distinct from Rejected) → RACI naming (locks criteria via a real
  DB trigger) → Business Case (auto-created, executive summary, investment
  with funding period, benefits, artifact uploads, separate approve/decline)
- **Strategic goals**: full lifecycle (active/suspended/completed), capped
  5/year, year-scoped admin screen
- **Portfolio hierarchy**: two levels only (trigger-enforced), budget lives on
  the parent only, demand tags to a sub-portfolio for delivery (assigned
  later, not at raise — defaults to "not yet categorised"), reassignment
  logged
- **Portfolio budgets**: per-year allocation, transfers between portfolios as
  recorded events with a reason, effective-budget view
- **Annual Planning board**: drag-and-drop, envelope maths (fixed vs.
  discretionary vs. genuine choice remaining), versioned agree/revise,
  only `assessed`-status demand is plannable

## 5. What's explicitly NOT built (deferred, not forgotten)

- Portfolio Rollup and Active Initiatives — still placeholder screens
- Automated cost-to-benefit flag — Business Case shows a manual reference
  number only
- Duplicate/in-flight detection at triage — deliberately deferred until the
  human process has real usage behind it
- Delivery, Adoption, Realisation, Variance stages — schema exists (from the
  original pre-RPVF build), no real routes or screens
- Role-based enforcement of who may hold a governance seat (sponsor, RACI
  seats) — currently a UI nudge only (senior roles sort first, shown with a
  role label), nothing blocks a junior pick
- File upload bucket for Business Case artifacts — code is built
  (`storage.ts`, signed URLs) but the actual GCS bucket was never created;
  see `create-artifacts-bucket.md` if picking this back up

## 6. Known gotchas — read before debugging blind

- **Generated files must be plain ASCII.** Smart quotes / em-dashes broke a
  PowerShell script early on. Every `.sql` and `.ps1` file since has been
  scrubbed; keep doing this for new ones.
- **`App.tsx` lives at `client\src\App.tsx`, not `client\src\pages\`.** This
  has bitten twice — always give the *full* destination path for every file,
  never just "overwrite," since that gets misread as "same folder as the row
  above."
- **Hand-seeded UUIDs are not strictly RFC4122-valid** (e.g.
  `41111111-0000-0000-0000-000000000001` — version/variant nibbles are `0`,
  which real UUIDs never use). Zod's `.uuid()` rejects these. Use the shared
  `looseUuid()` helper from `server/src/lib/validation.ts` for any field that
  might receive a seeded ID — not `z.string().uuid()`.
- **`pg` returns Postgres `numeric` columns as strings, not JS numbers.**
  Always wrap in `Number(...)` before calling `.toFixed()` or doing
  arithmetic — this caused a real crash once already.
- **RLS applies to the `postgres` connection too** (via `FORCE ROW LEVEL
  SECURITY`) — including for manual `psql` queries. Set context first:
  `SELECT set_config('app.current_org', '11111111-1111-1111-1111-111111111111', false);`
  (that's Acme Holdings' seeded org ID) before querying any tenant table
  directly.
- **Multi-statement `psql -c` commands share one transaction** — if a later
  statement fails, earlier ones in the same `-c` call roll back too, even if
  `psql` printed success for them. Run risky sequences as separate calls.
- **Postgres `numeric` accepts the literal value `NaN`.** A non-numeric
  string coerced with `Number()` can silently insert as `NaN` rather than
  erroring — server-side Zod validation now checks `!isNaN()` explicitly on
  numeric-string fields; keep doing this for any new numeric input.
- **Three tables are deliberately deprecated, not deleted** — never build
  new features against them: `strategy_objective` / `demand_strategy_link`
  (superseded by `strategic_goal` / `demand_goal_link`), `business_case_raci`
  (superseded by reusing `demand_raci`), `demand.delivering_portfolio_id`
  (superseded by `delivering_sub_portfolio_id`).

### 6a. Deployment gotchas — these caused real outages

Learned the expensive way in one session. Each cost real downtime.

- **Never gate `app.listen()` behind async work.** Cloud Run's startup probe
  is a plain TCP check on `$PORT` — it does not care whether the app is
  "ready", only that something is listening. An `await` on a DB query before
  `listen()` means a slow or hung connection reads as "container failed to
  start and listen on port within timeout", and the revision is killed. Bind
  the port first, always; do readiness checks afterwards.
- **A startup assertion about PRE-EXISTING state must never be fatal.** The
  boot-time `assert_rls_coverage()` check was added with `process.exit(1)` on
  failure. It failed on every single boot — correctly, because six tables
  genuinely lacked policies (see below) — and took production down in a crash
  loop. The check was right; making it fatal was wrong. A gap that has been
  true for months is not fixed by refusing to serve traffic; it just removes
  the service. Log it loudly, keep serving, fix it in a migration. This is
  now the deliberate behaviour in `server/src/index.ts` — do not "tighten" it
  back to a hard exit.
- **`gcloud run services update-traffic --to-revisions=X=100` silently
  switches the service to MANUAL traffic mode.** This is the standard way to
  roll back during an incident, and it is a trap afterwards: every subsequent
  deploy builds fine, creates a revision, reports success — and serves
  **0% of traffic**, because traffic stays pinned. Symptom is deploying a fix
  repeatedly and seeing no change in production, plus `...has been deployed
  and is serving 0 percent of traffic` in the deploy output (easy to miss).
  Fix: `gcloud run services update-traffic ledger-api --region=us-central1
  --to-latest`, which also restores automatic-latest mode going forward.
  **After any rollback, always `--to-latest` once the fix is deployed.**
- **`deploy-backend.ps1` exits 0 when the user answers anything but `y`.**
  `deploy-all.ps1` only checks `$LASTEXITCODE -ne 0`, so a declined or
  mis-keyed backend deploy looks like success and the frontend deploys anyway
  — leaving a new UI talking to an old API. Watch for the confirmation prompt
  actually being answered.
- **Diagnosing a Cloud Run outage: 503 + "No 'Access-Control-Allow-Origin'
  header" in the browser is NOT a CORS bug.** When no healthy container
  exists, Cloud Run returns a bare 503 before the app's CORS middleware ever
  runs, so the header is simply absent. Chase the 503, not the CORS message.

### 6b. RLS coverage — the rule for every new tenant table

**Migration 12 was a one-time scan, not a standing rule.** It enabled and
FORCEd RLS on every `organization_id` table *existing at that moment*. Six
tables created later never got a policy and had **no tenant isolation at all**
until migration 56 closed it: `portfolio_budget`, `portfolio_budget_transfer`
(27), `annual_plan` (29), `governance_tier` (31),
`portfolio_budget_adjustment` (32), `role` (34). No known leak — there is one
real tenant and routes filter by `organization_id` anyway — but the backstop
was missing on budgets, plans and role definitions.

**So: every new migration that creates a table with `organization_id` must
declare its own RLS inline.** Migrations 42 onward do this correctly; copy
that pattern:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_tenant_isolation ON <t>
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);
```

Use the **two-argument** `current_setting(..., true)` form. Without the
`true`, a query issued outside `withTenantContext()` raises "unrecognized
configuration parameter" instead of returning no rows. **Known inconsistency:
migrations 47–55 use the one-argument form.** They work, but should be
normalised in a follow-up pass — not changed under an incident.

Ending a migration with `SELECT assert_rls_coverage();` inside the
transaction is cheap insurance: if anything is uncovered, the whole migration
rolls back rather than half-applying.

### 6c. The schema does not replay cleanly from scratch

Confirmed by attempting a full 01→56 replay against an empty Postgres 16.
Everything below is **pre-existing**, not caused by recent work, and matters
for disaster recovery or standing up a second environment:

- **03** drops `impact_score` before the generated column depending on it
  (`priority_score`) — needs reordering or `CASCADE`
- **15** has hardcoded test-org UUID inserts assuming seed data already ran
- **17** uses `CREATE OR REPLACE VIEW` to *rename* a view column, which
  Postgres rejects outright — needs `DROP VIEW` + `CREATE VIEW`
- **22b** references demand rows that only exist if seed data ran

Nobody has hit these because the real database was built up incrementally,
one migration at a time. **If a from-scratch rebuild is ever needed, budget
time for this** — or fix the four files properly first.

## 7. Working agreements worth restating to Claude

- **Paste the current version of a frequently-edited file before asking for
  another change to it** — `DemandDetail.tsx`, `demand.ts`, and `App.tsx`
  have each been rewritten many times; Claude working from its last saved
  copy rather than your real file is the single most common source of bugs
  in this build.
- **No inline help-text/explanatory `<p>` tags under form fields** — trimmed
  out repeatedly; keep new forms lean by default.
- **Move buttons were replaced with real HTML5 drag-and-drop** on the
  planning board, by request — don't regress this if the board gets rebuilt.
- **Every SQL migration needing to write to a tenant table needs
  `app.current_org` set first** if applied manually rather than through the
  app.

## 8. Natural next steps, in rough priority order

1. Test Phase 3 (the planning board) properly — walk a demand all the way to
   `assessed` and confirm it appears, drag it around, agree a plan, start a
   revision
2. Portfolio Rollup — the org-wide dashboard, still a placeholder
3. Automate the cost-to-benefit flag (currently manual)
4. Open question #20 from the framework doc: what happens to a plan item
   when its demand's delivering sub-portfolio is reassigned to a different
   parent after being placed — not yet resolved
5. Eventually: Business Case artifact bucket (`create-artifacts-bucket.md`)

**Note:** this section predates v1.0/v1.1 and is not a current roadmap — much
of it is now built (Delivery/Adoption/Realisation tracking landed in
migrations 52–53, open question #20 was resolved in v1.1, and the app is
live on Cloud Run + Firebase Hosting, not localhost). Treat the framework
doc's own "state of the system" and open-questions sections as the current
priority list; this list is kept only for the items above that genuinely
remain open. Also outstanding from the most recent session: normalise the
one-argument `current_setting` calls in migrations 47–55 (see §6b).