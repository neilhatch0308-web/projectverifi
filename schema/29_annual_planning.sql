-- ============================================================
-- 29_annual_planning.sql
--
-- Phase 3: the annual planning board.
--
-- A plan is scoped to ONE parent portfolio and ONE financial year -
-- portfolio leads plan their own slice; a corporate rollup is a query
-- across all portfolios' plans for a year, not a single shared board.
--
-- Only ASSESSED demand (post-P75) is plannable - this is the whole
-- point of the P75 stage existing before planning: you plan against
-- real numbers, not tier guesses or raw P50 claims.
--
-- Eligible demand for a portfolio's plan: demand delivered by one of
-- its sub-portfolios, OR demand raised in this portfolio that's still
-- uncategorised at sub-portfolio level (per the agreed default - it
-- counts toward the raising portfolio's budget until reassigned).
--
-- Versioned: a plan is draft until agreed, then locked. Reviewing
-- mid-year creates a new draft version rather than editing the agreed
-- one - "the year as a large Sprint", with the original preserved for
-- comparison. This IS the preserved-original thesis applied to planning.
-- ============================================================

CREATE TABLE IF NOT EXISTS annual_plan (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organization(id),
    portfolio_id        UUID NOT NULL REFERENCES portfolio(id),   -- must be a parent portfolio
    financial_year       INT NOT NULL,
    version             INT NOT NULL DEFAULT 1,
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'agreed')),
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    agreed_by           UUID REFERENCES app_user(id),
    agreed_at           TIMESTAMPTZ,
    superseded_by        UUID REFERENCES annual_plan(id),   -- set when a revision is created
    UNIQUE (portfolio_id, financial_year, version)
);

CREATE OR REPLACE FUNCTION enforce_plan_on_parent_portfolio() RETURNS trigger AS $$
DECLARE
    is_sub BOOLEAN;
BEGIN
    SELECT (parent_portfolio_id IS NOT NULL) INTO is_sub FROM portfolio WHERE id = NEW.portfolio_id;
    IF is_sub THEN
        RAISE EXCEPTION 'An annual plan belongs to a parent portfolio, not a sub-portfolio';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_parent_only ON annual_plan;
CREATE TRIGGER trg_plan_parent_only
    BEFORE INSERT OR UPDATE ON annual_plan
    FOR EACH ROW EXECUTE FUNCTION enforce_plan_on_parent_portfolio();

-- Only one draft per portfolio/year at a time (the current working version)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_draft_per_portfolio_year
    ON annual_plan (portfolio_id, financial_year)
    WHERE status = 'draft';

-- ---------- Plan items: where each demand sits ----------

CREATE TABLE IF NOT EXISTS annual_plan_item (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id             UUID NOT NULL REFERENCES annual_plan(id),
    demand_id           UUID NOT NULL REFERENCES demand(id),
    column_placement    TEXT NOT NULL DEFAULT 'budget' CHECK (column_placement IN ('budget', 'deferred')),
    -- 'all' is not stored - it's the implicit state of eligible demand
    -- with no item row yet, so the pool never needs manual seeding.
    reason              TEXT,   -- required by the app layer when deferring
    moved_by            UUID REFERENCES app_user(id),
    moved_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, demand_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_item_plan ON annual_plan_item(plan_id);

-- ---------- Plan totals view ----------
-- Fixed vs discretionary, committed vs envelope - the header maths,
-- computed once here rather than reassembled ad hoc per request.

CREATE OR REPLACE VIEW annual_plan_totals AS
SELECT
    p.id AS plan_id,
    p.portfolio_id,
    p.financial_year,
    p.status,
    p.version,
    COUNT(*) FILTER (WHERE pi.column_placement = 'budget') AS budget_item_count,
    COUNT(*) FILTER (WHERE pi.column_placement = 'deferred') AS deferred_item_count,

    COALESCE(SUM(
        COALESCE(a.assessed_cost, d.claimed_cost)
    ) FILTER (WHERE pi.column_placement = 'budget' AND (d.date_driver_type IS NULL OR d.date_driver_type = 'none')), 0)
        AS discretionary_committed,

    COALESCE(SUM(
        COALESCE(a.assessed_cost, d.claimed_cost)
    ) FILTER (WHERE pi.column_placement = 'budget' AND d.date_driver_type IS NOT NULL AND d.date_driver_type <> 'none'), 0)
        AS fixed_committed,

    COALESCE(AVG(dpv.weighted_score) FILTER (WHERE pi.column_placement = 'budget'), 0) AS avg_weighted_score,

    -- A fixed-date item sitting in Deferred is a breach worth surfacing directly
    COUNT(*) FILTER (
        WHERE pi.column_placement = 'deferred'
          AND d.date_driver_type IS NOT NULL AND d.date_driver_type <> 'none'
    ) AS deferred_fixed_breach_count
FROM annual_plan p
LEFT JOIN annual_plan_item pi ON pi.plan_id = p.id
LEFT JOIN demand d ON d.id = pi.demand_id
LEFT JOIN demand_assessment a ON a.demand_id = d.id
LEFT JOIN demand_priority_view dpv ON dpv.demand_id = d.id
GROUP BY p.id, p.portfolio_id, p.financial_year, p.status, p.version;
