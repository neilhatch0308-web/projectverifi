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
Framework (currently v1.1 — see the framework doc's own state-of-the-system
section for what "complete" means at that version). P50/P75/P100 estimate
confidence and an anchored-claim principle are the mechanism that makes the
framework's honesty thesis pay off in year one rather than year two; a
growing reporting suite (Portfolio/Variance/Aging reports) and a full
per-demand audit trail exist specifically to make that honesty visible, not
just structurally present in the schema.

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
- **Schema:** `schema/01_*.sql` through `schema/63_*.sql`, apply in numeric
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
  by `assert_rls_coverage()` (non-fatal — logs loudly, keeps serving; see
  §6a). Two coverage gaps found and closed this cycle: six tables missed by
  migration 12's one-time scan (migration 56), and `kpi_definition` itself,
  which never had `organization_id` at all until migration 63. **Read §6b
  before adding any new tenant table.**
- **Demand lifecycle**: Raise (P50 claim, date driver, weighted priority
  scoring, mandatory success measures — at least one, always, enforced
  server-side) → Triage (complexity/cost tier, Accept/Reject) → Assessment
  (P75, claimed-vs-assessed shown side by side) → Stopped (distinct from
  Rejected) → RACI naming (locks criteria via `trg_block_criterion_edit`,
  now also records *who* named RACI via `demand_raci.set_by`, migration 63)
  → Business Case (auto-created, executive summary, investment with funding
  period, benefits, artifact uploads, separate approve/decline via the
  distinct `business_case.decide` permission — not the same as
  `business_case.edit`, see §6b)
- **Optional-at-raise fields stay editable pre-triage**: adoption change
  type, date driver, and strategic goal alignment can be set or changed by
  the raiser (or anyone holding `demand.triage`) right up until triage —
  `PATCH /demands/:id/raise-details`. Locked the moment status leaves
  `raised`. This did not exist before this cycle; these three fields were
  previously frozen the instant a demand was raised, stricter than intended.
- **Demand audit trail**: one chronological feed per demand
  (`demand_audit_trail` view, migration 55) unioning nine-plus existing
  audit sources — triage, stop, reassignments, RACI, business case
  revisions, confidential viewer grants/revocations — surfaced as a
  "History" tab on Demand Detail. Foreign keys resolve to display names, not
  raw UUIDs (migration 57); money figures are labelled with thousands
  separators (migration 58). Two genuinely new tables backing it:
  `demand_confidential_viewer_revocation` (grant history survives a
  revocation, which used to be a hard delete) and
  `demand_confidential_access_log` (who actually viewed a confidential
  demand, not just who's currently allowed to).
- **Success-measure outcomes**: whether a delivery/adoption/business/
  financial success measure was actually met, recorded once per measure at
  whichever gate its dimension belongs to (Delivery measures at Delivery
  complete, Adoption at Adoption measured, Business+Financial at Benefit
  realised) — `kpi_outcome` / `kpi_outcome_revision` (migration 63), surfaced
  inline on Demand Detail's delivery panel. Tri-state (met/partially_met/
  not_met), not boolean — "sort of, with caveats" is a real, common answer.
- **Reporting suite** (all gated on `budgets.view`/`budgets.manage`, all new
  this cycle): **Portfolio Report** — average time-in-stage and average
  claimed/assessed/actual cost & benefit per portfolio, every average always
  paired with its sample size (`n=`), never shown alone; optional raise-date
  range. **Variance Report** — named list of demands with the biggest gaps
  between claimed (P50) and actual (P100), cost and benefit shown
  separately, never blended into one score. **Aging Report** — demands
  currently sitting longer in their stage than that portfolio's own
  historical average, flagged only once a real baseline exists (minimum
  n=3). All three reuse `portfolio_report()` as the shared baseline
  (`assigned_amount`, not the dormant pre-migration-41 view — see §6b) rather
  than each re-deriving the same averages.
- **Strategic goals**: full lifecycle (active/suspended/completed), capped
  5/year, year-scoped admin screen
- **Portfolio hierarchy**: two levels only (trigger-enforced), budget lives on
  the parent only, demand tags to a sub-portfolio for delivery (assigned
  later, not at raise — defaults to "not yet categorised"), reassignment
  logged
- **Portfolio budgets**: Baseline (immutable after first set) / Current (live
  from `annual_plan_totals`, via `portfolio_budget.assigned_amount`, NOT the
  dormant `portfolio_effective_budget` view — see §6b) / Assigned (the real
  adjustable working budget) / Remainder (Assigned minus Current), reason-
  required adjustments logged
- **Annual Planning board**: drag-and-drop, envelope maths (fixed vs.
  discretionary vs. genuine choice remaining), versioned agree/revise, only
  `assessed`-status demand is plannable, and — since a recent fix — a demand
  with a target year only appears on the plan(s) actually covering that
  year (falling back to the current UK-fiscal-year plan if no target year is
  set), rather than on every year's board regardless of when it's needed
- **Delivery / Adoption / Realisation tracking**: four sequential milestones
  (Delivery started → Delivery complete → Adoption measured → Benefit
  realised) on `demand_delivery`, each requiring its own explicit action —
  approving a business case does **not** auto-start delivery. **Active
  Initiatives** shows exactly `status = 'promoted' AND business_case.decision
  = 'approved'` — appears the moment a decision is recorded, regardless of
  whether delivery has actually started yet.
- **Status/label consistency**: a promoted demand's `status` never changes
  again (permanent), but its *displayed label* varies by business case/
  delivery state — Awaiting decision → Approved → In delivery → Delivered →
  Adoption measured → Benefit realised (or Declined). This logic
  (`promotedDemandLabel.ts`) is used consistently on All Demand, My Home, and
  Demand Detail; **Portfolio Rollup still doesn't use it** (shows a generic
  label regardless of actual state) — known gap, not yet fixed, page is
  hidden from nav so lower priority.
- **Collapsible UI sections**: shared `CollapsibleSection` component (chevron
  toggle, two visual weights) used on the sidebar nav, My Home (both columns
  plus the three "Needs..." groupings), and All Demand (each of the five
  pipeline-stage columns) — for when a list gets long enough that seeing
  everything at once stops being useful.
- **Dummy data tooling** (`scripts/`): `seed-demo-portfolios.sql` (5 parents,
  2-5 random subs each), `generate-dummy-demands.js` /
  `dummy-demands.json` (50 realistic demands spanning every status, using at
  least 7 distinct real test users as owners), `load-dummy-demands.js`
  (resolves portfolio names and user IDs against the live DB at load time,
  never hardcodes a UUID — mirrors the server's own financial-trigger rule
  for realistic scoring, creates a real `business_case` row for every
  `promoted` demand since the real app never allows that status without one).
  `cleanup-demand-and-portfolios-v2.sql` — full reset, defensive
  (`to_regclass` existence checks per table, works regardless of which
  pre-RPVF scaffold tables happen to still exist in a given environment).

## 5. What's explicitly NOT built (deferred, not forgotten)

- Automated cost-to-benefit flag — Business Case shows a manual reference
  number only; `benefit.status` has no route to ever change it from its
  default
- Duplicate/in-flight detection at triage — deliberately deferred until the
  human process has real usage behind it
- Role-based enforcement of who may hold a governance seat (sponsor, RACI
  seats) — currently a UI nudge only (senior roles sort first, shown with a
  role label), nothing blocks a junior pick
- File upload bucket for Business Case artifacts — code is built
  (`storage.ts`, signed URLs) but the actual GCS bucket was never created;
  see `create-artifacts-bucket.md` if picking this back up
- AI-assisted clash/benefit-plausibility checking on new demand — parked.
  Not worth the model-cost, latency, and data-residency overhead at current
  demand volume; reconsider once pending demand is in the hundreds and
  manual review of the reference class stops scaling.
- Connection pool ceiling (`server/src/db/pool.ts`, `max: 10` per instance) —
  not increased alongside the annual_plan_item index fix. At `maxScale: 20`
  that's up to 200 possible connections, more than small Cloud SQL tiers
  typically allow. Deliberately deferred until production-readiness, when
  real concurrency numbers exist to size against rather than guessing —
  revisit alongside the Cloud SQL tier decision, not before.
- Portfolio Rollup's per-demand status label doesn't differentiate promoted-
  demand states (see §4) — page is hidden from nav, lower priority
- Fiscal-year vs. calendar-year as a per-org Annual Planning setting — raised
  as a real need (the Portfolio Budgets year dropdown currently uses plain
  calendar year while Horizon/Annual Planning use UK-April fiscal year, an
  active inconsistency), not yet designed. The real design question isn't
  the dropdown, it's what happens to `annual_plan.financial_year` for
  existing plans if an org ever switches modes — decide that before writing
  any code.

## 6. Known gotchas — read before debugging blind

- **Verify against the real repo before assuming a prior fix is still live.**
  Found this cycle: two real, previously-fixed bugs had regressed silently —
  `businessCase.ts` was missing all three confidentiality guards
  (investment, risk-delete, finance-impact-assessment routes) fixed earlier,
  and `ConfidentialityToggle.tsx` had reverted to the pre-fix `pill
  pill--toggle` class (the CSS collision bug this was meant to close). Both
  were re-applied against the actual current file content (`pg_dump
  --schema-only` / a fresh `git clone`), not from memory of "I already
  fixed this" — because a later version of a file being applied over a
  fixed one, or a fix simply never getting committed, is invisible from
  inside a chat session with no way to check. **When starting a new session
  or after a long gap, re-pull the real repo/schema and spot-check anything
  security-sensitive rather than trusting the last-known state.**
- **A stray duplicate exists: `client/src/pages/ConfidentialityToggle.tsx`.**
  Not imported anywhere (confirmed) — harmless dead weight, presumably a
  file landing in the wrong folder at some point. Safe to delete whenever
  convenient; not urgent.
- **`DATABASE_SCHEMA_REFERENCE.md` has real, confirmed drift from the live
  schema** — found via an actual `pg_dump --schema-only` diff, not assumed:
  five tables the document claims migration 38 dropped are still genuinely
  present (`business_case_goal_link`, `dis_benefit`, `outcome_questionnaire`,
  `programme`, `realization_check`), and `business_case` still carries
  `summary`, `source_doc_url`, `sensitivity_level`, and `programme_id` —
  all claimed dropped, none actually are. Treat that document as directional,
  not authoritative, until it's regenerated properly against a real dump.
- **`business_case.decide` is a real, deliberately separate permission from
  `business_case.edit`** — not a typo, not a bug. Seeded in migration 34,
  held only by Approver and Org Admin in the default role set. Someone with
  `.edit` (PMO, Portfolio Lead, Finance) can write a business case in full
  but will never see the Approve/Decline buttons — that's separation of
  duties working as designed, not a permission-check bug. Check this before
  assuming "no approve option" is broken.
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
  directly. **Exception: a migration backfill that legitimately needs to
  read across every tenant at once** (e.g. migration 63's kpi_definition
  backfill) genuinely cannot set one tenant's context and see all rows —
  `FORCE ROW LEVEL SECURITY` blocks the table owner too, with no context set,
  same as anyone else. The fix there was a narrow, explicit
  `DISABLE ROW LEVEL SECURITY` / do the backfill / `ENABLE ROW LEVEL
  SECURITY` bracket around just that one statement, inside the same
  transaction as everything else — not a general RLS weakening.
- **A local test as the `postgres` superuser gives false negatives on RLS.**
  Real Postgres superusers always bypass RLS regardless of `FORCE`. Testing
  any RLS-dependent logic locally needs a genuine non-superuser role that
  *owns* the tables it's testing (DDL needs ownership; RLS enforcement needs
  non-superuser) — mirrors Cloud SQL's actual `postgres` account, which has
  elevated privileges but is not a true superuser.
- **Multi-statement `psql -c` commands share one transaction** — if a later
  statement fails, earlier ones in the same `-c` call roll back too, even if
  `psql` printed success for them. Run risky sequences as separate calls.
- **A migration's own `COMMIT` left commented out (the convention in every
  script this cycle, for safety) means it silently rolls back if the session
  just ends** — no error, no `ROLLBACK` printed either, it just quietly
  never took effect. Watch for the literal word `COMMIT` in the output as
  confirmation it actually happened; its absence is the only sign.
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

**Second instance of the same class of gap, migration 63:** `kpi_definition`
had **never** had an `organization_id` column at all, in any migration —
not missed by the scan, genuinely never added. Every route reading it went
through a `demand`/`business_case` join, both of which are RLS'd, so there
was no known leak — but the table itself had zero backstop of its own.
Closed the same cycle `kpi_outcome`/`kpi_outcome_revision` were added, since
building new audit capability on a table with this gap would have compounded
it. **Worth a quick audit of any other table nobody's checked recently** —
this was found by deliberately going looking, not by a failure surfacing it.

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
rolls back rather than half-applying. **Better still: write a real
cross-tenant self-test into the migration** (insert two fake orgs, confirm
one can't see the other's row via the new table/view, clean up, assert zero
leaked rows) — every migration from 60 onward does this, run as a genuine
non-superuser table-owning role, not assumed from the coverage check alone.
This is what actually caught the `kpi_definition` gap and the RLS-blocks-
the-backfill issue above, not just the coverage function.

**Annual Planning's "Envelope" was reading the wrong figure for an unknown
period, until this cycle.** It queried `portfolio_effective_budget` — a view
explicitly documented as dormant since the Baseline/Current/Assigned rework
(migration 41), kept only because nothing forced its removal. Because
Postgres silently keeps a view's column references pointed at a renamed
column, its `allocated_amount` was quietly reading `portfolio_budget.
baseline_amount` (the one figure that's permanently immutable after first
set) — meaning adjusting the real working budget (Assigned) on Portfolio
Budgets could never have moved what Annual Planning displayed as the
envelope, regardless of the amount. Fixed to read `assigned_amount`
directly. **Lesson: "this view still works" (per its own dormant-since note)
is not the same as "nothing still queries it."** Grep for actual callers
before trusting a table/view's own dormancy note.

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
time for this** — or fix the four files properly first. Migrations 57-63
have not been re-tested against a from-scratch replay; no reason to expect
new issues there (they're additive, not schema-restructuring), but this
hasn't been explicitly confirmed the way 01-56 was.

## 7. Working agreements worth restating to Claude

- **Paste the current version of a frequently-edited file before asking for
  another change to it** — `DemandDetail.tsx`, `demand.ts`, and `App.tsx`
  have each been rewritten many times; Claude working from its last saved
  copy rather than your real file is the single most common source of bugs
  in this build. **Reinforced this cycle**: two real fixes (businessCase.ts
  confidentiality guards, ConfidentialityToggle.tsx's class name) had
  silently regressed — re-confirmed via a fresh `git clone` and `pg_dump
  --schema-only`, not assumed still-applied. When picking this project back
  up after any gap, re-pull the real repo/schema before trusting "already
  fixed" for anything security-sensitive.
- **No inline help-text/explanatory `<p>` tags under form fields** — trimmed
  out repeatedly; keep new forms lean by default.
- **Move buttons were replaced with real HTML5 drag-and-drop** on the
  planning board, by request — don't regress this if the board gets rebuilt.
- **Every SQL migration needing to write to a tenant table needs
  `app.current_org` set first** if applied manually rather than through the
  app — except a genuine cross-tenant backfill, which needs the narrow
  RLS-disable bracket described in §6b instead.
- **Test destructive/irreversible scripts against a real fixture before
  handing them over**, not just read through for correctness — the cleanup
  script went through several real, only-caught-by-running-it fixes (a
  circular FK, a column that no longer existed, a table nobody had checked
  references `portfolio`). Reasoning about SQL correctness by eye missed all
  of these; running it against seeded data with the actual constraints
  present did not.

## 8. Natural next steps, in rough priority order

This replaces the previous version of this list, which was pre-v1.0 and no
longer matched reality (Portfolio Rollup, Active Initiatives, and
Delivery/Adoption/Realisation are all built now — see §4). Current genuinely
open items, roughly in order of value-for-effort:

1. **Wire Portfolio Rollup to `promotedDemandLabel`** — it's the one screen
   still showing a generic label regardless of a promoted demand's actual
   state (Approved/In delivery/Delivered/etc). Small, contained fix; low
   priority only because the page is hidden from nav.
2. **Normalise `current_setting` to the two-argument form** across
   migrations 47–55 (see §6b) — cosmetic/consistency, not urgent, but drifts
   further from the house style every cycle it's left alone.
3. **Decide the fiscal-year-vs-calendar-year question** (§5) before it's
   asked again — the Portfolio Budgets dropdown and Horizon/Annual Planning
   currently disagree about what "this year" means for three months of the
   year. The real design question is what happens to existing
   `annual_plan.financial_year` values if an org ever switches modes;
   resolve that before writing any UI for it.
4. **Regenerate `DATABASE_SCHEMA_REFERENCE.md` from an actual `pg_dump`**,
   not incrementally hand-edited — confirmed real drift this cycle (five
   tables claimed dropped that aren't, four `business_case` columns claimed
   dropped that aren't). Trust the live dump, not this document, until it's
   redone properly.
5. **Automate the cost-to-benefit flag** (currently manual) — `benefit.status`
   has no route to ever change it from its default; this is the concrete
   blocker.
6. **Business Case artifact bucket** (`create-artifacts-bucket.md`) — code's
   built, GCS bucket was never created.
7. **Connection pool sizing** — deliberately parked until production-
   readiness gives real concurrency numbers to size against (§5); revisit
   alongside the Cloud SQL tier decision, not before.

Treat the framework doc's own "state of the system" and open-questions
sections as the higher-level priority list; this is the implementation-level
detail underneath it.