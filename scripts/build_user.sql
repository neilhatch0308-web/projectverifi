-- ============================================================
-- bootstrap-existing-user.sql
--
-- The row was already there all along - seeded with a placeholder
-- email/display_name ("admin@acme-holdings.example" / "System Admin")
-- but the correct firebase_uid. No need to create anything; just grant
-- the role. Optionally tidies the email/display_name to the real ones
-- while we're here, since "System Admin" showing up as your name
-- everywhere would be confusing.
-- ============================================================

SELECT set_config('app.current_org', '11111111-1111-1111-1111-111111111111', false);

UPDATE app_user
SET email = 'neil@we-verifi.co.uk',
    display_name = 'Neil Hatch'
WHERE firebase_uid = 'FKqBnQhNOETlPfxNTZ1Jlxayglv1';

INSERT INTO app_user_role (user_id, role_id, granted_by)
SELECT id, '34111111-0000-0000-0000-000000000005', id
FROM app_user
WHERE firebase_uid = 'FKqBnQhNOETlPfxNTZ1Jlxayglv1'
ON CONFLICT DO NOTHING;

-- Confirm:
SELECT u.id, u.display_name, u.email, r.name AS role
FROM app_user_role ur
JOIN app_user u ON u.id = ur.user_id
JOIN role r ON r.id = ur.role_id
WHERE u.firebase_uid = 'FKqBnQhNOETlPfxNTZ1Jlxayglv1';