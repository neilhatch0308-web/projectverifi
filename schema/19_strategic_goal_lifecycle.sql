-- ============================================================
-- 19_strategic_goal_lifecycle.sql
--
-- Adds a status lifecycle to strategic_goal: active -> suspended/completed,
-- suspended -> active/completed, completed is terminal. This is separate
-- from is_locked (which governs whether name/description/year can be
-- edited - they can't, once declared, per the framework's locking rule).
-- Status changes are lifecycle events, not edits to the declared goal
-- itself - the name and description stay exactly as declared even when
-- suspended or completed.
--
-- The existing 5-per-year cap trigger (enforce_strategic_goal_cap) is
-- UNCHANGED and deliberately counts all declared goals for a year
-- regardless of status - suspending a goal doesn't free up a slot.
-- Declaring is a one-time act capped at 5; suspending is not un-declaring.
-- ============================================================

ALTER TABLE strategic_goal
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'completed')),
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES app_user(id);
