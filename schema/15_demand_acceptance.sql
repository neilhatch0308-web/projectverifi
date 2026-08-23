-- ============================================================
-- 15_demand_acceptance.sql
--
-- Adds the acceptance gate at DEMAND level (not business_case/initiative -
-- that entity doesn't exist yet in the real app, only in the framework
-- doc's conceptual model). This is a deliberate interim decision: RACI
-- and the criteria lock attach to demand.id for now. If/when business_case
-- creation gets built as its own real flow, this may need to migrate
-- there instead - flagging now so it isn't forgotten later.
--
-- Three pieces:
--   1. demand_raci - the 5 named seats
--   2. Five dummy app_user rows with no firebase_uid, so they exist as
--      selectable people without being real logins
--   3. A trigger that makes the "preserved original, no direct edit
--      after acceptance" rule real at the database level, not just
--      an app-layer promise - it fires on any UPDATE to kpi_definition
--      once the parent demand's accepted_at is set.
-- ============================================================

-- ---------- 1. RACI seats ----------

CREATE TABLE IF NOT EXISTS demand_raci (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id                   UUID NOT NULL UNIQUE REFERENCES demand(id),
    accountable_financial_id    UUID NOT NULL REFERENCES app_user(id),
    accountable_scope_id        UUID NOT NULL REFERENCES app_user(id),
    accountable_schedule_id     UUID NOT NULL REFERENCES app_user(id),
    sponsor_id                  UUID NOT NULL REFERENCES app_user(id),
    benefit_owner_id            UUID NOT NULL REFERENCES app_user(id),
    set_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demand_raci_demand ON demand_raci(demand_id);

-- ---------- 2. Dummy accountability users (no firebase_uid - not real logins) ----------

INSERT INTO app_user (id, organization_id, email, display_name, role, firebase_uid, is_active)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', v.email, v.display_name, v.role, NULL, true
FROM (VALUES
    ('placeholder.financial@acme-holdings.example', 'Finance Lead (placeholder)', 'finance'),
    ('placeholder.scope@acme-holdings.example',     'Scope Owner (placeholder)', 'contributor'),
    ('placeholder.schedule@acme-holdings.example',  'Schedule Owner (placeholder)', 'contributor'),
    ('placeholder.sponsor@acme-holdings.example',   'Sponsor (placeholder)', 'sponsor'),
    ('placeholder.benefit@acme-holdings.example',   'Benefit Owner (placeholder)', 'benefit_owner')
) AS v(email, display_name, role)
WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE email = v.email);

-- ---------- 3. Real enforcement of the criteria lock ----------

CREATE OR REPLACE FUNCTION block_criterion_edit_after_acceptance() RETURNS trigger AS $$
DECLARE
    demand_accepted_at TIMESTAMPTZ;
BEGIN
    SELECT accepted_at INTO demand_accepted_at FROM demand WHERE id = OLD.demand_id;

    IF demand_accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot directly edit a preserved success criterion after demand acceptance (accepted_at = %). Use a gated re-base instead.', demand_accepted_at;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_criterion_edit ON kpi_definition;
CREATE TRIGGER trg_block_criterion_edit
    BEFORE UPDATE ON kpi_definition
    FOR EACH ROW EXECUTE FUNCTION block_criterion_edit_after_acceptance();

-- Note: this only blocks UPDATE, not DELETE or INSERT - a demand's criteria
-- set shouldn't grow or shrink after acceptance either, but that's an
-- app-layer concern (no delete/add-criterion endpoint exists in the real
-- app yet) rather than one worth a second trigger until that endpoint exists.
