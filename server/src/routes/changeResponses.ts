import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { deriveFlags, Capacity, Level } from '../lib/tolerance';

// Post-approval change control, step 4: the named decider sees what has
// been attributed to them, and confirms or disputes it.
// See 69_change_attribution_responses.sql.
//
// Deliberately gated on requireAuth only, NOT business_case.edit: being
// named as the decision-maker is what entitles a person to respond, and
// a Sponsor may hold no edit permission. What they can see is bounded
// instead by (1) being the effective named decider, (2) the change
// having actually been applied (a held change is invisible to them),
// and (3) can_view_confidential_demand().

const router = Router();
const DEFAULT_HOLD_FLAG_DAYS = 7;

// Effective attestation = the latest row for the change request (step 2).
const EFFECTIVE_ATTESTATION = `
  LEFT JOIN LATERAL (
    SELECT * FROM change_attestation a WHERE a.change_request_id = cr.id
     ORDER BY a.recorded_at DESC LIMIT 1
  ) att ON true`;

// Latest response for THAT attestation only: a response given to a
// superseded attribution does not speak for the current one.
const LATEST_RESPONSE = `
  LEFT JOIN LATERAL (
    SELECT * FROM change_attribution_response r WHERE r.attestation_id = att.id
     ORDER BY r.responded_at DESC LIMIT 1
  ) resp ON true`;

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ---------- Everything change control wants from ME, in one request ----------
// Composed server-side (same reason as My Portfolio): a home panel
// loading in three pieces is three places to show a half-loaded screen.
router.get('/me/change-control', requireAuth, async (req, res) => {
  const { organizationId, userId } = req.user!;

  try {
    const out = await withTenantContext(organizationId, async (client) => {
      // 1. Attributed to me: applied changes where I am the effective decider.
      const attributed = await client.query(
        `SELECT cr.id AS change_request_id, cr.demand_id, cr.business_case_id, d.title AS demand_title,
                d.confidential, cr.reason, cr.required_level,
                to_char(cr.created_at, 'YYYY-MM-DD') AS change_recorded_date,
                u.display_name AS recorded_by_name,
                bv.version_number, bv.approved_cost, bv.benefit_total,
                to_char(bv.planned_end_date, 'YYYY-MM-DD') AS planned_end_date, bv.scope_summary,
                pv.approved_cost AS prior_cost, pv.benefit_total AS prior_benefit,
                to_char(pv.planned_end_date, 'YYYY-MM-DD') AS prior_end_date, pv.scope_summary AS prior_scope,
                att.id AS attestation_id, att.decision_capacity,
                to_char(att.decision_date, 'YYYY-MM-DD') AS decision_date,
                att.evidence_reference, att.recorded_at AS attributed_at,
                (CURRENT_DATE - att.recorded_at::date) AS days_since_attributed,
                resp.response, resp.reason AS response_reason, resp.responded_at
           FROM change_request cr
           JOIN demand d ON d.id = cr.demand_id
           JOIN app_user u ON u.id = cr.created_by
           ${EFFECTIVE_ATTESTATION}
           JOIN baseline_version bv ON bv.change_request_id = cr.id
           LEFT JOIN baseline_version pv ON pv.id = bv.predecessor_id
           ${LATEST_RESPONSE}
          WHERE att.decider_user_id = $1
            AND (d.confidential = false OR can_view_confidential_demand(d.id, $1))
          ORDER BY (resp.response IS NULL) DESC, cr.created_at DESC`,
        [userId]
      );

      // 2. Changes I recorded that the named decider has disputed.
      const disputed = await client.query(
        `SELECT cr.id AS change_request_id, cr.demand_id, cr.business_case_id, d.title AS demand_title,
                d.confidential, cr.reason, decider.display_name AS decider_name,
                att.decision_capacity, resp.reason AS response_reason, resp.responded_at
           FROM change_request cr
           JOIN demand d ON d.id = cr.demand_id
           ${EFFECTIVE_ATTESTATION}
           ${LATEST_RESPONSE}
           LEFT JOIN app_user decider ON decider.id = att.decider_user_id
          WHERE cr.created_by = $1 AND resp.response = 'disputed'
            AND (d.confidential = false OR can_view_confidential_demand(d.id, $1))
          ORDER BY resp.responded_at DESC`,
        [userId]
      );

      // 3. Changes I recorded that are held (baseline behind reality).
      const setting = await client.query(`SELECT hold_flag_days FROM change_control_setting WHERE organization_id = $1`, [organizationId]);
      const flagDays: number = setting.rows[0]?.hold_flag_days ?? DEFAULT_HOLD_FLAG_DAYS;
      const held = await client.query(
        `SELECT h.change_request_id, h.demand_id, h.business_case_id, d.title AS demand_title, d.confidential, h.reason,
                h.placed_at, h.days_held, decider.display_name AS decider_name
           FROM change_request_held h
           JOIN demand d ON d.id = h.demand_id
           LEFT JOIN LATERAL (
             SELECT * FROM change_attestation a WHERE a.change_request_id = h.change_request_id
              ORDER BY a.recorded_at DESC LIMIT 1
           ) att ON true
           LEFT JOIN app_user decider ON decider.id = att.decider_user_id
          WHERE h.recorded_by = $1
            AND (d.confidential = false OR can_view_confidential_demand(d.id, $1))
          ORDER BY h.placed_at ASC`,
        [userId]
      );

      return {
        attributedToMe: attributed.rows.map((r: any) => ({
          changeRequestId: r.change_request_id, demandId: r.demand_id, businessCaseId: r.business_case_id,
          demandTitle: r.demand_title, confidential: r.confidential, reason: r.reason,
          recordedByName: r.recorded_by_name, requiredLevel: r.required_level,
          versionNumber: r.version_number,
          change: {
            cost: { prior: n(r.prior_cost), now: n(r.approved_cost) },
            benefit: { prior: n(r.prior_benefit), now: n(r.benefit_total) },
            endDate: { prior: r.prior_end_date, now: r.planned_end_date },
            scope: { prior: r.prior_scope, now: r.scope_summary },
          },
          decisionCapacity: r.decision_capacity, decisionDate: r.decision_date, evidenceReference: r.evidence_reference,
          status: r.response ?? 'unconfirmed',
          responseReason: r.response_reason, respondedAt: r.responded_at,
          daysUnconfirmed: r.response ? null : r.days_since_attributed,
          flags: deriveFlags(
            r.required_level as Level | null,
            { capacity: r.decision_capacity as Capacity, decisionDate: r.decision_date, hasUser: true, evidence: r.evidence_reference },
            r.change_recorded_date
          ),
        })),
        disputedRecordedByMe: disputed.rows,
        heldRecordedByMe: held.rows.map((h: any) => ({ ...h, overdue: h.days_held >= flagDays, flagAfterDays: flagDays })),
      };
    });
    res.json(out);
  } catch (err) {
    console.error('Failed to fetch change control summary:', err);
    res.status(500).json({ error: 'Failed to fetch change control summary' });
  }
});

// ---------- Confirm or dispute ----------
const responseSchema = z.object({
  response: z.enum(['confirmed', 'disputed']),
  reason: z.string().trim().optional(),
}).refine((r) => r.response === 'confirmed' || (r.reason !== undefined && r.reason.length > 0), {
  message: 'A reason is required to dispute a change.',
  path: ['reason'],
});

router.post('/change-requests/:crId/responses', requireAuth, async (req, res) => {
  const parsed = responseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const crId = Array.isArray(req.params.crId) ? req.params.crId[0] : req.params.crId;

  try {
    const ok = await withTenantContext(organizationId, async (client) => {
      const q = await client.query(
        `SELECT cr.id, att.id AS attestation_id,
                (d.confidential = false OR can_view_confidential_demand(d.id, $2)) AS can_view,
                EXISTS (SELECT 1 FROM baseline_version bv WHERE bv.change_request_id = cr.id) AS applied
           FROM change_request cr
           JOIN demand d ON d.id = cr.demand_id
           ${EFFECTIVE_ATTESTATION}
          WHERE cr.id = $1 AND att.decider_user_id = $2`,
        [crId, userId]
      );
      const row = q.rows[0];
      // Not the named decider, cannot see the demand, or not applied
      // (still held / withdrawn): all indistinguishable from "no such
      // change" -- existence is never confirmed to someone not entitled to it.
      if (!row || !row.can_view || !row.applied) return false;

      await client.query(
        `INSERT INTO change_attribution_response
           (organization_id, change_request_id, attestation_id, responder_user_id, response, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [organizationId, crId, row.attestation_id, userId, parsed.data.response, parsed.data.reason ?? null]
      );
      return true;
    });
    if (!ok) return res.status(404).json({ error: 'Change not found' });
    res.status(201).json({ recorded: true });
  } catch (err) {
    console.error('Failed to record response:', err);
    res.status(500).json({ error: 'Failed to record response' });
  }
});

export default router;
