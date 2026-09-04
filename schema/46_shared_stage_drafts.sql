-- 46_shared_stage_drafts.sql
--
-- Raise drafts stay strictly personal -- there's no demand yet, so a
-- raise draft genuinely is one person's private half-written idea.
--
-- Triage/Assess/Accept drafts are different: they're in-progress work
-- ON A SPECIFIC DEMAND, and the person who saved it isn't necessarily
-- who finishes it -- work gets handed off, the tagged assessor
-- changes, someone's out sick. Locking the draft to its original
-- author meant a handoff started from a blank form even though the
-- previous person had already typed most of it. Widening visibility
-- to "anyone holding the matching permission" for these three stages
-- matches how the real actions already work: demand.triage and
-- demand.assess are org-wide capabilities, not assigned to one named
-- person, so the draft that leads up to using them shouldn't be
-- either.

BEGIN;

ALTER TABLE form_draft ADD COLUMN updated_by UUID REFERENCES app_user(id);
UPDATE form_draft SET updated_by = user_id WHERE updated_by IS NULL;

COMMENT ON COLUMN form_draft.user_id IS
  'Who first created this draft. For raise-stage drafts this also gates visibility (personal, author-only). For triage/assess/accept drafts, visibility is shared with anyone holding the matching permission -- this column is provenance for those three, not an access gate.';
COMMENT ON COLUMN form_draft.updated_by IS
  'Who most recently saved this draft -- surfaced in the UI so a handoff is visible (e.g. "last saved by Priya, 10 minutes ago") rather than silent.';

-- Was (user_id, stage, demand_id) -- one draft per person per demand
-- per stage. Now (stage, demand_id) -- one SHARED draft per demand
-- per stage, since triage/assess/accept drafts no longer belong to
-- one person. Raise rows (demand_id IS NULL) are untouched by this
-- index either way -- multiple personal raise drafts remain allowed.
DROP INDEX idx_form_draft_one_per_stage_demand;
CREATE UNIQUE INDEX idx_form_draft_one_per_stage_demand
  ON form_draft (stage, demand_id)
  WHERE demand_id IS NOT NULL;

COMMIT;
