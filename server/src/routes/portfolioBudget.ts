import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

// ---------- Budgets for a financial year: Baseline / Current / Assigned ----------
// Every parent portfolio is listed, even ones with no budget row yet
// (baseline_amount/assigned_amount come back null) - the point is to
// make it obvious which portfolios still need a baseline set, not to
// hide them until someone remembers.
//
// "Current" is never stored - it's read live from whatever the latest
// annual plan version actually has committed to the budget column for
// that portfolio/year (annual_plan_totals). If planning moves, Current
// moves with it automatically; nothing here needs to keep it in sync.
router.get('/portfolio-budgets', requireAuth, requirePermission('budgets.manage'), async (req, res) => {
  const { organizationId } = req.user!;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  try {
    const budgets = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT p.id AS portfolio_id, p.name AS portfolio_name,
                pb.id AS portfolio_budget_id,
                pb.baseline_amount, pb.baseline_set_at,
                baseliner.display_name AS baseline_set_by_name,
                pb.assigned_amount, pb.assigned_set_at,
                assigner.display_name AS assigned_set_by_name,
                COALESCE(pt.discretionary_committed, 0) + COALESCE(pt.fixed_committed, 0) AS current_amount
         FROM portfolio p
         LEFT JOIN portfolio_budget pb ON pb.portfolio_id = p.id AND pb.financial_year = $1
         LEFT JOIN app_user baseliner ON baseliner.id = pb.baseline_set_by
         LEFT JOIN app_user assigner ON assigner.id = pb.assigned_set_by
         LEFT JOIN LATERAL (
           SELECT apt.discretionary_committed, apt.fixed_committed
           FROM annual_plan ap
           JOIN annual_plan_totals apt ON apt.plan_id = ap.id
           WHERE ap.portfolio_id = p.id AND ap.financial_year = $1
           ORDER BY ap.version DESC
           LIMIT 1
         ) pt ON true
         WHERE p.organization_id = $2 AND p.parent_portfolio_id IS NULL
         ORDER BY p.name`,
        [year, organizationId]
      );
      return result.rows;
    });

    res.json(budgets);
  } catch (err) {
    console.error('Failed to fetch portfolio budgets:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio budgets' });
  }
});

// ---------- Set the baseline - once, ever, per portfolio/year ----------
// The anchored-claim pattern applied to portfolio budgets: whatever's
// submitted here becomes permanent. Refuses outright if a baseline
// already exists for this portfolio/year - there's no update path for
// this field, by design. The frontend is expected to confirm with the
// person before calling this, since there's no undo.
const setBaselineSchema = z.object({
  portfolioId: looseUuid(),
  financialYear: z.number().int(),
  amount: z.number().min(0),
});

router.post('/portfolio-budgets/baseline', requireAuth, requirePermission('budgets.manage'), async (req, res) => {
  const parsed = setBaselineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { portfolioId, financialYear, amount } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(
        `SELECT id FROM portfolio_budget WHERE portfolio_id = $1 AND financial_year = $2`,
        [portfolioId, financialYear]
      );
      if (existing.rows.length > 0) return { alreadySet: true as const };

      // Assigned starts equal to baseline - the working figure only
      // diverges once a real adjustment happens.
      const budget = await client.query(
        `INSERT INTO portfolio_budget
           (id, organization_id, portfolio_id, financial_year,
            baseline_amount, baseline_set_by, baseline_set_at,
            assigned_amount, assigned_set_by, assigned_set_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), $4, $5, now())
         RETURNING id, portfolio_id, financial_year, baseline_amount, assigned_amount`,
        [organizationId, portfolioId, financialYear, amount, userId]
      );
      return { budget: budget.rows[0] };
    });

    if ('alreadySet' in result) {
      return res.status(409).json({ error: 'A baseline is already set for this portfolio and year - it cannot be changed. Adjust the assigned amount instead.' });
    }
    res.status(201).json(result.budget);
  } catch (err) {
    console.error('Failed to set baseline budget:', err);
    res.status(500).json({ error: 'Failed to set baseline budget' });
  }
});

// ---------- Adjust the assigned amount - the real working budget ----------
// Positive or negative, always requires a reason, always logged. This
// is the only figure that moves after baseline is set - a post-annual-
// planning business case adding funds, or a request to reduce overall
// spend, both just land here as an adjustment.
const adjustAssignedSchema = z.object({
  portfolioId: looseUuid(),
  financialYear: z.number().int(),
  amount: z.number().min(0),
  reason: z.string().min(1, 'A reason is required to adjust the assigned budget'),
});

router.patch('/portfolio-budgets/assigned', requireAuth, requirePermission('budgets.manage'), async (req, res) => {
  const parsed = adjustAssignedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { portfolioId, financialYear, amount, reason } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(
        `SELECT assigned_amount FROM portfolio_budget WHERE portfolio_id = $1 AND financial_year = $2`,
        [portfolioId, financialYear]
      );
      if (existing.rows.length === 0) return { noBaseline: true as const };

      const priorAmount = existing.rows[0].assigned_amount;

      const budget = await client.query(
        `UPDATE portfolio_budget SET assigned_amount = $1, assigned_set_by = $2, assigned_set_at = now()
         WHERE portfolio_id = $3 AND financial_year = $4
         RETURNING id, portfolio_id, financial_year, baseline_amount, assigned_amount`,
        [amount, userId, portfolioId, financialYear]
      );

      if (Number(priorAmount) !== amount) {
        await client.query(
          `INSERT INTO portfolio_budget_adjustment
             (id, organization_id, portfolio_id, financial_year, prior_amount, new_amount, reason, adjusted_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [organizationId, portfolioId, financialYear, priorAmount, amount, reason.trim(), userId]
        );
      }

      return { budget: budget.rows[0] };
    });

    if ('noBaseline' in result) {
      return res.status(409).json({ error: 'Set a baseline for this portfolio and year first' });
    }
    res.json(result.budget);
  } catch (err) {
    console.error('Failed to adjust assigned budget:', err);
    res.status(500).json({ error: 'Failed to adjust assigned budget' });
  }
});

// ---------- Adjustment history, optionally scoped to a year ----------
// year is optional here, deliberately - the history filter on the
// frontend needs to search across years, not just whichever one the
// budget table above happens to be showing.
router.get('/portfolio-budgets/adjustments', requireAuth, requirePermission('budgets.manage'), async (req, res) => {
  const { organizationId } = req.user!;
  const year = req.query.year ? Number(req.query.year) : null;

  try {
    const adjustments = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT a.id, a.prior_amount, a.new_amount, a.reason, a.adjusted_at,
                a.financial_year, a.portfolio_id,
                p.name AS portfolio_name,
                u.display_name AS adjusted_by_name
         FROM portfolio_budget_adjustment a
         JOIN portfolio p ON p.id = a.portfolio_id
         LEFT JOIN app_user u ON u.id = a.adjusted_by
         WHERE ($1::int IS NULL OR a.financial_year = $1)
         ORDER BY a.adjusted_at DESC`,
        [year]
      );
      return result.rows;
    });

    res.json(adjustments);
  } catch (err) {
    console.error('Failed to fetch budget adjustments:', err);
    res.status(500).json({ error: 'Failed to fetch budget adjustments' });
  }
});

// ---------- Transfer history, optionally scoped to a year - reads only ----------
// Cross-portfolio transfers are retired: "moving budget between
// portfolios isn't really a thing." No new transfers can be created -
// there is deliberately no POST endpoint for this anymore - but
// historical rows, if any exist, are never deleted and stay readable
// here for audit purposes. year is optional, same reasoning as above.
router.get('/portfolio-budgets/transfers', requireAuth, requirePermission('budgets.manage'), async (req, res) => {
  const { organizationId } = req.user!;
  const year = req.query.year ? Number(req.query.year) : null;

  try {
    const transfers = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT t.id, t.amount, t.reason, t.transferred_at, t.financial_year,
                t.from_portfolio_id, t.to_portfolio_id,
                fp.name AS from_portfolio_name, tp.name AS to_portfolio_name,
                d.title AS related_demand_title,
                u.display_name AS approved_by_name
         FROM portfolio_budget_transfer t
         JOIN portfolio fp ON fp.id = t.from_portfolio_id
         JOIN portfolio tp ON tp.id = t.to_portfolio_id
         LEFT JOIN demand d ON d.id = t.related_demand_id
         LEFT JOIN app_user u ON u.id = t.approved_by
         WHERE ($1::int IS NULL OR t.financial_year = $1)
         ORDER BY t.transferred_at DESC`,
        [year]
      );
      return result.rows;
    });

    res.json(transfers);
  } catch (err) {
    console.error('Failed to fetch budget transfers:', err);
    res.status(500).json({ error: 'Failed to fetch budget transfers' });
  }
});

export default router;