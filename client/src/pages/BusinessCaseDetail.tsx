import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface Raci {
  accountable_financial_name: string; accountable_scope_name: string;
  accountable_schedule_name: string; sponsor_name: string; benefit_owner_name: string;
}
interface Investment { approved_amount: number | null; actual_spend_to_date: number | null; }
interface Benefit { id: string; title: string; benefit_type: string; claimed_value: number | null; status: string; owner_name: string | null; }

interface BusinessCase {
  id: string; title: string; requested_spend: number | null;
  decision: string | null; decision_date: string | null;
  portfolio_name: string; sponsor_name: string | null; submitted_by_name: string | null;
  raci: Raci | null; investment: Investment | null; benefits: Benefit[];
}

interface User { id: string; display_name: string; }

export function BusinessCaseDetail() {
  const { id } = useParams();
  const [bc, setBc] = useState<BusinessCase | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [requestedSpend, setRequestedSpend] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [actualSpend, setActualSpend] = useState('');

  const [showAddBenefit, setShowAddBenefit] = useState(false);
  const [benefitTitle, setBenefitTitle] = useState('');
  const [benefitType, setBenefitType] = useState('');
  const [benefitValue, setBenefitValue] = useState('');
  const [benefitOwner, setBenefitOwner] = useState('');
  const [addingBenefit, setAddingBenefit] = useState(false);

  function load() {
    if (!id) return;
    setLoading(true);
    apiFetch(`/api/business-cases/${id}`)
      .then((data: BusinessCase) => {
        setBc(data);
        setRequestedSpend(data.requested_spend?.toString() ?? '');
        setApprovedAmount(data.investment?.approved_amount?.toString() ?? '');
        setActualSpend(data.investment?.actual_spend_to_date?.toString() ?? '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);
  useEffect(() => { apiFetch('/api/users').then(setUsers).catch(() => {}); }, []);

  async function saveRequestedSpend() {
    if (!id || !requestedSpend) return;
    try {
      await apiFetch(`/api/business-cases/${id}/requested-spend`, {
        method: 'PATCH', body: JSON.stringify({ requestedSpend: Number(requestedSpend) }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  async function saveInvestment() {
    if (!id) return;
    try {
      await apiFetch(`/api/business-cases/${id}/investment`, {
        method: 'PUT',
        body: JSON.stringify({
          approvedAmount: approvedAmount ? Number(approvedAmount) : undefined,
          actualSpendToDate: actualSpend ? Number(actualSpend) : undefined,
        }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  async function handleAddBenefit(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setAddingBenefit(true);
    try {
      await apiFetch(`/api/business-cases/${id}/benefits`, {
        method: 'POST',
        body: JSON.stringify({
          title: benefitTitle,
          benefitType,
          claimedValue: benefitValue ? Number(benefitValue) : undefined,
          ownerUserId: benefitOwner,
        }),
      });
      setBenefitTitle(''); setBenefitType(''); setBenefitValue(''); setBenefitOwner('');
      setShowAddBenefit(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add benefit');
    } finally {
      setAddingBenefit(false);
    }
  }

  async function recordDecision(decision: 'approved' | 'declined') {
    if (!id) return;
    try {
      await apiFetch(`/api/business-cases/${id}/decision`, {
        method: 'POST', body: JSON.stringify({ decision }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record decision');
    }
  }

  if (loading) return <p>Loading...</p>;
  if (error) return <p className="login-error">{error}</p>;
  if (!bc) return <p>Not found.</p>;

  const inputStyle = { width: '100%', padding: 8, border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13 };
  const remainingBenefit = bc.benefits.reduce((sum, b) => sum + (b.claimed_value ?? 0), 0) - (bc.investment?.actual_spend_to_date ?? 0);

  return (
    <div style={{ maxWidth: 660 }}>
      {bc.title && (
        <Link to={`/demand`} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>&larr; Back to All Demand</Link>
      )}

      <h1 className="page-title" style={{ marginTop: 12 }}>{bc.title}</h1>
      <p className="page-subtitle">
        {bc.portfolio_name}
        {bc.sponsor_name && <> &middot; sponsor {bc.sponsor_name}</>}
        {bc.submitted_by_name && <> &middot; submitted by {bc.submitted_by_name}</>}
      </p>

      {bc.decision && (
        <div style={{ marginBottom: '1.25rem' }}>
          <span className={`pill ${bc.decision === 'approved' ? 'pill--teal' : 'pill--muted'}`} style={{ textTransform: 'capitalize' }}>
            {bc.decision} {bc.decision_date && `on ${new Date(bc.decision_date).toLocaleDateString()}`}
          </span>
        </div>
      )}

      {bc.raci && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta" style={{ marginBottom: 8 }}>RACI (named at demand acceptance)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
            <div><strong>Financial:</strong> {bc.raci.accountable_financial_name}</div>
            <div><strong>Scope:</strong> {bc.raci.accountable_scope_name}</div>
            <div><strong>Schedule:</strong> {bc.raci.accountable_schedule_name}</div>
            <div><strong>Sponsor:</strong> {bc.raci.sponsor_name}</div>
            <div><strong>Benefit Owner:</strong> {bc.raci.benefit_owner_name}</div>
          </div>
        </div>
      )}

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta" style={{ marginBottom: 8 }}>Requested spend</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" value={requestedSpend} onChange={(e) => setRequestedSpend(e.target.value)}
            placeholder="GBP" style={{ ...inputStyle, maxWidth: 160 }} />
          <button onClick={saveRequestedSpend} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px' }}>Save</button>
        </div>
      </div>

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta" style={{ marginBottom: 8 }}>Investment tracking</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Approved amount</label>
            <input type="number" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Actual spend to date</label>
            <input type="number" value={actualSpend} onChange={(e) => setActualSpend(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <button onClick={saveInvestment} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px', marginTop: 10 }}>Save investment</button>
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="goal-card__meta">Benefits claimed</div>
          <button onClick={() => setShowAddBenefit((s) => !s)} className="btn btn--outline" style={{ fontSize: 12, padding: '4px 10px' }}>+ Add benefit</button>
        </div>

        {showAddBenefit && (
          <form onSubmit={handleAddBenefit} className="goal-card" style={{ marginBottom: 8 }}>
            <div className="login-field"><label>Title</label>
              <input type="text" value={benefitTitle} onChange={(e) => setBenefitTitle(e.target.value)} required /></div>
            <div className="login-field"><label>Type</label>
              <input type="text" placeholder="e.g. cost_saving, revenue, efficiency_hours" value={benefitType} onChange={(e) => setBenefitType(e.target.value)} required /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="login-field" style={{ marginBottom: 0 }}><label>Claimed value (GBP)</label>
                <input type="number" value={benefitValue} onChange={(e) => setBenefitValue(e.target.value)} /></div>
              <div className="login-field" style={{ marginBottom: 0 }}><label>Owner</label>
                <select value={benefitOwner} onChange={(e) => setBenefitOwner(e.target.value)} required style={inputStyle}>
                  <option value="">Select</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select></div>
            </div>
            <button type="submit" disabled={addingBenefit} className="btn btn--project" style={{ marginTop: 10 }}>
              {addingBenefit ? 'Adding...' : 'Add benefit'}
            </button>
          </form>
        )}

        {bc.benefits.map((b) => (
          <div key={b.id} className="goal-card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{b.title}</span>
              {b.claimed_value !== null && <span className="pill pill--indigo">GBP {b.claimed_value}</span>}
            </div>
            <div className="goal-card__meta" style={{ marginTop: 4 }}>{b.benefit_type} &middot; owner: {b.owner_name ?? 'unassigned'} &middot; {b.status}</div>
          </div>
        ))}
        {bc.benefits.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No benefits recorded yet.</p>}
      </div>

      {bc.investment && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta">Cost-to-benefit read (manual reference only - not yet an automated flag)</div>
          <div className="goal-card__desc" style={{ marginTop: 6 }}>
            Claimed benefit total minus actual spend to date: <strong>GBP {remainingBenefit.toFixed(0)}</strong>
            {remainingBenefit < 0 && <span style={{ color: '#c23' }}> - spend currently exceeds claimed benefit</span>}
          </div>
        </div>
      )}

      {!bc.decision && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => recordDecision('approved')} className="btn btn--project">Approve spend</button>
          <button onClick={() => recordDecision('declined')} className="btn btn--outline">Decline</button>
        </div>
      )}
    </div>
  );
}
