import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

// ---------- Portfolio report: average time in stage, average spend/benefit ----------
// Reads straight from portfolio_report() (migrations 60-61) - the route
// does no aggregation itself, the function is the single source of
// truth so a future second consumer (an export, a different page) gets
// the same numbers without re-deriving the joins.
//
// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD scope the report to demand
// raised in that window (both sides inclusive). Omit either or both
// for all-time. Validated as real dates before being passed through -
// an invalid date string reaching the function would surface as an
// opaque Postgres cast error instead of a clear 400.
//
// Gated the same as Portfolio Budgets (budgets.view/budgets.manage):
// this exposes averaged claimed/assessed/actual cost and benefit
// figures per portfolio, which is financial data of the same
// sensitivity as the budgets screen, even though it's read-only here.
router.get('/reporting/portfolio-report', requireAuth, requirePermission(['budgets.view', 'budgets.manage']), async (req, res) => {
  const { organizationId } = req.user!;

  const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional();
  const parsed = z.object({ from: dateSchema, to: dateSchema }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { from, to } = parsed.data;

  if (from && to && from > to) {
    return res.status(400).json({ error: '"from" must not be after "to"' });
  }

  try {
    const rows = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM portfolio_report($1, $2) ORDER BY portfolio_name`,
        [from ?? null, to ?? null]
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch portfolio report:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio report' });
  }
});

// ---------- Variance report: biggest gaps between claimed and actual ----------
// Reads from demand_variance_report (migration 62). Confidentiality is
// NOT filtered by the view - filtered here, same rule as every other
// confidential-demand read path: (confidential = false OR
// can_view_confidential_demand(demand_id, $userId)).
//
// Sorted by whichever dimension the caller asks for, defaulting to the
// worst miss in EITHER direction (cost or benefit) so a single bad
// benefit shortfall and a single bad cost overrun both surface without
// needing two separate default views.
router.get('/reporting/variance', requireAuth, requirePermission(['budgets.view', 'budgets.manage']), async (req, res) => {
  const { organizationId, userId } = req.user!;

  const sortSchema = z.enum(['cost', 'benefit', 'worst']).default('worst');
  const parsed = z.object({ sort: sortSchema }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const orderBy = {
    cost: 'ABS(cost_variance_pct) DESC NULLS LAST',
    benefit: 'ABS(benefit_variance_pct) DESC NULLS LAST',
    worst: 'GREATEST(ABS(COALESCE(cost_variance_pct, 0)), ABS(COALESCE(benefit_variance_pct, 0))) DESC',
  }[parsed.data.sort];

  try {
    const rows = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM demand_variance_report
          WHERE confidential = false OR can_view_confidential_demand(demand_id, $1)
          ORDER BY ${orderBy}`,
        [userId]
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch variance report:', err);
    res.status(500).json({ error: 'Failed to fetch variance report' });
  }
});

// ---------- Aging report: work currently sitting longer than usual ----------
// Reads from demand_stage_aging (migration 62). The view returns every
// currently-active demand regardless of baseline size; "flagged as
// stuck" is decided HERE (days over the portfolio's own average, with
// a minimum sample size before trusting that average at all) rather
// than baked into the view, so the threshold can be tuned without a
// migration. MIN_BASELINE_N=3 matches the same "don't judge against
// n=1" discipline used throughout this reporting work - a portfolio's
// very first demand through a stage has no real average to be over.
router.get('/reporting/aging', requireAuth, requirePermission(['budgets.view', 'budgets.manage']), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const MIN_BASELINE_N = 3;

  try {
    const rows = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT *,
                (days_in_current_stage - portfolio_avg_days) AS days_over_average,
                (n_baseline >= $2 AND days_in_current_stage > portfolio_avg_days) AS flagged
           FROM demand_stage_aging
          WHERE confidential = false OR can_view_confidential_demand(demand_id, $1)
          ORDER BY (days_in_current_stage - portfolio_avg_days) DESC NULLS LAST`,
        [userId, MIN_BASELINE_N]
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch aging report:', err);
    res.status(500).json({ error: 'Failed to fetch aging report' });
  }
});

export default router;
