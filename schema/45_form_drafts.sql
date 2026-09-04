-- 45_form_drafts.sql
--
-- A single, generic draft mechanism reused across every stage that has
-- a "submit to move this forward" action: Raise, Triage, Assess (P75),
-- and RACI+promote. A draft is deliberately NOT validated, real data --
-- it's a scratchpad of whatever the person has typed so far, saved so
-- it survives closing the tab or coming back tomorrow. Because none of
-- the four forms share a schema, and because a draft's whole point is
-- to hold incomplete/invalid-for-submission data, a single JSONB
-- payload column is the right shape here -- four bespoke draft tables
-- mirroring each form's strict Zod schema would fight the very thing
-- a draft is for.
--
-- Drafts are private to their author. This is an app-level access
-- rule enforced by always filtering on user_id in every query, not a
-- second RLS policy layer -- org-level RLS still applies for tenant
-- isolation underneath it.

BEGIN;

CREATE TABLE form_draft (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  user_id         UUID NOT NULL REFERENCES app_user(id),
  stage           TEXT NOT NULL CHECK (stage IN ('raise', 'triage', 'assess', 'accept')),
  -- NULL only for 'raise' -- no demand exists yet to attach it to.
  -- Every other stage's draft is tied to the specific demand it's
  -- in-progress on.
  demand_id       UUID REFERENCES demand(id),
  data            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT form_draft_raise_has_no_demand
    CHECK (stage <> 'raise' OR demand_id IS NULL),
  CONSTRAINT form_draft_non_raise_requires_demand
    CHECK (stage = 'raise' OR demand_id IS NOT NULL)
);

-- One draft per (user, stage, demand) for the three stages that
-- attach to an existing demand -- resuming means "load the one draft
-- I have for this action on this demand," not choosing between
-- several. Raise drafts are deliberately NOT constrained this way:
-- someone may have several half-written ideas in flight at once, each
-- its own row, since demand_id is NULL for all of them and multiple
-- NULLs don't collide under a normal unique index.
CREATE UNIQUE INDEX idx_form_draft_one_per_stage_demand
  ON form_draft (user_id, stage, demand_id)
  WHERE demand_id IS NOT NULL;

CREATE INDEX idx_form_draft_user ON form_draft (user_id, stage);

COMMENT ON TABLE form_draft IS
  'In-progress, unvalidated form data for any of the four submit-to-advance stages (raise/triage/assess/accept). Private to the author. Deleted once the real submit succeeds -- a draft that outlives its own submission would be stale, misleading clutter, not a useful record.';

ALTER TABLE form_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_draft FORCE ROW LEVEL SECURITY;

CREATE POLICY form_draft_tenant_isolation ON form_draft
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

COMMIT;
