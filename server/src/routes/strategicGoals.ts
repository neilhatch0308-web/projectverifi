import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

// ---------- List, optionally filtered by year ----------
router.get('/strategic-goals', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  const year = req.query.year ? Number(req.query.year) : undefined;

  try {
    const goals = await withTenantContext(organizationId, async (client) => {
      const result = year
        ? await client.query(
            `SELECT id, name, description, goal_year, status, declared_at, status_changed_at
             FROM strategic_goal WHERE goal_year = $1
             ORDER BY status, declared_at`,
            [year]
          )
        : await client.query(
            `SELECT id, name, description, goal_year, status, declared_at, status_changed_at
             FROM strategic_goal
             ORDER BY goal_year DESC, status, declared_at`
          );
      return result.rows;
    });

    res.json(goals);
  } catch (err) {
    console.error('Failed to fetch strategic goals:', err);
    res.status(500).json({ error: 'Failed to fetch strategic goals' });
  }
});

// ---------- Distinct years that have any goals declared (for the year selector) ----------
router.get('/strategic-goals/years', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const years = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT DISTINCT goal_year FROM strategic_goal ORDER BY goal_year DESC`
      );
      return result.rows.map((r) => r.goal_year);
    });

    res.json(years);
  } catch (err) {
    console.error('Failed to fetch strategic goal years:', err);
    res.status(500).json({ error: 'Failed to fetch strategic goal years' });
  }
});

// ---------- Add ----------
const createGoalSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  goalYear: z.number().int(),
});

router.post('/strategic-goals', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = createGoalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, description, goalYear } = parsed.data;
  const { userId, organizationId } = req.user!;

  try {
    const goal = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO strategic_goal (id, organization_id, name, description, goal_year, declared_by, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'active')
         RETURNING id, name, description, goal_year, status, declared_at`,
        [organizationId, name, description ?? null, goalYear, userId]
      );
      return result.rows[0];
    });

    res.status(201).json(goal);
  } catch (err: any) {
    // The 5-per-year cap trigger raises a plain exception - surface its
    // message directly rather than a generic 500, since it's genuinely
    // informative here (not an internal detail to hide).
    if (err.message?.includes('Strategic goal cap reached')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('Failed to create strategic goal:', err);
    res.status(500).json({ error: 'Failed to create strategic goal' });
  }
});

// ---------- Status transition ----------
const VALID_TRANSITIONS: Record<string, string[]> = {
  active: ['suspended', 'completed'],
  suspended: ['active', 'completed'],
  completed: [],
};

const updateStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'completed']),
});

router.patch('/strategic-goals/:id/status', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { status } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const check = await client.query(`SELECT status FROM strategic_goal WHERE id = $1`, [id]);
      const current = check.rows[0];

      if (!current) return { notFound: true as const };

      const allowed = VALID_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(status)) {
        return { invalidTransition: true as const, from: current.status, to: status };
      }

      const updated = await client.query(
        `UPDATE strategic_goal SET status = $1, status_changed_at = now(), status_changed_by = $2
         WHERE id = $3 RETURNING id, name, status`,
        [status, userId, id]
      );
      return { goal: updated.rows[0] };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Strategic goal not found' });
    if ('invalidTransition' in result) {
      return res.status(409).json({ error: `Cannot move from '${result.from}' to '${result.to}'` });
    }

    res.json(result.goal);
  } catch (err) {
    console.error('Failed to update strategic goal status:', err);
    res.status(500).json({ error: 'Failed to update strategic goal status' });
  }
});

export default router;
