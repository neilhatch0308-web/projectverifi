import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

const MILESTONES = ['delivery_started', 'delivery_completed', 'adoption_measured', 'benefit_realized'] as const;
type Milestone = (typeof MILESTONES)[number];

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');

// Each milestone now requires its own specific fields, entered by the
// person recording it, rather than the previous single generic
// { milestone, notes } shape that let the server stamp now() as the
// event date. `recordedDate` is what the picked date populates on the
// milestone's own *_at column (cast to a timestamp) -- replacing the
// old now() default, not adding a second date next to it.
const advanceSchema = z.discriminatedUnion('milestone', [
  z.object({
    milestone: z.literal('delivery_started'),
    recordedDate: dateString,
    plannedEndDate: dateString,
  }),
  z.object({
    milestone: z.literal('delivery_completed'),
    recordedDate: dateString,
    actualCost: z.number({ message: 'Actual cost is required' }).nonnegative(),
  }),
  z.object({
    milestone: z.literal('adoption_measured'),
    recordedDate: dateString,
    adoptionLevel: z.enum(['not_adopted', 'partial', 'full']),
    notes: z.string().optional(),
  }),
  z.object({
    milestone: z.literal('benefit_realized'),
    recordedDate: dateString,
    actualBenefitValue: z.number({ message: 'Actual benefit value is required' }),
    attributionConfidence: z.enum(['low', 'medium', 'high']),
    notes: z.string().optional(),
  }),
]);

const AT_COLUMN: Record<Milestone, string> = {
  delivery_started: 'delivery_started_at',
  delivery_completed: 'delivery_completed_at',
  adoption_measured: 'adoption_measured_at',
  benefit_realized: 'benefit_realized_at',
};
const BY_COLUMN: Record<Milestone, string> = {
  delivery_started: 'delivery_started_by',
  delivery_completed: 'delivery_completed_by',
  adoption_measured: 'adoption_measured_by',
  benefit_realized: 'benefit_realized_by',
};

// ---------- View delivery tracking for a demand ----------
// Joins in everything needed to show comparisons without duplicating
// any of it onto demand_delivery itself: the demand's need-by date,
// the business case's signed-off budget and claimed benefit total,
// and the two variance figures computed from already-immutable
// inputs. None of this is stored -- "current is never stored, always
// read live" (decision 66), applied here for the third time (decision 75).
router.get('/demands/:id/delivery', requireAuth, requirePermission(['delivery.view', 'delivery.edit']), async (req, res) => {
  const demandId = looseUuid().parse(req.params.id);
  const { organizationId } = req.user!;

  try {
    const record = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT dd.*,
                started.display_name AS delivery_started_by_name,
                completed.display_name AS delivery_completed_by_name,
                adopted.display_name AS adoption_measured_by_name,
                realized.display_name AS benefit_realized_by_name,
                d.need_by_date AS needed_by_date,
                inv.approved_amount AS signed_off_budget,
                bt.claimed_total AS claimed_business_case_benefit,
                (dd.delivery_completed_at::date - dd.planned_end_date) AS date_variance_days,
                CASE WHEN dd.actual_benefit_value IS NOT NULL AND bt.claimed_total IS NOT NULL
                     THEN dd.actual_benefit_value - bt.claimed_total END AS benefit_variance_amount,
                CASE WHEN dd.actual_benefit_value IS NOT NULL AND bt.claimed_total IS NOT NULL AND bt.claimed_total <> 0
                     THEN round(((dd.actual_benefit_value - bt.claimed_total) / bt.claimed_total) * 100, 1) END AS benefit_variance_pct,
                CASE WHEN dd.actual_cost IS NOT NULL AND inv.approved_amount IS NOT NULL
                     THEN dd.actual_cost - inv.approved_amount END AS cost_variance_amount
           FROM demand_delivery dd
           LEFT JOIN app_user started ON started.id = dd.delivery_started_by
           LEFT JOIN app_user completed ON completed.id = dd.delivery_completed_by
           LEFT JOIN app_user adopted ON adopted.id = dd.adoption_measured_by
           LEFT JOIN app_user realized ON realized.id = dd.benefit_realized_by
           LEFT JOIN demand d ON d.id = dd.demand_id
           LEFT JOIN business_case bc ON bc.demand_id = dd.demand_id
           LEFT JOIN investment inv ON inv.business_case_id = bc.id
           LEFT JOIN (
             SELECT business_case_id, SUM(claimed_value) AS claimed_total
               FROM benefit
              GROUP BY business_case_id
           ) bt ON bt.business_case_id = bc.id
          WHERE dd.demand_id = $1`,
        [demandId]
      );
      // No row yet just means nothing has been recorded -- a real,
      // valid state (not found), not an error. In that case the
      // caller still wants needed_by_date/signed_off_budget context,
      // so fall back to a lighter lookup.
      if (result.rows[0]) return result.rows[0];

      const fallback = await client.query(
        `SELECT d.need_by_date AS needed_by_date,
                inv.approved_amount AS signed_off_budget,
                bt.claimed_total AS claimed_business_case_benefit
           FROM demand d
           LEFT JOIN business_case bc ON bc.demand_id = d.id
           LEFT JOIN investment inv ON inv.business_case_id = bc.id
           LEFT JOIN (
             SELECT business_case_id, SUM(claimed_value) AS claimed_total
               FROM benefit
              GROUP BY business_case_id
           ) bt ON bt.business_case_id = bc.id
          WHERE d.id = $1`,
        [demandId]
      );
      return fallback.rows[0] ? { ...fallback.rows[0], id: null } : null;
    });
    res.json(record);
  } catch (err) {
    console.error('Failed to fetch delivery tracking:', err);
    res.status(500).json({ error: 'Failed to fetch delivery tracking' });
  }
});

// ---------- Advance to the next milestone ----------
router.post('/demands/:id/delivery/advance', requireAuth, requirePermission('delivery.edit'), async (req, res) => {
  const demandId = looseUuid().parse(req.params.id);
  const parsed = advanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { milestone, recordedDate } = parsed.data;
  const { organizationId, userId } = req.user!;
  const idx = MILESTONES.indexOf(milestone);
  const atCol = AT_COLUMN[milestone];
  const byCol = BY_COLUMN[milestone];

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      // Ensure a row exists for this demand -- created lazily on the
      // first milestone rather than at promotion time, so a demand
      // that's promoted but not yet actually being delivered doesn't
      // carry an empty row implying tracking has started.
      await client.query(
        `INSERT INTO demand_delivery (id, organization_id, demand_id)
         VALUES (gen_random_uuid(), $1, $2)
         ON CONFLICT (demand_id) DO NOTHING`,
        [organizationId, demandId]
      );

      const existing = await client.query(`SELECT * FROM demand_delivery WHERE demand_id = $1`, [demandId]);
      const row = existing.rows[0];

      if (row[atCol] !== null) {
        return { status: 409 as const, error: `${milestone.replace(/_/g, ' ')} has already been recorded.` };
      }
      if (idx > 0) {
        const prevAtCol = AT_COLUMN[MILESTONES[idx - 1]];
        if (row[prevAtCol] === null) {
          return { status: 409 as const, error: `${MILESTONES[idx - 1].replace(/_/g, ' ')} must be recorded first.` };
        }
      }

      // Build the milestone-specific SET clause and params. Each
      // branch owns exactly the columns that belong to it -- nothing
      // generic here, since the four milestones no longer share a
      // shape the way they did when this was just { at, by, notes }.
      const setParts: string[] = [`${atCol} = $1`, `${byCol} = $2`];
      const params: any[] = [recordedDate, userId];
      let paramIdx = 3;

      if (parsed.data.milestone === 'delivery_started') {
        setParts.push(`planned_end_date = $${paramIdx++}`);
        params.push(parsed.data.plannedEndDate);
      } else if (parsed.data.milestone === 'delivery_completed') {
        setParts.push(`actual_cost = $${paramIdx++}`);
        params.push(parsed.data.actualCost);
      } else if (parsed.data.milestone === 'adoption_measured') {
        setParts.push(`adoption_level = $${paramIdx++}`);
        params.push(parsed.data.adoptionLevel);
        if (parsed.data.notes) {
          setParts.push(`adoption_notes = $${paramIdx++}`);
          params.push(parsed.data.notes);
        }
      } else if (parsed.data.milestone === 'benefit_realized') {
        setParts.push(`actual_benefit_value = $${paramIdx++}`);
        params.push(parsed.data.actualBenefitValue);
        setParts.push(`benefit_attribution_confidence = $${paramIdx++}`);
        params.push(parsed.data.attributionConfidence);
        if (parsed.data.notes) {
          setParts.push(`benefit_realized_notes = $${paramIdx++}`);
          params.push(parsed.data.notes);
        }
      }

      params.push(demandId);
      const updated = await client.query(
        `UPDATE demand_delivery SET ${setParts.join(', ')}
          WHERE demand_id = $${paramIdx}
          RETURNING *`,
        params
      );
      return { status: 200 as const, record: updated.rows[0] };
    });

    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json(result.record);
  } catch (err) {
    console.error('Failed to advance delivery milestone:', err);
    res.status(500).json({ error: 'Failed to advance delivery milestone' });
  }
});

// ---------- Active Initiatives: approved, promoted demand currently in delivery ----------
router.get('/demands/active-initiatives', requireAuth, requirePermission(['delivery.view', 'delivery.edit']), async (req, res) => {
  const { organizationId, userId } = req.user!;

  try {
    const initiatives = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT d.id, d.title, d.confidential,
                p.name AS portfolio_name,
                bc.id AS business_case_id,
                CASE
                  WHEN dd.benefit_realized_at IS NOT NULL THEN 'benefit_realized'
                  WHEN dd.adoption_measured_at IS NOT NULL THEN 'adoption_measured'
                  WHEN dd.delivery_completed_at IS NOT NULL THEN 'delivery_completed'
                  WHEN dd.delivery_started_at IS NOT NULL THEN 'delivery_started'
                  ELSE NULL
                END AS delivery_stage
           FROM demand d
           JOIN business_case bc ON bc.demand_id = d.id
           JOIN portfolio p ON p.id = d.portfolio_id
           LEFT JOIN demand_delivery dd ON dd.demand_id = d.id
          WHERE d.status = 'promoted'
            AND bc.decision = 'approved'
            AND (d.confidential = false OR can_view_confidential_demand(d.id, $1))
          ORDER BY
            CASE
              WHEN dd.benefit_realized_at IS NOT NULL THEN 4
              WHEN dd.adoption_measured_at IS NOT NULL THEN 3
              WHEN dd.delivery_completed_at IS NOT NULL THEN 2
              WHEN dd.delivery_started_at IS NOT NULL THEN 1
              ELSE 0
            END, d.title`,
        [userId]
      );
      return result.rows;
    });
    res.json(initiatives);
  } catch (err) {
    console.error('Failed to fetch active initiatives:', err);
    res.status(500).json({ error: 'Failed to fetch active initiatives' });
  }
});

export default router;