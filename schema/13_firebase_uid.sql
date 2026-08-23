-- ============================================================
-- 13_firebase_uid.sql
--
-- app_user was built for a generic RBAC model and has no column linking
-- a row to a Firebase identity. This adds one, so the auth middleware
-- can look up organization_id from a verified Firebase token.
--
-- Nullable for now since existing seed users have no real Firebase
-- accounts yet - each will need firebase_uid set once you actually
-- create matching accounts in Firebase Auth (console or sign-up flow).
-- ============================================================

ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS firebase_uid TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_app_user_firebase_uid ON app_user(firebase_uid);
