-- ============================================================
-- Workflow Stage Ownership Extension
-- Separates WHO gatekeeps consistency (PMO scoring/triage) from
-- WHO owns each subsequent decision (acceptance, progression,
-- realization sign-off) — configurable per organization, tied
-- to a role rather than a named person.
-- Depends on: organization, app_user, demand, business_case, benefit
-- ============================================================

-- ---------- Defines the stages and who is accountable for each ----------
CREATE TABLE workflow_stage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization(id),
    entity_type     TEXT NOT NULL,      -- 'demand' | 'business_case' | 'benefit'
    stage_name      TEXT NOT NULL,      -- 'triage', 'acceptance', 'progression', 'realization_signoff'
    sequence_order  SMALLINT NOT NULL,  -- controls display/expected order, not a hard gate
    required_role   TEXT NOT NULL,      -- 'pmo' | 'sponsor' | 'benefit_owner' | 'finance' | 'exec'
    description     TEXT,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, entity_type, stage_name)
);

-- ---------- The actual decision event at each stage ----------
-- entity_type + entity_id is a lightweight polymorphic reference
-- (points at demand.id, business_case.id, or benefit.id depending
-- on entity_type) — kept this way so one table covers all three
-- lifecycles rather than three near-identical approval tables.
CREATE TABLE stage_approval (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id        UUID NOT NULL REFERENCES workflow_stage(id),
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    approver_user_id UUID REFERENCES app_user(id),
    approver_role   TEXT NOT NULL,      -- role the approver held at time of decision (may differ from stage default if delegated)
    decision        TEXT NOT NULL,      -- approved | rejected | deferred
    decision_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
    comments        TEXT
);

-- ---------- Indexes ----------
CREATE INDEX idx_stage_org_entity ON workflow_stage(organization_id, entity_type);
CREATE INDEX idx_approval_entity ON stage_approval(entity_type, entity_id);
CREATE INDEX idx_approval_stage ON stage_approval(stage_id);

-- ---------- Suggested seed data for the demand lifecycle ----------
-- INSERT INTO workflow_stage (organization_id, entity_type, stage_name, sequence_order, required_role) VALUES
--   ('<org_id>', 'demand', 'triage',              1, 'pmo'),           -- PMO: consistent scoring against matrix
--   ('<org_id>', 'demand', 'acceptance',           2, 'sponsor'),       -- sponsor/strategy owner: yes, this matters
--   ('<org_id>', 'demand', 'progression',          3, 'finance'),      -- finance/exec: releases budget, promotes to business_case
--   ('<org_id>', 'benefit', 'realization_signoff', 1, 'benefit_owner');-- benefit owner: confirms it actually happened

-- ============================================================
-- Design notes:
-- 1. `required_role` on workflow_stage is the DEFAULT accountable role —
--    `stage_approval.approver_role` records who actually approved,
--    which lets you spot when PMO is being asked to approve things
--    that should sit elsewhere (a good health-check report on its own).
-- 2. A demand can sit at 'triage' indefinitely without an approval row —
--    that's fine, it just means it hasn't been scored/gated yet.
--    `demand.status` (raised/triaged/backlog/etc.) and `stage_approval`
--    are related but not the same thing: status is the demand's current
--    state, stage_approval is the audit trail of who decided what.
-- 3. Recommend the app layer writes a `stage_approval` row AND an
--    `audit_log` row on every decision — stage_approval gives you the
--    structured "who owns this stage" report, audit_log gives you the
--    generic timeline view alongside every other change to the record.
-- 4. Because entity_type/entity_id is polymorphic (not a real FK), add
--    an application-layer check that entity_id actually exists in the
--    right table before insert — Postgres won't enforce this for you.
-- ============================================================
