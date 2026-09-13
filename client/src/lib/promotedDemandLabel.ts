export const DELIVERY_STAGE_LABELS: Record<string, string> = {
  delivery_started: 'In delivery',
  delivery_completed: 'Delivered',
  adoption_measured: 'Adoption measured',
  benefit_realized: 'Benefit realised',
};

export interface PromotedDemandLike {
  business_case_decision: string | null;
  delivery_stage: 'delivery_started' | 'delivery_completed' | 'adoption_measured' | 'benefit_realized' | null;
}

/**
 * The label for a promoted demand's current furthest-reached state --
 * declined, approved-but-not-yet-in-delivery, or wherever it's gotten
 * to in delivery/adoption/benefit tracking. One function so every page
 * that shows this label (My Home, All Demand) computes it the same
 * way rather than each re-deriving its own version of the priority
 * order.
 */
export function promotedDemandLabel(d: PromotedDemandLike): string {
  if (d.business_case_decision && d.business_case_decision !== 'pending' && d.business_case_decision !== 'approved') {
    return d.business_case_decision; // e.g. declined
  }
  if (d.delivery_stage) return DELIVERY_STAGE_LABELS[d.delivery_stage];
  if (d.business_case_decision === 'approved') return 'Approved';
  // Deliberately NOT "Progressed" - that's the column/stage name on
  // All Demand's board, and a card saying "Progressed" inside a column
  // called "Progressed" tells you nothing you didn't already know from
  // the column header. This is the one state where nothing has
  // happened on the case yet, so the label should say exactly what's
  // needed next instead of repeating the stage name.
  return 'Awaiting decision';
}
