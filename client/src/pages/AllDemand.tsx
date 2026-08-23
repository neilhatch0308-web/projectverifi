import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface Demand {
  id: string;
  title: string;
  status: string;
  raised_date: string;
  need_by_date: string | null;
  weighted_score: number;
}

const statusPill: Record<string, string> = {
  raised: 'pill--muted', accepted: 'pill--indigo', promoted: 'pill--teal', rejected: 'pill--muted',
};

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
          <p className="page-subtitle">Every demand raised, across all stages</p>
        </div>
        <Link to="/demand/raise" className="btn btn--project" style={{ textDecoration: 'none' }}>+ Raise demand</Link>
      </div>

      <input type="text" placeholder="Search by title..." value={search} onChange={(e) => setSearch(e.target.value)} className="search-input" />

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && !error && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th><th>Status</th><th>Weighted score</th><th>Needed by</th><th>Raised</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id}>
                <td><Link to={`/demand/${d.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{d.title}</Link></td>
                <td><span className={`pill ${statusPill[d.status] ?? 'pill--muted'}`}>{d.status}</span></td>
                <td>{Number(d.weighted_score) > 0 ? Number(d.weighted_score).toFixed(1) : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
                <td>{d.need_by_date ? new Date(d.need_by_date).toLocaleDateString() : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
                <td>{new Date(d.raised_date).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>No demand matches your search.</p>
      )}
    </div>
  );
}
