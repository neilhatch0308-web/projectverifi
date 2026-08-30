import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface ParentPortfolio { id: string; name: string; }

interface Demand {
  id: string;
  title: string;
  status: string;
  raised_date: string;
  need_by_date: string | null;
  weighted_score: number;
  date_driver_type: string | null;
  business_case_id: string | null;
  business_case_decision: string | null;
  stopped_at: string | null;
  confidential: boolean;
  portfolio_id: string;
  portfolio_name: string;
  delivering_sub_portfolio_id: string | null;
  delivering_sub_portfolio_name: string | null;
}

const ALL_STATUSES = ['raised', 'accepted', 'assessed', 'promoted', 'stopped'];
const STATUS_LABELS: Record<string, string> = {
  raised: 'Raised', accepted: 'Accepted', assessed: 'Assessed', promoted: 'Business Case', stopped: 'Stopped',
};

export function PortfolioRollup() {
  const [portfolios, setPortfolios] = useState<ParentPortfolio[]>([]);
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Defaults to everything except stopped - a rollup for reassignment
  // is mostly about live work; stopped demand rarely needs its
  // portfolio fixed, and can still be added back via the filter.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    new Set(['raised', 'accepted', 'assessed', 'promoted'])
  );

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverPortfolioId, setDragOverPortfolioId] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch('/api/portfolios'),
      apiFetch('/api/demands'),
    ])
      .then(([p, d]) => { setPortfolios(p); setDemands(d); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function toggleStatus(status: string) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  }

  const visibleDemands = demands.filter((d) => statusFilter.has(d.status));

  function handleDragStart(e: React.DragEvent, demandId: string) {
    setDraggedId(demandId);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragEnd() {
    setDraggedId(null);
    setDragOverPortfolioId(null);
  }
  function handleDragOver(e: React.DragEvent, portfolioId: string) {
    e.preventDefault();
    setDragOverPortfolioId(portfolioId);
  }

  async function handleDrop(e: React.DragEvent, portfolioId: string) {
    e.preventDefault();
    setDragOverPortfolioId(null);
    const demandId = draggedId;
    setDraggedId(null);
    if (!demandId) return;

    const demand = demands.find((d) => d.id === demandId);
    if (!demand || demand.portfolio_id === portfolioId) return;

    setReassigning(demandId);
    try {
      await apiFetch(`/api/demands/${demandId}/raising-portfolio`, {
        method: 'PATCH',
        body: JSON.stringify({ portfolioId }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reassign portfolio');
    } finally {
      setReassigning(null);
    }
  }

  function columnStyle(portfolioId: string): CSSProperties {
    const isDragTarget = dragOverPortfolioId === portfolioId;
    return {
      background: isDragTarget ? 'rgba(23,195,178,0.08)' : 'var(--cloud)',
      border: isDragTarget ? '1.5px dashed var(--teal)' : '1.5px solid transparent',
      borderRadius: 'var(--radius)',
      padding: 12,
      minWidth: 240,
      flex: '1 1 0',
      transition: 'background 0.1s, border 0.1s',
    };
  }

  return (
    <div>
      <h1 className="page-title">Portfolio Rollup</h1>
      <p className="page-subtitle">
        Demand grouped by raising portfolio. Drag a card to a different portfolio to reassign it -
        useful when consolidating or retiring one. Delivering sub-portfolio is shown for reference on each card.
      </p>

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`pill ${statusFilter.has(s) ? 'pill--teal' : 'pill--muted'}`}
              style={{ border: 'none', cursor: 'pointer' }}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}

      {!loading && (
        <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: portfolios.length * 260 }}>
            {portfolios.map((p) => {
              const items = visibleDemands.filter((d) => d.portfolio_id === p.id);
              return (
                <div
                  key={p.id}
                  style={columnStyle(p.id)}
                  onDragOver={(e) => handleDragOver(e, p.id)}
                  onDrop={(e) => handleDrop(e, p.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13.5 }}>{p.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{items.length}</span>
                  </div>

                  {items.map((d) => (
                    <div
                      key={d.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, d.id)}
                      onDragEnd={handleDragEnd}
                      style={{
                        background: '#fff', border: '1px solid var(--hairline)', borderRadius: 10,
                        padding: '10px 12px', marginBottom: 8, fontSize: 12.5,
                        cursor: 'grab', opacity: draggedId === d.id ? 0.4 : reassigning === d.id ? 0.6 : 1,
                      }}
                    >
                      <Link to={`/demand/${d.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          {d.title}
                          {d.confidential && (
                            <span style={{
                              marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 5px',
                              borderRadius: 4, background: 'rgba(91,95,239,0.12)', color: 'var(--indigo)',
                            }}>CONFIDENTIAL</span>
                          )}
                        </div>
                        <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px' }}>
                          {STATUS_LABELS[d.status] ?? d.status}
                        </span>
                      </Link>

                      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                        Delivering: {d.delivering_sub_portfolio_name ?? 'not yet categorised'}
                      </div>
                    </div>
                  ))}

                  {items.length === 0 && (
                    <div style={{ color: 'var(--muted)', fontSize: 11.5, textAlign: 'center', padding: '14px 0', fontFamily: 'var(--font-mono)' }}>
                      Drop here
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
