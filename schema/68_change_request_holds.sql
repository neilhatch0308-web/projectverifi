-- 68_change_request_holds.sql
--
-- Post-approval change control, step 3 of 5: held changes.
--
-- THE PROBLEM. A change request names a decider. If the demand is
-- confidential and that person cannot see it, applying the change would
-- move the baseline on the strength of a decision attributed to someone
-- who has never been able to look at what they supposedly decided.
--
-- THE RULE (agreed): flag and hold. The change is RECORDED (with its
-- computed required level and attestation) but NOT APPLIED -- no cost,
-- benefit, descope or new baseline version -- so delivery keeps
-- tracking the previous baseline. Someone who can already see the
-- demand adds the named person as a confidential viewer (the existing
-- append-only circle of trust); the hold then releases automatically
-- and the change applies. Or the recorder re-attributes to someone who
-- can see it, or withdraws the change. Nothing is applied until then.
--
-- The named decider sees nothing beforehand: no My Home entry, no
-- notification. Existence of a confidential demand is never leaked
-- (404, not 403, same as every other confidential read).
--
-- Held state is DERIVED, never stored as a mutable flag: a hold row
-- with no resolution row. Both tables are insert-only, like the rest
-- of change control. The proposed changes are held as a payload and are
-- planned AGAIN at release against the state at that moment, not
-- applied from a stale snapshot.
--
-- One held change per business case at a time (enforced in the route):
-- while the baseline is out of step, stacking further changes onto it
-- would make "drift from v1" ambiguous.
--
-- Hold ageing: a held change means the baseline is behind reality, so
-- the tenant sets how many days before one is flagged as overdue
-- (change_control_setting.hold_flag_days).
--
-- NOT HERE: My Home and confirm/dispute (step 4), reporting (step 5),
-- the demand_audit_trail view (change events are not yet unioned in --
-- flagged for step 5 rather than half-done here).

BEGIN;

-- ---------- 1. Hold (insert-only) ----------
CREATE TABLE change_request_hold (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organization(id),
  change_request_id UUID NOT NULL UNIQUE REFERENCES change_request(id),
  payload           JSONB NOT NULL,
  placed_by         UUID NOT NULL REFERENCES app_user(id),
  placed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 2. Resolution (insert-only): released or withdrawn ----------
CREATE TABLE change_request_resolution (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organization(id),
  change_request_id   UUID NOT NULL UNIQUE REFERENCES change_request(id),
  outcome             TEXT NOT NULL CHECK (outcome IN ('released', 'withdrawn')),
  released_via        TEXT CHECK (released_via IN ('viewer_grant', 'reattribution', 'recheck')),
  -- The demand_confidential_viewer grant that unblocked it. Deliberately
  -- NOT a foreign key: revoking a viewer hard-deletes that row, and a
  -- history table must not block or vanish with it.
  viewer_grant_id     UUID,
  baseline_version_id UUID REFERENCES baseline_version(id),
  withdraw_reason     TEXT,
  resolved_by         UUID NOT NULL REFERENCES app_user(id),
  resolved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT change_request_resolution_shape CHECK (
    (outcome = 'released' AND released_via IS NOT NULL AND baseline_version_id IS NOT NULL AND withdraw_reason IS NULL)
    OR
    (outcome = 'withdrawn' AND length(btrim(COALESCE(withdraw_reason, ''))) > 0
       AND released_via IS NULL AND baseline_version_id IS NULL AND viewer_grant_id IS NULL)
  )
);

CREATE TRIGGER trg_change_request_hold_immutable BEFORE UPDATE OR DELETE ON change_request_hold
  FOR EACH ROW EXECUTE FUNCTION block_change_control_mutation();
CREATE TRIGGER trg_change_request_resolution_immutable BEFORE UPDATE OR DELETE ON change_request_resolution
  FOR EACH ROW EXECUTE FUNCTION block_change_control_mutation();

-- ---------- 3. Tenant setting: when a hold counts as overdue ----------
CREATE TABLE change_control_setting (
  organization_id UUID PRIMARY KEY REFERENCES organization(id),
  hold_flag_days  INT NOT NULL DEFAULT 7 CHECK (hold_flag_days > 0),
  updated_by      UUID REFERENCES app_user(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 4. RLS ----------
ALTER TABLE change_request_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_request_hold FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_request_hold ON change_request_hold
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

ALTER TABLE change_request_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_request_resolution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_request_resolution ON change_request_resolution
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

ALTER TABLE change_control_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_control_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_control_setting ON change_control_setting
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

-- ---------- 5. Held changes: derived, never stored ----------
-- Not confidentiality-filtered (same contract as every cross-cutting
-- view here): the calling route must apply can_view_confidential_demand().
CREATE VIEW change_request_held AS
SELECT cr.id AS change_request_id, cr.organization_id, cr.demand_id, cr.business_case_id,
       cr.reason, cr.created_by AS recorded_by, cr.required_level,
       h.placed_at, h.payload,
       (CURRENT_DATE - h.placed_at::date) AS days_held
  FROM change_request cr
  JOIN change_request_hold h ON h.change_request_id = cr.id
  LEFT JOIN change_request_resolution res ON res.change_request_id = cr.id
 WHERE res.id IS NULL;

SELECT assert_rls_coverage();

COMMIT;
