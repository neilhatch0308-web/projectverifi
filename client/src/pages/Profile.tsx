import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

interface Portfolio { id: string; name: string; }

export function Profile() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [defaultPortfolioId, setDefaultPortfolioId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiFetch('/api/portfolios'), apiFetch('/api/me')])
      .then(([p, me]) => {
        setPortfolios(p);
        setDefaultPortfolioId(me.defaultPortfolioId ?? '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await apiFetch('/api/me/default-portfolio', {
        method: 'PATCH',
        body: JSON.stringify({ portfolioId: defaultPortfolioId || null }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="horizon-state">Loading...</div>;

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 className="page-title">Profile</h1>
      <p className="page-subtitle">Personal preferences for how the app opens for you.</p>

      <div className="goal-card" style={{ marginTop: '1.25rem' }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          Default portfolio for Annual Planning
        </label>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Which view Annual Planning opens to. "All portfolios" always stays available as an option regardless of this setting.
        </p>
        <select
          value={defaultPortfolioId}
          onChange={(e) => setDefaultPortfolioId(e.target.value)}
          style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14, marginBottom: 12 }}
        >
          <option value="">All portfolios (default)</option>
          {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {error && <p className="login-error">{error}</p>}
        {saved && <p style={{ fontSize: 13, color: 'var(--teal)', marginBottom: 8 }}>Saved.</p>}

        <button className="btn btn--project" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
