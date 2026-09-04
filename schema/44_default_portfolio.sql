-- 44_default_portfolio.sql
--
-- A user's default portfolio for Annual Planning -- purely a UI
-- convenience (which view loads first), not an access-control change.
-- "All portfolios" always remains selectable regardless of this
-- setting; nothing here restricts what a user can see, only what
-- they land on.
--
-- Nullable and unset by default -- a user with no preference still
-- lands on "All portfolios", matching today's behaviour exactly.

BEGIN;

ALTER TABLE app_user
  ADD COLUMN default_portfolio_id UUID REFERENCES portfolio(id);

COMMENT ON COLUMN app_user.default_portfolio_id IS
  'Which portfolio Annual Planning opens to by default for this user. NULL means "All portfolios" (today''s existing default). Purely a UI convenience -- does not gate visibility or access.';

COMMIT;
