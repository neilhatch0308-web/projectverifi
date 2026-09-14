import { promotedDemandLabel } from './promotedDemandLabel';

export interface StageStepperDemand {
  status: string; // raised | accepted | assessed | promoted | stopped
  business_case_decision: string | null;
  delivery_stage: 'delivery_started' | 'delivery_completed' | 'adoption_measured' | 'benefit_realized' | null;
  stop_reason: string | null;
}

const STAGE_KEYS = ['raised', 'accepted', 'assessed', 'decision', 'delivery', 'delivered', 'adoption', 'benefit'] as const;
type StageKey = typeof STAGE_KEYS[number];

const STAGE_LABEL: Record<StageKey, string> = {
  raised: 'Raised',
  accepted: 'Accepted',
  assessed: 'Assessed',
  decision: 'Business case',
  delivery: 'In delivery',
  delivered: 'Delivered',
  adoption: 'Adoption measured',
  benefit: 'Benefit realised',
};

// One line of "what happens next" for whichever stage is current -
// enough for someone who doesn't know the framework's own stage names
// to know what to expect, without turning this into a wizard.
const NEXT_STEP_HINT: Record<StageKey, string> = {
  raised: 'Next: triage sets a complexity and cost tier, then accepts it for assessment.',
  accepted: 'Next: an assessor reviews this and sets a P75 estimate.',
  assessed: 'Next: RACI seats are named and a business case is written up for decision.',
  decision: 'Next: once approved, delivery can be started.',
  delivery: 'Next: marked delivered once the change has actually gone live.',
  delivered: 'Next: adoption is measured once there has been time to use it.',
  adoption: 'Next: the actual benefit is recorded once it can be measured.',
  benefit: '',
};

function currentStageKey(d: StageStepperDemand): StageKey {
  if (d.status === 'raised') return 'raised';
  if (d.status === 'accepted') return 'accepted';
  if (d.status === 'assessed') return 'assessed';
  // status === 'promoted' from here on
  if (d.delivery_stage === 'benefit_realized') return 'benefit';
  if (d.delivery_stage === 'adoption_measured') return 'adoption';
  if (d.delivery_stage === 'delivery_completed') return 'delivered';
  if (d.delivery_stage === 'delivery_started') return 'delivery';
  return 'decision'; // approved-but-not-started, or still awaiting decision
}

/**
 * Full-path progress stepper for Demand Detail. Reuses the exact same
 * status/decision/delivery_stage fields promotedDemandLabel already
 * reads, so this can never show a different "current stage" from the
 * badge shown on My Home / All Demand. Stopped and Declined are shown
 * as their own terminal banners rather than forced into the spine -
 * they're valid endpoints, not a missing step.
 */
export function DemandStageStepper({ demand }: { demand: StageStepperDemand }) {
  if (demand.status === 'stopped') {
    return (
      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#b03a3a' }}>Stopped</span>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
          Not a verdict on the idea - just not moving forward right now.
          {demand.stop_reason && <> &mdash; "{demand.stop_reason}"</>}
        </div>
      </div>
    );
  }

  if (demand.business_case_decision === 'declined') {
    return (
      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#b03a3a' }}>Declined</span>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
          The business case was declined at decision - this demand has reached its terminal state.
        </div>
      </div>
    );
  }

  const currentKey = currentStageKey(demand);
  const currentIndex = STAGE_KEYS.indexOf(currentKey);
  const decisionLabel = currentKey === 'decision'
    ? promotedDemandLabel({ business_case_decision: demand.business_case_decision, delivery_stage: null })
    : STAGE_LABEL.decision;

  return (
    <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', margin: '4px 2px 2px' }}>
        <div style={{ position: 'absolute', top: 10, left: 14, right: 14, height: 2, background: 'var(--hairline)' }} />
        <div
          style={{
            position: 'absolute', top: 10, left: 14, height: 2, background: 'var(--teal)',
            width: `${(currentIndex / (STAGE_KEYS.length - 1)) * 100}%`,
          }}
        />
        {STAGE_KEYS.map((key, i) => {
          const done = i < currentIndex;
          const isCurrent = i === currentIndex;
          const label = key === 'decision' ? decisionLabel : STAGE_LABEL[key];
          return (
            <div key={key} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 68 }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%',
                background: done ? 'var(--teal)' : '#fff',
                border: isCurrent ? '2px solid var(--teal)' : done ? 'none' : '1px solid var(--hairline)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: done ? '#fff' : 'var(--teal)',
              }}>
                {done ? '\u2713' : ''}
              </div>
              <span style={{
                fontSize: 10.5, marginTop: 5, textAlign: 'center',
                color: isCurrent ? undefined : 'var(--muted)',
                fontWeight: isCurrent ? 600 : 400,
              }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
      {NEXT_STEP_HINT[currentKey] && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
          {NEXT_STEP_HINT[currentKey]}
        </div>
      )}
    </div>
  );
}