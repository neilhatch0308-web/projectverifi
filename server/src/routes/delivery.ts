import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

const MILESTONES = ['delivery_started', 'delivery_completed', 'adoption_measured', 'benefit_realized'] as const;
type Milestone = (typeof MILESTONES)[number];

// Maps each milestone to its column names and, for the two that carry
// optional context, its notes column -- keeps the advance handler
// generic instead of four near-identical copy-pasted branches.
const COLUMN: Record<Milestone, { at: string; by: string; notes?: string }> = {
  delivery_started: { at: 'delivery_started_at', by: 'delivery_started_by' },
  delivery_completed: { at: 'delivery_completed_at', by: 'delivery_completed_by' },
  adoption_measured: { at: 'adoption_measured_at', by: 'adoption_measured_by', notes: 'adoption_notes' },
  benefit_realized: { at: 'benefit_realized_at', by: 'benefit_realized_by', notes: 'benefit_realized_notes' },
};

// ---------- View delivery tracking for a demand ----------
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
                realized.display_name AS benefit_realized_by_name
           FROM demand_delivery dd
           LEFT JOIN app_user started ON started.id = dd.delivery_started_by
           LEFT JOIN app_user completed ON completed.id = dd.delivery_completed_by
           LEFT JOIN app_user adopted ON adopted.id = dd.adoption_measured_by
           LEFT JOIN app_user realized ON realized.id = dd.benefit_realized_by
          WHERE dd.demand_id = $1`,
        [demandId]
      );
      // No row yet just means nothing has been recorded -- a real,
      // valid state (not found), not an error.
      return result.rows[0] ?? null;
    });
    res.json(record);
  } catch (err) {
    console.error('Failed to fetch delivery tracking:', err);
    res.status(500).json({ error: 'Failed to fetch delivery tracking' });
  }
});

const advanceSchema = z.object({
  milestone: z.enum(MILESTONES),
  notes: z.string().optional(),
});

// ---------- Advance to the next milestone ----------
router.post('/demands/:id/delivery/advance', requireAuth, requirePermission('delivery.edit'), async (req, res) => {
  const demandId = looseUuid().parse(req.params.id);
  const parsed = advanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { milestone, notes } = parsed.data;
  const { organizationId, userId } = req.user!;
  const idx = MILESTONES.indexOf(milestone);
  const col = COLUMN[milestone];

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

      if (row[col.at] !== null) {
        return { status: 409 as const, error: `${milestone.replace(/_/g, ' ')} has already been recorded.` };
      }
      if (idx > 0) {
        const prevCol = COLUMN[MILESTONES[idx - 1]];
        if (row[prevCol.at] === null) {
          return { status: 409 as const, error: `${MILESTONES[idx - 1].replace(/_/g, ' ')} must be recorded first.` };
        }
      }

      const setNotes = col.notes ? `, ${col.notes} = $3` : '';
      const params: any[] = [userId, demandId];
      if (col.notes) params.push(notes ?? null);

      const updated = await client.query(
        `UPDATE demand_delivery SET ${col.at} = now(), ${col.by} = $1${setNotes}
          WHERE demand_id = $2
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
