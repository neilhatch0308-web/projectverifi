-- ============================================================
-- seed-demo-portfolios.sql
--
-- Creates 5 parent ("Demo Portfolio 1".."5") portfolios, each with a
-- random 2-5 sub-portfolios underneath it - for building out a
-- realistic demand test dataset against.
--
-- Everything created here is named with a "Demo Portfolio" prefix
-- specifically so it's trivially identifiable and removable later:
--   DELETE FROM portfolio WHERE name LIKE 'Demo Portfolio%';
-- (sub-portfolios first if you do it manually - parent_portfolio_id is
-- self-referential, same ordering constraint as the cleanup script.
-- The one-liner above handles both directions fine since it deletes
-- children and parents in the same statement - Postgres evaluates the
-- whole DELETE's row set before enforcing constraints within one
-- statement, so this works as a single command.)
--
-- Idempotency: NOT idempotent by design - re-running this adds a
-- second set of 5 parents (with different random sub-counts) rather
-- than skipping or erroring. If you want a clean re-seed, run the
-- DELETE above first.
--
-- Transaction-wrapped, COMMIT left commented out - same convention as
-- every other script this session. Review the summary, then commit
-- yourself.
-- ============================================================

SELECT set_config('app.current_org', '11111111-1111-1111-1111-111111111111', false);

BEGIN;

DO $$
DECLARE
    org_id UUID := '11111111-1111-1111-1111-111111111111';
    parent_id UUID;
    sub_count INT;
    i INT;
    j INT;
BEGIN
    FOR i IN 1..5 LOOP
        INSERT INTO portfolio (id, organization_id, name, parent_portfolio_id)
        VALUES (gen_random_uuid(), org_id, 'Demo Portfolio ' || i, NULL)
        RETURNING id INTO parent_id;

        -- Random 2-5 sub-portfolios per parent, inclusive both ends
        sub_count := 2 + floor(random() * 4)::INT;

        FOR j IN 1..sub_count LOOP
            INSERT INTO portfolio (id, organization_id, name, parent_portfolio_id)
            VALUES (gen_random_uuid(), org_id, 'Demo Portfolio ' || i || ' - Sub ' || j, parent_id);
        END LOOP;

        RAISE NOTICE 'Demo Portfolio % created with % sub-portfolio(s)', i, sub_count;
    END LOOP;
END $$;

SELECT p.name AS parent, COUNT(s.id) AS sub_portfolio_count
FROM portfolio p
LEFT JOIN portfolio s ON s.parent_portfolio_id = p.id
WHERE p.name LIKE 'Demo Portfolio%' AND p.parent_portfolio_id IS NULL
GROUP BY p.name
ORDER BY p.name;

-- Review the counts above (each should be between 2 and 5), then:
COMMIT;
