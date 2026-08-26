import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/apiClient';

interface SubPortfolio { id: string; name: string; parent_portfolio_id: string; }
interface ParentPortfolio { id: string; name: string; parent_portfolio_id: null; subPortfolios: SubPortfolio[]; }

export function PortfolioAdmin() {
  const [hierarchy, setHierarchy] = useState<ParentPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newParentName, setNewParentName] = useState('');
  const [addingParent, setAddingParent] = useState(false);

  const [subFormOpenFor, setSubFormOpenFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  function load() {
    setLoading(true);
    apiFetch('/api/portfolios/hierarchy')
      .then(setHierarchy)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function addParent(e: FormEvent) {
    e.preventDefault();
    setAddingParent(true);
    try {
      await apiFetch('/api/portfolios', { method: 'POST', body: JSON.stringify({ name: newParentName }) });
      setNewParentName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add portfolio');
    } finally {
      setAddingParent(false);
    }
  }

  async function addSub(parentId: string, e: FormEvent) {
    e.preventDefault();
    setAddingSub(true);
    try {
      await apiFetch('/api/portfolios', {
        method: 'POST',
        body: JSON.stringify({ name: newSubName, parentPortfolioId: parentId }),
      });
      setNewSubName('');
      setSubFormOpenFor(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add sub-portfolio');
    } finally {
      setAddingSub(false);
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 className="page-title">Portfolio Configuration</h1>
      <p className="page-subtitle">
        Two levels only. Parent portfolios hold the budget; demand tags against a
        sub-portfolio, and its cost rolls up to the parent - no separate sub-allocation needed.
      </p>

      <form onSubmit={addParent} className="goal-card" style={{ marginBottom: '1.5rem' }}>
        <div className="goal-card__meta" style={{ marginBottom: 8 }}>Add a parent portfolio</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" placeholder="e.g. Products" value={newParentName}
            onChange={(e) => setNewParentName(e.target.value)} required />
          <button type="submit" disabled={addingParent} className="btn btn--project">
            {addingParent ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && hierarchy.map((parent) => (
        <div key={parent.id} className="goal-card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="goal-card__name">{parent.name}</div>
            <button
              onClick={() => setSubFormOpenFor(subFormOpenFor === parent.id ? null : parent.id)}
              className="btn btn--outline"
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              + Sub-portfolio
            </button>
          </div>

          {parent.subPortfolios.length > 0 ? (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {parent.subPortfolios.map((s) => (
                <span key={s.id} className="pill pill--muted">{s.name}</span>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--muted)' }}>No sub-portfolios yet.</div>
          )}

          {subFormOpenFor === parent.id && (
            <form onSubmit={(e) => addSub(parent.id, e)} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input type="text" placeholder="e.g. ERP" value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)} required autoFocus />
              <button type="submit" disabled={addingSub} className="btn btn--project" style={{ fontSize: 12 }}>
                {addingSub ? 'Adding...' : 'Add'}
              </button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
