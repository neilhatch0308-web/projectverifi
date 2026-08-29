import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

// Roles considered "senior" for sponsor-selection purposes - a UI nudge,
// not enforcement, kept separate from the real role/permission system
// below (34_roles_and_permissions.sql). This is about who LOOKS right
// to pick as a RACI seat; that system is about who's ALLOWED to do what
// in the app. Different questions, deliberately not merged.
const SENIOR_ROLES = ['org_admin', 'sponsor', 'finance'];

router.get('/users', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const users = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, display_name, email, role FROM app_user WHERE is_active = true ORDER BY display_name`
      );
      return result.rows.map((u) => ({ ...u, is_senior: SENIOR_ROLES.includes(u.role) }));
    });

    res.json(users);
  } catch (err) {
    console.error('Failed to fetch users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ---------- Current user's identity + effective permissions ----------
// Lets the frontend know what to show/hide without guessing. Every user
// implicitly has the Submitter baseline (raise demand, view/edit their
// own) regardless of what's in `permissions` - that array only lists
// the ADDITIONAL capabilities their roles grant.
router.get('/me', requireAuth, async (req, res) => {
  const { userId, displayName, email, permissions } = req.user!;
  res.json({ userId, displayName, email, permissions });
});

// ---------- Permission catalog (fixed, for building the roles UI) ----------
router.get('/permissions', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  try {
    const permissions = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(`SELECT key, label, description FROM permission ORDER BY key`);
      return result.rows;
    });
    res.json(permissions);
  } catch (err) {
    console.error('Failed to fetch permission catalog:', err);
    res.status(500).json({ error: 'Failed to fetch permission catalog' });
  }
});

// ---------- Roles: list, with their granted permissions ----------
router.get('/roles', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  try {
    const roles = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT r.id, r.name, r.description,
                COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
         FROM role r
         LEFT JOIN role_permission rp ON rp.role_id = r.id
         WHERE r.organization_id = $1
         GROUP BY r.id
         ORDER BY r.name`,
        [organizationId]
      );
      return result.rows;
    });
    res.json(roles);
  } catch (err) {
    console.error('Failed to fetch roles:', err);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// ---------- Roles: create ----------
const createRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
});

router.post('/roles', requireAuth, requirePermission('users.manage'), async (req, res) => {
  const parsed = createRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { name, description, permissions } = parsed.data;

  try {
    const role = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO role (id, organization_id, name, description, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         RETURNING id, name, description`,
        [organizationId, name, description ?? null, userId]
      );
      const role = result.rows[0];

      for (const key of permissions) {
        await client.query(
          `INSERT INTO role_permission (role_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [role.id, key]
        );
      }

      return { ...role, permissions };
    });

    res.status(201).json(role);
  } catch (err) {
    console.error('Failed to create role:', err);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// ---------- Roles: update (name/description + full permission set) ----------
const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

router.patch('/roles/:id', requireAuth, requirePermission('users.manage'), async (req, res) => {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { id } = req.params;
  const { name, description, permissions } = parsed.data;

  try {
    const role = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE role SET name = COALESCE($1, name), description = COALESCE($2, description)
         WHERE id = $3 RETURNING id, name, description`,
        [name ?? null, description ?? null, id]
      );
      const role = result.rows[0];
      if (!role) return null;

      // Permission set, when provided, is a full replace - simpler and
      // safer to reason about than a partial add/remove diff for a
      // tick-box UI where the frontend always sends the complete set.
      if (permissions) {
        await client.query(`DELETE FROM role_permission WHERE role_id = $1`, [id]);
        for (const key of permissions) {
          await client.query(
            `INSERT INTO role_permission (role_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, key]
          );
        }
      }

      return role;
    });

    if (!role) return res.status(404).json({ error: 'Role not found' });
    res.json(role);
  } catch (err) {
    console.error('Failed to update role:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ---------- Roles: delete ----------
router.delete('/roles/:id', requireAuth, requirePermission('users.manage'), async (req, res) => {
  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    await withTenantContext(organizationId, async (client) => {
      await client.query(`DELETE FROM role WHERE id = $1`, [id]);
    });
    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete role:', err);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

// ---------- User admin: list users with the roles they hold ----------
router.get('/users/admin', requireAuth, requirePermission('users.manage'), async (req, res) => {
  const { organizationId } = req.user!;
  try {
    const users = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT u.id, u.display_name, u.email, u.is_active,
                COALESCE(array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS role_ids
         FROM app_user u
         LEFT JOIN app_user_role ur ON ur.user_id = u.id
         WHERE u.organization_id = $1
         GROUP BY u.id
         ORDER BY u.display_name`,
        [organizationId]
      );
      return result.rows;
    });
    res.json(users);
  } catch (err) {
    console.error('Failed to fetch users for admin:', err);
    res.status(500).json({ error: 'Failed to fetch users for admin' });
  }
});

// ---------- User admin: set a user's full role set (tick-box replace) ----------
const setUserRolesSchema = z.object({ roleIds: z.array(looseUuid()) });

router.put('/users/:id/roles', requireAuth, requirePermission('users.manage'), async (req, res) => {
  const parsed = setUserRolesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId: grantedBy } = req.user!;
  const { id } = req.params;
  const { roleIds } = parsed.data;

  try {
    await withTenantContext(organizationId, async (client) => {
      await client.query(`DELETE FROM app_user_role WHERE user_id = $1`, [id]);
      for (const roleId of roleIds) {
        await client.query(
          `INSERT INTO app_user_role (user_id, role_id, granted_by) VALUES ($1, $2, $3)`,
          [id, roleId, grantedBy]
        );
      }
    });
    res.status(200).json({ userId: id, roleIds });
  } catch (err) {
    console.error('Failed to set user roles:', err);
    res.status(500).json({ error: 'Failed to set user roles' });
  }
});

// ---------- User admin: suspend or reactivate ----------
// is_active is already enforced in requireAuth (a deactivated account
// gets 403 on every request) - this just exposes the toggle. Guarded
// against self-deactivation: locking yourself out with no other
// org_admin around is a real footgun, not a hypothetical one.
const setStatusSchema = z.object({ isActive: z.boolean() });

router.patch('/users/:id/status', requireAuth, requirePermission('users.manage'), async (req, res) => {
  const parsed = setStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId: callerId } = req.user!;
  const { id } = req.params;
  const { isActive } = parsed.data;

  if (id === callerId && !isActive) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE app_user SET is_active = $1 WHERE id = $2 RETURNING id, display_name, is_active`,
        [isActive, id]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update user status:', err);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

export default router;
