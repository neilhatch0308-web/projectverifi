import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, apiDownload } from '../lib/apiClient';
import { usePermissions } from '../context/PermissionsContext';

interface Raci {
  accountable_financial_name: string; accountable_scope_name: string;
  accountable_schedule_name: string; sponsor_name: string; benefit_owner_name: string;
}
interface Investment { approved_amount: number | null; actual_spend_to_date: number | null; }
interface Benefit {
  id: string; title: string; benefit_type: string; claimed_value: number | null; status: string;
  owner_name: string | null; recurrence: 'one_time' | 'annual' | 'multi_year_lump_sum' | null;
  duration_years: number | null;
}
interface StrategicGoal { goal_name: string; goal_year: number; alignment_notes: string | null; }
interface Estimate {
  claimed_cost: number | null; claimed_benefit: number | null;
  assessed_cost: number | null; assessed_benefit: number | null;
  cost_confidence: string | null; benefit_confidence: string | null;
}
interface Risk {
  id: string; description: string; category: string; likelihood: string; impact: string;
  mitigation: string | null; status: string; created_at: string; owner_name: string | null;
}
interface Governance {
  required_approvers: string[];
  required_documents: string[];
  highest_tier_name: string | null;
  highest_tier_threshold: number | null;
  requiresFinanceImpactAssessment: boolean;
}
interface FinanceImpactAssessment {
  id: string;
  funding_source: string | null;
  cost_centre: string | null;
  capex_amount: number | null;
  opex_amount: number | null;
  ongoing_annual_cost: number | null;
  funding_period_months: number | null;
  financial_narrative: string | null;
  status: 'draft' | 'completed';
  prepared_at: string | null;
  prepared_by_name: string | null;
}

interface BusinessCase {
  id: string; title: string; requested_spend: number | null;
  decision: string | null; decision_date: string | null;
  portfolio_name: string; sponsor_name: string | null; submitted_by_name: string | null;
  executive_summary: string | null; problem_statement: string | null;
  raci: Raci | null; investment: Investment | null; benefits: Benefit[];
  strategicGoal: StrategicGoal | null; estimate: Estimate | null; risks: Risk[];
  governance: Governance; financeImpactAssessment: FinanceImpactAssessment | null;
}

interface User { id: string; display_name: string; }

export function BusinessCaseDetail() {
  const { id } = useParams();
  const { has } = usePermissions();
  const [bc, setBc] = useState<BusinessCase | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  // loadError = the initial fetch failed, nothing to show at all - the
  // only case that should replace the whole page.
  // error = an ACTION failed (save, decision, etc.) - shown inline,
  // alongside the still-fully-rendered page, so whatever the person was
  // doing (e.g. typing a reason) isn't wiped out by their own mistake.
  // These were both the same state before, which meant a routine
  // "reason required" validation message destroyed the entire page,
  // including the reason field needed to actually fix it - a dead end.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [requestedSpend, setRequestedSpend] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  // Only meaningful once bc.decision === 'approved' - the server
  // requires and logs a reason for these two fields at that point
  // (migration 54, business_case_revision), but the client never had a
  // field to actually provide one, so every attempt failed with no way
  // to recover short of a raw API call.
  const [requestedSpendReason, setRequestedSpendReason] = useState('');
  const [approvedAmountReason, setApprovedAmountReason] = useState('');
  const [actualSpend, setActualSpend] = useState('');

  const [executiveSummary, setExecutiveSummary] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [savingNarrative, setSavingNarrative] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [showAddRisk, setShowAddRisk] = useState(false);
  const [riskDescription, setRiskDescription] = useState('');
  const [riskCategory, setRiskCategory] = useState<'delivery' | 'business'>('delivery');
  const [riskLikelihood, setRiskLikelihood] = useState<'low' | 'medium' | 'high'>('medium');
  const [riskImpact, setRiskImpact] = useState<'low' | 'medium' | 'high'>('medium');
  const [riskMitigation, setRiskMitigation] = useState('');
  const [riskOwner, setRiskOwner] = useState('');
  const [addingRisk, setAddingRisk] = useState(false);

  const [fiaFundingSource, setFiaFundingSource] = useState('');
  const [fiaCostCentre, setFiaCostCentre] = useState('');
  const [fiaCapex, setFiaCapex] = useState('');
  const [fiaOpex, setFiaOpex] = useState('');
  const [fiaOngoingCost, setFiaOngoingCost] = useState('');
  const [fiaFundingPeriod, setFiaFundingPeriod] = useState('');
  const [fiaNarrative, setFiaNarrative] = useState('');
  const [savingFia, setSavingFia] = useState(false);

  const [showAddBenefit, setShowAddBenefit] = useState(false);
  const [benefitTitle, setBenefitTitle] = useState('');
  const [benefitType, setBenefitType] = useState('');
  const [benefitValue, setBenefitValue] = useState('');
  const [benefitOwner, setBenefitOwner] = useState('');
  const [benefitRecurrence, setBenefitRecurrence] = useState<'one_time' | 'annual' | 'multi_year_lump_sum' | ''>('');
  const [benefitDuration, setBenefitDuration] = useState('');
  const [addingBenefit, setAddingBenefit] = useState(false);
  const [classifyingBenefitId, setClassifyingBenefitId] = useState<string | null>(null);
  const [classifyRecurrence, setClassifyRecurrence] = useState<'one_time' | 'annual' | 'multi_year_lump_sum' | ''>('');
  const [classifyDuration, setClassifyDuration] = useState('');
  const [classifyError, setClassifyError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    apiFetch(`/api/business-cases/${id}`)
      .then((data: BusinessCase) => {
        setBc(data);
        setRequestedSpend(data.requested_spend?.toString() ?? '');
        setApprovedAmount(data.investment?.approved_amount?.toString() ?? '');
        setActualSpend(data.investment?.actual_spend_to_date?.toString() ?? '');
        setExecutiveSummary(data.executive_summary ?? '');
        setProblemStatement(data.problem_statement ?? '');
        if (data.financeImpactAssessment) {
          const fia = data.financeImpactAssessment;
          setFiaFundingSource(fia.funding_source ?? '');
          setFiaCostCentre(fia.cost_centre ?? '');
          setFiaCapex(fia.capex_amount?.toString() ?? '');
          setFiaOpex(fia.opex_amount?.toString() ?? '');
          setFiaOngoingCost(fia.ongoing_annual_cost?.toString() ?? '');
          setFiaFundingPeriod(fia.funding_period_months?.toString() ?? '');
          setFiaNarrative(fia.financial_narrative ?? '');
        }
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);
  useEffect(() => { apiFetch('/api/users').then(setUsers).catch(() => {}); }, []);

  async function saveRequestedSpend() {
    if (!id || !requestedSpend) return;
    try {
      await apiFetch(`/api/business-cases/${id}/requested-spend`, {
        method: 'PATCH',
        body: JSON.stringify({
          requestedSpend: Number(requestedSpend),
          reason: requestedSpendReason.trim() || undefined,
        }),
      });
      setRequestedSpendReason('');
      setError(null);
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
          reason: approvedAmountReason.trim() || undefined,
        }),
      });
      setApprovedAmountReason('');
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  async function handleAddBenefit(e: FormEvent) {
    e.preventDefault();
    if (!id || !benefitRecurrence) return;
    setAddingBenefit(true);
    try {
      await apiFetch(`/api/business-cases/${id}/benefits`, {
        method: 'POST',
        body: JSON.stringify({
          title: benefitTitle,
          benefitType,
          claimedValue: benefitValue ? Number(benefitValue) : undefined,
          ownerUserId: benefitOwner,
          recurrence: benefitRecurrence,
          durationYears: benefitRecurrence !== 'one_time' && benefitDuration ? Number(benefitDuration) : undefined,
        }),
      });
      setBenefitTitle(''); setBenefitType(''); setBenefitValue(''); setBenefitOwner('');
      setBenefitRecurrence(''); setBenefitDuration('');
      setShowAddBenefit(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add benefit');
    } finally {
      setAddingBenefit(false);
    }
  }

  async function saveClassification(benefitId: string) {
    if (!id || !classifyRecurrence) return;
    setClassifyError(null);
    try {
      await apiFetch(`/api/business-cases/${id}/benefits/${benefitId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          recurrence: classifyRecurrence,
          durationYears: classifyRecurrence !== 'one_time' && classifyDuration ? Number(classifyDuration) : null,
        }),
      });
      setClassifyingBenefitId(null);
      load();
    } catch (err) {
      setClassifyError(err instanceof Error ? err.message : 'Could not save classification.');
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

  async function saveNarrative() {
    if (!id) return;
    setSavingNarrative(true);
    try {
      await apiFetch(`/api/business-cases/${id}/narrative`, {
        method: 'PATCH',
        body: JSON.stringify({ executiveSummary, problemStatement }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingNarrative(false);
    }
  }

  async function downloadPdf() {
    if (!id || !bc) return;
    setDownloading(true);
    try {
      await apiDownload(`/api/business-cases/${id}/export.pdf`, `${bc.title || 'business-case'}-summary.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download PDF');
    } finally {
      setDownloading(false);
    }
  }

  async function handleAddRisk(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setAddingRisk(true);
    try {
      await apiFetch(`/api/business-cases/${id}/risks`, {
        method: 'POST',
        body: JSON.stringify({
          description: riskDescription,
          category: riskCategory,
          likelihood: riskLikelihood,
          impact: riskImpact,
          mitigation: riskMitigation || undefined,
          ownerUserId: riskOwner || undefined,
        }),
      });
      setRiskDescription(''); setRiskMitigation(''); setRiskOwner('');
      setRiskCategory('delivery'); setRiskLikelihood('medium'); setRiskImpact('medium');
      setShowAddRisk(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add risk');
    } finally {
      setAddingRisk(false);
    }
  }

  async function updateRiskStatus(riskId: string, status: string) {
    if (!id) return;
    try {
      await apiFetch(`/api/business-cases/${id}/risks/${riskId}`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update risk');
    }
  }

  async function saveFia(status: 'draft' | 'completed') {
    if (!id) return;
    setSavingFia(true);
    try {
      await apiFetch(`/api/business-cases/${id}/finance-impact-assessment`, {
        method: 'PUT',
        body: JSON.stringify({
          fundingSource: fiaFundingSource || undefined,
          costCentre: fiaCostCentre || undefined,
          capexAmount: fiaCapex ? Number(fiaCapex) : undefined,
          opexAmount: fiaOpex ? Number(fiaOpex) : undefined,
          ongoingAnnualCost: fiaOngoingCost ? Number(fiaOngoingCost) : undefined,
          fundingPeriodMonths: fiaFundingPeriod ? Number(fiaFundingPeriod) : undefined,
          financialNarrative: fiaNarrative || undefined,
          status,
        }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save finance impact assessment');
    } finally {
      setSavingFia(false);
    }
  }

  if (loading) return <p>Loading...</p>;
  if (loadError) return <p className="login-error">{loadError}</p>;
  if (!bc) return <p>Not found.</p>;

  const inputStyle = { width: '100%', padding: 8, border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13 };
  const oneTimeBenefits = bc.benefits.filter((b) => b.recurrence === 'one_time');
  const annualBenefits = bc.benefits.filter((b) => b.recurrence === 'annual');
  const lumpSumBenefits = bc.benefits.filter((b) => b.recurrence === 'multi_year_lump_sum');
  const unclassifiedBenefits = bc.benefits.filter((b) => !b.recurrence);

  const oneTimeTotal = oneTimeBenefits.reduce((sum, b) => sum + Number(b.claimed_value ?? 0), 0);
  const annualTotal = annualBenefits.reduce((sum, b) => sum + Number(b.claimed_value ?? 0), 0);
  const lumpSumTotal = lumpSumBenefits.reduce((sum, b) => sum + Number(b.claimed_value ?? 0), 0);
  const unclassifiedTotal = unclassifiedBenefits.reduce((sum, b) => sum + Number(b.claimed_value ?? 0), 0);

  // Only true totals (one-time + multi-year lump sum) are compared
  // against cumulative spend -- an annual RATE isn't directly
  // comparable to a point-in-time spend figure without picking a
  // horizon to normalize against, which is exactly the kind of silent
  // assumption this framework avoids making on someone's behalf.
  const comparableBenefitTotal = oneTimeTotal + lumpSumTotal;
  const remainingBenefit = comparableBenefitTotal - Number(bc.investment?.actual_spend_to_date ?? 0);

  return (
    <div style={{ maxWidth: 660 }}>
      {error && (
        <div className="login-error" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'inherit', textDecoration: 'underline', flexShrink: 0, marginLeft: 12 }}
          >
            Dismiss
          </button>
        </div>
      )}
      {bc.title && (
        <Link to={`/demand`} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>&larr; Back to All Demand</Link>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 12 }}>
        <h1 className="page-title" style={{ margin: 0 }}>{bc.title}</h1>
        <button onClick={downloadPdf} disabled={downloading} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}>
          {downloading ? 'Preparing...' : 'Download PDF'}
        </button>
      </div>
      <p className="page-subtitle">
        {bc.portfolio_name}
        {bc.sponsor_name && <> &middot; sponsor {bc.sponsor_name}</>}
        {bc.submitted_by_name && <> &middot; submitted by {bc.submitted_by_name}</>}
      </p>

      {bc.decision && bc.decision !== 'pending' && (
        <div style={{ marginBottom: '1.25rem' }}>
          <span className={`pill ${bc.decision === 'approved' ? 'pill--teal' : 'pill--muted'}`} style={{ textTransform: 'capitalize' }}>
            {bc.decision} {bc.decision_date && `on ${new Date(bc.decision_date).toLocaleDateString()}`}
          </span>
        </div>
      )}

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta" style={{ marginBottom: 8 }}>Executive summary</div>
        <textarea
          value={executiveSummary}
          onChange={(e) => setExecutiveSummary(e.target.value)}
          rows={4}
          placeholder="Concise overview - key outcomes, costs and benefits, decision required."
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <div className="goal-card__meta" style={{ marginTop: 12, marginBottom: 8 }}>Problem / opportunity statement</div>
        <textarea
          value={problemStatement}
          onChange={(e) => setProblemStatement(e.target.value)}
          rows={4}
          placeholder="What issue or gap exists today, and why it matters."
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        {has('business_case.edit') && (
          <button onClick={saveNarrative} disabled={savingNarrative} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px', marginTop: 10 }}>
            {savingNarrative ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta" style={{ marginBottom: 8 }}>Strategic alignment</div>
        {bc.strategicGoal ? (
          <div style={{ fontSize: 13 }}>
            <div><strong>{bc.strategicGoal.goal_name}</strong> ({bc.strategicGoal.goal_year})</div>
            {bc.strategicGoal.alignment_notes && (
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>{bc.strategicGoal.alignment_notes}</div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>Not linked to a declared strategic goal.</p>
        )}
      </div>

      {bc.estimate && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta" style={{ marginBottom: 8 }}>Financial position (anchored estimate)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>Claimed at raise (P50)</div>
              <div>Cost: {bc.estimate.claimed_cost != null ? `GBP ${Number(bc.estimate.claimed_cost).toLocaleString()}` : '—'}</div>
              <div>Benefit: {bc.estimate.claimed_benefit != null ? `GBP ${Number(bc.estimate.claimed_benefit).toLocaleString()}` : '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>Assessed (P75)</div>
              <div>Cost: {bc.estimate.assessed_cost != null ? `GBP ${Number(bc.estimate.assessed_cost).toLocaleString()}` : '—'}
                {bc.estimate.cost_confidence && <span className="pill pill--muted" style={{ marginLeft: 6, fontSize: 10 }}>{bc.estimate.cost_confidence}</span>}
              </div>
              <div>Benefit: {bc.estimate.assessed_benefit != null ? `GBP ${Number(bc.estimate.assessed_benefit).toLocaleString()}` : '—'}
                {bc.estimate.benefit_confidence && <span className="pill pill--muted" style={{ marginLeft: 6, fontSize: 10 }}>{bc.estimate.benefit_confidence}</span>}
              </div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, marginBottom: 0 }}>
            Read from the demand's raise and assessment stages - the original claim is never overwritten here.
          </p>
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
        <div className="goal-card__meta" style={{ marginBottom: 8 }}>
          Governance requirements {bc.governance.highest_tier_name && `- ${bc.governance.highest_tier_name}`}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
          Based on requested spend. Cumulative - includes everything from lower tiers too.
          This is a checklist, not a gate: it doesn't block approval or submission.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 13 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Required approvers</div>
            {bc.governance.required_approvers.length > 0 ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {bc.governance.required_approvers.map((a) => <span key={a} className="pill pill--indigo">{a}</span>)}
              </div>
            ) : <span style={{ color: 'var(--muted)' }}>None configured</span>}
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Required documents</div>
            {bc.governance.required_documents.length > 0 ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {bc.governance.required_documents.map((d) => <span key={d} className="pill pill--muted">{d}</span>)}
              </div>
            ) : <span style={{ color: 'var(--muted)' }}>None configured</span>}
          </div>
        </div>
      </div>

      {bc.governance.requiresFinanceImpactAssessment && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="goal-card__meta">Finance impact assessment</div>
            {bc.financeImpactAssessment && (
              <span className={`pill ${bc.financeImpactAssessment.status === 'completed' ? 'pill--teal' : 'pill--muted'}`} style={{ textTransform: 'capitalize' }}>
                {bc.financeImpactAssessment.status}
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="login-field" style={{ marginBottom: 0 }}><label>Funding source</label>
              <input type="text" value={fiaFundingSource} onChange={(e) => setFiaFundingSource(e.target.value)} style={inputStyle} /></div>
            <div className="login-field" style={{ marginBottom: 0 }}><label>Cost centre</label>
              <input type="text" value={fiaCostCentre} onChange={(e) => setFiaCostCentre(e.target.value)} style={inputStyle} /></div>
            <div className="login-field" style={{ marginBottom: 0 }}><label>Capex (GBP)</label>
              <input type="number" value={fiaCapex} onChange={(e) => setFiaCapex(e.target.value)} style={inputStyle} /></div>
            <div className="login-field" style={{ marginBottom: 0 }}><label>Opex (GBP)</label>
              <input type="number" value={fiaOpex} onChange={(e) => setFiaOpex(e.target.value)} style={inputStyle} /></div>
            <div className="login-field" style={{ marginBottom: 0 }}><label>Ongoing annual cost (GBP)</label>
              <input type="number" value={fiaOngoingCost} onChange={(e) => setFiaOngoingCost(e.target.value)} style={inputStyle} /></div>
            <div className="login-field" style={{ marginBottom: 0 }}><label>Funding period (months)</label>
              <input type="number" value={fiaFundingPeriod} onChange={(e) => setFiaFundingPeriod(e.target.value)} style={inputStyle} /></div>
          </div>
          <div className="login-field" style={{ marginTop: 10 }}><label>Financial narrative</label>
            <textarea value={fiaNarrative} onChange={(e) => setFiaNarrative(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} /></div>
          {has('business_case.edit') && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => saveFia('draft')} disabled={savingFia} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px' }}>
                {savingFia ? 'Saving...' : 'Save draft'}
              </button>
              <button onClick={() => saveFia('completed')} disabled={savingFia} className="btn btn--project" style={{ fontSize: 12, padding: '6px 12px' }}>
                Mark completed
              </button>
            </div>
          )}
          {bc.financeImpactAssessment?.status === 'completed' && bc.financeImpactAssessment.prepared_by_name && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              Completed by {bc.financeImpactAssessment.prepared_by_name}
              {bc.financeImpactAssessment.prepared_at && ` on ${new Date(bc.financeImpactAssessment.prepared_at).toLocaleDateString()}`}
            </div>
          )}
        </div>
      )}

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta" style={{ marginBottom: 8 }}>Requested spend</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" value={requestedSpend} onChange={(e) => setRequestedSpend(e.target.value)}
            placeholder="GBP" style={{ ...inputStyle, maxWidth: 160 }} />
          <button onClick={saveRequestedSpend} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px' }}>Save</button>
        </div>
        {bc.decision === 'approved' && (
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4, color: 'var(--muted)' }}>
              Reason for change (required - this case is approved, and the change will be logged)
            </label>
            <input
              type="text"
              value={requestedSpendReason}
              onChange={(e) => setRequestedSpendReason(e.target.value)}
              placeholder="Why is this changing?"
              style={inputStyle}
            />
          </div>
        )}
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
        {bc.decision === 'approved' && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4, color: 'var(--muted)' }}>
              Reason for change to Approved amount (required once approved - Actual spend is always free to update and doesn't need one)
            </label>
            <input
              type="text"
              value={approvedAmountReason}
              onChange={(e) => setApprovedAmountReason(e.target.value)}
              placeholder="Why is the approved amount changing?"
              style={inputStyle}
            />
          </div>
        )}
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
            <div style={{ display: 'grid', gridTemplateColumns: benefitRecurrence === 'one_time' || !benefitRecurrence ? '1fr' : '1fr 1fr', gap: 10, marginTop: 10 }}>
              <div className="login-field" style={{ marginBottom: 0 }}>
                <label>How is this figure shaped over time?</label>
                <select
                  value={benefitRecurrence}
                  onChange={(e) => setBenefitRecurrence(e.target.value as typeof benefitRecurrence)}
                  required
                  style={inputStyle}
                >
                  <option value="">Select</option>
                  <option value="one_time">One-time — a single flat amount</option>
                  <option value="annual">Annual — claimed value is the per-year rate</option>
                  <option value="multi_year_lump_sum">Multi-year lump sum — claimed value is already a total</option>
                </select>
              </div>
              {benefitRecurrence && benefitRecurrence !== 'one_time' && (
                <div className="login-field" style={{ marginBottom: 0 }}>
                  <label>{benefitRecurrence === 'annual' ? 'Number of years it recurs' : 'Realized over how many years'}</label>
                  <input type="number" min="1" value={benefitDuration} onChange={(e) => setBenefitDuration(e.target.value)} required />
                </div>
              )}
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
              {b.claimed_value !== null && (
                <span className="pill pill--indigo">
                  GBP {b.claimed_value}{b.recurrence === 'annual' ? '/yr' : ''}
                </span>
              )}
            </div>
            <div className="goal-card__meta" style={{ marginTop: 4 }}>
              {b.benefit_type} &middot; owner: {b.owner_name ?? 'unassigned'} &middot; {b.status}
              {b.recurrence === 'one_time' && ' \u00b7 one-time'}
              {b.recurrence === 'annual' && ` \u00b7 annual for ${b.duration_years} year${b.duration_years === 1 ? '' : 's'}`}
              {b.recurrence === 'multi_year_lump_sum' && ` \u00b7 total realized over ${b.duration_years} year${b.duration_years === 1 ? '' : 's'}`}
            </div>

            {!b.recurrence && (
              classifyingBenefitId === b.id ? (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="login-field" style={{ marginBottom: 0 }}>
                    <label>How is this figure shaped over time?</label>
                    <select value={classifyRecurrence} onChange={(e) => setClassifyRecurrence(e.target.value as typeof classifyRecurrence)} style={inputStyle}>
                      <option value="">Select</option>
                      <option value="one_time">One-time</option>
                      <option value="annual">Annual (per-year rate)</option>
                      <option value="multi_year_lump_sum">Multi-year lump sum (already a total)</option>
                    </select>
                  </div>
                  {classifyRecurrence && classifyRecurrence !== 'one_time' && (
                    <div className="login-field" style={{ marginBottom: 0 }}>
                      <label>Years</label>
                      <input type="number" min="1" value={classifyDuration} onChange={(e) => setClassifyDuration(e.target.value)} style={{ ...inputStyle, width: 80 }} />
                    </div>
                  )}
                  <button onClick={() => saveClassification(b.id)} disabled={!classifyRecurrence} className="btn btn--project" style={{ fontSize: 12, padding: '6px 12px' }}>Save</button>
                  <button onClick={() => setClassifyingBenefitId(null)} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px' }}>Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => { setClassifyingBenefitId(b.id); setClassifyRecurrence(''); setClassifyDuration(''); }}
                  className="btn btn--outline"
                  style={{ fontSize: 11, padding: '3px 8px', marginTop: 6 }}
                >
                  &#9888; Not yet classified — click to set
                </button>
              )
            )}
            {classifyingBenefitId === b.id && classifyError && <p className="login-error" style={{ marginTop: 6 }}>{classifyError}</p>}
          </div>
        ))}
        {bc.benefits.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No benefits recorded yet.</p>}
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="goal-card__meta">Risk assessment</div>
          {has('business_case.edit') && (
            <button onClick={() => setShowAddRisk((s) => !s)} className="btn btn--outline" style={{ fontSize: 12, padding: '4px 10px' }}>+ Add risk</button>
          )}
        </div>

        {showAddRisk && (
          <form onSubmit={handleAddRisk} className="goal-card" style={{ marginBottom: 8 }}>
            <div className="login-field"><label>Description</label>
              <input type="text" value={riskDescription} onChange={(e) => setRiskDescription(e.target.value)} required /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div className="login-field" style={{ marginBottom: 0 }}><label>Category</label>
                <select value={riskCategory} onChange={(e) => setRiskCategory(e.target.value as 'delivery' | 'business')} style={inputStyle}>
                  <option value="delivery">Delivery</option>
                  <option value="business">Business</option>
                </select></div>
              <div className="login-field" style={{ marginBottom: 0 }}><label>Likelihood</label>
                <select value={riskLikelihood} onChange={(e) => setRiskLikelihood(e.target.value as 'low' | 'medium' | 'high')} style={inputStyle}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select></div>
              <div className="login-field" style={{ marginBottom: 0 }}><label>Impact</label>
                <select value={riskImpact} onChange={(e) => setRiskImpact(e.target.value as 'low' | 'medium' | 'high')} style={inputStyle}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select></div>
            </div>
            <div className="login-field"><label>Mitigation (optional)</label>
              <input type="text" value={riskMitigation} onChange={(e) => setRiskMitigation(e.target.value)} /></div>
            <div className="login-field"><label>Owner (optional)</label>
              <select value={riskOwner} onChange={(e) => setRiskOwner(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select></div>
            <button type="submit" disabled={addingRisk} className="btn btn--project" style={{ marginTop: 10 }}>
              {addingRisk ? 'Adding...' : 'Add risk'}
            </button>
          </form>
        )}

        {bc.risks.map((r) => (
          <div key={r.id} className="goal-card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.description}</span>
              <select value={r.status} onChange={(e) => updateRiskStatus(r.id, e.target.value)}
                style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--hairline)', borderRadius: 6 }}>
                <option value="open">Open</option>
                <option value="mitigated">Mitigated</option>
                <option value="accepted">Accepted</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div className="goal-card__meta" style={{ marginTop: 4 }}>
              {r.category} &middot; likelihood {r.likelihood} &middot; impact {r.impact}
              {r.owner_name && <> &middot; owner: {r.owner_name}</>}
            </div>
            {r.mitigation && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Mitigation: {r.mitigation}</div>}
          </div>
        ))}
        {bc.risks.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No risks recorded yet.</p>}
      </div>

      {bc.investment && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta">Cost-to-benefit read (manual reference only - not yet an automated flag)</div>
          <div className="goal-card__desc" style={{ marginTop: 6 }}>
            {(oneTimeBenefits.length > 0 || lumpSumBenefits.length > 0) && (
              <div>
                One-time + multi-year lump sum total minus actual spend to date: <strong>GBP {remainingBenefit.toFixed(0)}</strong>
                {remainingBenefit < 0 && <span style={{ color: '#c23' }}> - spend currently exceeds this total</span>}
              </div>
            )}
            {annualBenefits.length > 0 && (
              <div style={{ marginTop: 4 }}>
                Annual benefit rate: <strong>GBP {annualTotal.toFixed(0)}/yr</strong> across {annualBenefits.length} benefit{annualBenefits.length === 1 ? '' : 's'}
                {' '}&mdash; shown separately, not blended into the total above, since a per-year rate isn't directly comparable to a point-in-time spend figure without choosing a horizon.
              </div>
            )}
            {unclassifiedBenefits.length > 0 && (
              <div style={{ marginTop: 4, color: '#8a6100' }}>
                &#9888; GBP {unclassifiedTotal.toFixed(0)} across {unclassifiedBenefits.length} benefit{unclassifiedBenefits.length === 1 ? '' : 's'} not yet classified &mdash; excluded from the totals above until reviewed.
              </div>
            )}
            {bc.benefits.length === 0 && <span>No benefits recorded yet.</span>}
          </div>
        </div>
      )}

      {(!bc.decision || bc.decision === 'pending') && has('business_case.decide') && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => recordDecision('approved')} className="btn btn--project">Approve spend</button>
          <button onClick={() => recordDecision('declined')} className="btn btn--outline">Decline</button>
        </div>
      )}
    </div>
  );
}