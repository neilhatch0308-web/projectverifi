import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/apiClient';

interface Budget {
  portfolio_budget_id: string;
  portfolio_id: string;
  portfolio_name: string;
  financial_year: number;
  allocated_amount: number;
  transferred_in: number;
  transferred_out: number;
  effective_amount: number;
}

interface Portfolio { id: string; name: string; }

interface Transfer {
  id: string;
  amount: number;
  reason: string;
  transferred_at: string;
  from_portfolio_name: string;
  to_portfolio_name: string;
  related_demand_title: string | null;
  approved_by_name: string | null;
}

export function PortfolioBudgets() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Record<string, string>>({});
  const [showTransfer, setShowTransfer] = useState(false);
  const [fromPortfolio, setFromPortfolio] = useState('');
  const [toPortfolio, setToPortfolio] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [savingTransfer, setSavingTransfer] = useState(false);

  function load(y: number) {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/portfolio-budgets?year=${y}`),
      apiFetch(`/api/portfolio-budgets/transfers?year=${y}`),
    ])
      .then(([b, t]) => { setBudgets(b); setTransfers(t); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { apiFetch('/api/portfolios').then(setPortfolios).catch(() => {}); }, []);
  useEffect(() => load(year), [year]);

  async function saveBudget(portfolioId: string) {
    const value = editing[portfolioId];
    if (value === undefined || value === '') return;
    try {
      await apiFetch('/api/portfolio-budgets', {
        method: 'PUT',
        body: JSON.stringify({ portfolioId, financialYear: year, allocatedAmount: Number(value) }),
      });
      setEditing((e) => { const n = { ...e }; delete n[portfolioId]; return n; });
      load(year);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save budget');
    }
  }

  async function submitTransfer(e: FormEvent) {
    e.preventDefault();
    setSavingTransfer(true);
    try {
      await apiFetch('/api/portfolio-budgets/transfers', {
        method: 'POST',
        body: JSON.stringify({
          financialYear: year,
          fromPortfolioId: fromPortfolio,
          toPortfolioId: toPortfolio,
          amount: Number(transferAmount),
          reason: transferReason,
        }),
      });
      setFromPortfolio(''); setToPortfolio(''); setTransferAmount(''); setTransferReason('');
      setShowTransfer(false);
      load(year);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record transfer');
    } finally {
      setSavingTransfer(false);
    }
  }

  const totalAllocated = budgets.reduce((s, b) => s + Number(b.allocated_amount), 0);
  const totalEffective = budgets.reduce((s, b) => s + Number(b.effective_amount), 0);

  const inputStyle = { padding: 8, border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13, width: '100%' };
  const selectStyle = { ...inputStyle };

  // Portfolios with no budget row yet for this year
  const unbudgeted = portfolios.filter((p) => !budgets.some((b) => b.portfolio_id === p.id));

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Portfolio Budgets</h1>
          <p className="page-subtitle">Each portfolio has its own budget line. The corporate envelope is their sum.</p>
        </div>
        <button onClick={() => setShowTransfer((s) => !s)} className="btn btn--outline">
          Move budget between portfolios
        </button>
      </div>

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
            <div className="goal-card__meta">Total allocated</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
              GBP {totalAllocated.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="goal-card__meta">Effective after transfers</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
              GBP {totalEffective.toLocaleString()}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              transfers move money between lines, they never change the total
            </div>
          </div>
        </div>
      </div>

      {showTransfer && (
        <form onSubmit={submitTransfer} className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta" style={{ marginBottom: 10 }}>Record a budget transfer</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>From</label>
              <select value={fromPortfolio} onChange={(e) => setFromPortfolio(e.target.value)} required style={selectStyle}>
                <option value="">Select</option>
                {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>To</label>
              <select value={toPortfolio} onChange={(e) => setToPortfolio(e.target.value)} required style={selectStyle}>
                <option value="">Select</option>
                {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Amount (GBP)</label>
              <input type="number" step="any" min="1" value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)} required style={inputStyle} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Reason</label>
            <input type="text" value={transferReason} onChange={(e) => setTransferReason(e.target.value)}
              required placeholder="Why is this money moving?" style={inputStyle} />
          </div>
          <button type="submit" disabled={savingTransfer} className="btn btn--project" style={{ marginTop: 12 }}>
            {savingTransfer ? 'Recording...' : 'Record transfer'}
          </button>
        </form>
      )}

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && (
        <>
          <table className="data-table" style={{ marginBottom: '1.5rem' }}>
            <thead>
              <tr>
                <th>Portfolio</th>
                <th style={{ textAlign: 'right' }}>Allocated</th>
                <th style={{ textAlign: 'right' }}>In</th>
                <th style={{ textAlign: 'right' }}>Out</th>
                <th style={{ textAlign: 'right' }}>Effective</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={b.portfolio_budget_id}>
                  <td>{b.portfolio_name}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      type="number" step="any" min="0"
                      value={editing[b.portfolio_id] ?? Number(b.allocated_amount)}
                      onChange={(e) => setEditing((s) => ({ ...s, [b.portfolio_id]: e.target.value }))}
                      style={{ ...inputStyle, width: 120, textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ textAlign: 'right', color: Number(b.transferred_in) > 0 ? '#0e8f82' : 'var(--muted)' }}>
                    {Number(b.transferred_in) > 0 ? `+${Number(b.transferred_in).toLocaleString()}` : '-'}
                  </td>
                  <td style={{ textAlign: 'right', color: Number(b.transferred_out) > 0 ? '#8a6100' : 'var(--muted)' }}>
                    {Number(b.transferred_out) > 0 ? `-${Number(b.transferred_out).toLocaleString()}` : '-'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {Number(b.effective_amount).toLocaleString()}
                  </td>
                  <td>
                    {editing[b.portfolio_id] !== undefined && (
                      <button onClick={() => saveBudget(b.portfolio_id)} className="btn btn--outline"
                        style={{ fontSize: 11, padding: '4px 8px' }}>Save</button>
                    )}
                  </td>
                </tr>
              ))}
              {unbudgeted.map((p) => (
                <tr key={p.id} style={{ color: 'var(--muted)' }}>
                  <td>{p.name}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      type="number" step="any" min="0" placeholder="0"
                      value={editing[p.id] ?? ''}
                      onChange={(e) => setEditing((s) => ({ ...s, [p.id]: e.target.value }))}
                      style={{ ...inputStyle, width: 120, textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>-</td>
                  <td style={{ textAlign: 'right' }}>-</td>
                  <td style={{ textAlign: 'right' }}>not set</td>
                  <td>
                    {editing[p.id] !== undefined && editing[p.id] !== '' && (
                      <button onClick={() => saveBudget(p.id)} className="btn btn--outline"
                        style={{ fontSize: 11, padding: '4px 8px' }}>Save</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {transfers.length > 0 && (
            <div>
              <div className="goal-card__meta" style={{ marginBottom: 8 }}>Transfer history - {year}</div>
              {transfers.map((t) => (
                <div key={t.id} className="goal-card" style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>GBP {Number(t.amount).toLocaleString()}</strong> moved from{' '}
                    <strong>{t.from_portfolio_name}</strong> to <strong>{t.to_portfolio_name}</strong>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{t.reason}</div>
                  <div className="goal-card__meta" style={{ marginTop: 6, textTransform: 'none', letterSpacing: 0 }}>
                    {t.approved_by_name ?? 'unknown'} &middot; {new Date(t.transferred_at).toLocaleDateString()}
                    {t.related_demand_title && ` \u00b7 re: ${t.related_demand_title}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
