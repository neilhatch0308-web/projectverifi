-- 63_kpi_outcome.sql
--
-- Two things, found and built together because the second needs the
-- first to be safe:
--
-- 1. A real, previously-undiscovered RLS gap. kpi_definition has NEVER
--    carried an organization_id column - not missed by migration 12's
--    scan, genuinely never added by any migration. That means it has
--    never had a tenant_isolation policy and structurally CAN'T get
--    one under this schema's normal convention (every RLS'd table
--    carries its own organization_id). In practice every route reads
--    it via a JOIN through demand or business_case, both of which ARE
--    RLS'd, so there is no known leak - but that is a property of every
--    route happening to join correctly, not a database-level backstop.
--    Same category of gap as migration 56 (portfolio_budget,
--    annual_plan, governance_tier, etc.), just on a table that hadn't
--    been looked at yet. Closed here: add organization_id (backfilled
--    from whichever parent - demand or business_case - the row
--    resolves through, matching kpi_origin_check's own either/or
--    shape), then RLS like everything else.
--
-- 2. kpi_outcome: recording whether a success measure was actually met.
--    Deliberately a NEW table, not a resurrection of the old
--    kpi_measurement/kpi_definition_revision tables dropped in
--    migration 38 - those were built for a periodic-tracking model
--    (measurements over time, weekly/monthly/quarterly) this framework
--    never ended up using. What's needed now is simpler and matches
--    the actual lifecycle already built: one judgement per KPI, made
--    at the gate its dimension belongs to (Delivery measures at
--    Delivery complete, Adoption at Adoption measured, Business and
--    Financial together at Benefit realised - see DemandDetail.tsx).
--
--    Same anchored-claim-with-gated-rebase shape used everywhere else
--    in this schema: the FIRST recording needs no reason (there is no
--    prior judgement to justify a change from). Changing an EXISTING
--    recorded outcome does need one, logged to kpi_outcome_revision -
--    same pattern as portfolio_budget_adjustment, business_case_revision,
--    demand_target_year_reassignment.
--
--    status is a tri-state (met / partially_met / not_met), not a
--    boolean - "sort of, with caveats" is a real, common outcome for a
--    success measure and forcing it into yes/no would lose the most
--    useful case to talk about. actual_value and notes are both
--    optional: the status is the thing that MUST be recorded; a number
--    or a note add context but aren't required to have an opinion.

BEGIN;

-- ---------- 1. Close the kpi_definition RLS gap ----------

ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organization(id);

-- This backfill genuinely needs to see every tenant's demand/business_case
-- rows at once, not just one - but FORCE ROW LEVEL SECURITY on both
-- tables means with no app.current_org set (as is correctly the case
-- for a migration script, which isn't acting on behalf of any one
-- tenant), the owning role sees ZERO rows on either table, same as
-- anyone else. Confirmed by testing this migration exactly as it will
-- really run (a non-superuser owner, matching Cloud SQL's postgres
-- account) - the backfill silently found nothing and the safety check
-- below correctly caught it. Bypassing RLS narrowly, for these two
-- tables, for only this one statement, is the correct fix - not
-- disabling it more broadly or for longer than this backfill needs.
-- Also disable this table's own edit-lock trigger (15_demand_acceptance.sql:
-- trg_block_criterion_edit) for the same reason and the same narrow
-- duration - it fires on ANY UPDATE to kpi_definition once the owning
-- demand is accepted, with no column discrimination, so it can't tell
-- "backfilling an infrastructure column" apart from "editing a locked
-- success criterion" and correctly refuses both. Confirmed by the
-- deploy attempt that surfaced this: the backfill hit it immediately
-- on the very first accepted demand in the real table.
ALTER TABLE kpi_definition DISABLE TRIGGER trg_block_criterion_edit;
ALTER TABLE demand DISABLE ROW LEVEL SECURITY;
ALTER TABLE business_case DISABLE ROW LEVEL SECURITY;

UPDATE kpi_definition kd
   SET organization_id = COALESCE(
     (SELECT d.organization_id FROM demand d WHERE d.id = kd.demand_id),
     (SELECT bc.organization_id FROM business_case bc WHERE bc.id = kd.business_case_id)
   )
 WHERE kd.organization_id IS NULL;

ALTER TABLE kpi_definition ENABLE TRIGGER trg_block_criterion_edit;
ALTER TABLE demand ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand FORCE ROW LEVEL SECURITY;
ALTER TABLE business_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_case FORCE ROW LEVEL SECURITY;

-- If any row still has no organization_id after backfill, something is
-- wrong with that row's demand_id/business_case_id links - fail loudly
-- rather than silently leaving a hole in RLS coverage.
DO $$
DECLARE orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO orphan_count FROM kpi_definition WHERE organization_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'kpi_definition has % row(s) with no resolvable organization_id - backfill failed, investigate before adding RLS', orphan_count;
  END IF;
END $$;

ALTER TABLE kpi_definition ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE kpi_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_definition FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_kpi_definition ON kpi_definition
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

-- ---------- 2. kpi_outcome ----------

CREATE TABLE kpi_outcome (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organization(id),
  kpi_definition_id UUID NOT NULL UNIQUE REFERENCES kpi_definition(id),
  status            TEXT NOT NULL CHECK (status IN ('met', 'partially_met', 'not_met')),
  actual_value      NUMERIC(14,2),
  notes             TEXT,
  recorded_by       UUID NOT NULL REFERENCES app_user(id),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kpi_outcome_kpi_definition ON kpi_outcome (kpi_definition_id);

COMMENT ON TABLE kpi_outcome IS
  'Whether a success measure (kpi_definition) was actually met, recorded once at whichever gate its dimension belongs to. One row per KPI (UNIQUE kpi_definition_id) - a correction to an existing row is a genuine judgement change, not a new measure, so this stays a single updatable row with history in kpi_outcome_revision rather than an append-only log.';

ALTER TABLE kpi_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_outcome FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_kpi_outcome ON kpi_outcome
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

CREATE TABLE kpi_outcome_revision (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organization(id),
  kpi_outcome_id    UUID NOT NULL REFERENCES kpi_outcome(id),
  prior_status      TEXT NOT NULL,
  new_status        TEXT NOT NULL,
  prior_actual_value NUMERIC(14,2),
  new_actual_value  NUMERIC(14,2),
  reason            TEXT NOT NULL,
  changed_by        UUID NOT NULL REFERENCES app_user(id),
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kpi_outcome_revision_outcome ON kpi_outcome_revision (kpi_outcome_id, changed_at DESC);

COMMENT ON TABLE kpi_outcome_revision IS
  'Written whenever an EXISTING kpi_outcome row changes - not on first recording, same as portfolio_budget_adjustment and business_case_revision (a first-ever value has no prior to justify a change from). Insert-only.';

ALTER TABLE kpi_outcome_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_outcome_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_kpi_outcome_revision ON kpi_outcome_revision
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

-- ---------- Prove tenant isolation on the two genuinely new/newly-RLS'd tables ----------
-- Stronger than checking only for one seeded row: since org_b is a
-- brand-new, otherwise-empty tenant, a correct policy means it sees
-- ZERO kpi_definition/kpi_outcome rows at all under its own context -
-- including any pre-existing real tenant's data, not just this test's
-- own row. A leak of either kind would show up the same way.
DO $$
DECLARE
  org_a UUID := gen_random_uuid();
  org_b UUID := gen_random_uuid();
  portfolio_a UUID;
  demand_a UUID;
  kpi_a UUID;
  outcome_a UUID;
  leaked_kpi_defs INT;
  leaked_outcomes INT;
BEGIN
  PERFORM set_config('app.current_org', org_a::TEXT, true);
  INSERT INTO organization (id, name) VALUES (org_a, 'RLS test org A (migration 63)');
  INSERT INTO portfolio (id, organization_id, name) VALUES (gen_random_uuid(), org_a, 'RLS test portfolio (migration 63)') RETURNING id INTO portfolio_a;
  INSERT INTO app_user (id, organization_id, email, firebase_uid, display_name) VALUES (gen_random_uuid(), org_a, 'kpi-rls-test-63@example.invalid', 'fb-kpi-rls-test-63', 'RLS Test User (migration 63)');
  INSERT INTO demand (id, organization_id, portfolio_id, title)
    VALUES (gen_random_uuid(), org_a, portfolio_a, 'RLS test demand (migration 63)') RETURNING id INTO demand_a;
  INSERT INTO kpi_definition (id, organization_id, demand_id, name, dimension, unit)
    VALUES (gen_random_uuid(), org_a, demand_a, 'RLS test measure', 'delivery', 'days') RETURNING id INTO kpi_a;
  INSERT INTO kpi_outcome (id, organization_id, kpi_definition_id, status, recorded_by)
    VALUES (gen_random_uuid(), org_a, kpi_a, 'met', (SELECT id FROM app_user WHERE organization_id = org_a LIMIT 1)) RETURNING id INTO outcome_a;

  PERFORM set_config('app.current_org', org_b::TEXT, true);
  INSERT INTO organization (id, name) VALUES (org_b, 'RLS test org B (migration 63)');
  SELECT COUNT(*) INTO leaked_kpi_defs FROM kpi_definition;
  SELECT COUNT(*) INTO leaked_outcomes FROM kpi_outcome;

  -- Clean up before asserting, so a failed assertion doesn't leave test rows behind
  PERFORM set_config('app.current_org', org_a::TEXT, true);
  DELETE FROM kpi_outcome WHERE id = outcome_a;
  DELETE FROM kpi_definition WHERE id = kpi_a;
  DELETE FROM demand WHERE id = demand_a;
  DELETE FROM portfolio WHERE id = portfolio_a;
  DELETE FROM app_user WHERE organization_id = org_a;
  DELETE FROM organization WHERE id = org_a;
  PERFORM set_config('app.current_org', org_b::TEXT, true);
  DELETE FROM organization WHERE id = org_b;

  IF leaked_kpi_defs > 0 THEN
    RAISE EXCEPTION 'kpi_definition leaked cross-tenant data after adding RLS (org B saw % row(s))', leaked_kpi_defs;
  END IF;
  IF leaked_outcomes > 0 THEN
    RAISE EXCEPTION 'kpi_outcome leaked cross-tenant data (org B saw % row(s))', leaked_outcomes;
  END IF;
  RAISE NOTICE 'kpi_definition and kpi_outcome tenant isolation confirmed: org B saw 0 rows of either.';
END $$;

COMMIT;