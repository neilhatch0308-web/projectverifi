-- ============================================================
-- 14_auth_lookup_function.sql
--
-- Fixes a chicken-and-egg problem created by 12_row_level_security.sql:
-- the auth middleware's very first query (find organization_id for a
-- given firebase_uid) has to run BEFORE the app knows what org to set
-- app.current_org to - but FORCE ROW LEVEL SECURITY now blocks that
-- query too, same as everything else. On Cloud SQL, the 'postgres'
-- connection is NOT a true RLS-bypassing superuser, so it's caught by
-- this same wall.
--
-- Fix: one narrow, deliberate hole. A dedicated role with BYPASSRLS
-- owns a SECURITY DEFINER function that does ONLY this one lookup -
-- nothing else in the app gets broader access. Every other query still
-- goes through the normal RLS-scoped path.
-- ============================================================

-- A role that exists only to own the lookup function below. It is
-- NOLOGIN - nothing ever connects AS this role directly, so it can't be
-- used to run arbitrary queries even if compromised; it only matters as
-- the function's execution identity.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_auth_resolver') THEN
        CREATE ROLE ledger_auth_resolver NOLOGIN BYPASSRLS;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION resolve_app_user_by_firebase_uid(p_firebase_uid TEXT)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    display_name TEXT,
    email TEXT,
    is_active BOOLEAN
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT au.id, au.organization_id, au.display_name, au.email, au.is_active
    FROM app_user au
    WHERE au.firebase_uid = p_firebase_uid;
END;
$$;

ALTER FUNCTION resolve_app_user_by_firebase_uid(TEXT) OWNER TO ledger_auth_resolver;

-- The role the app actually connects as needs permission to CALL this
-- function (not to bypass RLS itself - it's borrowing the function's
-- privileged execution just for this one lookup).
GRANT EXECUTE ON FUNCTION resolve_app_user_by_firebase_uid(TEXT) TO postgres;
-- When you switch the app to a non-superuser connection role later
-- (ledger_app, per SETUP_GUIDE.md), grant it here too:
-- GRANT EXECUTE ON FUNCTION resolve_app_user_by_firebase_uid(TEXT) TO ledger_app;