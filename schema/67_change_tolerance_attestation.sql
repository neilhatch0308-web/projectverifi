-- 67_change_tolerance_attestation.sql
--
-- Post-approval change control, step 2 of 5: who DECIDED a change, and
-- what level of decision it needed.
--
-- TWO SEPARATE FACTS. The person recording a change (change_request.
-- created_by) needs only business_case.edit. The person who DECIDED it
-- is attested, not authenticated: a named user or an outside name, the
-- capacity they decided in (sponsor / portfolio / executive), the date
-- they decided (a picked date, so last week's decision is not stamped
-- today), and an evidence reference (minutes, email, ticket). The
-- system cannot verify a decision; it records who says it was made and
-- where the proof is.
--
-- REQUIRED LEVEL IS COMPUTED, MISMATCH IS FLAGGED, NEVER BLOCKED.
-- Tenant-configured tolerance rules (change_tolerance_rule) are
-- evaluated against TOTAL drift from baseline v1, not the size of this
-- one change -- ten 2% increases must eventually trigger something.
-- Triggers per rule: percentage, absolute amount, days of slip, a
-- governance tier threshold crossed, or a scope change/descope. Any one
-- firing escalates to that rule's level; the highest level fired wins.
-- The result is stored on change_request at record time (immutable), so
-- editing the rules later never rewrites history.
--
-- ATTESTATION IS INSERT-ONLY. A later row supersedes an earlier one
-- (the latest is effective); nothing is overwritten. That lets the
-- recorder add a decider afterwards, or correct a wrong one, while the
-- history of who was named is kept.
--
-- Retrospective is derived, not typed: the decision date is earlier
-- than the date the change was recorded.
--
-- NOT HERE: held state for confidential demands (step 3), confirm /
-- dispute and My Home (step 4), reporting (step 5).

BEGIN;

-- ---------- 1. Tolerance rules (tenant-configured) ----------
CREATE TABLE change_tolerance_rule (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organization(id),
  name             TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  required_level   TEXT NOT NULL CHECK (required_level IN ('sponsor', 'portfolio', 'executive')),
  min_pct          NUMERIC(7,2) CHECK (min_pct > 0),
  min_abs          NUMERIC(14,2) CHECK (min_abs > 0),
  min_days         INT CHECK (min_days > 0),
  on_tier_crossing BOOLEAN NOT NULL DEFAULT false,
  on_scope_change  BOOLEAN NOT NULL DEFAULT false,
  created_by       UUID REFERENCES app_user(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A rule with no trigger would never fire; refuse it.
  CONSTRAINT change_tolerance_rule_has_trigger CHECK (
    min_pct IS NOT NULL OR min_abs IS NOT NULL OR min_days IS NOT NULL
    OR on_tier_crossing OR on_scope_change
  )
);
CREATE INDEX idx_change_tolerance_rule_org ON change_tolerance_rule (organization_id);

-- ---------- 2. Computed result, stored on the change request ----------
-- Nullable: change requests recorded before this migration were never
-- evaluated, and NULL says so honestly rather than claiming 'none'.
-- Drift is measured against baseline v1. Percentages are NULL, never
-- fabricated, when the v1 figure was zero or missing.
ALTER TABLE change_request
  ADD COLUMN required_level         TEXT CHECK (required_level IN ('none', 'sponsor', 'portfolio', 'executive')),
  ADD COLUMN required_reasons       TEXT[],
  ADD COLUMN cost_drift_amount      NUMERIC(14,2),
  ADD COLUMN cost_drift_pct         NUMERIC(9,2),
  ADD COLUMN benefit_drift_amount   NUMERIC(14,2),
  ADD COLUMN benefit_drift_pct      NUMERIC(9,2),
  ADD COLUMN date_slip_days         INT,
  ADD COLUMN crossed_governance_tier BOOLEAN,
  ADD COLUMN scope_changed_since_v1 BOOLEAN;

-- ---------- 3. Attestation (insert-only, latest supersedes) ----------
CREATE TABLE change_attestation (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organization(id),
  change_request_id     UUID NOT NULL REFERENCES change_request(id),
  decider_user_id       UUID REFERENCES app_user(id),
  decider_external_name TEXT,
  decision_capacity     TEXT NOT NULL CHECK (decision_capacity IN ('sponsor', 'portfolio', 'executive')),
  decision_date         DATE NOT NULL,
  evidence_reference    TEXT,
  recorded_by           UUID NOT NULL REFERENCES app_user(id),
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT change_attestation_has_decider CHECK (
    decider_user_id IS NOT NULL OR length(btrim(COALESCE(decider_external_name, ''))) > 0
  )
);
CREATE INDEX idx_change_attestation_cr ON change_attestation (change_request_id, recorded_at DESC);
CREATE INDEX idx_change_attestation_decider ON change_attestation (decider_user_id) WHERE decider_user_id IS NOT NULL;

CREATE TRIGGER trg_change_attestation_immutable BEFORE UPDATE OR DELETE ON change_attestation
  FOR EACH ROW EXECUTE FUNCTION block_change_control_mutation();

-- ---------- 4. RLS ----------
ALTER TABLE change_tolerance_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_tolerance_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_tolerance_rule ON change_tolerance_rule
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

ALTER TABLE change_attestation ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_attestation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_attestation ON change_attestation
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

SELECT assert_rls_coverage();

COMMIT;
