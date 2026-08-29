-- ============================================================
-- 35_confidential_demand.sql
--
-- Confidentiality is a ROLE-GRANTED permission, not a separate per-user
-- checkbox - it slots into the same system as 34_roles_and_permissions.sql.
-- Every role's tick-list (Roles admin screen) gets one more option:
-- "View confidential demand." The Submitter baseline never has it and
-- can never be given it, by construction - it's a permission, and the
-- baseline isn't a role, it's the floor everyone stands on regardless
-- of role. A demand's own submitter can always see their own demand,
-- confidential or not - confidentiality hides it from OTHERS, not from
-- its author.
-- ============================================================

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS confidential BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN demand.confidential IS 'Set at raise by the submitter. Hidden from anyone who lacks demand.view_confidential, except the demand''s own raiser.';

INSERT INTO permission (key, label, description) VALUES
    ('demand.view_confidential', 'View confidential demand',
     'See demand marked confidential by its submitter, beyond their own. Not part of the Submitter baseline - must be granted via a role, on every role''s tick-list.')
ON CONFLICT (key) DO NOTHING;

-- Org Admin gets it by default, matching the "full access" intent
-- already seeded for that role. No other seeded role is auto-granted
-- this - confidentiality access should be a deliberate tick, not an
-- accidental side effect of an unrelated role like PMO or Finance.
INSERT INTO role_permission (role_id, permission_key)
VALUES ('34111111-0000-0000-0000-000000000005', 'demand.view_confidential')
ON CONFLICT DO NOTHING;
