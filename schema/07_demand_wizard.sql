-- ============================================================
-- Demand Creation Wizard Extension
-- Supports: draft-as-you-go demand creation, instant fuzzy-text
-- duplicate prompting at the description step, portfolio/sub-
-- portfolio hierarchy, multiple owners, and success criteria
-- authored at demand stage (carried forward to business case).
-- Depends on: organization, app_user, portfolio, demand, kpi_definition
-- ============================================================

-- ---------- Enable fast fuzzy text matching (no AI call needed for step 1) ----------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_demand_description_trgm ON demand USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_demand_title_trgm ON demand USING gin (title gin_trgm_ops);
-- Powers: SELECT id, title, similarity(description, :input) AS score FROM demand
--         WHERE description % :input ORDER BY score DESC LIMIT 5;
-- Cheap enough to run on every keystroke-pause in the wizard, no external AI call required.

-- ---------- Demand gains a draft state and wizard-specific fields ----------
-- (demand.status now includes: draft | raised | triaged | backlog | parked
--  | actioned | promoted | rejected | duplicate)
ALTER TABLE demand ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE demand ADD COLUMN IF NOT EXISTS outcome_required TEXT;
    -- distinct from `description` (the problem) — this is "what does good look like"

-- ---------- Sub-portfolio hierarchy — division -> optional sub-portfolio, same table ----------
ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS parent_portfolio_id UUID REFERENCES portfolio(id);
-- e.g. 'Academic Division' (parent NULL) -> 'Academic — Digital Products' (parent = Academic Division)

-- ---------- Multiple owners per demand ----------
CREATE TABLE demand_owner (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id       UUID NOT NULL REFERENCES demand(id),
    user_id         UUID NOT NULL REFERENCES app_user(id),
    owner_role      TEXT NOT NULL DEFAULT 'primary',  -- primary | delivery | business
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (demand_id, user_id)
);

-- ---------- Success criteria now originate at the demand wizard, not just business case ----------
ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS demand_id UUID REFERENCES demand(id);
ALTER TABLE kpi_definition ALTER COLUMN business_case_id DROP NOT NULL;
ALTER TABLE kpi_definition ADD CONSTRAINT kpi_origin_check
    CHECK (demand_id IS NOT NULL OR business_case_id IS NOT NULL);
-- Authored against demand_id during the wizard's "success criteria" step.
-- When the demand is promoted, business_case_id gets populated on the same
-- rows (carrying the original criteria forward) rather than recreating them.

-- ---------- Step 1 fuzzy-match prompt log — the accountability trail ----------
CREATE TABLE demand_duplicate_prompt (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id           UUID NOT NULL REFERENCES demand(id),
    prompt_type         TEXT NOT NULL,   -- 'fuzzy_text_step1' | 'ai_semantic_final'
    candidates_shown    JSONB NOT NULL,  -- [{entity_type, entity_id, title, score}, ...]
    candidates_count    INTEGER NOT NULL DEFAULT 0,
    viewed_candidate_ids UUID[] DEFAULT '{}',   -- which ones the user actually opened
    user_action         TEXT NOT NULL,   -- 'continued_without_viewing' | 'continued_after_viewing' | 'abandoned_and_edited'
    prompted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actioned_at         TIMESTAMPTZ
);

-- ---------- Distinguish where an AI similarity check was triggered from ----------
ALTER TABLE ai_similarity_check ADD COLUMN IF NOT EXISTS triggered_context TEXT NOT NULL DEFAULT 'scheduled_batch';
    -- 'wizard_final_step' (requester chose "AI compare" before completing)
    -- | 'gate_check' (mandatory check run at sponsor acceptance, per prior extension)
    -- | 'scheduled_batch' (periodic background sweep)

-- ---------- Indexes ----------
CREATE INDEX idx_demand_owner_demand ON demand_owner(demand_id);
CREATE INDEX idx_demand_owner_user ON demand_owner(user_id);
CREATE INDEX idx_portfolio_parent ON portfolio(parent_portfolio_id);
CREATE INDEX idx_kpi_demand ON kpi_definition(demand_id);
CREATE INDEX idx_dup_prompt_demand ON demand_duplicate_prompt(demand_id);

-- ============================================================
-- Wizard flow, mapped to this schema:
-- 1. Problem description entered -> demand row created (status='draft',
--    description populated). pg_trgm fuzzy search runs against
--    demand.description immediately.
-- 2. Candidates (if any) shown -> demand_duplicate_prompt row written
--    with prompt_type='fuzzy_text_step1', logging what was shown and
--    whether the user viewed/continued. This is NOT a gate — it's a
--    prompt. The user can always continue.
-- 3. Title, demand_owner rows, portfolio_id (+ optional parent-linked
--    sub-portfolio), outcome_required, kpi_definition rows (success
--    criteria) get filled in across subsequent steps, all UPDATEs to
--    the same draft demand row.
-- 4. scoring_criterion values recorded via demand_score (existing table).
-- 5. Final step: optional "AI compare" button -> writes rows to
--    ai_similarity_check with triggered_context='wizard_final_step'.
--    This is the requester's own courtesy check, separate from and in
--    ADDITION to the mandatory gate_check that still runs automatically
--    at sponsor acceptance (demand_pending_similarity_review, from the
--    RBAC/security extension) — running it early doesn't skip the
--    later mandatory check, it just means fewer surprises at that stage.
-- 6. "Complete" transitions demand.status from 'draft' to 'raised'.
-- ============================================================
