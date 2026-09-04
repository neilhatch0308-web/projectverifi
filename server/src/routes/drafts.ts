import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

const STAGES = ['raise', 'triage', 'assess', 'accept'] as const;
type Stage = (typeof STAGES)[number];
const stageSchema = z.enum(STAGES);

// Raise has no permission gate here -- raising is the Submitter
// baseline, everyone has it. The other three match exactly what the
// real submit actions on each stage already require.
const STAGE_PERMISSION: Record<Stage, string | null> = {
  raise: null,
  triage: 'demand.triage',
  assess: 'demand.assess',
  accept: 'demand.triage', // matches RACI-naming/promote's gate
};

function canActOnStage(stage: Stage, permissions: string[]): boolean {
  const required = STAGE_PERMISSION[stage];
  return !required || permissions.includes(required);
}

const createDraftSchema = z.object({
  stage: stageSchema,
  demandId: looseUuid().nullable().optional(),
  data: z.record(z.string(), z.any()),
});

const updateDraftSchema = z.object({
  data: z.record(z.string(), z.any()),
});

// ---------- List drafts ----------
// GET /api/drafts?stage=raise            -> only the caller's own raise drafts
// GET /api/drafts?stage=triage&demandId= -> the shared draft for that demand, if any
router.get('/drafts', requireAuth, async (req, res) => {
  const { userId, organizationId, permissions } = req.user!;
  const stageFilter = req.query.stage ? stageSchema.safeParse(req.query.stage) : null;
  const demandIdFilter = typeof req.query.demandId === 'string' ? req.query.demandId : null;

  if (stageFilter && !stageFilter.success) return res.status(400).json({ error: 'Invalid stage' });
  if (stageFilter?.success && !canActOnStage(stageFilter.data, permissions)) {
    return res.status(403).json({ error: 'Missing permission for this stage' });
  }

  try {
    const drafts = await withTenantContext(organizationId, async (client) => {
      const conditions: string[] = [];
      const params: any[] = [];

      if (stageFilter?.success) {
        params.push(stageFilter.data);
        conditions.push(`fd.stage = $${params.length}`);
      }
      if (demandIdFilter) {
        params.push(demandIdFilter);
        conditions.push(`fd.demand_id = $${params.length}`);
      }
      // Raise drafts are personal -- only ever list the caller's own.
      // Non-raise drafts are shared, so no user_id filter for them.
      if (stageFilter?.success && stageFilter.data === 'raise') {
        params.push(userId);
        conditions.push(`fd.user_id = $${params.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await client.query(
        `SELECT fd.id, fd.stage, fd.demand_id, fd.data, fd.updated_at,
                d.title AS demand_title, u.display_name AS updated_by_name
           FROM form_draft fd
           LEFT JOIN demand d ON d.id = fd.demand_id
           LEFT JOIN app_user u ON u.id = fd.updated_by
           ${where}
          ORDER BY fd.updated_at DESC`,
        params
      );
      return result.rows;
    });
    res.json(drafts);
  } catch (err) {
    console.error('Failed to list drafts:', err);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
});

// ---------- Fetch one draft ----------
// Raise: owner only. Others: anyone holding the stage's permission.
router.get('/drafts/:id', requireAuth, async (req, res) => {
  const { userId, organizationId, permissions } = req.user!;
  const draftId = looseUuid().parse(req.params.id);

  try {
    const draft = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT fd.id, fd.stage, fd.demand_id, fd.data, fd.updated_at, fd.user_id,
                u.display_name AS updated_by_name
           FROM form_draft fd
           LEFT JOIN app_user u ON u.id = fd.updated_by
          WHERE fd.id = $1`,
        [draftId]
      );
      return result.rows[0] ?? null;
    });
    if (!draft) return res.status(404).json({ error: 'Draft not found' });

    const stage = draft.stage as Stage;
    if (stage === 'raise' && draft.user_id !== userId) {
      return res.status(403).json({ error: 'This draft belongs to someone else' });
    }
    if (stage !== 'raise' && !canActOnStage(stage, permissions)) {
      return res.status(403).json({ error: 'Missing permission for this stage' });
    }

    res.json(draft);
  } catch (err) {
    console.error('Failed to fetch draft:', err);
    res.status(500).json({ error: 'Failed to fetch draft' });
  }
});

// ---------- Save a new draft (or attach to the existing shared one) ----------
router.post('/drafts', requireAuth, async (req, res) => {
  const parsed = createDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { userId, organizationId, permissions } = req.user!;
  const { stage, demandId, data } = parsed.data;

  if (stage === 'raise' && demandId) {
    return res.status(400).json({ error: 'A raise draft cannot be tied to a demand.' });
  }
  if (stage !== 'raise' && !demandId) {
    return res.status(400).json({ error: `A ${stage} draft must be tied to a demand.` });
  }
  if (!canActOnStage(stage, permissions)) {
    return res.status(403).json({ error: 'Missing permission for this stage' });
  }

  try {
    const draft = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO form_draft (id, organization_id, user_id, stage, demand_id, data, updated_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $2)
         ON CONFLICT (stage, demand_id) WHERE demand_id IS NOT NULL
         DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING id, stage, demand_id, data, updated_at`,
        [organizationId, userId, stage, demandId ?? null, JSON.stringify(data)]
      );
      return result.rows[0];
    });
    res.status(201).json(draft);
  } catch (err) {
    console.error('Failed to save draft:', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// ---------- Update an existing draft's data ----------
// Raise: owner only. Others: anyone holding the stage's permission.
router.patch('/drafts/:id', requireAuth, async (req, res) => {
  const draftId = looseUuid().parse(req.params.id);
  const parsed = updateDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { userId, organizationId, permissions } = req.user!;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(`SELECT stage, user_id FROM form_draft WHERE id = $1`, [draftId]);
      if (existing.rows.length === 0) return { notFound: true as const };

      const stage = existing.rows[0].stage as Stage;
      if (stage === 'raise' && existing.rows[0].user_id !== userId) {
        return { forbidden: true as const };
      }
      if (stage !== 'raise' && !canActOnStage(stage, permissions)) {
        return { forbidden: true as const };
      }

      const updated = await client.query(
        `UPDATE form_draft SET data = $1, updated_by = $2, updated_at = now()
          WHERE id = $3
          RETURNING id, stage, demand_id, data, updated_at`,
        [JSON.stringify(parsed.data.data), userId, draftId]
      );
      return { row: updated.rows[0] };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Draft not found' });
    if ('forbidden' in result) return res.status(403).json({ error: 'Not allowed to edit this draft' });
    res.json(result.row);
  } catch (err) {
    console.error('Failed to update draft:', err);
    res.status(500).json({ error: 'Failed to update draft' });
  }
});

// ---------- Discard a draft ----------
// Raise: owner only. Others: anyone holding the stage's permission.
router.delete('/drafts/:id', requireAuth, async (req, res) => {
  const draftId = looseUuid().parse(req.params.id);
  const { userId, organizationId, permissions } = req.user!;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(`SELECT stage, user_id FROM form_draft WHERE id = $1`, [draftId]);
      if (existing.rows.length === 0) return { notFound: true as const };

      const stage = existing.rows[0].stage as Stage;
      if (stage === 'raise' && existing.rows[0].user_id !== userId) {
        return { forbidden: true as const };
      }
      if (stage !== 'raise' && !canActOnStage(stage, permissions)) {
        return { forbidden: true as const };
      }

      await client.query(`DELETE FROM form_draft WHERE id = $1`, [draftId]);
      return { ok: true as const };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Draft not found' });
    if ('forbidden' in result) return res.status(403).json({ error: 'Not allowed to discard this draft' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to discard draft:', err);
    res.status(500).json({ error: 'Failed to discard draft' });
  }
});

export default router;
