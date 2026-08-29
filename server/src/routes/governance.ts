import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

// ---------- List all tiers, ordered by threshold ----------
router.get('/governance-tiers', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const tiers = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, name, min_threshold, added_approvers, added_documents, sort_order
         FROM governance_tier
         WHERE organization_id = $1
         ORDER BY min_threshold ASC`,
        [organizationId]
      );
      return result.rows;
    });

    res.json(tiers);
  } catch (err) {
    console.error('Failed to fetch governance tiers:', err);
    res.status(500).json({ error: 'Failed to fetch governance tiers' });
  }
});

// ---------- Create a tier ----------
const tierSchema = z.object({
  name: z.string().min(1),
  minThreshold: z.number().min(0),
  addedApprovers: z.array(z.string()).default([]),
  addedDocuments: z.array(z.string()).default([]),
});

router.post('/governance-tiers', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = tierSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { name, minThreshold, addedApprovers, addedDocuments } = parsed.data;

  try {
    const tier = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO governance_tier
           (id, organization_id, name, min_threshold, added_approvers, added_documents, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
         RETURNING id, name, min_threshold, added_approvers, added_documents`,
        [organizationId, name, minThreshold, addedApprovers, addedDocuments, userId]
      );
      return result.rows[0];
    });

    res.status(201).json(tier);
  } catch (err) {
    console.error('Failed to create governance tier:', err);
    res.status(500).json({ error: 'Failed to create governance tier' });
  }
});

// ---------- Update a tier ----------
const updateTierSchema = z.object({
  name: z.string().min(1).optional(),
  minThreshold: z.number().min(0).optional(),
  addedApprovers: z.array(z.string()).optional(),
  addedDocuments: z.array(z.string()).optional(),
});

router.patch('/governance-tiers/:id', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = updateTierSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { id } = req.params;
  const { name, minThreshold, addedApprovers, addedDocuments } = parsed.data;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE governance_tier SET
           name = COALESCE($1, name),
           min_threshold = COALESCE($2, min_threshold),
           added_approvers = COALESCE($3, added_approvers),
           added_documents = COALESCE($4, added_documents),
           updated_at = now()
         WHERE id = $5
         RETURNING id, name, min_threshold, added_approvers, added_documents`,
        [name ?? null, minThreshold ?? null, addedApprovers ?? null, addedDocuments ?? null, id]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'Governance tier not found' });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update governance tier:', err);
    res.status(500).json({ error: 'Failed to update governance tier' });
  }
});

// ---------- Delete a tier ----------
router.delete('/governance-tiers/:id', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    await withTenantContext(organizationId, async (client) => {
      await client.query(`DELETE FROM governance_tier WHERE id = $1`, [id]);
    });
    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete governance tier:', err);
    res.status(500).json({ error: 'Failed to delete governance tier' });
  }
});

export default router;
