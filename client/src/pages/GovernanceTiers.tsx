import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/apiClient';

interface GovernanceTier {
  id: string;
  name: string;
  min_threshold: number;
  added_approvers: string[];
  added_documents: string[];
}

// Comma-separated tag input kept deliberately simple - no tag-picker
// widget, just a text field parsed on save. Matches the rest of the
// app's lean-form conventions.
function parseTags(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function GovernanceTiers() {
  const [tiers, setTiers] = useState<GovernanceTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [minThreshold, setMinThreshold] = useState('');
  const [approvers, setApprovers] = useState('');
  const [documents, setDocuments] = useState('');
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editThreshold, setEditThreshold] = useState('');
  const [editApprovers, setEditApprovers] = useState('');
  const [editDocuments, setEditDocuments] = useState('');

  function load() {
    setLoading(true);
    apiFetch('/api/governance-tiers')
      .then(setTiers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function addTier(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/governance-tiers', {
        method: 'POST',
        body: JSON.stringify({
          name,
          minThreshold: Number(minThreshold),
          addedApprovers: parseTags(approvers),
          addedDocuments: parseTags(documents),
        }),
      });
      setName(''); setMinThreshold(''); setApprovers(''); setDocuments('');
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add tier');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(tier: GovernanceTier) {
    setEditingId(tier.id);
    setEditName(tier.name);
    setEditThreshold(tier.min_threshold.toString());
    setEditApprovers(tier.added_approvers.join(', '));
    setEditDocuments(tier.added_documents.join(', '));
  }

  async function saveEdit(tierId: string) {
    setSaving(true);
    try {
      await apiFetch(`/api/governance-tiers/${tierId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName,
          minThreshold: Number(editThreshold),
          addedApprovers: parseTags(editApprovers),
          addedDocuments: parseTags(editDocuments),
        }),
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tier');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTier(tierId: string) {
    try {
      await apiFetch(`/api/governance-tiers/${tierId}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tier');
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Governance Tiers</h1>
          <p className="page-subtitle">
            Cumulative, by requested spend. Each tier ADDS its approvers and documents
            to every tier below it - A finance committee report needs all porceeding levels. 
            PDF reporting extracts the corect level of information.
          </p>
        </div>
        <button onClick={() => setShowAdd((s) => !s)} className="btn btn--project" style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}>
          + Add tier
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addTier} className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="login-field"><label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="login-field"><label>Minimum threshold (GBP)</label>
            <input type="number" min="0" value={minThreshold} onChange={(e) => setMinThreshold(e.target.value)} required /></div>
          <div className="login-field"><label>Added approvers (comma-separated)</label>
            <input type="text" value={approvers} onChange={(e) => setApprovers(e.target.value)} /></div>
          <div className="login-field"><label>Added documents (comma-separated)</label>
            <input type="text" value={documents} onChange={(e) => setDocuments(e.target.value)} /></div>
          <button type="submit" disabled={saving} className="btn btn--project" style={{ marginTop: 4 }}>
            {saving ? 'Adding...' : 'Add tier'}
          </button>
        </form>
      )}

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && tiers.map((tier) => (
        <div key={tier.id} className="goal-card" style={{ marginBottom: '1rem' }}>
          {editingId === tier.id ? (
            <>
              <div className="login-field"><label>Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
              <div className="login-field"><label>Minimum threshold (GBP)</label>
                <input type="number" min="0" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)} /></div>
              <div className="login-field"><label>Added approvers (comma-separated)</label>
                <input type="text" value={editApprovers} onChange={(e) => setEditApprovers(e.target.value)} /></div>
              <div className="login-field"><label>Added documents (comma-separated)</label>
                <input type="text" value={editDocuments} onChange={(e) => setEditDocuments(e.target.value)} /></div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={() => saveEdit(tier.id)} disabled={saving} className="btn btn--project" style={{ fontSize: 12, padding: '6px 12px' }}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditingId(null)} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px' }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="goal-card__name">{tier.name}</div>
                  <div className="goal-card__meta">From GBP {Number(tier.min_threshold).toLocaleString()}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => startEdit(tier)} className="btn btn--outline" style={{ fontSize: 11, padding: '4px 10px' }}>Edit</button>
                  <button onClick={() => deleteTier(tier.id)} className="btn btn--outline" style={{ fontSize: 11, padding: '4px 10px' }}>Delete</button>
                </div>
              </div>
              {tier.added_approvers.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Adds approvers</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {tier.added_approvers.map((a) => <span key={a} className="pill pill--indigo">{a}</span>)}
                  </div>
                </div>
              )}
              {tier.added_documents.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Adds documents</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {tier.added_documents.map((d) => <span key={d} className="pill pill--muted">{d}</span>)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {!loading && tiers.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No governance tiers configured yet.</p>}
    </div>
  );
}
