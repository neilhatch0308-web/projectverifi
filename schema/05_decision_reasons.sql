-- ============================================================
-- Decision Reason Extension
-- Gives sponsors (and any other stage approver) a controlled set
-- of reasons alongside free-text notes, so "why did good ideas
-- get shelved" becomes a real report, not a guess from comment text.
-- Depends on: organization, stage_approval
-- (see workflow_stage_ownership_extension.sql)
-- ============================================================

-- ---------- Configurable reason codes, per organization ----------
CREATE TABLE decision_reason (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organization(id),
    applies_to_decision TEXT NOT NULL,      -- 'deferred' | 'rejected' | 'approved' | 'any'
    label               TEXT NOT NULL,      -- 'Budget unavailable this cycle', 'Not a strategic priority right now'
    description         TEXT,
    active              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, applies_to_decision, label)
);

-- ---------- One or more reasons attached to a single decision ----------
CREATE TABLE stage_approval_reason (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_approval_id   UUID NOT NULL REFERENCES stage_approval(id),
    decision_reason_id  UUID NOT NULL REFERENCES decision_reason(id),
    notes               TEXT,           -- specific detail beyond the standard reason label
    UNIQUE (stage_approval_id, decision_reason_id)
);

-- ---------- Indexes ----------
CREATE INDEX idx_reason_org_decision ON decision_reason(organization_id, applies_to_decision);
CREATE INDEX idx_approval_reason_approval ON stage_approval_reason(stage_approval_id);

-- ---------- Suggested seed data ----------
-- INSERT INTO decision_reason (organization_id, applies_to_decision, label) VALUES
--   ('<org_id>', 'deferred', 'Budget unavailable this cycle'),
--   ('<org_id>', 'deferred', 'Timing — market or internal readiness not right yet'),
--   ('<org_id>', 'deferred', 'Awaiting outcome of related initiative'),
--   ('<org_id>', 'deferred', 'Insufficient information to decide'),
--   ('<org_id>', 'rejected', 'Not aligned to current strategic priorities'),
--   ('<org_id>', 'rejected', 'Duplicate of existing initiative'),
--   ('<org_id>', 'rejected', 'Cost/effort disproportionate to benefit'),
--   ('<org_id>', 'rejected', 'Superseded by a better alternative'),
--   ('<org_id>', 'any',      'Other — see notes');

-- ============================================================
-- Design notes:
-- 1. A high `demand_priority_view.total_score` combined with a
--    'deferred' or 'rejected' stage_approval is not a contradiction —
--    it's the exact signal you asked for: "sponsor overrode a
--    high-tier demand." Report on this pairing directly; it's
--    probably your most interesting portfolio-health metric.
-- 2. When a sponsor defers, pair the decision_reason with the
--    existing `demand.next_review_date` / `review_trigger` fields —
--    e.g. reason = 'Budget unavailable this cycle', trigger =
--    'revisit at FY27 budget planning'. The reason explains WHY,
--    the trigger defines WHEN to look again.
-- 3. `applies_to_decision = 'any'` covers reasons like 'Other' that
--    don't need to be decision-specific — keep the seed list short
--    at first; a bloated reason list defeats the point of making
--    this analyzable.
-- ============================================================
