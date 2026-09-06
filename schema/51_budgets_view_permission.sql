-- 51_budgets_view_permission.sql
--
-- Same split as migration 50 (planning.view): budgets.manage was the
-- only gate on Portfolio Budgets at all -- holding it meant you could
-- both see figures AND set baseline/adjust assigned amounts, with no
-- narrower option. A finance stakeholder or auditor who should see
-- budget commitments but not change them had no role short of full
-- budgets.manage.
--
-- Both permissions can see the page; only budgets.manage can act on
-- it. Existing roles holding budgets.manage are unaffected.

INSERT INTO permission (key, label, description) VALUES
    ('budgets.view', 'View Portfolio Budgets', 'See portfolio budget figures, adjustment history, and historical transfers. Cannot set a baseline or adjust an assigned amount.')
ON CONFLICT (key) DO NOTHING;
