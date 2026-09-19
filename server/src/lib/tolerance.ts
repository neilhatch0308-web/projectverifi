// Tolerance evaluation for post-approval change requests.
// See 67_change_tolerance_attestation.sql. Pure functions, no database:
// the route gathers the inputs, this decides the required level.

export type Level = 'none' | 'sponsor' | 'portfolio' | 'executive';
export type Capacity = 'sponsor' | 'portfolio' | 'executive';

export const LEVEL_RANK: Record<Level, number> = { none: 0, sponsor: 1, portfolio: 2, executive: 3 };

export interface ToleranceRule {
  name: string;
  required_level: Capacity;
  min_pct: number | null;
  min_abs: number | null;
  min_days: number | null;
  on_tier_crossing: boolean;
  on_scope_change: boolean;
}

export interface Drift {
  costAmount: number | null;
  costPct: number | null;
  benefitAmount: number | null;
  benefitPct: number | null;
  dateSlipDays: number | null;
  crossedGovernanceTier: boolean;
  scopeChangedSinceV1: boolean;
}

export interface Evaluation {
  requiredLevel: Level;
  reasons: string[];
}

// Drift against baseline v1 (the commitment), never against the
// previous version -- otherwise a run of small changes never adds up.
export function computeDrift(
  v1: { cost: number | null; benefit: number | null; endDate: string | null; scope: string | null },
  now: { cost: number | null; benefit: number | null; endDate: string | null; scope: string | null },
  crossedGovernanceTier: boolean,
  anyDescope: boolean
): Drift {
  const amount = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);
  // A percentage is never fabricated: null when the v1 figure is zero or missing.
  const pct = (a: number | null, b: number | null) =>
    a === null || b === null || a === 0 ? null : ((b - a) / Math.abs(a)) * 100;

  let slip: number | null = null;
  if (v1.endDate && now.endDate) {
    const ms = Date.parse(now.endDate + 'T00:00:00Z') - Date.parse(v1.endDate + 'T00:00:00Z');
    slip = Math.round(ms / 86400000);
  }
  return {
    costAmount: amount(v1.cost, now.cost),
    costPct: pct(v1.cost, now.cost),
    benefitAmount: amount(v1.benefit, now.benefit),
    benefitPct: pct(v1.benefit, now.benefit),
    dateSlipDays: slip,
    crossedGovernanceTier,
    scopeChangedSinceV1: anyDescope || (v1.scope ?? '') !== (now.scope ?? ''),
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Any trigger on a rule firing escalates to that rule's level; the
// highest level fired wins. No rules configured = 'none' (nothing is
// ever flagged for a tenant that has not set tolerances).
export function evaluateTolerance(rules: ToleranceRule[], d: Drift): Evaluation {
  let best: Level = 'none';
  const reasons: string[] = [];

  for (const rule of rules) {
    const fired: string[] = [];

    if (rule.min_pct !== null) {
      const worst = Math.max(Math.abs(d.costPct ?? 0), Math.abs(d.benefitPct ?? 0));
      if (worst >= rule.min_pct) fired.push(`drift ${r2(worst)}% >= ${rule.min_pct}%`);
    }
    if (rule.min_abs !== null) {
      const worst = Math.max(Math.abs(d.costAmount ?? 0), Math.abs(d.benefitAmount ?? 0));
      if (worst >= rule.min_abs) fired.push(`drift ${r2(worst)} >= ${rule.min_abs}`);
    }
    if (rule.min_days !== null && d.dateSlipDays !== null && Math.abs(d.dateSlipDays) >= rule.min_days) {
      fired.push(`date moved ${Math.abs(d.dateSlipDays)} days >= ${rule.min_days}`);
    }
    if (rule.on_tier_crossing && d.crossedGovernanceTier) fired.push('governance tier threshold crossed');
    if (rule.on_scope_change && d.scopeChangedSinceV1) fired.push('scope changed');

    if (fired.length > 0) {
      reasons.push(`${rule.name} (${rule.required_level}): ${fired.join('; ')}`);
      if (LEVEL_RANK[rule.required_level] > LEVEL_RANK[best]) best = rule.required_level;
    }
  }
  return { requiredLevel: best, reasons };
}

export interface AttestationFlags {
  attestationMissing: boolean;
  belowRequiredLevel: boolean;
  retrospective: boolean;
  unverifiableAttribution: boolean;
  noEvidence: boolean;
}

// Derived, never stored. Surfaced in history and reports; nothing here blocks.
export function deriveFlags(
  requiredLevel: Level | null,
  attestation: { capacity: Capacity; decisionDate: string; hasUser: boolean; evidence: string | null } | null,
  changeRecordedDate: string
): AttestationFlags {
  const required = requiredLevel ?? 'none';
  return {
    attestationMissing: LEVEL_RANK[required] > 0 && attestation === null,
    belowRequiredLevel: attestation !== null && LEVEL_RANK[attestation.capacity] < LEVEL_RANK[required],
    retrospective: attestation !== null && attestation.decisionDate < changeRecordedDate,
    unverifiableAttribution: attestation !== null && !attestation.hasUser,
    noEvidence: attestation !== null && !(attestation.evidence && attestation.evidence.trim()),
  };
}
