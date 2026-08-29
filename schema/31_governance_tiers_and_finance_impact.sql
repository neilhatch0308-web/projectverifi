-- ============================================================
-- 31_governance_tiers_and_finance_impact.sql
--
-- Cost-tiered governance: what a Business Case needs (which approvers,
-- which documents) scales with requested spend. Tenant-configurable,
-- per §7 of the framework doc ("stage gates... criterion types &
-- thresholds... tenant-owned configuration").
--
-- CUMULATIVE MODEL. Each tier fires once requested_spend crosses its
-- min_threshold, and ADDS to whatever lower tiers already required -
-- it never replaces. So "over £150,000 includes finance director"
-- means finance director is required IN ADDITION TO whatever the
-- £0 tier already required (portfolio lead, finance lead), not instead
-- of it. The effective requirement set for a given spend is the union
-- of every tier whose min_threshold <= that spend.
--
-- approvers and documents are both free-text arrays, not fixed enums -
-- deliberately, so a tenant can rename or add their own without a
-- schema change. This is a checklist, not a workflow: it surfaces what
-- SHOULD happen, it does not gate or block anything, consistent with
-- RPVF's "flags, never blocks" instinct (planning board, cost-to-
-- benefit flag). Sign-off capture per approver is explicitly deferred -
-- this is visibility first, enforcement later if ever.
--
-- Convention: a tier that should trigger the Finance Impact Assessment
-- form (below) includes the literal string 'Finance Impact Assessment'
-- in its added_documents array - the app matches on that string
-- case-insensitively to decide whether to show/require the form. If a
-- tenant renames that document, update the match or keep the label.
-- ============================================================

CREATE TABLE IF NOT EXISTS governance_tier (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organization(id),
    name                TEXT NOT NULL,            -- e.g. "Finance director required", tenant's own label
    min_threshold       NUMERIC(14,2) NOT NULL,    -- spend >= this activates the tier
    added_approvers     TEXT[] NOT NULL DEFAULT '{}',
    added_documents     TEXT[] NOT NULL DEFAULT '{}',
    sort_order          INT NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_governance_tier_org ON governance_tier(organization_id, min_threshold);

COMMENT ON TABLE governance_tier IS 'Cumulative cost-based governance ladder. Effective requirements for a spend = union of every tier with min_threshold <= spend. Tenant-configurable via admin UI.';

-- ---------- Finance Impact Assessment (structured form) ----------
-- Required once a governance tier whose added_documents contains
-- "Finance Impact Assessment" is reached. One per business case.

CREATE TABLE IF NOT EXISTS finance_impact_assessment (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id       UUID NOT NULL UNIQUE REFERENCES business_case(id),
    funding_source          TEXT,                     -- budget line / cost centre this draws from
    cost_centre              TEXT,
    capex_amount             NUMERIC(14,2),
    opex_amount              NUMERIC(14,2),
    ongoing_annual_cost      NUMERIC(14,2),            -- run-cost after delivery, e.g. licensing, support
    funding_period_months    INT,
    financial_narrative      TEXT,                     -- free text: the actual impact assessment writeup
    status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
    prepared_by              UUID REFERENCES app_user(id),
    prepared_at               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE finance_impact_assessment IS 'Structured financial impact form, required above the governance tier that names it. One per business case.';

-- ---------- Example seed data (Acme Holdings) ----------
-- Matches the worked example given during design. Fully editable/
-- deletable via the admin UI afterwards - this just avoids a blank
-- screen on first load.

INSERT INTO governance_tier (id, organization_id, name, min_threshold, added_approvers, added_documents, sort_order)
VALUES
    ('31111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
     'Standard', 0,
     ARRAY['Portfolio lead', 'Finance lead'],
     ARRAY['Executive summary', 'Business case'],
     0),
    ('31111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     'Finance director required', 150000,
     ARRAY['Finance director'],
     ARRAY[]::TEXT[],
     1),
    ('31111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
     'ExCo paper required', 250000,
     ARRAY[]::TEXT[],
     ARRAY['ExCo paper', 'Finance Impact Assessment'],
     2),
    ('31111111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
     'Finance committee required', 400000,
     ARRAY['Finance committee'],
     ARRAY[]::TEXT[],
     3)
ON CONFLICT (id) DO NOTHING;
