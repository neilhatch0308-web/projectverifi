-- ============================================================
-- 41_portfolio_budget_baseline_assigned.sql
--
-- Reworks portfolio budgets from an allocated-amount-plus-transfers
-- model to Baseline / Current / Assigned - a genuine rethink, not a
-- cosmetic rename:
--
--   - BASELINE: the year's budget for a portfolio, set ONCE at first
--     submission, then permanently immutable. The anchored-claim
--     pattern already used for demand (claimed_cost, never overwritten)
--     applied to portfolio budgets for the first time.
--   - CURRENT: NOT stored here at all - it's what Annual Planning
--     actually has committed to the budget column for this portfolio/
--     year (discretionary_committed + fixed_committed from
--     annual_plan_totals), read live. A derived figure, not an
--     independent one.
--   - ASSIGNED: the real, adjustable working budget. Starts equal to
--     Baseline, then moves up or down via the existing adjustment
--     audit trail (portfolio_budget_adjustment, unchanged) - a
--     post-annual-planning business case, or a spend reduction
--     request, both just become an adjustment with a reason.
--
-- Cross-portfolio TRANSFERS are retired from active use ("moving
-- budget between portfolios isn't really a thing"). The
-- portfolio_budget_transfer table and its historical rows are left
-- untouched - never delete audit history - but nothing in the app
-- creates new ones from here on. If you want the table properly
-- retired later (once you're confident nothing needs it), that's a
-- separate, deliberate decision - not made here.
-- ============================================================

ALTER TABLE portfolio_budget RENAME COLUMN allocated_amount TO baseline_amount;
ALTER TABLE portfolio_budget RENAME COLUMN set_by TO baseline_set_by;
ALTER TABLE portfolio_budget RENAME COLUMN set_at TO baseline_set_at;

ALTER TABLE portfolio_budget
    ADD COLUMN IF NOT EXISTS assigned_amount    NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS assigned_set_by     UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS assigned_set_at     TIMESTAMPTZ;

-- Backfill: whatever was previously "allocated" becomes both the
-- baseline AND the starting assigned figure for existing rows - the
-- anchored claim has to start somewhere, and the most recent figure
-- already on record is the only sensible starting point.
UPDATE portfolio_budget
SET assigned_amount = baseline_amount,
    assigned_set_by = baseline_set_by,
    assigned_set_at = baseline_set_at
WHERE assigned_amount IS NULL;

ALTER TABLE portfolio_budget ALTER COLUMN assigned_amount SET NOT NULL;

COMMENT ON COLUMN portfolio_budget.baseline_amount IS 'Set once, at first submission, via an explicit confirmation - never changed after. The anchored original.';
COMMENT ON COLUMN portfolio_budget.assigned_amount IS 'The real working budget - starts equal to baseline, then adjustable (positive or negative) via portfolio_budget_adjustment.';
