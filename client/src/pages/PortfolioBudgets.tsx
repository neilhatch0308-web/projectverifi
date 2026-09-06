import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { usePermissions } from '../context/PermissionsContext';

interface Budget {
  portfolio_id: string;
  portfolio_name: string;
  portfolio_budget_id: string | null;
  baseline_amount: number | null;
  baseline_set_at: string | null;
  baseline_set_by_name: string | null;
  assigned_amount: number | null;
  assigned_set_at: string | null;
  assigned_set_by_name: string | null;
  current_amount: number;
}

interface Portfolio { id: string; name: string; }

interface Transfer {
  id: string;
  amount: number;
  reason: string;
  transferred_at: string;
  financial_year: number;
  from_portfolio_id: string;
  to_portfolio_id: string;
  from_portfolio_name: string;
  to_portfolio_name: string;
  related_demand_title: string | null;
  approved_by_name: string | null;
}

interface Adjustment {
  id: string;
  prior_amount: number;
  new_amount: number;
  reason: string;
  adjusted_at: string;
  financial_year: number;
  portfolio_id: string;
  portfolio_name: string;
  adjusted_by_name: string | null;
}

// A single merged timeline entry, so the audit trail reads as one
// history rather than two separate lists a reader has to cross-reference.
// Transfers stay in the merge for any HISTORICAL rows - the feature is
// retired, but old records are never deleted or hidden.
type ChangeEntry =
  | { kind: 'adjustment'; at: string; data: Adjustment }
  | { kind: 'transfer'; at: string; data: Transfer };

const inputStyle = { padding: 8, border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13, width: '100%' };

export function PortfolioBudgets() {
  const { has } = usePermissions();
  const canManage = has('budgets.manage');
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // History filters, deliberately independent of the budget table's
  // year selector above - the history search shouldn't be limited to
  // whichever single year the table happens to be showing.
  const [historyYearFilter, setHistoryYearFilter] = useState('all');
  const [historyPortfolioFilter, setHistoryPortfolioFilter] = useState('all');

  // Draft input state, per portfolio, for the two editable actions
  const [baselineDraft, setBaselineDraft] = useState<Record<string, string>>({});
  const [confirmBaselineFor, setConfirmBaselineFor] = useState<{ portfolioId: string; portfolioName: string; amount: number } | null>(null);
  const [settingBaseline, setSettingBaseline] = useState(false);

  const [assignedDraft, setAssignedDraft] = useState<Record<string, string>>({});
  const [assignedReason, setAssignedReason] = useState<Record<string, string>>({});
  const [savingAssigned, setSavingAssigned] = useState<string | null>(null);

  function loadBudgets(y: number) {
    setLoading(true);
    apiFetch(`/api/portfolio-budgets?year=${y}`)
      .then(setBudgets)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // History fetched once, across ALL years - the two filters below
  // narrow it down client-side, independent of the budget table's year.
  function loadHistory() {
    Promise.all([
      apiFetch('/api/portfolio-budgets/transfers'),
      apiFetch('/api/portfolio-budgets/adjustments'),
    ])
      .then(([t, a]) => { setTransfers(t); setAdjustments(a); })
      .catch((err) => setError(err.message));
  }

  useEffect(() => { apiFetch('/api/portfolios').then(setPortfolios).catch(() => {}); }, []);
  useEffect(() => loadBudgets(year), [year]);
  useEffect(loadHistory, []);

  // Combined change-triggering reload used by the mutating actions below
  function load(y: number) {
    loadBudgets(y);
    loadHistory();
  }

  function openBaselineConfirm(portfolioId: string, portfolioName: string) {
    const raw = baselineDraft[portfolioId];
    if (raw === undefined || raw === '') return;
    setConfirmBaselineFor({ portfolioId, portfolioName, amount: Number(raw) });
  }

  async function confirmSetBaseline() {
    if (!confirmBaselineFor) return;
    setSettingBaseline(true);
    try {
      await apiFetch('/api/portfolio-budgets/baseline', {
        method: 'POST',
        body: JSON.stringify({
          portfolioId: confirmBaselineFor.portfolioId,
          financialYear: year,
          amount: confirmBaselineFor.amount,
        }),
      });
      setBaselineDraft((d) => { const n = { ...d }; delete n[confirmBaselineFor.portfolioId]; return n; });
      setConfirmBaselineFor(null);
      setError(null);
      load(year);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set baseline');
    } finally {
      setSettingBaseline(false);
    }
  }

  async function saveAssigned(portfolioId: string) {
    const raw = assignedDraft[portfolioId];
    if (raw === undefined || raw === '') return;
    const reason = assignedReason[portfolioId]?.trim() ?? '';
    if (!reason) {
      setError('A reason is required to adjust the assigned budget.');
      return;
    }

    setSavingAssigned(portfolioId);
    try {
      await apiFetch('/api/portfolio-budgets/assigned', {
        method: 'PATCH',
        body: JSON.stringify({ portfolioId, financialYear: year, amount: Number(raw), reason }),
      });
      setAssignedDraft((d) => { const n = { ...d }; delete n[portfolioId]; return n; });
      setAssignedReason((r) => { const n = { ...r }; delete n[portfolioId]; return n; });
      setError(null);
      load(year);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust assigned budget');
    } finally {
      setSavingAssigned(null);
    }
  }

  const totalBaseline = budgets.reduce((s, b) => s + Number(b.baseline_amount ?? 0), 0);
  const totalAssigned = budgets.reduce((s, b) => s + Number(b.assigned_amount ?? 0), 0);
  const totalCurrent = budgets.reduce((s, b) => s + Number(b.current_amount ?? 0), 0);

  const changeHistory: ChangeEntry[] = [
    ...adjustments.map((a): ChangeEntry => ({ kind: 'adjustment', at: a.adjusted_at, data: a })),
    ...transfers.map((t): ChangeEntry => ({ kind: 'transfer', at: t.transferred_at, data: t })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // Years actually present in the history, newest first - not just
  // currentYear-1..+1 like the budget table's selector, since history
  // can span further back.
  const historyYears = Array.from(new Set(changeHistory.map((e) =>
    e.kind === 'adjustment' ? e.data.financial_year : e.data.financial_year
  ))).sort((a, b) => b - a);

  const filteredHistory = changeHistory.filter((entry) => {
    const entryYear = entry.kind === 'adjustment' ? entry.data.financial_year : entry.data.financial_year;
    const matchesYear = historyYearFilter === 'all' || entryYear === Number(historyYearFilter);

    const matchesPortfolio = historyPortfolioFilter === 'all' || (
      entry.kind === 'adjustment'
        ? entry.data.portfolio_id === historyPortfolioFilter
        : entry.data.from_portfolio_id === historyPortfolioFilter || entry.data.to_portfolio_id === historyPortfolioFilter
    );

    return matchesYear && matchesPortfolio;
  });

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 className="page-title">Portfolio Budgets</h1>
      <p className="page-subtitle">
        Baseline is set once and never changes. Current reflects what's actually committed in Annual
        Planning. Assigned is the real working budget - adjustable, always with a reason.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Financial year</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          style={{ padding: '6px 10px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13 }}>
          {[currentYear - 1, currentYear, currentYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="goal-card" style={{ marginBottom: '1.25rem', border: '2px solid var(--teal)' }}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div>
            <div className="goal-card__meta">Total baseline</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
              GBP {totalBaseline.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="goal-card__meta">Total current (in Annual Planning)</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
              GBP {totalCurrent.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="goal-card__meta">Total assigned</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
              GBP {totalAssigned.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && (
        <>
          <table className="data-table" style={{ marginBottom: '1.5rem' }}>
            <thead>
              <tr>
                <th>Portfolio</th>
                <th style={{ textAlign: 'right' }}>Baseline</th>
                <th style={{ textAlign: 'right' }}>Current</th>
                <th style={{ textAlign: 'right' }}>Assigned</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => {
                const hasBaseline = b.baseline_amount !== null;
                return (
                  <tr key={b.portfolio_id}>
                    <td>{b.portfolio_name}</td>

                    <td style={{ textAlign: 'right' }}>
                      {hasBaseline ? (
                        <span style={{ fontWeight: 600 }}>{Number(b.baseline_amount).toLocaleString()}</span>
                      ) : canManage ? (
                        <input
                          type="number" step="any" min="0" placeholder="Set once"
                          value={baselineDraft[b.portfolio_id] ?? ''}
                          onChange={(e) => setBaselineDraft((s) => ({ ...s, [b.portfolio_id]: e.target.value }))}
                          style={{ ...inputStyle, width: 120, textAlign: 'right' }}
                        />
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>not set</span>
                      )}
                    </td>

                    <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                      {Number(b.current_amount).toLocaleString()}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      {!hasBaseline ? (
                        <span style={{ color: 'var(--muted)' }}>not set</span>
                      ) : !canManage ? (
                        <span style={{ fontWeight: 600 }}>{Number(b.assigned_amount).toLocaleString()}</span>
                      ) : (
                        <>
                          <input
                            type="number" step="any" min="0"
                            value={assignedDraft[b.portfolio_id] ?? Number(b.assigned_amount)}
                            onChange={(e) => setAssignedDraft((s) => ({ ...s, [b.portfolio_id]: e.target.value }))}
                            style={{ ...inputStyle, width: 120, textAlign: 'right' }}
                          />
                          {assignedDraft[b.portfolio_id] !== undefined && (
                            <input
                              type="text" placeholder="Reason for change"
                              value={assignedReason[b.portfolio_id] ?? ''}
                              onChange={(e) => setAssignedReason((s) => ({ ...s, [b.portfolio_id]: e.target.value }))}
                              style={{ ...inputStyle, width: 160, marginTop: 6, fontSize: 12 }}
                            />
                          )}
                        </>
                      )}
                    </td>

                    <td>
                      {canManage && !hasBaseline && baselineDraft[b.portfolio_id] && (
                        <button onClick={() => openBaselineConfirm(b.portfolio_id, b.portfolio_name)}
                          className="btn btn--project" style={{ fontSize: 11, padding: '4px 8px' }}>
                          Set baseline
                        </button>
                      )}
                      {canManage && hasBaseline && assignedDraft[b.portfolio_id] !== undefined && (
                        <button onClick={() => saveAssigned(b.portfolio_id)} disabled={savingAssigned === b.portfolio_id}
                          className="btn btn--outline" style={{ fontSize: 11, padding: '4px 8px' }}>
                          {savingAssigned === b.portfolio_id ? '...' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {(adjustments.length > 0 || transfers.length > 0) && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                <div className="goal-card__meta">Budget change history</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={historyYearFilter} onChange={(e) => setHistoryYearFilter(e.target.value)}
                    style={{ padding: '5px 8px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 12.5 }}>
                    <option value="all">All years</option>
                    {historyYears.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={historyPortfolioFilter} onChange={(e) => setHistoryPortfolioFilter(e.target.value)}
                    style={{ padding: '5px 8px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 12.5 }}>
                    <option value="all">All portfolios</option>
                    {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              {filteredHistory.length === 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>No history matches this filter.</p>
              )}
              {filteredHistory.map((entry) => (
                entry.kind === 'adjustment' ? (
                  <div key={`adj-${entry.data.id}`} className="goal-card" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>{entry.data.portfolio_name}</strong> adjusted from{' '}
                        <strong>GBP {Number(entry.data.prior_amount).toLocaleString()}</strong> to{' '}
                        <strong>GBP {Number(entry.data.new_amount).toLocaleString()}</strong>
                      </div>
                      <span className="pill pill--indigo">Adjustment</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{entry.data.reason}</div>
                    <div className="goal-card__meta" style={{ marginTop: 6, textTransform: 'none', letterSpacing: 0 }}>
                      {entry.data.adjusted_by_name ?? 'unknown'} &middot; {new Date(entry.data.adjusted_at).toLocaleDateString()} &middot; FY{entry.data.financial_year}
                    </div>
                  </div>
                ) : (
                  <div key={`xfer-${entry.data.id}`} className="goal-card" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>GBP {Number(entry.data.amount).toLocaleString()}</strong> moved from{' '}
                        <strong>{entry.data.from_portfolio_name}</strong> to <strong>{entry.data.to_portfolio_name}</strong>
                      </div>
                      <span className="pill pill--teal">Transfer (historical)</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{entry.data.reason}</div>
                    <div className="goal-card__meta" style={{ marginTop: 6, textTransform: 'none', letterSpacing: 0 }}>
                      {entry.data.approved_by_name ?? 'unknown'} &middot; {new Date(entry.data.transferred_at).toLocaleDateString()} &middot; FY{entry.data.financial_year}
                      {entry.data.related_demand_title && ` \u00b7 re: ${entry.data.related_demand_title}`}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </>
      )}

      {confirmBaselineFor && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(20,22,28,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 'var(--radius)', padding: '1.75rem',
            maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              Set baseline for {confirmBaselineFor.portfolioName}?
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 18 }}>
              GBP {confirmBaselineFor.amount.toLocaleString()} will become the permanent baseline for{' '}
              {confirmBaselineFor.portfolioName} in {year}. This can never be changed afterward - only the
              assigned amount can move, and only with a reason. Make sure this is right first.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmSetBaseline} disabled={settingBaseline} className="btn btn--project">
                {settingBaseline ? 'Setting...' : 'Yes, set baseline'}
              </button>
              <button onClick={() => setConfirmBaselineFor(null)} className="btn btn--outline">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}