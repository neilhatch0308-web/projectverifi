import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

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
  { key: 'promoted', label: 'Business Case', statuses: ['promoted'] },
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--muted)' }}>
          {stage.exit ? (
            <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px' }}>Stopped</span>
          ) : stage.key === 'promoted' ? (
            <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px', textTransform: 'capitalize' }}>
              {d.business_case_decision ?? 'Awaiting decision'}
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
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/demands').then(setDemands).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  const filtered = demands.filter((d) => d.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">All Demand</h1>
          <p className="page-subtitle">Every demand raised, laid out by stage - left to right is the golden thread.</p>
        </div>
        <Link to="/demand/raise" className="btn btn--project" style={{ textDecoration: 'none' }}>+ Raise demand</Link>
      </div>

      <input type="text" placeholder="Search by title..." value={search} onChange={(e) => setSearch(e.target.value)} className="search-input" />

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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13.5 }}>{stage.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{items.length}</span>
                    </div>
                    {items.map((d) => <DemandCard key={d.id} d={d} stage={stage} />)}
                    {items.length === 0 && (
                      <div style={{ color: 'var(--muted)', fontSize: 11.5, textAlign: 'center', padding: '14px 0', fontFamily: 'var(--font-mono)' }}>
                        None
                      </div>
                    )}
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
