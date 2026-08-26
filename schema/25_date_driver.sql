-- ============================================================
-- 25_date_driver.sql
--
-- Phase 1 of the v0.7 direction: makes need_by_date meaningful by
-- recording WHY the date matters.
--
-- A demand with a hard external driver (regulation, audit finding,
-- contractual commitment, product launch) is FIXED - not genuinely a
-- candidate for deferral at annual planning, and it consumes the budget
-- envelope before any discretionary choosing begins. Everything else is
-- DISCRETIONARY, and that's where real planning happens.
--
-- Deliberately captured at RAISE, by the conceiver, rather than later -
-- the person raising it knows whether a regulator or a launch date is
-- driving it. Adding this field later would mean backfilling every
-- demand raised in the meantime.
--
-- This also effectively answers open question #7 from v0.4 (how to
-- handle non-discretionary spend that maps to no strategic goal):
-- such work is identified by its date driver, not by needing a special
-- flag-exemption class.
--
-- 'none' is the default and is a legitimate answer - most demand has no
-- external driver at all. Nullable rather than NOT NULL so existing rows
-- aren't forced into a false value; the app treats NULL and 'none' the
-- same way.
-- ============================================================

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS date_driver_type TEXT
        CHECK (date_driver_type IN ('regulatory', 'audit_finding', 'contractual', 'product_launch', 'none')),
    ADD COLUMN IF NOT EXISTS date_driver_detail TEXT;

COMMENT ON COLUMN demand.date_driver_type IS 'Why need_by_date matters. Anything other than none/NULL makes this demand FIXED for annual planning purposes.';
COMMENT ON COLUMN demand.date_driver_detail IS 'Free text naming the specific obligation - which regulation, which audit finding, which launch. Required by the app layer when date_driver_type is set to anything other than none.';

CREATE INDEX IF NOT EXISTS idx_demand_date_driver ON demand(date_driver_type) WHERE date_driver_type IS NOT NULL AND date_driver_type <> 'none';
