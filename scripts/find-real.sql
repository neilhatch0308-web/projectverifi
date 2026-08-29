-- ============================================================
-- find-real-login.sql
--
-- The topbar shows whatever email you signed into Firebase with -
-- that's read straight from the client-side Firebase Auth session
-- (AppShell.tsx: {user?.email}), NOT from app_user.email. Your actual
-- app_user row is matched by firebase_uid, not email (see
-- resolve_app_user_by_firebase_uid in 14_auth_lookup_function.sql).
-- So the row wired to your real login might have a different, or even
-- placeholder, email in this table. This finds it by checking which
-- row(s) actually HAVE a firebase_uid set - the seed/placeholder
-- accounts never got one.
-- ============================================================

SELECT set_config('app.current_org', '11111111-1111-1111-1111-111111111111', false);

SELECT id, email, display_name, firebase_uid, is_active
FROM app_user
WHERE firebase_uid IS NOT NULL;