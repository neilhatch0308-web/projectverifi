-- 50_planning_view_permission.sql
--
-- Splits Annual Planning into view and edit. Previously planning.edit
-- was the only gate on the page at all -- holding it meant you could
-- both see the board AND drag/lock/agree it, with no way to grant
-- just the former. A role that should see budget commitments (an
-- auditor, a finance stakeholder, a portfolio lead who doesn't run
-- planning themselves) had no option short of planning.edit, which
-- also handed them the ability to change things.
--
-- Both permissions can see the board; only planning.edit can act on
-- it. Existing roles that already hold planning.edit are unaffected --
-- this only adds a narrower option alongside it, nothing is removed
-- or renamed.

INSERT INTO permission (key, label, description) VALUES
    ('planning.view', 'View Annual Planning', 'See the Annual Planning board and history. Cannot move demand, lock/unlock, agree a plan, or start a mid-year revision.')
ON CONFLICT (key) DO NOTHING;
