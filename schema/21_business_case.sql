-- ============================================================
-- 21_business_case.sql
--
-- Links business_case back to the demand it came from, and deprecates
-- business_case_raci - the RACI was already named at demand promotion
-- (demand_raci), so requiring a SECOND naming step for the same 5 seats
-- at business-case stage would just be re-asking a question already
-- answered. Business Case detail reads RACI via the linked demand.
--
-- A business_case is created automatically the moment a demand's RACI
-- naming completes (see the updated /demands/:id/accept endpoint) - not
-- something a user creates by hand, since "promoted" IS "a business case
-- now exists for this."
-- ============================================================

ALTER TABLE business_case
    ADD COLUMN IF NOT EXISTS demand_id UUID UNIQUE REFERENCES demand(id);

COMMENT ON TABLE business_case_raci IS 'DEPRECATED as of 21_business_case.sql - RACI is named once, at demand promotion (demand_raci). Business Case reads RACI via business_case.demand_id, not a second table. Rows preserved for audit only.';

-- decision / decision_date already existed on business_case from the
-- original build - repurposed here as THIS stage's approval gate
-- (approved/declined the requested spend), distinct from the earlier
-- triage accept/reject decision on the demand itself. Two different
-- questions: "is this idea worth pursuing" (triage) vs "is this specific
-- spend approved" (business case decision).
