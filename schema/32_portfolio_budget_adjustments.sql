-- ============================================================
-- 32_portfolio_budget_adjustments.sql
--
-- Gap: portfolio_budget_transfer (27_portfolio_split.sql) already
-- records cross-portfolio movement as an audited event with a reason.
-- But a DIRECT adjustment to a single portfolio's allocation - "Back
-- Office's FY26 budget goes from £400k to £450k because finance
-- approved a mid-year top-up" - went through PUT /portfolio-budgets'
-- `ON CONFLICT DO UPDATE`, which silently overwrote allocated_amount
-- with no reason and no history. set_by/set_at only ever held the
-- MOST RECENT change, not the trail.
--
-- In practice this single-line adjustment is the more common operation
-- - most budget changes are "this portfolio's number moved," not "money
-- moved between two portfolios" - so it needed the same discipline the
-- framework already applies to transfers (§7, decision 44: "budget
-- transfers... are recorded events... not silent edits").
--
-- A first-ever allocation (no prior row) is NOT logged here - there's
-- no prior value to record a change against, same logic as the
-- anchored claim not treating the original figure as a "revision."
-- Only a change to an EXISTING allocation is an adjustment.
-- ============================================================

CREATE TABLE IF NOT EXISTS portfolio_budget_adjustment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organization(id),
    portfolio_id        UUID NOT NULL REFERENCES portfolio(id),
    financial_year      INT NOT NULL,
    prior_amount        NUMERIC(14,2) NOT NULL,
    new_amount          NUMERIC(14,2) NOT NULL,
    reason              TEXT NOT NULL,
    adjusted_by         UUID REFERENCES app_user(id),
    adjusted_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_adjustment_year ON portfolio_budget_adjustment(organization_id, financial_year);

COMMENT ON TABLE portfolio_budget_adjustment IS 'Audit trail for direct changes to a single portfolio''s allocated_amount. Reason required. First-ever allocation for a portfolio/year is not logged - only subsequent changes to an existing figure.';
