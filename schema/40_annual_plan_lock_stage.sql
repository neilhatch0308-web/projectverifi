-- ============================================================
-- 40_annual_plan_lock_stage.sql
--
-- Expands annual_plan.status from a two-value (draft/agreed) to a
-- three-value lifecycle: draft -> agreed -> locked, with a genuine
-- unlock back to draft.
--
-- DESIGN DECISIONS (stated explicitly, since the original request was
-- ambiguous even after clarifying - flagging assumptions rather than
-- guessing silently):
--
--   - Agree and Lock are two SEPARATE, deliberate steps, not one
--     action relabeled. Agreeing already stops cards being draggable
--     (unchanged from before) - Locking is a further, more formal
--     commitment on top of that.
--   - Unlock is a TRUE reversal - it goes all the way back to `draft`
--     (fully editable, draggable again), not just back to `agreed`.
--     This is a genuine change from the earlier design principle that
--     an agreed plan is permanent and only a NEW draft revision can
--     supersede it. That principle still holds for the normal path
--     ("start mid-year revision" clones into a new version and marks
--     the original superseded, untouched by this migration) - Unlock
--     is a distinct "we made a mistake, fix THIS plan in place"
--     escape hatch, not a replacement for that workflow.
--   - No separate audit-event table for lock/unlock (unlike budget
--     adjustments or portfolio reassignment) - just who/when columns
--     directly on the row, matching the existing agreed_by/agreed_at
--     pattern. Lower-stakes than a financial change; a fuller
--     reason-logging trail would be a natural follow-up if this
--     capability gets used often enough to want a real history.
-- ============================================================

ALTER TABLE annual_plan DROP CONSTRAINT IF EXISTS annual_plan_status_check;

ALTER TABLE annual_plan
    ALTER COLUMN status DROP DEFAULT;

ALTER TABLE annual_plan
    ADD CONSTRAINT annual_plan_status_check CHECK (status IN ('draft', 'agreed', 'locked'));

ALTER TABLE annual_plan
    ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE annual_plan
    ADD COLUMN IF NOT EXISTS locked_by     UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS unlocked_by   UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS unlocked_at   TIMESTAMPTZ;

COMMENT ON COLUMN annual_plan.status IS 'draft (editable) -> agreed (non-draggable, committed) -> locked (formally final). Unlock reverts a locked plan all the way back to draft.';
