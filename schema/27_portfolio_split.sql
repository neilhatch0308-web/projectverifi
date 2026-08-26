-- ============================================================
-- 27_portfolio_split.sql
--
-- Prerequisite for the annual planning board (Phase 3).
--
-- Until now demand.portfolio_id has done double duty: "where it was
-- raised" and "whose budget pays". Those are genuinely different.
-- A web payment change might be raised in Front Office but delivered
-- as an ERP change in Back Office - and it's the DELIVERING portfolio
-- whose budget line it consumes.
--
-- Portfolios here are technology spending categories, not a mirror of
-- the org chart: Front Office, Back Office (HR/ERP/finance systems),
-- Infrastructure (cloud, DC, wifi), End User Services (laptops,
-- monitors, software), and so on.
--
-- One portfolio owns the cost. Where reality involves shared funding,
-- that's handled by moving budget BETWEEN portfolio lines rather than
-- splitting a demand across two - which keeps the demand model clean
-- while still recognising the funding honestly, because the transfer
-- itself is recorded (see portfolio_budget_transfer below).
-- ============================================================

-- ---------- 1. Raising vs delivering portfolio ----------
-- The existing portfolio_id becomes the RAISING portfolio (no data
-- migration needed - that's what it has effectively been). Delivering
-- portfolio is new, and defaults to the same value where not yet set.

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS delivering_portfolio_id UUID REFERENCES portfolio(id);

COMMENT ON COLUMN demand.portfolio_id IS 'RAISING portfolio - where the need originated.';
COMMENT ON COLUMN demand.delivering_portfolio_id IS 'DELIVERING portfolio - whose budget line and team actually does the work. Often the same as portfolio_id, sometimes not. This is the one that matters for annual planning.';

-- Backfill: existing demand delivers where it was raised, which is the
-- only honest assumption available - nothing recorded a difference before now.
UPDATE demand
SET delivering_portfolio_id = portfolio_id
WHERE delivering_portfolio_id IS NULL;

-- ---------- 2. Portfolio budget lines ----------
-- One row per portfolio per financial year. The corporate envelope is
-- the sum of these, so allocation and total stay reconcilable by
-- construction rather than by someone remembering to keep them in step.

CREATE TABLE IF NOT EXISTS portfolio_budget (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organization(id),
    portfolio_id        UUID NOT NULL REFERENCES portfolio(id),
    financial_year      INT NOT NULL,
    allocated_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
    set_by              UUID REFERENCES app_user(id),
    set_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (portfolio_id, financial_year)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_budget_year ON portfolio_budget(organization_id, financial_year);

-- ---------- 3. Budget transfers as recorded events ----------
-- When funding moves between portfolio lines - because a demand needs
-- both, or priorities shifted mid-year - that movement is an event with
-- a reason and an approver, not two numbers quietly edited. Consistent
-- with the framework's standing instinct that movement is signal.

CREATE TABLE IF NOT EXISTS portfolio_budget_transfer (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES organization(id),
    financial_year          INT NOT NULL,
    from_portfolio_id       UUID NOT NULL REFERENCES portfolio(id),
    to_portfolio_id         UUID NOT NULL REFERENCES portfolio(id),
    amount                  NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    reason                  TEXT NOT NULL,
    related_demand_id       UUID REFERENCES demand(id),   -- optional: the demand that prompted it
    approved_by             UUID REFERENCES app_user(id),
    transferred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_portfolio_id <> to_portfolio_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_transfer_year ON portfolio_budget_transfer(organization_id, financial_year);

-- ---------- 4. Effective budget view ----------
-- Allocated amount adjusted by any transfers in or out. This is the
-- figure a portfolio actually plans against, and it stays correct
-- automatically as transfers are recorded.

CREATE OR REPLACE VIEW portfolio_effective_budget AS
SELECT
    pb.id AS portfolio_budget_id,
    pb.organization_id,
    pb.portfolio_id,
    p.name AS portfolio_name,
    pb.financial_year,
    pb.allocated_amount,
    COALESCE(inbound.total, 0) AS transferred_in,
    COALESCE(outbound.total, 0) AS transferred_out,
    pb.allocated_amount + COALESCE(inbound.total, 0) - COALESCE(outbound.total, 0) AS effective_amount
FROM portfolio_budget pb
JOIN portfolio p ON p.id = pb.portfolio_id
LEFT JOIN (
    SELECT to_portfolio_id, financial_year, SUM(amount) AS total
    FROM portfolio_budget_transfer GROUP BY to_portfolio_id, financial_year
) inbound ON inbound.to_portfolio_id = pb.portfolio_id AND inbound.financial_year = pb.financial_year
LEFT JOIN (
    SELECT from_portfolio_id, financial_year, SUM(amount) AS total
    FROM portfolio_budget_transfer GROUP BY from_portfolio_id, financial_year
) outbound ON outbound.from_portfolio_id = pb.portfolio_id AND outbound.financial_year = pb.financial_year;
