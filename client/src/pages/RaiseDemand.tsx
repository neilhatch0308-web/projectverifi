import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface Portfolio { id: string; name: string; }
interface SubPortfolio { id: string; name: string; parent_id: string; parent_name: string; }
interface User { id: string; display_name: string; role: string; is_senior: boolean; }
interface StrategicGoal {
  id: string;
  name: string;
  description: string | null;
  status: string;
  portfolio_id: string | null;
  portfolio_name: string | null;
}

interface ScoringCriterion {
  id: string;
  name: string;
  description: string | null;
  weight_pct: number;
  level_definitions: Record<string, string>;
}

interface Criterion {
  dimension: 'delivery' | 'adoption' | 'business' | 'financial';
  measure: string;
  baselineValue: string;
  targetValue: string;
  unit: string;
}

const DIMENSIONS: { key: Criterion['dimension']; label: string; hint: string }[] = [
  { key: 'delivery', label: 'Delivery', hint: 'e.g. delivered within 6 months at budget' },
  { key: 'adoption', label: 'Adoption', hint: 'e.g. used by 80% of the team by month 12' },
  { key: 'business', label: 'Business metric', hint: 'e.g. forecast accuracy improves from 87% to 94%' },
  { key: 'financial', label: 'Financial', hint: 'e.g. saves 50000 per year in labour' },
];

const LEVELS = ['0', '5', '10', '15', '20'];

export function RaiseDemand() {
  const navigate = useNavigate();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [subPortfolios, setSubPortfolios] = useState<SubPortfolio[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [strategicGoals, setStrategicGoals] = useState<StrategicGoal[]>([]);
  const [scoringCriteria, setScoringCriteria] = useState<ScoringCriterion[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [outcomeStatement, setOutcomeStatement] = useState('');
  const [portfolioId, setPortfolioId] = useState('');
  const [deliveringSubPortfolioId, setDeliveringSubPortfolioId] = useState('');
  const [sponsorUserId, setSponsorUserId] = useState('');
  const [needByDate, setNeedByDate] = useState('');
  const [changeType, setChangeType] = useState('');
  const [claimedCost, setClaimedCost] = useState('');
  const [claimedBenefit, setClaimedBenefit] = useState('');
  const [dateDriverType, setDateDriverType] = useState('none');
  const [dateDriverDetail, setDateDriverDetail] = useState('');
  const [strategicGoalId, setStrategicGoalId] = useState('');
  const [alignmentNotes, setAlignmentNotes] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [confidentialViewerIds, setConfidentialViewerIds] = useState<string[]>([]);
  const [targetStartYear, setTargetStartYear] = useState('');
  const [targetStartQuarter, setTargetStartQuarter] = useState('');

  const currentFY = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const horizonYears = Array.from({ length: 5 }, (_, i) => currentFY + i);

  const [selectedDimensions, setSelectedDimensions] = useState<Set<Criterion['dimension']>>(new Set(['adoption']));
  const [criteria, setCriteria] = useState<Record<string, Criterion>>({
    adoption: { dimension: 'adoption', measure: '', baselineValue: '', targetValue: '', unit: '' },
  });

  const [scores, setScores] = useState<Record<string, { level: string; rationale: string }>>({});

  // Matched by name, same acknowledged trade-off as the Finance Impact
  // Assessment trigger elsewhere in this app (a case-insensitive string
  // match against a tenant-configurable name, not a first-class flag).
  // Mirrors the server-side check in POST /demands exactly - that route
  // is the real enforcement; this is purely to guide the person to the
  // right state before they hit submit, not a substitute for it.
  const financialTriggerCriterion = scoringCriteria.find((c) => /financial|revenue/i.test(c.name));
  const financialTriggerLevel = financialTriggerCriterion ? scores[financialTriggerCriterion.id]?.level : undefined;
  const financialRequired = financialTriggerLevel === '15' || financialTriggerLevel === '20';

  // Once the financial trigger fires, the Financial dimension is
  // mandatory - select it automatically rather than waiting for the
  // person to notice the new requirement and do it themselves.
  useEffect(() => {
    if (!financialRequired) return;
    setSelectedDimensions((prev) => {
      if (prev.has('financial')) return prev;
      const next = new Set(prev);
      next.add('financial');
      return next;
    });
    setCriteria((c) => (c.financial ? c : { ...c, financial: { dimension: 'financial', measure: '', baselineValue: '', targetValue: '', unit: '' } }));
  }, [financialRequired]);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [otherDrafts, setOtherDrafts] = useState<{ id: string; data: any; updated_at: string }[]>([]);

  function refreshDraftList() {
    apiFetch('/api/drafts?stage=raise')
      .then((drafts: { id: string; data: any; updated_at: string }[]) => setOtherDrafts(drafts))
      .catch(() => {});
  }
  useEffect(refreshDraftList, []);

  function currentFormSnapshot() {
    return {
      title, description, outcomeStatement, portfolioId, deliveringSubPortfolioId, sponsorUserId,
      needByDate, changeType, claimedCost, claimedBenefit, dateDriverType, dateDriverDetail,
      strategicGoalId, alignmentNotes, confidential, confidentialViewerIds, targetStartYear, targetStartQuarter,
      selectedDimensions: Array.from(selectedDimensions), criteria, scores,
    };
  }

  function resumeDraft(draft: { id: string; data: any }) {
    const d = draft.data ?? {};
    setTitle(d.title ?? '');
    setDescription(d.description ?? '');
    setOutcomeStatement(d.outcomeStatement ?? '');
    setPortfolioId(d.portfolioId ?? '');
    setDeliveringSubPortfolioId(d.deliveringSubPortfolioId ?? '');
    setSponsorUserId(d.sponsorUserId ?? '');
    setNeedByDate(d.needByDate ?? '');
    setChangeType(d.changeType ?? '');
    setClaimedCost(d.claimedCost ?? '');
    setClaimedBenefit(d.claimedBenefit ?? '');
    setDateDriverType(d.dateDriverType ?? 'none');
    setDateDriverDetail(d.dateDriverDetail ?? '');
    setStrategicGoalId(d.strategicGoalId ?? '');
    setAlignmentNotes(d.alignmentNotes ?? '');
    setConfidential(d.confidential ?? false);
    setConfidentialViewerIds(d.confidentialViewerIds ?? []);
    setTargetStartYear(d.targetStartYear ?? '');
    setTargetStartQuarter(d.targetStartQuarter ?? '');
    setSelectedDimensions(new Set(d.selectedDimensions ?? ['adoption']));
    setCriteria(d.criteria ?? { adoption: { dimension: 'adoption', measure: '', baselineValue: '', targetValue: '', unit: '' } });
    setScores(d.scores ?? {});
    setDraftId(draft.id);
    setDraftError(null);
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    setDraftError(null);
    try {
      if (draftId) {
        await apiFetch(`/api/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify({ data: currentFormSnapshot() }) });
      } else {
        const created = await apiFetch('/api/drafts', {
          method: 'POST',
          body: JSON.stringify({ stage: 'raise', data: currentFormSnapshot() }),
        });
        setDraftId(created.id);
      }
      setDraftSavedAt(new Date());
      refreshDraftList();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Could not save draft.');
    } finally {
      setSavingDraft(false);
    }
  }

  async function discardOtherDraft(id: string) {
    try {
      await apiFetch(`/api/drafts/${id}`, { method: 'DELETE' });
      setOtherDrafts((prev) => prev.filter((d) => d.id !== id));
      if (draftId === id) setDraftId(null);
    } catch {
      // Non-critical -- leave it in the list if the delete failed, they can retry.
    }
  }

  useEffect(() => {
    apiFetch('/api/portfolios').then(setPortfolios).catch((err) => setError(err.message));
    apiFetch('/api/portfolios/sub-portfolios/all').then(setSubPortfolios).catch((err) => setError(err.message));
    apiFetch('/api/users').then(setUsers).catch((err) => setError(err.message));
    apiFetch('/api/scoring-criteria').then(setScoringCriteria).catch((err) => setError(err.message));
  }, []);

// Goals are refetched whenever the raising portfolio changes: a demand
// can link to a corporate objective or one owned by its own raising
// portfolio, nothing else. Scoped to the current year too - with the
// 5-per-year cap gone, an unfiltered list would grow without bound.
useEffect(() => {
  if (!portfolioId) {
    setStrategicGoals([]);
    return;
  }
  const goalYear = new Date().getFullYear();
  apiFetch(`/api/strategic-goals?year=${goalYear}&portfolio=${portfolioId}`)
    .then((goals: StrategicGoal[]) => setStrategicGoals(goals.filter((g) => g.status === 'active')))
    .catch(() => setStrategicGoals([]));
}, [portfolioId]);

// A goal picked before the portfolio changed may no longer be valid
// against the new one - clear it rather than silently submitting a
// link the server would reject.
useEffect(() => {
  if (strategicGoalId && !strategicGoals.some((g) => g.id === strategicGoalId)) {
    setStrategicGoalId('');
    setAlignmentNotes('');
  }
}, [strategicGoals]);

  function toggleDimension(dim: Criterion['dimension']) {
    setSelectedDimensions((prev) => {
      // Every demand must keep at least one success measure - the last
      // remaining dimension can't be clicked off (mirrors the server's
      // own `criteria: z.array(...).min(1, ...)` requirement; this is
      // the guided-UX half of that, not the real enforcement).
      if (prev.has(dim) && prev.size === 1) return prev;
      // Financial is locked on once the priority-scoring trigger fires -
      // see financialRequired above. Removing it here would just have
      // the effect immediately re-add it, so block it instead of
      // letting the state flicker.
      if (dim === 'financial' && financialRequired && prev.has(dim)) return prev;

      const next = new Set(prev);
      if (next.has(dim)) next.delete(dim);
      else {
        next.add(dim);
        setCriteria((c) => ({ ...c, [dim]: c[dim] ?? { dimension: dim, measure: '', baselineValue: '', targetValue: '', unit: '' } }));
      }
      return next;
    });
  }

  function updateCriterion(dim: string, field: keyof Criterion, value: string) {
    setCriteria((c) => ({ ...c, [dim]: { ...c[dim], [field]: value } }));
  }

  function updateScore(criterionId: string, field: 'level' | 'rationale', value: string) {
    setScores((s) => {
      const existing = s[criterionId] ?? { level: '', rationale: '' };
      return { ...s, [criterionId]: { ...existing, [field]: value } };
    });
  }

  const weightedTotal = scoringCriteria.reduce((sum, c) => {
    const level = scores[c.id]?.level;
    if (level === undefined || level === '') return sum;
    return sum + (Number(level) * c.weight_pct) / 100;
  }, 0);
  const scoredCount = scoringCriteria.filter((c) => scores[c.id]?.level !== undefined && scores[c.id]?.level !== '').length;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const activeCriteria = Array.from(selectedDimensions).map((dim) => criteria[dim]);
    if (activeCriteria.length === 0) {
      setError('Every demand needs at least one success measure');
      return;
    }
    if (activeCriteria.some((c) => !c.measure.trim())) {
      setError('Every selected dimension needs a success measure filled in');
      return;
    }

    if (financialRequired && !activeCriteria.some((c) => c.dimension === 'financial')) {
      setError(`A financial success measure is required because ${financialTriggerCriterion?.name} is scored ${financialTriggerLevel}`);
      return;
    }

    if (!claimedCost || !claimedBenefit) {
      setError('Give your best estimate of cost and benefit - a rough figure is fine, it will be assessed properly later');
      return;
    }

    if (dateDriverType !== 'none' && !dateDriverDetail.trim()) {
      setError('Name the specific obligation driving the date - which regulation, audit finding, contract, or launch');
      return;
    }

    const unscored = scoringCriteria.filter(
      (c) => scores[c.id]?.level === undefined || scores[c.id]?.level === ''
    );
    if (unscored.length > 0) {
      setError(`Every priority category must be scored - missing: ${unscored.map((c) => c.name).join(', ')}`);
      return;
    }

    const scorePayload = scoringCriteria.map((c) => ({
      criterionId: c.id,
      scoreAwarded: Number(scores[c.id].level),
      rationale: scores[c.id].rationale || undefined,
    }));

    setSubmitting(true);
    try {
      const demand = await apiFetch('/api/demands', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          outcomeStatement,
          portfolioId,
          deliveringSubPortfolioId: deliveringSubPortfolioId || undefined,
          sponsorUserId,
          needByDate: needByDate || undefined,
          adoptionChangeType: changeType || null,
          dateDriverType,
          dateDriverDetail: dateDriverDetail || undefined,
          claimedCost: Number(claimedCost),
          claimedBenefit: Number(claimedBenefit),
          confidential,
          confidentialViewerIds: confidential && confidentialViewerIds.length > 0 ? confidentialViewerIds : undefined,
          criteria: activeCriteria,
          scores: scorePayload,
          strategicGoalId: strategicGoalId || undefined,
          alignmentNotes: alignmentNotes || undefined,
          targetStartYear: targetStartYear ? Number(targetStartYear) : undefined,
          targetStartQuarter: targetStartQuarter ? Number(targetStartQuarter) : undefined,
        }),
      });
      if (draftId) apiFetch(`/api/drafts/${draftId}`, { method: 'DELETE' }).catch(() => {});
      navigate(`/demand/${demand.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to raise demand');
    } finally {
      setSubmitting(false);
    }
  }

  const selectStyle = { width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14 };
  const textareaStyle = { ...selectStyle, fontFamily: 'var(--font-body)' };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="page-title">Raise Demand</h1>
      <p className="page-subtitle">
        Everything triage needs to scale this before accepting or rejecting it.
      </p>

      {otherDrafts.filter((d) => d.id !== draftId).length > 0 && (
        <div className="goal-card" style={{ marginBottom: '1.25rem', background: 'var(--cloud)' }}>
          <div className="goal-card__meta" style={{ marginBottom: 6 }}>
            You have {otherDrafts.filter((d) => d.id !== draftId).length} saved draft
            {otherDrafts.filter((d) => d.id !== draftId).length > 1 ? 's' : ''}
          </div>
          {otherDrafts.filter((d) => d.id !== draftId).map((d) => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <div style={{ fontSize: 13 }}>
                {d.data?.title || '(untitled draft)'}
                <span style={{ color: 'var(--muted)', fontSize: 11.5, marginLeft: 8 }}>
                  saved {new Date(d.updated_at).toLocaleString()}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn--outline" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => resumeDraft(d)}>
                  Resume
                </button>
                <button type="button" className="btn btn--outline" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => discardOtherDraft(d.id)}>
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* ---------- Who ---------- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="login-field">
            <label>Raising portfolio</label>
            <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} required style={selectStyle}>
              <option value="">Select</option>
              {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="login-field">
            <label>Delivering sub-portfolio (optional)</label>
            <select value={deliveringSubPortfolioId} onChange={(e) => setDeliveringSubPortfolioId(e.target.value)} style={selectStyle}>
              <option value="">Not yet categorised</option>
              {subPortfolios.map((s) => <option key={s.id} value={s.id}>{s.parent_name} / {s.name}</option>)}
            </select>
          </div>
          <div className="login-field">
            <label>Sponsor</label>
            <select value={sponsorUserId} onChange={(e) => setSponsorUserId(e.target.value)} required style={selectStyle}>
              <option value="">Select</option>
              {[...users].sort((a, b) => Number(b.is_senior) - Number(a.is_senior)).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}{!u.is_senior ? ` (${u.role})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 16px' }}>
          You (the conceiver) are recorded automatically as whoever is signed in.
        </p>



        <div className="login-field">
          <label>Problem title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Regional forecast data remains manual and error-prone" required />
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: confidential ? 10 : '1.25rem' }}>
          <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <strong>Confidential</strong>
            <span style={{ color: 'var(--muted)' }}> - only visible to you and named viewers. Nobody else, including admins, can see it unless you or a named viewer adds them.</span>
          </span>
        </label>

        {confidential && (
          <div className="login-field" style={{ marginBottom: '1.25rem' }}>
            <label>Name initial viewers (optional)</label>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 6px' }}>
              You'll always be able to see it. Add anyone else who needs to from the start - you can add more later from the demand page.
            </p>
            <select
              multiple
              value={confidentialViewerIds}
              onChange={(e) => setConfidentialViewerIds(Array.from(e.target.selectedOptions, (o) => o.value))}
              style={{ width: '100%', padding: 8, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 13, minHeight: 90 }}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="login-field">
          <label>Problem statement</label>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 6px' }}>
            The issue or problem the business/team has today
          </p>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            required rows={3} style={textareaStyle} />
        </div>

        <div className="login-field">
          <label>Need and output</label>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 6px' }}>
            What this demand needs to deliver and achieve - distinct from the problem above
          </p>
          <textarea value={outcomeStatement} onChange={(e) => setOutcomeStatement(e.target.value)}
            required rows={3} style={textareaStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="login-field">
            <label>Needed by</label>
            <input type="date" value={needByDate} onChange={(e) => setNeedByDate(e.target.value)} />
          </div>
          <div className="login-field">
            <label>Adoption change type (optional)</label>
            <select value={changeType} onChange={(e) => setChangeType(e.target.value)} style={selectStyle}>
              <option value="">Not applicable</option>
              <option value="process">Process</option>
              <option value="tool">Tool</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: '1.5rem', marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Your estimate
          </label>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
            Your best view of cost and benefit. A rough figure is expected at this stage -
            it gets properly assessed later. But this is the number you are putting your
            name to, and it stays on the record alongside whatever the assessment finds.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="login-field" style={{ marginBottom: 0 }}>
              <label>Estimated cost (GBP)</label>
              <input type="number" step="any" min="0" value={claimedCost}
                onChange={(e) => setClaimedCost(e.target.value)} required />
            </div>
            <div className="login-field" style={{ marginBottom: 0 }}>
              <label>Estimated benefit (GBP)</label>
              <input type="number" step="any" min="0" value={claimedBenefit}
                onChange={(e) => setClaimedBenefit(e.target.value)} required />
            </div>
          </div>
        </div>

        <div className="login-field" style={{ marginTop: '1.25rem' }}>
          <label>Is this date driven by an external obligation?</label>
          <select value={dateDriverType} onChange={(e) => setDateDriverType(e.target.value)} style={selectStyle}>
            <option value="none">No - the date is a preference, not an obligation</option>
            <option value="regulatory">Regulatory / legislative deadline</option>
            <option value="audit_finding">Audit finding remediation</option>
            <option value="contractual">Contractual commitment</option>
            <option value="product_launch">Product launch dependency</option>
          </select>
          {dateDriverType !== 'none' && (
            <input
              type="text"
              placeholder="Which one specifically? e.g. 'GDPR Art. 17 retention', 'Internal audit finding IA-2026-14'"
              value={dateDriverDetail}
              onChange={(e) => setDateDriverDetail(e.target.value)}
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <div className="login-field" style={{ marginTop: '1.25rem' }}>
          <label>Target year (optional)</label>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 6px' }}>
            Realistically, which financial year does this land in? Shows up on the
            Five-Year Horizon view. Leave blank if you're not sure yet - an assessor
            can set this later instead.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <select value={targetStartYear} onChange={(e) => setTargetStartYear(e.target.value)} style={selectStyle}>
              <option value="">No target year yet</option>
              {horizonYears.map((y) => <option key={y} value={y}>FY{String(y).slice(-2)}</option>)}
            </select>
            <select
              value={targetStartQuarter}
              onChange={(e) => setTargetStartQuarter(e.target.value)}
              disabled={!targetStartYear}
              style={selectStyle}
            >
              <option value="">Whole year</option>
              <option value="1">Q1</option>
              <option value="2">Q2</option>
              <option value="3">Q3</option>
              <option value="4">Q4</option>
            </select>
          </div>
        </div>

        <div className="login-field" style={{ marginTop: '1.25rem' }}>
             <label>Linked objective (optional)</label>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 6px' }}>
            {portfolioId
            ? 'Corporate objectives, plus those belonging to the raising portfolio.'
      : 'Pick a raising portfolio first to see which objectives apply.'}
            </p>
    <select
    value={strategicGoalId}
    onChange={(e) => setStrategicGoalId(e.target.value)}
    disabled={!portfolioId}
    style={selectStyle}
  >
    <option value="">No link</option>
    {strategicGoals.filter((g) => g.portfolio_id === null).map((g) => (
      <option key={g.id} value={g.id}>Corporate - {g.name}</option>
    ))}
    {strategicGoals.filter((g) => g.portfolio_id !== null).map((g) => (
      <option key={g.id} value={g.id}>{g.portfolio_name} - {g.name}</option>
    ))}
  </select>
  {strategicGoalId && (
    <input
      type="text"
      placeholder="Why does this demand support that objective?"
      value={alignmentNotes}
      onChange={(e) => setAlignmentNotes(e.target.value)}
      style={{ marginTop: 8 }}
    />
  )}
</div>

        {/* ---------- Weighted priority scoring ---------- */}
        <div style={{ marginTop: '1.75rem', marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Priority scoring
          </label>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
            Every category below must be scored - pick the level that best matches this demand.
            {scoringCriteria.length > 0 && (
              <> Weighted total: <strong>{weightedTotal.toFixed(1)} / 20</strong> ({scoredCount} of {scoringCriteria.length} scored - all required)</>
            )}
          </p>
        </div>

        {scoringCriteria.map((c) => (
          <div key={c.id} className="goal-card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="goal-card__name">{c.name}</div>
              <span className="pill pill--muted">weight {c.weight_pct}%</span>
            </div>
            {c.description && <div className="goal-card__meta" style={{ marginTop: 4 }}>{c.description}</div>}

            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {LEVELS.map((level) => (
                <label
                  key={level}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    fontSize: 12.5,
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: scores[c.id]?.level === level ? 'rgba(23,195,178,0.08)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name={`score-${c.id}`}
                    value={level}
                    checked={scores[c.id]?.level === level}
                    onChange={(e) => updateScore(c.id, 'level', e.target.value)}
                    style={{ marginTop: 2 }}
                  />
                  <span><strong>{level}</strong> - {c.level_definitions?.[level]}</span>
                </label>
              ))}
            </div>

            <div className="login-field" style={{ marginTop: 8, marginBottom: 0 }}>
              <label>Rationale (optional)</label>
              <input
                type="text"
                placeholder="Why this level?"
                value={scores[c.id]?.rationale ?? ''}
                onChange={(e) => updateScore(c.id, 'rationale', e.target.value)}
              />
            </div>
          </div>
        ))}

        {/* ---------- Success measures ---------- */}
        <div style={{ marginTop: '1.5rem', marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Success measures
          </label>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
            Pick which dimensions apply - every demand needs at least one. These are captured now
            and preserved - changing them later requires an approved re-base, not a direct edit.
            {financialRequired && (
              <> <strong>Financial is required</strong> because {financialTriggerCriterion?.name} is scored {financialTriggerLevel}.</>
            )}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            {DIMENSIONS.map((d) => {
              const locked = (selectedDimensions.size === 1 && selectedDimensions.has(d.key)) ||
                (d.key === 'financial' && financialRequired && selectedDimensions.has(d.key));
              return (
                <div
                  key={d.key}
                  onClick={() => toggleDimension(d.key)}
                  title={locked ? 'Required - every demand needs at least one success measure' : undefined}
                  style={{
                    border: selectedDimensions.has(d.key) ? '2px solid var(--teal)' : '1px solid var(--hairline)',
                    borderRadius: 10, padding: '10px 12px', cursor: locked ? 'default' : 'pointer', fontSize: 13, fontWeight: 600,
                    background: selectedDimensions.has(d.key) ? 'rgba(23,195,178,0.06)' : '#fff',
                    opacity: locked ? 0.85 : 1,
                  }}
                >
                  {d.label}
                  {locked && <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>(required)</span>}
                </div>
              );
            })}
          </div>
        </div>

        {DIMENSIONS.filter((d) => selectedDimensions.has(d.key)).map((d) => (
          <div key={d.key} className="goal-card" style={{ marginBottom: 10 }}>
            <div className="goal-card__name">{d.label} criterion</div>
            <div className="login-field" style={{ marginTop: 10, marginBottom: 8 }}>
              <label>Success measure</label>
              <input type="text" placeholder={d.hint} value={criteria[d.key]?.measure ?? ''}
                onChange={(e) => updateCriterion(d.key, 'measure', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="login-field" style={{ marginBottom: 0 }}>
                <label>Baseline (number only)</label>
                <input type="number" step="any" value={criteria[d.key]?.baselineValue ?? ''}
                  onChange={(e) => updateCriterion(d.key, 'baselineValue', e.target.value)} />
              </div>
              <div className="login-field" style={{ marginBottom: 0 }}>
                <label>Target (number only)</label>
                <input type="number" step="any" value={criteria[d.key]?.targetValue ?? ''}
                  onChange={(e) => updateCriterion(d.key, 'targetValue', e.target.value)} />
              </div>
              <div className="login-field" style={{ marginBottom: 0 }}>
                <label>Unit</label>
                <input type="text" placeholder="%, GBP, days..." value={criteria[d.key]?.unit ?? ''}
                  onChange={(e) => updateCriterion(d.key, 'unit', e.target.value)} />
              </div>
            </div>
          </div>
        ))}

        {error && <p className="login-error" style={{ marginTop: 12 }}>{error}</p>}
        {draftError && <p className="login-error" style={{ marginTop: 12 }}>{draftError}</p>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <button type="submit" disabled={submitting} className="btn btn--project">
            {submitting ? 'Raising...' : 'Raise demand'}
          </button>
          <button type="button" onClick={handleSaveDraft} disabled={savingDraft} className="btn btn--outline">
            {savingDraft ? 'Saving...' : 'Save draft'}
          </button>
          {draftSavedAt && !savingDraft && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Draft saved {draftSavedAt.toLocaleTimeString()}</span>
          )}
        </div>
      </form>
    </div>
  );
}