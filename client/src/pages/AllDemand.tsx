import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { useHideConfidential } from '../lib/useHideConfidential';
import { ConfidentialityToggle } from '../components/ConfidentialityToggle';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { promotedDemandLabel } from '../lib/promotedDemandLabel';

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
  delivery_stage: 'delivery_started' | 'delivery_completed' | 'adoption_measured' | 'benefit_realized' | null;
  stopped_at: string | null;
  confidential: boolean;
  portfolio_id: string;
  portfolio_name: string;
}

interface Stage { key: string; label: string; statuses: string[]; highlight?: boolean; exit?: boolean; }

// Five stages, left to right - the golden thread as a pipeline rather
// than a flat table. Stopped demand gets its OWN lane at the end rather
// than disappearing from the view entirely: the framework treats
// failure as first-class, not missing data, and that has to hold here
// too, not just in the data model. It's deliberately not styled as an
// alarm - a stopped demand isn't a verdict, just not moving right now.
const STAGES: Stage[] = [
  { key: 'raised', label: 'Raised', statuses: ['raised'] },
  { key: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { key: 'assessed', label: 'Assessed', statuses: ['assessed'], highlight: true },
  { key: 'promoted', label: 'Progressed', statuses: ['promoted'] },
  { key: 'stopped', label: 'Stopped', statuses: ['stopped'], exit: true },
];

function columnStyle(stage: Stage): CSSProperties {
  if (stage.highlight) {
    return { background: 'rgba(23,195,178,0.06)', border: '1.5px solid var(--teal)', borderRadius: 'var(--radius)', padding: '10.5px' };
  }
  if (stage.exit) {
    // Calm, not alarmed - dashed border like the app's "empty slot"
    // convention, not a red warning tint.
    return { background: 'var(--cloud)', border: '1.5px dashed var(--hairline)', borderRadius: 'var(--radius)', padding: '10.5px' };
  }
  return { background: 'var(--cloud)', borderRadius: 'var(--radius)', padding: 12 };
}

function DemandCard({ d, stage }: { d: Demand; stage: Stage }) {
  const linkTo = stage.key === 'promoted' && d.business_case_id
    ? `/business-case/${d.business_case_id}`
    : `/demand/${d.id}`;

  const dateLabel = stage.exit && d.stopped_at
    ? new Date(d.stopped_at).toLocaleDateString()
    : d.need_by_date ? new Date(d.need_by_date).toLocaleDateString() : new Date(d.raised_date).toLocaleDateString();

  return (
    <Link to={linkTo} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        background: '#fff', border: '1px solid var(--hairline)', borderRadius: 10,
        padding: '10px 12px', marginBottom: 8, fontSize: 12.5,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 5 }}>
          {d.title}
          {d.confidential && (
            <span style={{
              marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 5px',
              borderRadius: 4, background: 'rgba(91,95,239,0.12)', color: 'var(--indigo)',
            }}>CONFIDENTIAL</span>
          )}
          {d.date_driver_type && d.date_driver_type !== 'none' && (
            <span style={{
              marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 5px',
              borderRadius: 4, background: 'rgba(232,163,23,0.15)', color: '#8a6100',
            }}>FIXED</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5 }}>{d.portfolio_name}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--muted)' }}>
          {stage.exit ? (
            <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px' }}>Stopped</span>
          ) : stage.key === 'promoted' ? (
            <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px', textTransform: 'capitalize' }}>
              {promotedDemandLabel(d)}
            </span>
          ) : (
            <span>Score {Number(d.weighted_score) > 0 ? Number(d.weighted_score).toFixed(1) : '-'}</span>
          )}
          <span>{dateLabel}</span>
        </div>
      </div>
    </Link>
  );
}

export function AllDemand() {
  const [demands, setDemands] = useState<Demand[]>([]);
  const [portfolios, setPortfolios] = useState<{ id: string; name: string }[]>([]);
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<Set<string>>(new Set());
  const [portfolioMenuOpen, setPortfolioMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([apiFetch('/api/demands'), apiFetch('/api/portfolios')])
      .then(([d, p]) => {
        setDemands(d);
        setPortfolios(p);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function togglePortfolio(id: string) {
    setSelectedPortfolioIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const portfolioFilterLabel =
    selectedPortfolioIds.size === 0
      ? 'All portfolios'
      : selectedPortfolioIds.size === 1
      ? portfolios.find((p) => selectedPortfolioIds.has(p.id))?.name ?? '1 selected'
      : `${selectedPortfolioIds.size} portfolios selected`;

  const { hideConfidential, setHideConfidential } = useHideConfidential();
  const hasConfidential = demands.some((d) => d.confidential);

  const filtered = demands.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) &&
      (selectedPortfolioIds.size === 0 || selectedPortfolioIds.has(d.portfolio_id)) &&
      (!hideConfidential || !d.confidential)
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">All Demand</h1>
          <p className="page-subtitle">Every demand raised, laid out by stage - left to right is the golden thread.</p>
        </div>
        <Link to="/demand/raise" className="btn btn--project" style={{ textDecoration: 'none' }}>+ Raise demand</Link>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <input
          type="text"
          placeholder="Search by title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
          style={{ margin: 0 }}
        />

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setPortfolioMenuOpen((o) => !o)}
            className="btn btn--outline"
            style={{
              fontSize: 14, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6,
              borderRadius: 'var(--radius)', boxSizing: 'border-box', height: 42,
            }}
          >
            {portfolioFilterLabel}
            <span style={{ fontSize: 9 }}>&#9662;</span>
          </button>

          {portfolioMenuOpen && (
            <>
              {/* Click-outside catcher */}
              <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setPortfolioMenuOpen(false)} />
              <div
                style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 11,
                  background: '#fff', border: '1px solid var(--hairline)', borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(20,22,28,0.15)', padding: 10, minWidth: 220, maxHeight: 320, overflowY: 'auto',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedPortfolioIds(new Set())}
                    className="btn btn--outline"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    All portfolios
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPortfolioIds(new Set(portfolios.map((p) => p.id)))}
                    className="btn btn--outline"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    Select all
                  </button>
                </div>
                {portfolios.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '5px 2px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selectedPortfolioIds.has(p.id)} onChange={() => togglePortfolio(p.id)} />
                    {p.name}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <ConfidentialityToggle hideConfidential={hideConfidential} onToggle={setHideConfidential} hasConfidential={hasConfidential} />
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 1200 }}>
            {STAGES.map((stage, i) => {
              const items = filtered.filter((d) => stage.statuses.includes(d.status));
              return (
                <div key={stage.key} style={{ display: 'contents' }}>
                  <div style={{ flex: '1 1 0', minWidth: 210, ...columnStyle(stage) }}>
                    <CollapsibleSection title={stage.label} count={items.length} variant="section">
                      {items.map((d) => <DemandCard key={d.id} d={d} stage={stage} />)}
                      {items.length === 0 && (
                        <div style={{ color: 'var(--muted)', fontSize: 11.5, textAlign: 'center', padding: '14px 0', fontFamily: 'var(--font-mono)' }}>
                          None
                        </div>
                      )}
                    </CollapsibleSection>
                  </div>
                  {i < STAGES.length - 1 && (
                    <div style={{ alignSelf: 'center', color: 'var(--hairline)', fontSize: 22, paddingTop: 40, userSelect: 'none' }}>
                      &#8594;
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>No demand matches your search.</p>
      )}
    </div>
  );
}