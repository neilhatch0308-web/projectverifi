import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

// ---------- Get the current (latest) plan for a portfolio/year, creating
// a fresh draft if none exists yet ----------
router.get('/annual-plans/current', requireAuth, requirePermission(['planning.view', 'planning.edit']), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const portfolioId = req.query.portfolioId as string;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  if (!portfolioId) return res.status(400).json({ error: 'portfolioId is required' });

  try {
    const plan = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(
        `SELECT id, portfolio_id, financial_year, version, status, agreed_at
         FROM annual_plan
         WHERE portfolio_id = $1 AND financial_year = $2
         ORDER BY version DESC LIMIT 1`,
        [portfolioId, year]
      );

      if (existing.rows.length > 0) return existing.rows[0];

      // No plan exists yet for this portfolio/year at all - create the
      // first draft automatically, since there's nothing to choose between.
      const created = await client.query(
        `INSERT INTO annual_plan (id, organization_id, portfolio_id, financial_year, version, status, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, 'draft', $4)
         RETURNING id, portfolio_id, financial_year, version, status, agreed_at`,
        [organizationId, portfolioId, year, userId]
      );
      return created.rows[0];
    });

    res.json(plan);
  } catch (err) {
    console.error('Failed to get or create annual plan:', err);
    res.status(500).json({ error: 'Failed to get or create annual plan' });
  }
});

// ---------- Full board: envelope, totals, and demand grouped by column ----------
router.get('/annual-plans/:id/board', requireAuth, requirePermission(['planning.view', 'planning.edit']), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const planResult = await client.query(
        `SELECT p.id, p.portfolio_id, po.name AS portfolio_name, p.financial_year,
                p.version, p.status, p.created_at, p.agreed_at,
                p.locked_at, p.unlocked_at,
                creator.display_name AS created_by_name,
                agreer.display_name AS agreed_by_name,
                locker.display_name AS locked_by_name,
                unlocker.display_name AS unlocked_by_name
         FROM annual_plan p
         JOIN portfolio po ON po.id = p.portfolio_id
         LEFT JOIN app_user creator ON creator.id = p.created_by
         LEFT JOIN app_user agreer ON agreer.id = p.agreed_by
         LEFT JOIN app_user locker ON locker.id = p.locked_by
         LEFT JOIN app_user unlocker ON unlocker.id = p.unlocked_by
         WHERE p.id = $1`,
        [id]
      );
      const plan = planResult.rows[0];
      if (!plan) return null;

      const totalsResult = await client.query(
        `SELECT budget_item_count, deferred_item_count, discretionary_committed,
                fixed_committed, avg_weighted_score, deferred_fixed_breach_count
         FROM annual_plan_totals WHERE plan_id = $1`,
        [id]
      );
      const totals = totalsResult.rows[0] ?? {
        budget_item_count: 0, deferred_item_count: 0, discretionary_committed: 0,
        fixed_committed: 0, avg_weighted_score: 0, deferred_fixed_breach_count: 0,
      };

      const envelopeResult = await client.query(
        `SELECT allocated_amount, effective_amount FROM portfolio_effective_budget
         WHERE portfolio_id = $1 AND financial_year = $2`,
        [plan.portfolio_id, plan.financial_year]
      );
      const envelope = envelopeResult.rows[0] ?? { allocated_amount: 0, effective_amount: 0 };

      // Current financial year, computed identically to the client's own
      // horizon-year picker (RaiseDemand.tsx: UK fiscal year, April-start)
      // so "no target year set" resolves to the same year everywhere in
      // the app, not a second, subtly different definition.
      const now = new Date();
      const currentFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

      // Eligible demand: assessed status, delivered by a sub-portfolio of
      // THIS parent, or still uncategorised but raised in THIS parent -
      // AND due in the year this specific plan covers.
      //
      // Year matching:
      //   - A demand with a target year set only belongs to the plan(s)
      //     covering that year (target_start_year..target_end_year,
      //     inclusive - end defaults to start for a single-year/quarter
      //     span). It no longer shows on every year's board regardless
      //     of when it's actually needed.
      //   - A demand with NO target year set falls back to the CURRENT
      //     financial year's plan only - not every plan either.
      //   - Either way, a demand ALREADY PLACED on THIS plan (has an
      //     annual_plan_item row here) never disappears just because its
      //     target year was reassigned afterward - same principle this
      //     schema already applies to portfolio reassignment on a
      //     Locked/Agreed plan (surface the discrepancy, never silently
      //     drop a committed placement).
      const demandResult = await client.query(
        `SELECT d.id, d.title, d.date_driver_type, d.date_driver_detail, d.confidential,
                d.complexity_tier, COALESCE(a.assessed_cost, d.claimed_cost) AS cost,
                COALESCE(dpv.weighted_score, 0) AS weighted_score,
                pi.column_placement, pi.reason AS deferred_reason,
                sub.name AS sub_portfolio_name,
                d.target_start_year, d.target_end_year
         FROM demand d
         LEFT JOIN demand_assessment a ON a.demand_id = d.id
         LEFT JOIN demand_priority_view dpv ON dpv.demand_id = d.id
         LEFT JOIN annual_plan_item pi ON pi.demand_id = d.id AND pi.plan_id = $1
         LEFT JOIN portfolio sub ON sub.id = d.delivering_sub_portfolio_id
         WHERE d.status = 'assessed'
           AND (
             sub.parent_portfolio_id = $2
             OR (d.delivering_sub_portfolio_id IS NULL AND d.portfolio_id = $2)
           )
           AND (d.confidential = false OR can_view_confidential_demand(d.id, $3))
           AND (
             pi.plan_id IS NOT NULL
             OR (d.target_start_year IS NOT NULL AND $4 BETWEEN d.target_start_year AND COALESCE(d.target_end_year, d.target_start_year))
             OR (d.target_start_year IS NULL AND $4 = $5)
           )
         ORDER BY d.date_driver_type IS NULL OR d.date_driver_type = 'none', dpv.weighted_score DESC NULLS LAST`,
        [id, plan.portfolio_id, userId, plan.financial_year, currentFY]
      );

      const all = demandResult.rows.filter((r) => !r.column_placement);
      const budget = demandResult.rows.filter((r) => r.column_placement === 'budget');
      const deferred = demandResult.rows.filter((r) => r.column_placement === 'deferred');

      return { plan, totals, envelope, columns: { all, budget, deferred } };
    });

    if (!result) return res.status(404).json({ error: 'Plan not found' });
    res.json(result);
  } catch (err) {
    console.error('Failed to load plan board:', err);
    res.status(500).json({ error: 'Failed to load plan board' });
  }
});

// ---------- Move a demand into Budget or Deferred ----------
const placeItemSchema = z.object({
  demandId: looseUuid(),
  columnPlacement: z.enum(['budget', 'deferred']),
  reason: z.string().optional(),
});

router.post('/annual-plans/:id/items', requireAuth, requirePermission('planning.edit'), async (req, res) => {
  const parsed = placeItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { demandId, columnPlacement, reason } = parsed.data;

  if (columnPlacement === 'deferred' && !reason) {
    return res.status(400).json({ error: 'A reason is required when deferring a demand' });
  }

  try {
    const planCheck = await withTenantContext(organizationId, async (client) => {
      const plan = await client.query(`SELECT status FROM annual_plan WHERE id = $1`, [id]);
      if (plan.rows.length === 0) return { notFound: true as const };
      if (plan.rows[0].status !== 'draft') return { locked: true as const };

      // The board read already filters confidential demand out - a
      // planning.edit holder shouldn't be able to move a demandId they
      // can't see by supplying it directly instead of dragging a card.
      const visible = await client.query(
        `SELECT (confidential = false OR can_view_confidential_demand(id, $2)) AS can_view
           FROM demand WHERE id = $1`,
        [demandId, userId]
      );
      if (!visible.rows[0] || !visible.rows[0].can_view) return { notFound: true as const };

      await client.query(
        `INSERT INTO annual_plan_item (id, plan_id, demand_id, column_placement, reason, moved_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
         ON CONFLICT (plan_id, demand_id)
         DO UPDATE SET column_placement = EXCLUDED.column_placement, reason = EXCLUDED.reason,
                        moved_by = EXCLUDED.moved_by, moved_at = now()`,
        [id, demandId, columnPlacement, reason ?? null, userId]
      );
      return { ok: true as const };
    });

    if ('notFound' in planCheck) return res.status(404).json({ error: 'Plan not found' });
    if ('locked' in planCheck) return res.status(409).json({ error: 'This plan is agreed and locked - create a revision to make changes' });

    res.status(200).json({ moved: true });
  } catch (err) {
    console.error('Failed to place item:', err);
    res.status(500).json({ error: 'Failed to place item' });
  }
});

// ---------- Move a demand back to All (remove its placement) ----------
router.delete('/annual-plans/:id/items/:demandId', requireAuth, requirePermission('planning.edit'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id, demandId } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const plan = await client.query(`SELECT status FROM annual_plan WHERE id = $1`, [id]);
      if (plan.rows.length === 0) return { notFound: true as const };
      if (plan.rows[0].status !== 'draft') return { locked: true as const };

      const visible = await client.query(
        `SELECT (confidential = false OR can_view_confidential_demand(id, $2)) AS can_view
           FROM demand WHERE id = $1`,
        [demandId, userId]
      );
      if (!visible.rows[0] || !visible.rows[0].can_view) return { notFound: true as const };

      await client.query(`DELETE FROM annual_plan_item WHERE plan_id = $1 AND demand_id = $2`, [id, demandId]);
      return { ok: true as const };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Plan not found' });
    if ('locked' in result) return res.status(409).json({ error: 'This plan is agreed and locked' });

    res.status(200).json({ removed: true });
  } catch (err) {
    console.error('Failed to remove item:', err);
    res.status(500).json({ error: 'Failed to remove item' });
  }
});

// ---------- Lock the plan - a light, reversible checkpoint ----------
// Stops cards being draggable while a plan is reviewed for sign-off.
// Deliberately NOT the final commitment - Unlock (below) reverses this
// freely. The heavy, one-way-except-via-revision step is Agree, further
// down, not this one.
router.post('/annual-plans/:id/lock', requireAuth, requirePermission('planning.edit'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE annual_plan SET status = 'locked', locked_by = $1, locked_at = now()
         WHERE id = $2 AND status = 'draft'
         RETURNING id, status, locked_at`,
        [userId, id]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(409).json({ error: 'Only a draft plan can be locked' });
    res.json(updated);
  } catch (err) {
    console.error('Failed to lock plan:', err);
    res.status(500).json({ error: 'Failed to lock plan' });
  }
});

// ---------- Unlock - reverses Lock, back to fully editable draft ----------
// Easy, low-friction - draft and locked are meant to be freely
// toggled while a plan is still being worked on. Distinct from Agree
// below, which is the genuinely final step.
router.post('/annual-plans/:id/unlock', requireAuth, requirePermission('planning.edit'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const plan = await client.query(
        `SELECT portfolio_id, financial_year, status FROM annual_plan WHERE id = $1`, [id]
      );
      if (plan.rows.length === 0) return { notFound: true as const };
      if (plan.rows[0].status !== 'locked') return { wrongStatus: true as const };

      const existingDraft = await client.query(
        `SELECT id FROM annual_plan WHERE portfolio_id = $1 AND financial_year = $2 AND status = 'draft' AND id <> $3`,
        [plan.rows[0].portfolio_id, plan.rows[0].financial_year, id]
      );
      if (existingDraft.rows.length > 0) return { draftExists: true as const };

      const updated = await client.query(
        `UPDATE annual_plan SET status = 'draft', unlocked_by = $1, unlocked_at = now()
         WHERE id = $2
         RETURNING id, status, unlocked_at`,
        [userId, id]
      );
      return { updated: updated.rows[0] };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Plan not found' });
    if ('wrongStatus' in result) return res.status(409).json({ error: 'Only a locked plan can be unlocked' });
    if ('draftExists' in result) {
      return res.status(409).json({ error: 'A newer draft already exists for this portfolio and year - resolve that first' });
    }
    res.json(result.updated);
  } catch (err) {
    console.error('Failed to unlock plan:', err);
    res.status(500).json({ error: 'Failed to unlock plan' });
  }
});

// ---------- Agree the plan - the genuinely final commitment ----------
// Only reachable from Locked, never directly from Draft - a plan has
// to have passed through the reversible checkpoint first. There is
// deliberately NO unlock/un-agree from here: once agreed, the only way
// forward is "start mid-year revision" below, which creates a new
// draft version and leaves this one permanently intact for comparison.
router.post('/annual-plans/:id/agree', requireAuth, requirePermission('planning.edit'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE annual_plan SET status = 'agreed', agreed_by = $1, agreed_at = now()
         WHERE id = $2 AND status = 'locked'
         RETURNING id, status, agreed_at`,
        [userId, id]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(409).json({ error: 'Only a locked plan can be agreed' });
    res.json(updated);
  } catch (err) {
    console.error('Failed to agree plan:', err);
    res.status(500).json({ error: 'Failed to agree plan' });
  }
});

// ---------- Create a revision: a new draft cloning the agreed plan's placements ----------
// "The year as a large Sprint" - a mid-year review doesn't edit the
// agreed original, it creates a new version. The original stays exactly
// as agreed, for comparison.
router.post('/annual-plans/:id/revise', requireAuth, requirePermission('planning.edit'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const source = await client.query(
        `SELECT portfolio_id, financial_year, version, status FROM annual_plan WHERE id = $1`,
        [id]
      );
      if (source.rows.length === 0) return { notFound: true as const };
      if (source.rows[0].status !== 'agreed') return { notAgreed: true as const };

      const { portfolio_id, financial_year, version } = source.rows[0];

      const existingDraft = await client.query(
        `SELECT id FROM annual_plan WHERE portfolio_id = $1 AND financial_year = $2 AND status = 'draft'`,
        [portfolio_id, financial_year]
      );
      if (existingDraft.rows.length > 0) return { alreadyDraft: true as const, planId: existingDraft.rows[0].id };

      const newPlan = await client.query(
        `INSERT INTO annual_plan (id, organization_id, portfolio_id, financial_year, version, status, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'draft', $5)
         RETURNING id`,
        [organizationId, portfolio_id, financial_year, version + 1, userId]
      );
      const newPlanId = newPlan.rows[0].id;

      await client.query(
        `INSERT INTO annual_plan_item (id, plan_id, demand_id, column_placement, reason, moved_by)
         SELECT gen_random_uuid(), $1, demand_id, column_placement, reason, $2
         FROM annual_plan_item WHERE plan_id = $3`,
        [newPlanId, userId, id]
      );

      await client.query(`UPDATE annual_plan SET superseded_by = $1 WHERE id = $2`, [newPlanId, id]);

      return { planId: newPlanId as string };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Plan not found' });
    if ('notAgreed' in result) return res.status(409).json({ error: 'Only an agreed plan can be revised' });
    if ('alreadyDraft' in result) return res.json({ planId: result.planId, alreadyExisted: true });

    res.status(201).json({ planId: result.planId });
  } catch (err) {
    console.error('Failed to create plan revision:', err);
    res.status(500).json({ error: 'Failed to create plan revision' });
  }
});

// ---------- Version history for a portfolio/year ----------
router.get('/annual-plans/history', requireAuth, requirePermission(['planning.view', 'planning.edit']), async (req, res) => {
  const { organizationId } = req.user!;
  const portfolioId = req.query.portfolioId as string;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  try {
    const history = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT p.id, p.version, p.status, p.created_at, p.agreed_at,
                creator.display_name AS created_by_name, agreer.display_name AS agreed_by_name
         FROM annual_plan p
         LEFT JOIN app_user creator ON creator.id = p.created_by
         LEFT JOIN app_user agreer ON agreer.id = p.agreed_by
         WHERE p.portfolio_id = $1 AND p.financial_year = $2
         ORDER BY p.version DESC`,
        [portfolioId, year]
      );
      return result.rows;
    });

    res.json(history);
  } catch (err) {
    console.error('Failed to fetch plan history:', err);
    res.status(500).json({ error: 'Failed to fetch plan history' });
  }
});

export default router;