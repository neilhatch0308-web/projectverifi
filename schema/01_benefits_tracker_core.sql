-- ============================================================
-- Benefits Realization & Business Case Tracker — Core Data Model
-- Positioning: a benefits-integrity ledger that sits on top of
-- existing PM/finance tools. Tracks what was claimed, what was
-- spent, and whether it actually materialized — and flags when
-- two business cases quietly claim the same underlying saving.
-- ============================================================

CREATE TABLE organization (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization(id),
    email           TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'contributor', -- exec_sponsor | pmo | benefit_owner | contributor | auditor
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional grouping — division, programme, portfolio
CREATE TABLE portfolio (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization(id),
    name            TEXT NOT NULL             -- 'Academic Division', 'Front Office Transformation'
);

-- ---------- The submission itself ----------
CREATE TABLE business_case (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organization(id),
    portfolio_id        UUID REFERENCES portfolio(id),
    title               TEXT NOT NULL,
    sponsor_user_id     UUID REFERENCES app_user(id),   -- exec who owns the ask
    submitted_by        UUID REFERENCES app_user(id),
    requested_spend     NUMERIC(14,2),
    currency            TEXT DEFAULT 'GBP',
    submission_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    decision            TEXT DEFAULT 'pending',   -- pending | approved | rejected | deferred | superseded
    decision_date       DATE,
    summary             TEXT,                     -- your own summary, not the full deck
    source_doc_url      TEXT,                      -- link to the original deck/paper, not stored content
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Approved spend vs. actual spend ----------
CREATE TABLE investment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id    UUID NOT NULL REFERENCES business_case(id),
    approved_amount     NUMERIC(14,2),
    currency            TEXT DEFAULT 'GBP',
    actual_spend_to_date NUMERIC(14,2) DEFAULT 0,
    last_updated        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Each individual claimed benefit within a case ----------
CREATE TABLE benefit (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id       UUID NOT NULL REFERENCES business_case(id),
    title                   TEXT NOT NULL,             -- 'Reduced 8x8 licensing cost'
    benefit_type            TEXT NOT NULL,             -- cost_saving | revenue | efficiency_hours | risk_reduction | other
    claimed_value           NUMERIC(14,2),
    currency                TEXT DEFAULT 'GBP',
    baseline_reference      TEXT,                      -- what existing spend/metric this is measured against
    owner_user_id           UUID REFERENCES app_user(id), -- accountable for realization, may differ from sponsor
    expected_realization_date DATE,
    status                  TEXT NOT NULL DEFAULT 'claimed',
                                -- claimed | at_risk | realized | partially_realized | not_realized | withdrawn
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Overlap / duplicate detection — the sharpest differentiator ----------
CREATE TABLE benefit_link (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    benefit_id_a        UUID NOT NULL REFERENCES benefit(id),
    benefit_id_b         UUID NOT NULL REFERENCES benefit(id),
    relationship_type   TEXT NOT NULL,   -- duplicate | overlaps | depends_on | supersedes
    notes               TEXT,
    flagged_by          UUID REFERENCES app_user(id),   -- often the platform via matching rules, else null = system
    flagged_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved            BOOLEAN NOT NULL DEFAULT false,
    resolution_notes    TEXT,
    CHECK (benefit_id_a <> benefit_id_b)
);

-- ---------- Closing the loop: did it actually happen ----------
CREATE TABLE realization_check (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    benefit_id          UUID NOT NULL REFERENCES benefit(id),
    scheduled_date      DATE NOT NULL,       -- when the check SHOULD happen (drives the nudge/alert)
    performed_date      DATE,                -- when it actually was reviewed
    performed_by        UUID REFERENCES app_user(id),
    actual_value        NUMERIC(14,2),
    variance            NUMERIC(14,2) GENERATED ALWAYS AS (actual_value - NULL) STORED, -- placeholder; compute in app layer against claimed_value
    outcome             TEXT,                -- realized | partial | not_realized | deferred
    evidence_url        TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Immutable audit trail ----------
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization(id),
    actor_user_id   UUID REFERENCES app_user(id),
    entity_type     TEXT NOT NULL,   -- 'business_case' | 'benefit' | 'realization_check' | 'benefit_link'
    entity_id       UUID NOT NULL,
    action          TEXT NOT NULL,   -- 'submitted' | 'approved' | 'status_changed' | 'flagged_overlap' | 'checked'
    before_value    JSONB,
    after_value     JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Indexes ----------
CREATE INDEX idx_case_org ON business_case(organization_id);
CREATE INDEX idx_case_portfolio ON business_case(portfolio_id);
CREATE INDEX idx_benefit_case ON benefit(business_case_id);
CREATE INDEX idx_benefit_status ON benefit(status);
CREATE INDEX idx_check_benefit ON realization_check(benefit_id);
CREATE INDEX idx_check_scheduled ON realization_check(scheduled_date);
CREATE INDEX idx_link_benefits ON benefit_link(benefit_id_a, benefit_id_b);
CREATE INDEX idx_audit_org_entity ON audit_log(organization_id, entity_type, entity_id);

-- ============================================================
-- Design notes:
-- 1. `benefit_link` is the core differentiator — this is what a
--    portfolio director can't do by memory across dozens of cases:
--    "this saving from Project A's case is the same £400K already
--    claimed in Project C's baseline." Matching logic (fuzzy text
--    match on baseline_reference, same cost centre, same time window)
--    lives in the app layer and writes rows here for human review —
--    the platform flags, a person resolves.
-- 2. `realization_check.scheduled_date` is what drives your proactive
--    value: nobody has to remember to chase this — the platform
--    surfaces it when the date arrives, whether or not anyone acted.
-- 3. `benefit.status` defaulting to 'claimed' and never silently
--    becoming 'realized' without a `realization_check` row existing
--    is the whole point — no benefit is marked delivered on the
--    strength of the original business case alone.
-- 4. Keep `source_doc_url` pointing at the original deck rather than
--    storing/reproducing its content — avoids IP and version-drift issues.
-- ============================================================
