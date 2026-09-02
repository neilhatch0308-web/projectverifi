// server/src/routes/target-year-routes.ts
//
// ASSUMPTIONS (confirm against actual codebase before wiring in):
//   - `requireAuth` and `requirePermission(key)` middleware exist and
//     behave like the ones already used in demand-routes.ts / roles-routes.ts.
//   - `pool` is the shared pg Pool from `../db`, and `withOrgContext`
//     (or equivalent) sets `app.current_org` per request as used
//     elsewhere -- naming inferred from FORCE ROW LEVEL SECURITY
//     pattern already in place, not confirmed against the real file.
//   - Router is mounted at `/api/demands` alongside the existing
//     demand routes, so paths below are relative to that.
//
// Three endpoints:
//   PATCH /:id/target-year            -- raiser (own demand) or assessor, first-set, no reason
//   PATCH /:id/target-year/reassign   -- lead/admin, drag or resize, reason required
//   GET   /horizon                    -- five-year board read, grouped by portfolio

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool'; // confirm this matches the real export -- server/src/db/pool.ts per project notes
import { requireAuth, requirePermission } from '../middleware/auth'; // adjust path to match actual project layout
import { looseUuid } from '../lib/validation';

const router = Router();

const quarterSchema = z.number().int().min(1).max(4).nullable().optional();

const setTargetYearSchema = z.object({
  target_start_year: z.number().int(),
  target_start_quarter: quarterSchema,
  target_end_year: z.number().int().nullable().optional(),
  target_end_quarter: quarterSchema,
});

const reassignSchema = z.object({
  to_year: z.number().int(),
  to_quarter: quarterSchema,
  to_end_year: z.number().int().nullable().optional(),
  to_end_quarter: quarterSchema,
  reason: z.string().min(1, 'A reason is required for this change.'),
});

// ── PATCH /:id/target-year ──────────────────────────────────────────
// First-ever set. Raiser can set on their own demand; assessor can set
// via demand.assess. No reason required -- there is no "prior value"
// to justify a change from yet, same logic as portfolio_budget's
// baseline_amount and the first-ever portfolio allocation.
router.patch('/:id/target-year', requireAuth, async (req: Request, res: Response) => {
  const demandId = looseUuid().parse(req.params.id);
  const body = setTargetYearSchema.parse(req.body);
  const user = req.user!; // populated by requireAuth

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_org = $1', [user.organizationId]);

    const { rows } = await client.query(
      `SELECT id, raised_by, target_start_year, assigned_assessor_id
         FROM demand WHERE id = $1`,
      [demandId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Demand not found' });
    const demand = rows[0];

    const isRaiser = demand.raised_by === user.userId;
    const canAssess = user.permissions?.includes('demand.assess');
    if (!isRaiser && !canAssess) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the raiser or an assessor can set the target year.' });
    }

    if (demand.target_start_year !== null) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Target year is already set. Use the Five-Year Horizon view to move it (reason required).',
      });
    }

    await client.query(
      `UPDATE demand
          SET target_start_year = $1,
              target_start_quarter = $2,
              target_end_year = COALESCE($3, $1),
              target_end_quarter = $4,
              target_year_set_by = $5,
              target_year_set_at = now()
        WHERE id = $6`,
      [
        body.target_start_year,
        body.target_start_quarter ?? null,
        body.target_end_year ?? null,
        body.target_end_quarter ?? null,
        user.userId,
        demandId,
      ]
    );

    await client.query('COMMIT');
    return res.status(200).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── PATCH /:id/target-year/reassign ─────────────────────────────────
// Drag or resize from the Five-Year Horizon view. Portfolio lead or
// org admin only. Blocked entirely if the demand is locked -- either
// an Agreed annual_plan_item, or a fixed date_driver_type. One row
// logged per event, even when start and end both move across a
// fiscal-year boundary in a single resize.
router.patch(
  '/:id/target-year/reassign',
  requireAuth,
  requirePermission('demand.reassign_target_year'),
  async (req: Request, res: Response) => {
    const demandId = looseUuid().parse(req.params.id);
    const body = reassignSchema.parse(req.body);
    const user = req.user!;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL app.current_org = $1', [user.organizationId]);

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
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Demand not found' });
      }
      const demand = rows[0];

      if (demand.is_agreed_locked) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'This demand is on an Agreed annual plan and cannot be moved. Start a mid-year revision to change its plan placement.',
        });
      }
      if (demand.date_driver_type && demand.date_driver_type !== 'none') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'This demand has a fixed date driver and cannot be dragged or resized.',
        });
      }
      if (demand.target_start_year === null) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No target year is set yet -- nothing to reassign.' });
      }

      await client.query(
        `INSERT INTO demand_target_year_reassignment
           (organization_id, demand_id, from_year, from_quarter,
            from_end_year, from_end_quarter, to_year, to_quarter,
            to_end_year, to_end_quarter, reason, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          user.organizationId,
          demandId,
          demand.target_start_year,
          demand.target_start_quarter,
          demand.target_end_year,
          demand.target_end_quarter,
          body.to_year,
          body.to_quarter ?? null,
          body.to_end_year ?? body.to_year,
          body.to_end_quarter ?? null,
          body.reason,
          user.userId,
        ]
      );

      await client.query(
        `UPDATE demand
            SET target_start_year = $1,
                target_start_quarter = $2,
                target_end_year = $3,
                target_end_quarter = $4
          WHERE id = $5`,
        [body.to_year, body.to_quarter ?? null, body.to_end_year ?? body.to_year, body.to_end_quarter ?? null, demandId]
      );

      await client.query('COMMIT');
      return res.status(200).json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
);

// ── GET /horizon ─────────────────────────────────────────────────
// Read model for the Five-Year Horizon board: every horizon-tagged
// demand, grouped by raising portfolio, with enough to render a bar
// and decide lock state client-side (though the reassign endpoint is
// the real enforcement -- this is display only).
router.get('/horizon', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const client = await pool.connect();
  try {
    await client.query('SET LOCAL app.current_org = $1', [user.organizationId]);

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
          AND d.status NOT IN ('stopped')
        ORDER BY p.name, d.target_start_year, d.target_start_quarter NULLS FIRST`
    );

    return res.status(200).json({ demands: rows });
  } finally {
    client.release();
  }
});

export default router;