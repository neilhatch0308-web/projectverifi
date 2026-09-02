import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

const quarterSchema = z.number().int().min(1).max(4).nullable().optional();

const setTargetYearSchema = z.object({
  targetStartYear: z.number().int(),
  targetStartQuarter: quarterSchema,
  targetEndYear: z.number().int().nullable().optional(),
  targetEndQuarter: quarterSchema,
});

const reassignSchema = z.object({
  toYear: z.number().int(),
  toQuarter: quarterSchema,
  toEndYear: z.number().int().nullable().optional(),
  toEndQuarter: quarterSchema,
  reason: z.string().min(1, 'A reason is required for this change.'),
});

// ---------- Set target year (first-ever set: raiser or assessor, no reason) ----------
router.patch('/demands/:id/target-year', requireAuth, async (req, res) => {
  const { organizationId, userId, permissions } = req.user!;
  const demandId = looseUuid().parse(req.params.id);
  const body = setTargetYearSchema.parse(req.body);

  try {
    const outcome = await withTenantContext(organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, raised_by, target_start_year FROM demand WHERE id = $1`,
        [demandId]
      );
      if (rows.length === 0) return { status: 404 as const, error: 'Demand not found' };
      const demand = rows[0];

      const isRaiser = demand.raised_by === userId;
      const canAssess = permissions.includes('demand.assess');
      if (!isRaiser && !canAssess) {
        return { status: 403 as const, error: 'Only the raiser or an assessor can set the target year.' };
      }
      if (demand.target_start_year !== null) {
        return {
          status: 409 as const,
          error: 'Target year is already set. Use the Five-Year Horizon view to move it (reason required).',
        };
      }

      await client.query(
        `UPDATE demand
            SET target_start_year = $1::int,
                target_start_quarter = $2::int,
                target_end_year = COALESCE($3::int, $1::int),
                target_end_quarter = $4::int,
                target_year_set_by = $5::uuid,
                target_year_set_at = now()
          WHERE id = $6::uuid`,
        [
          body.targetStartYear,
          body.targetStartQuarter ?? null,
          body.targetEndYear ?? null,
          body.targetEndQuarter ?? null,
          userId,
          demandId,
        ]
      );
      return { status: 200 as const };
    });

    return res.status(outcome.status).json(outcome.status === 200 ? { ok: true } : { error: outcome.error });
  } catch (err) {
    console.error('Failed to set target year:', err);
    return res.status(500).json({ error: 'Failed to set target year' });
  }
});

// ---------- Reassign (drag/resize: lead/admin only, reason required) ----------
router.patch(
  '/demands/:id/target-year/reassign',
  requireAuth,
  requirePermission('demand.reassign_target_year'),
  async (req, res) => {
    const { organizationId, userId } = req.user!;
    const demandId = looseUuid().parse(req.params.id);
    const body = reassignSchema.parse(req.body);

    try {
      const outcome = await withTenantContext(organizationId, async (client) => {
        const { rows } = await client.query(
          `SELECT d.id, d.target_start_year, d.target_start_quarter,
                  d.target_end_year, d.target_end_quarter, d.date_driver_type,
                  EXISTS (
                    SELECT 1 FROM annual_plan_item api
                    JOIN annual_plan ap ON ap.id = api.plan_id
                    WHERE api.demand_id = d.id AND ap.status = 'agreed'
                  ) AS is_agreed_locked
             FROM demand d
            WHERE d.id = $1
            FOR UPDATE`,
          [demandId]
        );
        if (rows.length === 0) return { status: 404 as const, error: 'Demand not found' };
        const demand = rows[0];

        if (demand.is_agreed_locked) {
          return {
            status: 409 as const,
            error: 'This demand is on an Agreed annual plan and cannot be moved. Start a mid-year revision to change its plan placement.',
          };
        }
        if (demand.date_driver_type && demand.date_driver_type !== 'none') {
          return { status: 409 as const, error: 'This demand has a fixed date driver and cannot be dragged or resized.' };
        }
        if (demand.target_start_year === null) {
          return { status: 409 as const, error: 'No target year is set yet -- nothing to reassign.' };
        }

        await client.query(
          `INSERT INTO demand_target_year_reassignment
             (organization_id, demand_id, from_year, from_quarter,
              from_end_year, from_end_quarter, to_year, to_quarter,
              to_end_year, to_end_quarter, reason, changed_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            organizationId,
            demandId,
            demand.target_start_year,
            demand.target_start_quarter,
            demand.target_end_year,
            demand.target_end_quarter,
            body.toYear,
            body.toQuarter ?? null,
            body.toEndYear ?? body.toYear,
            body.toEndQuarter ?? null,
            body.reason,
            userId,
          ]
        );

        await client.query(
          `UPDATE demand
              SET target_start_year = $1,
                  target_start_quarter = $2,
                  target_end_year = $3,
                  target_end_quarter = $4
            WHERE id = $5`,
          [body.toYear, body.toQuarter ?? null, body.toEndYear ?? body.toYear, body.toEndQuarter ?? null, demandId]
        );

        return { status: 200 as const };
      });

      return res.status(outcome.status).json(outcome.status === 200 ? { ok: true } : { error: outcome.error });
    } catch (err) {
      console.error('Failed to reassign target year:', err);
      return res.status(500).json({ error: 'Failed to reassign target year' });
    }
  }
);

// ---------- Horizon board read ----------
router.get('/demands/horizon', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const demands = await withTenantContext(organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT d.id, d.title, d.status, d.date_driver_type,
                d.target_start_year, d.target_start_quarter,
                d.target_end_year, d.target_end_quarter,
                p.id AS portfolio_id, p.name AS portfolio_name,
                EXISTS (
                  SELECT 1 FROM annual_plan_item api
                  JOIN annual_plan ap ON ap.id = api.plan_id
                  WHERE api.demand_id = d.id AND ap.status = 'agreed'
                ) AS is_agreed_locked
           FROM demand d
           JOIN portfolio p ON p.id = d.portfolio_id
          WHERE d.target_start_year IS NOT NULL
            AND d.status != 'stopped'
          ORDER BY p.name, d.target_start_year, d.target_start_quarter NULLS FIRST`
      );
      return rows;
    });

    return res.json({ demands });
  } catch (err) {
    console.error('Failed to fetch horizon:', err);
    return res.status(500).json({ error: 'Failed to fetch horizon' });
  }
});

export default router;