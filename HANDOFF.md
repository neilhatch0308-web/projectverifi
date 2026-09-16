# Project Handoff — Ledger / Project Verifi

Bring this document, plus the current framework doc, to a new chat. The
framework doc is the *design* source of truth (what and why); this is the
*technical/operational* source of truth (how, and what to watch out for).
`DATABASE_SCHEMA_REFERENCE.md` is **not** currently authoritative — it has
confirmed drift (see §6) and is overdue a regeneration from a real dump.
Point Claude at these, and at the GitHub repo, rather than relying on chat
history.

**Schema head: migration 65.** Framework doc is at v1.2; migrations 63-65
postdate it and are not yet reflected in its narrative.

---

## 0. Read this first if you are Claude

Two things about this project bite every session:

1. **Verify against real state, never memory.** Decision 81 exists because
   two fixes from a prior cycle had silently regressed. A chat session's
   record of "I already fixed this" is not evidence the fix is still there.
   Re-pull the repo or `pg_dump --schema-only` before trusting anything
   security-sensitive.
2. **Paste the current file before asking for a change to it.**
   `DemandDetail.tsx`, `demand.ts`, and `App.tsx` have each been rewritten
   many times. Claude working from a stale copy is the single most common
   source of bugs in this build.

### Repo access from a chat session (learned the hard way)

GitHub serves a **hard-cached, months-old snapshot** of this repo at any
`main`-ref URL — `github.com/.../projectverifi`, `/blob/main/...`,
`/tree/main/...` all return a 1-commit view of the pre-RPVF prototype.
This is a caching artifact, not the real repo state, and repeated fetches
do not clear it.

**Workaround: use commit-pinned blob URLs.** These bypass the cache
entirely and return current content:

```
https://github.com/neilhatch0308-web/projectverifi/blob/<full-sha>/server/src/routes/reporting.ts
```

Grab the SHA from the commits page. Two further constraints:

- **Tree/directory URLs are robots-blocked** regardless of ref — only
  individual file (blob) URLs work.
- Claude can generally only fetch URLs that have already appeared in the
  conversation, so it cannot construct sibling paths itself. Paste each
  file's blob URL, or paste the file contents directly.

---

## 1. What this is

A demand-to-outcome governance platform ("Ledger", the real product behind
"Project Verifi" on we-verifi.co.uk), built against the Realistic Path
Value Framework. P50/P75/P100 estimate confidence and an anchored-claim
principle are the mechanism that makes the framework's honesty thesis pay
off in year one rather than year two; the reporting suite and a full
per-demand audit trail exist specifically to make that honesty visible,
not just structurally present in the schema.

## 2. Where everything lives

- **Repo:** `github.com/neilhatch0308-web/projectverifi` (public — see §0
  for the caching trap)
- **Local machine:** Windows 11, PowerShell, VS Code, repo at
  `C:\Users\hatch\Project-Realisation`
- **GCP project:** `ledger-rpvf-prod`, region `us-central1`
- **Cloud SQL:** public IP + Cloud SQL Auth Proxy (no VPC — deliberate
  cost decision; see `SETUP_GUIDE.md` §9 for the migration path)
- **Auth:** Firebase Authentication
- **Frontend:** React + Vite, `client/`
- **Backend:** Express + TypeScript (using `tsx`, not `ts-node-dev`),
  `server/`
- **Schema:** `schema/01_*.sql` through `schema/65_*.sql`, apply in numeric
  order **except** `10_seed_dummy_data.sql`, which must run *after*
  `11_programme_layer.sql`, and `36_retire_dead_rbac_schema.sql`, which
  must run *before* `34_roles_and_permissions.sql` (36 drops the dead
  migration-08 RBAC tables whose names 34 then reuses)

Reference docs in the repo: `SETUP_GUIDE.md`, `COMMAND_REFERENCE.md`,
`set-env.ps1`, `start-db.ps1` / `stop-db.ps1`.

## 3. Session startup, every time

```powershell
cd C:\Users\hatch\Project-Realisation
. .\set-env.ps1          # note the leading ". " - dot-source, don't just run it
.\start-db.ps1
```

Then, separate terminals: the Cloud SQL Auth Proxy, `npm run dev` in
`server\`, `npm run dev` in `client\`. Full detail in
`COMMAND_REFERENCE.md`. `.\stop-db.ps1` when done — it's the only real
always-on cost.

## 4. What's actually built (don't assume more than this)

Everything in the prior handoff's §4 still stands: full auth chain, RLS,
the demand lifecycle (Raise → Triage → Accept → Assess → Stop → RACI →
Business Case), audit trail, success-measure outcomes, portfolio
hierarchy, portfolio budgets, Annual Planning board, Delivery/Adoption/
Realisation milestones, status-label consistency, collapsible UI
sections, and the dummy-data tooling in `scripts/`.

### 4a. Reporting suite

All gated on `budgets.view` / `budgets.manage` — these expose claimed/
assessed/actual cost and benefit figures, which is financial data of the
same sensitivity as the budgets screen even though read-only. All live in
`server/src/routes/reporting.ts`.

**House pattern, followed by every report here:** a SQL function or view
does the aggregation and is the single source of truth; the route does
confidentiality filtering and ordering only. A future second consumer (an
export, a different page) gets the same numbers without re-deriving joins.
Any new report should follow this rather than aggregating inline.

- **Portfolio Report** — `GET /reporting/portfolio-report`. Reads
  `portfolio_report()` (migrations 60-61). Average time-in-stage and
  average claimed/assessed/actual cost and benefit per portfolio. Optional
  `?from=YYYY-MM-DD&to=YYYY-MM-DD` scopes to demand raised in that window;
  dates are validated before being passed through, since an invalid string
  reaching the function surfaces as an opaque Postgres cast error rather
  than a clear 400. **Every average is paired with its sample size
  (`n=`), never shown alone** (decision 79).
- **Variance Report** — `GET /reporting/variance`. Reads
  `demand_variance_report` (migration 62). Named list of demands whose
  actual outcome landed furthest from what was claimed. Cost and benefit
  shown as separate figures, never blended into one score — a cost overrun
  and a benefit shortfall are different failure modes with different
  owners. `?sort=cost|benefit|worst`, defaulting to `worst` (biggest miss
  in either direction).
- **Aging Report** — `GET /reporting/aging`. Reads `demand_stage_aging`
  (migration 62). Demands sitting longer in their stage than that
  portfolio's own historical average. **"Flagged as stuck" is decided in
  the route, not the view** (`MIN_BASELINE_N = 3`), so the threshold can be
  tuned without a migration.
- **Commitment Report** — `GET /reporting/commitment`. Reads
  `commitment_report()` (migration 64). Approved spend vs actual, by
  portfolio — "how much of what we've approved has actually gone out the
  door," which previously only existed per-business-case. No sort param;
  always worst-absolute-variance first. Drill-down at
  `GET /reporting/commitment/cases` reads `business_case_commitment`,
  optional `?portfolioId=`.
- **My Portfolio dashboard** — `GET /reporting/my-portfolio`.
  Deliberately **not** gated as a whole: stage counts, dependency-blocked
  items, and coming-up are ordinary demand visibility. Two pieces *are*
  gated on `budgets.view`/`budgets.manage` via a single `canViewSpend`
  check: the commitment footer, and the aging-derived half of "needs
  attention" (same underlying `demand_stage_aging` that Aging Report
  already gates). A caller without the permission still gets a real
  dashboard. Composes four existing sources into one response on purpose —
  a dashboard firing four requests on load is four places to show a
  half-loaded screen.

**Confidentiality in reporting:** the views do **not** filter it. Every
route applies `(confidential = false OR can_view_confidential_demand(
demand_id, $userId))` itself, same rule as every other confidential-demand
read path. Keep doing this for any new report — the view returning
unfiltered rows is deliberate, not an oversight.

**`canViewSpend` gating is query-time, not response-time.** In
`my-portfolio`, the aging query isn't run at all for a caller lacking the
permission, rather than being fetched and discarded — the data never
leaves the database for someone who shouldn't see it.

### 4b. Objectives (migration 65) — partially applied

**Schema applied. Route and UI changes NOT yet applied as of this
handoff.** Verify current state before continuing.

Two changes to `strategic_goal`:

1. **The 5-per-org-per-year cap is gone** — `trg_strategic_goal_cap` and
   `enforce_strategic_goal_cap()` (both migration 09) dropped.
2. **`portfolio_id` added, nullable.** NULL = a corporate/org-wide
   objective (the only kind that existed before). Non-NULL = owned by that
   parent portfolio. Every pre-existing row is NULL, i.e. corporate, which
   is what they were.

**Parent-portfolio-only**, enforced by
`trg_strategic_goal_parent_portfolio`, following
`enforce_plan_on_parent_portfolio`'s precedent. The reason: a demand's
raising portfolio is always a parent, and `delivering_sub_portfolio_id` is
nullable and typically assigned *after* raise — so a sub-portfolio-owned
objective would be invisible at exactly the moment someone first picks
one. The trigger raises a plain exception; the route surfaces it as a 409
rather than a generic 500, since the message is genuinely informative.

**Linking rule:** a demand raised against portfolio X may link to a
corporate objective OR one owned by X. Nothing else. The picker enforces
this via `GET /strategic-goals?portfolio=<uuid>`, which returns
`portfolio_id IS NULL OR portfolio_id = $1`.

**Still to apply for this change:**
- `server/src/routes/strategicGoals.ts` — portfolio-aware list/create, cap
  handling removed
- `client/src/pages/StrategicGoals.tsx` — slot-counting removed, grouped
  by corporate/portfolio, scope selector on the add form
- `client/src/pages/RaiseDemand.tsx` — four edits: extend the
  `StrategicGoal` interface with `portfolio_id`/`portfolio_name`; move the
  goals fetch out of the mount effect into a `portfolioId`-dependent one;
  clear a selected goal when the portfolio changes; relabel and filter the
  picker
- Sidebar in `AppShell.tsx` still says "Strategic Goals" while the page is
  retitled "Objectives" — cosmetic inconsistency, not wired up

**Found while applying 65, worth recording:** `strategic_goal` had **no
named RLS policy attached** before this migration, despite being in scope
for migration 12's original scan. The migration's `DROP POLICY IF EXISTS`
reported "does not exist, skipping." So this closed a real gap rather than
merely confirming coverage — the **third** instance of this class of gap
after migration 56's six tables and migration 63's `kpi_definition`.
Worth folding into the framework doc's next build report, and worth
treating open question #39 (how many more of these remain) as more
pressing than it was.

### 4c. Stage stepper (applied)

`client/src/lib/stageStepper.tsx` — a full-path progress stepper showing
Raised → Accepted → Assessed → Business case → In delivery → Delivered →
Adoption measured → Benefit realised, with past stages checked, the
current one highlighted, future ones greyed, and a one-line "what happens
next" hint. Exists because a user who doesn't know the framework had no
way to see where a demand sat in the overall process, or what was coming.

It derives its current stage from the **same** `status` /
`business_case_decision` / `delivery_stage` fields `promotedDemandLabel.ts`
reads, so the two can never disagree. Stopped and Declined render as their
own terminal banners rather than being forced into the spine — they're
valid endpoints, not missing steps.

Surfaced on Demand Detail, Assess Demand, and Business Case Detail. **Not
yet on** Annual Planning or Five-Year Horizon, which still show cards with
no stage indication despite having the data.

Colours use `var(--teal)` (the brand token), not a hardcoded hex. The
stopped/declined banners stay red — semantic danger, not brand.

**Backend change this required:** `GET /business-cases/:id` now joins
`demand` and `demand_delivery` to return `demand_status`, `stop_reason`,
and a derived `delivery_stage` (CASE over the four milestone timestamps,
benefit → adoption → completed → started). The PDF export route's
near-identical query was deliberately left untouched — it doesn't need
this. **If a shared `delivery_stage` derivation exists elsewhere, point
this at it** rather than keeping a second hand-written copy that can
drift.

Also fixed alongside: Demand Detail's subtitle had a hardcoded literal
`(raised)` next to the portfolio name regardless of actual status; Business
Case Detail's back link went to the generic All Demand list rather than
its own demand.

## 5. What's explicitly NOT built (deferred, not forgotten)

Carried forward unchanged: automated cost-to-benefit flag
(`benefit.status` has no route to ever change it — the concrete blocker);
duplicate/in-flight detection at triage; role-based enforcement of who may
hold a governance seat; the Business Case artifact GCS bucket (code built,
bucket never created); AI-assisted clash/benefit-plausibility checking
(parked until demand volume justifies the cost/latency); connection pool
ceiling (`max: 10`, parked until production-readiness gives real numbers);
Portfolio Rollup's per-demand status label; fiscal-year vs calendar-year as
a per-org setting.

**New this cycle:**

- **Objective cost-to-benefit rollup** — designed, not built. See §8.
- **Stage stepper on Annual Planning and Five-Year Horizon** — the
  component exists and the data is already fetched; just not wired in.

## 6. Known gotchas — read before debugging blind

All prior gotchas still apply. The ones most likely to bite:

- **Verify against the real repo before assuming a prior fix is still
  live.** Two previously-fixed bugs had silently regressed, found only by
  checking actual file content.
- **`DATABASE_SCHEMA_REFERENCE.md` has real, confirmed drift** — five
  tables it claims migration 38 dropped are still present
  (`business_case_goal_link`, `dis_benefit`, `outcome_questionnaire`,
  `programme`, `realization_check`), and `business_case` still carries
  `summary`, `source_doc_url`, `sensitivity_level`, `programme_id`, all
  claimed dropped. **Treat it as directional, not authoritative.** It also
  now runs ~11 migrations behind.
- **`business_case.decide` is a real, deliberately separate permission
  from `business_case.edit`.** Separation of duties working as designed,
  not a permission-check bug.
- **Generated files must be plain ASCII.** Smart quotes / em-dashes broke a
  PowerShell script early on. Scrub every new `.sql` and `.ps1`.
- **`App.tsx` lives at `client\src\App.tsx`, not `client\src\pages\`.**
  Always give the full destination path for every file.
- **Hand-seeded UUIDs are not RFC4122-valid.** Use `looseUuid()` from
  `server/src/lib/validation.ts`, not `z.string().uuid()`, for any field
  that might receive a seeded ID.
- **`pg` returns `numeric` columns as strings.** Always `Number(...)`
  before arithmetic.
- **RLS applies to the `postgres` connection too** (`FORCE ROW LEVEL
  SECURITY`), including manual `psql`. Set context first:
  `SELECT set_config('app.current_org', '<org-uuid>', false);`
- **A local test as `postgres` superuser gives false negatives on RLS.**
  Superusers bypass RLS regardless of `FORCE`. Genuine verification needs a
  non-superuser role that *owns* the tables.
- **Multi-statement `psql -c` shares one transaction.** A later failure
  rolls back earlier statements even if psql printed success.
- **A commented-out `COMMIT` silently rolls back** if the session ends.
  Watch for the literal word `COMMIT` in the output — its absence is the
  only sign.
- **Three tables are deliberately deprecated, not deleted** — never build
  against them: `strategy_objective` / `demand_strategy_link`,
  `business_case_raci`, `demand.delivering_portfolio_id`.
- **Stray dead files, safe to delete whenever convenient:**
  `client/src/pages/ConfidentialityToggle.tsx` (duplicate, not imported)
  and `client/src/App.css` (Vite scaffold leftover — `.hero`, `.counter`,
  `#next-steps`, and CSS vars like `--accent`/`--border` that match nothing
  in the real token set; confirmed not imported anywhere).

### 6a. Deployment gotchas — these caused real outages

Unchanged and still load-bearing:

- **Never gate `app.listen()` behind async work.** Cloud Run's startup
  probe is a plain TCP check on `$PORT`. Bind first, readiness-check after.
- **A startup assertion about PRE-EXISTING state must never be fatal.**
  `assert_rls_coverage()` with `process.exit(1)` took production down in a
  crash loop. Log loudly, keep serving, fix in a migration. **Do not
  "tighten" this back to a hard exit.**
- **`gcloud run services update-traffic --to-revisions=X=100` silently
  switches to MANUAL traffic mode.** Every subsequent deploy then serves
  0% of traffic while reporting success. After any rollback, always
  `--to-latest`.
- **`deploy-backend.ps1` exits 0 when the user answers anything but `y`.**
  A declined backend deploy looks like success and the frontend deploys
  anyway.
- **503 + "No 'Access-Control-Allow-Origin' header" is NOT a CORS bug.**
  Chase the 503.

### 6b. RLS coverage — the rule for every new tenant table

**Migration 12 was a one-time scan, not a standing rule**, and it is now
confirmed to have missed more than was first thought — six tables closed
in migration 56, `kpi_definition` in 63, and `strategic_goal` in 65.

**Every new migration creating a table with `organization_id` must declare
its own RLS inline:**

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_tenant_isolation ON <t>
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);
```

Use the **two-argument** `current_setting(..., true)` form. **Known
inconsistency: migrations 47-55 use the one-argument form.** They work,
but should be normalised — not under an incident.

**Write a real cross-tenant self-test into the migration**, not just
`SELECT assert_rls_coverage();`. Migration 65's own self-test is a working
template, and its first draft failed in a way worth knowing about:

> **Seeding a self-test needs tenant context set, not RLS disabled per
> table.** The first version disabled RLS on the table under test, then
> inserted into `organization` and `app_user` — whose own policies
> rejected the write with "new row violates row-level security policy."
> Fix: `PERFORM set_config('app.current_org', org_a::text, true)` before
> seeding, so each insert satisfies its own table's `WITH CHECK`. Only
> `organization` needs a narrow `DISABLE`/`ENABLE` bracket, because
> inserting two orgs means one can never match a single active context.

### 6c. The schema does not replay cleanly from scratch

Confirmed against an empty Postgres 16 for 01→56. All **pre-existing**:

- **03** drops `impact_score` before the generated column depending on it
- **15** has hardcoded test-org UUID inserts assuming seed data ran
- **17** uses `CREATE OR REPLACE VIEW` to rename a view column, which
  Postgres rejects — needs `DROP VIEW` + `CREATE VIEW`
- **22b** references demand rows that only exist if seed data ran

Migrations 57-65 have **not** been re-tested against a from-scratch
replay. They're additive rather than restructuring, so no reason to expect
new issues — but this hasn't been confirmed the way 01-56 was.

## 7. Working agreements worth restating to Claude

- **Paste the current version of a frequently-edited file** before asking
  for another change to it.
- **No inline help-text/explanatory `<p>` tags under form fields** — keep
  new forms lean by default.
- **Move buttons were replaced with real HTML5 drag-and-drop** on the
  planning board — don't regress this.
- **Every SQL migration writing to a tenant table needs `app.current_org`
  set first** if applied manually — except a genuine cross-tenant
  backfill, which needs the narrow RLS-disable bracket (§6b).
- **Test destructive/irreversible scripts against a real fixture**, not
  just read through for correctness.
- **Follow the reporting house pattern** (§4a): SQL function or view
  aggregates, route filters confidentiality and orders. Don't aggregate
  inline.

## 8. Natural next steps, in rough priority order

1. **Finish the objectives change** (§4b) — schema is applied, route and
   three UI files are not. The app is currently in a half-applied state:
   `portfolio_id` exists and the cap is gone, but nothing writes or reads
   the new column.
2. **Objective cost-to-benefit rollup** — designed this cycle, not built.
   The screen: per objective, claimed (P50) / assessed (P75) / actual
   (P100) cost and benefit side by side, with the ratio as a derived
   secondary figure. The point is watching the ratio *move* across the
   three rows — an objective whose claimed ratio looked fine but whose
   assessed ratio already degraded is a signal before anyone spends.
   **Decisions already made:** stopped and declined demands are excluded
   entirely (they contribute nothing); it's an as-is snapshot, not a
   trend; cost and benefit stay separate figures with the ratio never
   replacing them; show the count of demands behind each figure.
   **Still open:** how confidentiality works when aggregating. A
   confidential demand's figures would otherwise be baked into a total
   whose constituents the caller can't see. Recommended: exclude them from
   totals for anyone who can't see them (consistent with 404-not-403,
   though it means two people see different numbers for the same
   objective). Alternatives are including them but hiding the drill-down
   (inferrable by subtraction), or aggregating in the route instead of a
   function (breaks house style). **This needs deciding before building.**
   Note it sidesteps open question #6's blocker entirely — aggregating
   per objective needs no per-benefit flag, only figures that already
   exist.
3. **Stage stepper on Annual Planning and Five-Year Horizon** (§4c) —
   component built, data already fetched, just not wired in.
4. **Wire Portfolio Rollup to `promotedDemandLabel`** — the one screen
   still showing a generic label regardless of actual state. Low priority
   only because the page is hidden from nav.
5. **Regenerate `DATABASE_SCHEMA_REFERENCE.md` from an actual `pg_dump`**
   — confirmed real drift, and now ~11 migrations behind. More pressing
   than it was, since it's now been shown to accumulate exactly the kind
   of drift it exists to prevent.
6. **Audit for more "shipped silently, undetected" gaps** — three found
   by deliberately looking (migration 56's six tables, 63's
   `kpi_definition`, 65's `strategic_goal`). None surfaced from a failure.
   Worth deciding whether a genuinely complete pass is warranted before
   layering more capability on top.
7. **Normalise `current_setting` to the two-argument form** across
   migrations 47-55 — cosmetic, drifts further every cycle it's left.
8. **Decide the fiscal-year-vs-calendar-year question** — the real
   design question is what happens to existing
   `annual_plan.financial_year` values if an org switches modes.
9. **Automate the cost-to-benefit flag** — `benefit.status` has no route
   to change it from its default; that's the concrete blocker.
10. **Business Case artifact bucket** — code built, GCS bucket never
    created.
11. **Connection pool sizing** — parked until production-readiness.

---

## Appendix — gaps in this handoff

Recorded explicitly rather than papered over, per decision 81's spirit.

- **Migrations 60-65 are described from route comments and this session's
  own work, not from reading the migration files.** `portfolio_report()`
  (60-61), `demand_variance_report` / `demand_stage_aging` (62),
  `commitment_report()` / `business_case_commitment` (64) are known by
  name, signature, and purpose — but their full column shapes were not
  read. Migration 63's contents are known only from the prior handoff.
- **What the original migration 65 was, before
  `65_portfolio_level_objectives.sql` took that number, is unknown.**
  Confirm nothing was displaced.
- **The framework doc has not been updated** for migrations 63-65 or for
  the reporting suite's later additions (Commitment Report, My Portfolio).
  Folding these into a v1.3 is a separate, deliberate decision, not a
  mechanical sync.
- **Nothing in §4c or §4b was verified against the live repo after being
  written** — these were produced in-session from pasted files. Per §0,
  confirm against real state before trusting any of it.
