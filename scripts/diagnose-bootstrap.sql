-- ============================================================
-- diagnose-bootstrap.sql
--
-- The bootstrap insert matched 0 rows. Two possible causes:
--   1. The email doesn't exactly match what's stored (typo, casing,
--      different domain, leading/trailing space)
--   2. RLS is filtering app_user beyond just organization_id
-- This shows what's actually there so we know which.
-- ============================================================

SELECT set_config('app.current_org', '11111111-1111-1111-1111-111111111111', false);

-- Every user RLS currently lets this session see, in this org context
SELECT id, email, display_name, organization_id, is_active
FROM app_user
ORDER BY display_name;