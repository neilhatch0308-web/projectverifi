-- ============================================================
-- 39_assigned_assessor.sql
--
-- Adds a forward-looking task assignment: WHO should run the P75
-- assessment for this demand, tagged at triage (or reassignable
-- later), distinct from demand_assessment.assessor_capacity/detail
-- which describes who actually DID it, captured retrospectively once
-- the assessment is submitted.
--
-- Nullable by design - tagging a specific assessor is optional. When
-- unset, the task is visible to anyone holding demand.assess as a
-- role-wide item, same as triage is today. When set, it becomes a
-- personal task for that named person specifically (see /me/actions).
--
-- No dedicated audit table for this - unlike portfolio/budget
-- reassignment, this is a lightweight task tag, not a governance-
-- relevant structural change. Matches how RACI/sponsor selection also
-- isn't separately audited beyond the record itself.
-- ============================================================

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS assigned_assessor_id UUID REFERENCES app_user(id);

COMMENT ON COLUMN demand.assigned_assessor_id IS 'Who should run the P75 assessment - optional, tagged at triage or reassigned later. NULL means open to anyone with demand.assess.';
