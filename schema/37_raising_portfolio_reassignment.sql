-- ============================================================
-- 37_raising_portfolio_reassignment.sql
--
-- Until now, demand.portfolio_id (the RAISING portfolio - where a
-- demand was conceived) was set once at raise and never reassignable.
-- That's fine as a general default (§3b of the framework: "raising
-- stays at parent level, the conceiver knows their own area"), but it
-- became a real gap once portfolio deletion started checking for
-- exactly this - a portfolio with demand raised against it can never
-- be cleaned up otherwise.
--
-- A SEPARATE table from demand_portfolio_assignment_history
-- (28_portfolio_hierarchy.sql), not a shared/overloaded one - that
-- table's from/to columns are specifically sub-portfolio-level
-- (delivering assignment), and this is parent-level (raising
-- provenance). Same shape as portfolio_budget_transfer vs
-- portfolio_budget_adjustment: similar-looking events, kept in
-- distinct tables because what they mean is genuinely different.
-- ============================================================

CREATE TABLE IF NOT EXISTS demand_raising_portfolio_reassignment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id           UUID NOT NULL REFERENCES demand(id),
    from_portfolio_id   UUID REFERENCES portfolio(id),
    to_portfolio_id     UUID NOT NULL REFERENCES portfolio(id),
    reason              TEXT,
    changed_by          UUID REFERENCES app_user(id),
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raising_reassignment_demand ON demand_raising_portfolio_reassignment(demand_id);

COMMENT ON TABLE demand_raising_portfolio_reassignment IS 'Audit trail for changes to a demand''s raising (conceiving) portfolio - distinct from delivering-sub-portfolio reassignment history.';
