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

// ---------- Commitment report: approved spend vs actual, by portfolio ----------
// Reads from commitment_report() (migration 64) - the fourth sibling
// to Portfolio/Variance/Aging, same "derive rather than duplicate"
// instinct. Answers "how much of what we've approved to spend has
// actually gone out the door", which previously only existed
// per-business-case on Business Case Detail, never rolled up.
//
// No sort param here - the route always orders by the worst absolute
// variance percentage first (either direction: biggest unspent
// exposure or biggest in-flight overrun), since that's the triage
// order a finance reader actually wants; the UI can re-sort client-side
// if a specific ordering is ever needed.
router.get('/reporting/commitment', requireAuth, requirePermission(['budgets.view', 'budgets.manage']), async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const rows = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM commitment_report()
          ORDER BY ABS(COALESCE(variance_pct, 0)) DESC`
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch commitment report:', err);
    res.status(500).json({ error: 'Failed to fetch commitment report' });
  }
});

// ---------- Commitment report drill-down: individual business cases ----------
// Reads from business_case_commitment (migration 64). Confidentiality
// is NOT filtered by the view - filtered here, same rule as every
// other confidential-demand read path in this file.
//
// Optional ?portfolioId= scopes to the cases behind a single
// portfolio's rollup row, for the drill-down link from the aggregate
// table above - omit it for the full worst-first list across every
// portfolio.
router.get('/reporting/commitment/cases', requireAuth, requirePermission(['budgets.view', 'budgets.manage']), async (req, res) => {
  const { organizationId, userId } = req.user!;

  const parsed = z.object({ portfolioId: z.string().uuid().optional() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { portfolioId } = parsed.data;

  try {
    const rows = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM business_case_commitment
          WHERE (confidential = false OR can_view_confidential_demand(demand_id, $1))
            AND ($2::UUID IS NULL OR portfolio_id = $2)
          ORDER BY ABS(COALESCE(variance_pct, 0)) DESC`,
        [userId, portfolioId ?? null]
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch commitment case list:', err);
    res.status(500).json({ error: 'Failed to fetch commitment case list' });
  }
});

// ---------- My Portfolio: composed pipeline-health dashboard ----------
// Not gated on budgets.view/budgets.manage as a whole - stage counts,
// dependency-blocked items, and coming-up are ordinary demand
// visibility, same as All Demand or My Home, and are returned to any
// caller. Two pieces ARE gated on budgets.view/budgets.manage,
// checked once as `canViewSpend`: the commitment footer (financial),
// and the aging-derived half of "needs attention" - Aging Report
// itself already requires this permission for the exact same
// underlying data (demand_stage_aging), so exposing it here without
// the same check would have been a second, ungated door to data the
// app already decided was sensitive. A caller without the permission
// still gets a real dashboard - stage counts, dependency blockers,
// coming-up - just without the aging list or the spend figure.
//
// Composes four existing sources into one response, deliberately - a
// dashboard that fires four separate requests on load is four places
// to show a half-loaded screen. Nothing here is a new figure: stage
// counts are a plain GROUP BY on demand.status, "needs attention"
// reuses demand_stage_aging (migration 62) plus a same-shaped
// dependency-blocked query, "coming up" reads target_start_year/
// quarter (migration 42), and commitment reuses commitment_report()
// (migration 64) filtered to one portfolio.
//
// "Blocked" (needsAttention kind=blocked) is NOT the full cross-
// portfolio dependency rollup discussed separately - it's a narrow
// slice scoped to this endpoint: does this portfolio's active demand
// depend on something that hasn't reached benefit_realized_at yet.
// Confidentiality is checked per-demand on both sides of a dependency
// link, same discipline as every other confidential-demand read path.
// Unlike the aging half, dependency-blocked status isn't gated on
// budgets.view - it's a scheduling/delivery fact, not a financial one,
// and nothing elsewhere in the app treats dependency links as
// permission-restricted (planning.edit gates creating/removing a link,
// not viewing one).
router.get('/reporting/my-portfolio', requireAuth, async (req, res) => {
  const { organizationId, userId, permissions } = req.user!;
  const canViewSpend = permissions.includes('budgets.view') || permissions.includes('budgets.manage');

  const parsed = z.object({ portfolioId: z.string().uuid() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { portfolioId } = parsed.data;

  try {
    const data = await withTenantContext(organizationId, async (client) => {
      const portfolioResult = await client.query(`SELECT id, name FROM portfolio WHERE id = $1`, [portfolioId]);
      if (portfolioResult.rows.length === 0) return null;
      const portfolio = portfolioResult.rows[0];

      const stageCountsResult = await client.query(
        `SELECT
            COUNT(*) FILTER (WHERE d.status = 'raised') AS raised,
            COUNT(*) FILTER (WHERE d.status = 'accepted') AS accepted,
            COUNT(*) FILTER (WHERE d.status = 'assessed') AS assessed,
            COUNT(*) FILTER (WHERE d.status = 'promoted' AND (bc.decision IS NULL OR bc.decision = 'pending')) AS awaiting_decision,
            COUNT(*) FILTER (WHERE d.status = 'promoted' AND bc.decision = 'approved' AND dd.delivery_started_at IS NOT NULL AND dd.delivery_completed_at IS NULL) AS in_delivery
           FROM demand d
           LEFT JOIN business_case bc ON bc.demand_id = d.id
           LEFT JOIN demand_delivery dd ON dd.demand_id = d.id
          WHERE d.portfolio_id = $1 AND d.stopped_at IS NULL
            AND (d.confidential = false OR can_view_confidential_demand(d.id, $2))`,
        [portfolioId, userId]
      );

      // Aging-derived data is only queried when the caller holds
      // budgets.view/budgets.manage - Aging Report itself is gated on
      // this same permission, and demand_stage_aging is its underlying
      // source. Not querying it at all for a caller without the
      // permission (rather than fetching and discarding) means the
      // data never leaves the database for someone who shouldn't see
      // it, not just never leaves the response.
      const agingResult = canViewSpend
        ? await client.query(
            `SELECT demand_id, title, current_stage, days_in_current_stage, portfolio_avg_days, n_baseline
               FROM demand_stage_aging
              WHERE portfolio_id = $1
                AND (confidential = false OR can_view_confidential_demand(demand_id, $2))
                AND n_baseline >= 3 AND days_in_current_stage > portfolio_avg_days
              ORDER BY (days_in_current_stage - portfolio_avg_days) DESC
              LIMIT 6`,
            [portfolioId, userId]
          )
        : { rows: [] as { demand_id: string; title: string; current_stage: string; days_in_current_stage: number; portfolio_avg_days: number; n_baseline: number }[] };

      const blockedResult = await client.query(
        `SELECT d.id AS demand_id, d.title, dep_d.id AS blocking_demand_id, dep_d.title AS blocking_title
           FROM demand d
           JOIN demand_dependency dep ON dep.demand_id = d.id
           JOIN demand dep_d ON dep_d.id = dep.depends_on_id
           LEFT JOIN demand_delivery dep_dd ON dep_dd.demand_id = dep_d.id
          WHERE d.portfolio_id = $1 AND d.stopped_at IS NULL AND dep_d.stopped_at IS NULL
            AND dep_dd.benefit_realized_at IS NULL
            AND (d.confidential = false OR can_view_confidential_demand(d.id, $2))
            AND (dep_d.confidential = false OR can_view_confidential_demand(dep_d.id, $2))
          LIMIT 6`,
        [portfolioId, userId]
      );

      const comingUpResult = await client.query(
        `SELECT d.id AS demand_id, d.title, d.target_start_year, d.target_start_quarter
           FROM demand d
           LEFT JOIN demand_delivery dd ON dd.demand_id = d.id
          WHERE d.portfolio_id = $1 AND d.stopped_at IS NULL AND d.target_start_year IS NOT NULL
            AND (dd.demand_id IS NULL OR dd.delivery_completed_at IS NULL)
            AND (d.confidential = false OR can_view_confidential_demand(d.id, $2))
          ORDER BY d.target_start_year, COALESCE(d.target_start_quarter, 1)
          LIMIT 4`,
        [portfolioId, userId]
      );

      let commitment = null;
      if (canViewSpend) {
        const commitmentResult = await client.query(
          `SELECT total_approved, total_actual, variance_amount, n_overrun FROM commitment_report() WHERE portfolio_id = $1`,
          [portfolioId]
        );
        commitment = commitmentResult.rows[0] ?? { total_approved: 0, total_actual: 0, variance_amount: 0, n_overrun: 0 };
      }

      const needsAttention = [
        ...agingResult.rows.map((r) => ({ kind: 'aging' as const, ...r })),
        ...blockedResult.rows.map((r) => ({ kind: 'blocked' as const, ...r })),
      ].slice(0, 6);

      return {
        portfolio,
        stageCounts: stageCountsResult.rows[0],
        needsAttention,
        comingUp: comingUpResult.rows,
        commitment,
      };
    });

    if (data === null) return res.status(404).json({ error: 'Portfolio not found' });
    res.json(data);
  } catch (err) {
    console.error('Failed to fetch my-portfolio dashboard:', err);
    res.status(500).json({ error: 'Failed to fetch my-portfolio dashboard' });
  }
});

export default router;