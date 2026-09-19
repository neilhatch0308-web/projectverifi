import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { CollapsibleSection } from './CollapsibleSection';

// My Home panel for post-approval change control (step 4).
// Three lists, all from one composed endpoint (GET /api/me/change-control):
//   1. Attributed to me - a change recorded in my name as the decider.
//      I can confirm it, or dispute it with a reason. Disputing does not
//      reverse the change; it flags it for a human to resolve.
//   2. Disputed - changes I recorded that the named decider disputed.
//   3. Held - changes I recorded that are waiting because the named
//      decider cannot yet see the (confidential) demand.
// Renders nothing at all when there is nothing to show, so it costs
// no space on a quiet day. A failure here never blanks My Home: it
// loads and fails on its own.

interface Flags {
  attestationMissing: boolean; belowRequiredLevel: boolean; retrospective: boolean;
  unverifiableAttribution: boolean; noEvidence: boolean;
}
interface Pair<T> { prior: T | null; now: T | null }
interface Attributed {
  changeRequestId: string; demandId: string; businessCaseId: string; demandTitle: string; confidential: boolean;
  reason: string; recordedByName: string; requiredLevel: string | null; versionNumber: number;
  change: { cost: Pair<number>; benefit: Pair<number>; endDate: Pair<string>; scope: Pair<string> };
  decisionCapacity: string; decisionDate: string; evidenceReference: string | null;
  status: 'unconfirmed' | 'confirmed' | 'disputed'; responseReason: string | null; respondedAt: string | null;
  daysUnconfirmed: number | null; flags: Flags;
}
interface Disputed {
  change_request_id: string; business_case_id: string; demand_title: string; confidential: boolean; reason: string;
  decider_name: string | null; decision_capacity: string; response_reason: string; responded_at: string;
}
interface Held {
  change_request_id: string; business_case_id: string; demand_title: string; confidential: boolean; reason: string;
  days_held: number; decider_name: string | null; overdue: boolean; flagAfterDays: number;
}
interface Summary { attributedToMe: Attributed[]; disputedRecordedByMe: Disputed[]; heldRecordedByMe: Held[] }

const gbp = (v: number | null) => (v === null ? 'n/a' : `GBP ${Number(v).toLocaleString()}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function movement(label: string, p: Pair<any>, fmt: (v: any) => string) {
  if (p.prior === p.now) return null;
  return <div key={label}>{label}: {fmt(p.prior)} {'->'} <strong>{fmt(p.now)}</strong></div>;
}

function AttributedRow({ item, onDone }: { item: Attributed; onDone: () => void }) {
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function respond(response: 'confirmed' | 'disputed') {
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/api/change-requests/${item.changeRequestId}/responses`, {
        method: 'POST',
        body: JSON.stringify({ response, reason: response === 'disputed' ? reason : undefined }),
      });
      setDisputing(false); setReason('');
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const statusPill =
    item.status === 'confirmed' ? <span className="pill pill--teal" style={{ fontSize: 9.5, padding: '2px 6px' }}>Confirmed</span>
    : item.status === 'disputed' ? <span className="pill" style={{ fontSize: 9.5, padding: '2px 6px', background: 'rgba(204,34,34,0.12)', color: '#c22' }}>Disputed</span>
    : <span className="pill pill--indigo" style={{ fontSize: 9.5, padding: '2px 6px' }}>
        Unconfirmed{item.daysUnconfirmed !== null ? ` ${item.daysUnconfirmed}d` : ''}
      </span>;

  return (
    <div style={{ padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, marginBottom: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <Link to={`/business-case/${item.businessCaseId}`} style={{ fontWeight: 600, color: 'inherit' }}>{item.demandTitle}</Link>
          {item.confidential && (
            <span title="Confidential" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#c22', marginLeft: 7, verticalAlign: 'middle' }} />
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Baseline v{item.versionNumber} recorded by {item.recordedByName}, attributed to you as {item.decisionCapacity}
            {' '}(decided {item.decisionDate}{item.evidenceReference ? `, evidence: ${item.evidenceReference}` : ', no evidence reference'})
          </div>
        </div>
        {statusPill}
      </div>

      <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
        {movement('Approved cost', item.change.cost, gbp)}
        {movement('Benefit', item.change.benefit, gbp)}
        {movement('Planned end', item.change.endDate, (v) => v ?? 'n/a')}
        {movement('Scope', item.change.scope, (v) => v ?? 'n/a')}
        <div style={{ color: 'var(--muted)', marginTop: 4 }}>Reason: {item.reason}</div>
      </div>

      {(item.flags.belowRequiredLevel || item.flags.retrospective || item.flags.noEvidence) && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {item.flags.belowRequiredLevel && (
            <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px' }}>
              Needed {item.requiredLevel ? cap(item.requiredLevel) : 'higher'} level
            </span>
          )}
          {item.flags.retrospective && <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px' }}>Retrospective</span>}
          {item.flags.noEvidence && <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px' }}>No evidence</span>}
        </div>
      )}

      {item.status === 'disputed' && item.responseReason && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>Your dispute: {item.responseReason}</div>
      )}

      {!disputing && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          {item.status !== 'confirmed' && (
            <button className="btn btn--project" disabled={busy} onClick={() => respond('confirmed')} style={{ fontSize: 12, padding: '6px 12px' }}>
              Confirm
            </button>
          )}
          {item.status !== 'disputed' && (
            <button className="btn btn--outline" disabled={busy} onClick={() => setDisputing(true)} style={{ fontSize: 12, padding: '6px 12px' }}>
              Dispute
            </button>
          )}
        </div>
      )}

      {disputing && (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Why do you dispute this? A reason is required. The change stays in place and is flagged for review."
            style={{ width: '100%', boxSizing: 'border-box', padding: 8, border: '1px solid var(--hairline)', borderRadius: 8, font: 'inherit', fontSize: 12 }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="btn btn--outline" disabled={busy || reason.trim().length === 0} onClick={() => respond('disputed')} style={{ fontSize: 12, padding: '6px 12px' }}>
              Submit dispute
            </button>
            <button className="btn btn--outline" disabled={busy} onClick={() => { setDisputing(false); setReason(''); }} style={{ fontSize: 12, padding: '6px 12px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && <p className="login-error" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}

export function ChangeControlPanel({ hideConfidential }: { hideConfidential: boolean }) {
  const [data, setData] = useState<Summary | null>(null);

  const load = useCallback(() => {
    apiFetch('/api/me/change-control').then(setData).catch(() => setData(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return null;

  const attributed = data.attributedToMe.filter((a) => !hideConfidential || !a.confidential);
  const disputed = data.disputedRecordedByMe.filter((d) => !hideConfidential || !d.confidential);
  const held = data.heldRecordedByMe.filter((h) => !hideConfidential || !h.confidential);
  const total = attributed.length + disputed.length + held.length;
  if (total === 0) return null;

  const unconfirmed = attributed.filter((a) => a.status === 'unconfirmed').length;

  return (
    <div style={{ marginTop: 24 }}>
      <CollapsibleSection title="Changes needing you" count={unconfirmed + disputed.length + held.length} variant="section">
        {attributed.length > 0 && (
          <CollapsibleSection title="Decisions attributed to you" count={attributed.length}>
            {attributed.map((a) => <AttributedRow key={a.changeRequestId} item={a} onDone={load} />)}
          </CollapsibleSection>
        )}

        {disputed.length > 0 && (
          <CollapsibleSection title="Disputed changes you recorded" count={disputed.length}>
            {disputed.map((d) => (
              <Link key={d.change_request_id} to={`/business-case/${d.business_case_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, marginBottom: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{d.demand_title}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {d.decider_name ?? 'The named decider'} disputed this on {new Date(d.responded_at).toLocaleDateString()}: {d.response_reason}
                  </div>
                </div>
              </Link>
            ))}
          </CollapsibleSection>
        )}

        {held.length > 0 && (
          <CollapsibleSection title="Held changes you recorded" count={held.length}>
            {held.map((h) => (
              <Link key={h.change_request_id} to={`/business-case/${h.business_case_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, marginBottom: 8, fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{h.demand_title}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      Not applied: {h.decider_name ?? 'the named decider'} cannot see this demand yet. Add them as a viewer, re-attribute, or withdraw.
                    </div>
                  </div>
                  <span className={h.overdue ? 'pill' : 'pill pill--indigo'} style={{
                    fontSize: 9.5, padding: '2px 6px',
                    ...(h.overdue ? { background: 'rgba(204,34,34,0.12)', color: '#c22' } : {}),
                  }}>
                    Held {h.days_held}d
                  </span>
                </div>
              </Link>
            ))}
          </CollapsibleSection>
        )}
      </CollapsibleSection>
    </div>
  );
}
