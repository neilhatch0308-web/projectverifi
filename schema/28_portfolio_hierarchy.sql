-- ============================================================
-- 28_portfolio_hierarchy.sql
--
-- Two-level portfolio hierarchy. A parent portfolio (Front Office,
-- Back Office, Products) holds the budget. Sub-portfolios (ERP, HR,
-- Payments, Sales, Marketing...) are what demand actually tags against
-- for delivery - their costs roll up to the parent's single budget
-- line, with no separate sub-level allocation required.
--
-- Raising stays at PARENT level - the person raising a demand knows
-- their own area, not which technical team will end up delivering it.
-- Delivering is assigned at SUB-portfolio level, later (typically at
-- assessment, but changeable up to planning), and defaults to "not yet
-- categorised" rather than guessing - existing demand and any newly
-- raised demand with no delivery assignment yet both sit this way,
-- counted toward the RAISING portfolio's budget until reassigned.
--
-- Deliberately just two levels, enforced by a trigger - not arbitrary
-- nesting. Keeps the budget rollup a single, always-correct SUM rather
-- than a recursive query.
-- ============================================================

-- ---------- 1. Hierarchy ----------

ALTER TABLE portfolio
    ADD COLUMN IF NOT EXISTS parent_portfolio_id UUID REFERENCES portfolio(id);

CREATE OR REPLACE FUNCTION enforce_two_level_portfolio() RETURNS trigger AS $$
DECLARE
    grandparent_check UUID;
BEGIN
    IF NEW.parent_portfolio_id IS NOT NULL THEN
        SELECT parent_portfolio_id INTO grandparent_check
        FROM portfolio WHERE id = NEW.parent_portfolio_id;

        IF grandparent_check IS NOT NULL THEN
            RAISE EXCEPTION 'Portfolio hierarchy is limited to two levels - % is already a sub-portfolio and cannot have children', NEW.parent_portfolio_id;
        END IF;

        IF NEW.parent_portfolio_id = NEW.id THEN
            RAISE EXCEPTION 'A portfolio cannot be its own parent';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_two_level_portfolio ON portfolio;
CREATE TRIGGER trg_two_level_portfolio
    BEFORE INSERT OR UPDATE ON portfolio
    FOR EACH ROW EXECUTE FUNCTION enforce_two_level_portfolio();

-- Existing 6 portfolios (Operations, Manufacturing, Sales, International
-- Sales, Finance, IT) need no change - parent_portfolio_id stays NULL,
-- which is exactly what makes them parents. Nothing to backfill here.

-- ---------- 2. Budget stays at parent level only ----------

CREATE OR REPLACE FUNCTION enforce_budget_on_parent_only() RETURNS trigger AS $$
DECLARE
    is_sub BOOLEAN;
BEGIN
    SELECT (parent_portfolio_id IS NOT NULL) INTO is_sub FROM portfolio WHERE id = NEW.portfolio_id;
    IF is_sub THEN
        RAISE EXCEPTION 'Budget can only be set on a parent portfolio, not a sub-portfolio - % is a sub-portfolio', NEW.portfolio_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_budget_parent_only ON portfolio_budget;
CREATE TRIGGER trg_budget_parent_only
    BEFORE INSERT OR UPDATE ON portfolio_budget
    FOR EACH ROW EXECUTE FUNCTION enforce_budget_on_parent_only();

-- ---------- 3. Demand: delivering sub-portfolio, assigned later ----------
-- NULL by default and by design - Option 2: existing demand (and newly
-- raised demand until someone categorises it) is "not yet categorised"
-- at sub-portfolio level, not force-guessed into one. Its cost still
-- counts toward the RAISING portfolio's effective budget until this is set.

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS delivering_sub_portfolio_id UUID REFERENCES portfolio(id);

CREATE OR REPLACE FUNCTION enforce_sub_portfolio_assignment() RETURNS trigger AS $$
DECLARE
    is_sub BOOLEAN;
BEGIN
    IF NEW.delivering_sub_portfolio_id IS NOT NULL THEN
        SELECT (parent_portfolio_id IS NOT NULL) INTO is_sub
        FROM portfolio WHERE id = NEW.delivering_sub_portfolio_id;
        IF NOT is_sub THEN
            RAISE EXCEPTION 'delivering_sub_portfolio_id must reference a sub-portfolio, not a parent portfolio';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sub_portfolio_assignment ON demand;
CREATE TRIGGER trg_sub_portfolio_assignment
    BEFORE INSERT OR UPDATE ON demand
    FOR EACH ROW EXECUTE FUNCTION enforce_sub_portfolio_assignment();

COMMENT ON COLUMN demand.delivering_portfolio_id IS 'DEPRECATED as of 28_portfolio_hierarchy.sql - superseded by delivering_sub_portfolio_id, which carries both the sub-portfolio assignment and (via its parent) the delivering parent portfolio. Rows preserved for audit only.';
COMMENT ON COLUMN demand.delivering_sub_portfolio_id IS 'Assigned later, typically at assessment - NULL means not yet categorised. When NULL, the demand still counts toward the RAISING portfolio''s budget (portfolio_id), not a guessed default.';

-- ---------- 4. Reassignment history ----------
-- Consistent with budget transfers being recorded events: changing
-- which sub-portfolio (and therefore which parent budget) a demand's
-- cost counts against is itself a signal worth keeping.

CREATE TABLE IF NOT EXISTS demand_portfolio_assignment_history (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id                   UUID NOT NULL REFERENCES demand(id),
    from_sub_portfolio_id       UUID REFERENCES portfolio(id),   -- NULL if previously uncategorised
    to_sub_portfolio_id         UUID REFERENCES portfolio(id),   -- NULL if being un-set
    reason                      TEXT,
    changed_by                  UUID REFERENCES app_user(id),
    changed_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignment_history_demand ON demand_portfolio_assignment_history(demand_id);

-- ---------- 5. Rollup views ----------

-- Sub-portfolio cost breakdown within each parent - derived from what's
-- actually been raised/assessed, not a formal sub-allocation exercise.
CREATE OR REPLACE VIEW subportfolio_cost_breakdown AS
SELECT
    parent.id AS parent_portfolio_id,
    parent.name AS parent_portfolio_name,
    sub.id AS sub_portfolio_id,
    sub.name AS sub_portfolio_name,
    COUNT(d.id) AS demand_count,
    COALESCE(SUM(COALESCE(a.assessed_cost, d.claimed_cost)), 0) AS total_cost
FROM portfolio parent
JOIN portfolio sub ON sub.parent_portfolio_id = parent.id
LEFT JOIN demand d ON d.delivering_sub_portfolio_id = sub.id
LEFT JOIN demand_assessment a ON a.demand_id = d.id
GROUP BY parent.id, parent.name, sub.id, sub.name;

-- Demand not yet categorised at sub-portfolio level, per parent -
-- surfaces the "still needs assigning" backlog directly.
CREATE OR REPLACE VIEW uncategorised_demand_by_portfolio AS
SELECT
    p.id AS portfolio_id,
    p.name AS portfolio_name,
    COUNT(d.id) AS uncategorised_count,
    COALESCE(SUM(COALESCE(a.assessed_cost, d.claimed_cost)), 0) AS uncategorised_cost
FROM portfolio p
JOIN demand d ON d.portfolio_id = p.id
LEFT JOIN demand_assessment a ON a.demand_id = d.id
WHERE d.delivering_sub_portfolio_id IS NULL
  AND p.parent_portfolio_id IS NULL
GROUP BY p.id, p.name;
