import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/apiClient';

interface Permission { key: string; label: string; description: string | null; }
interface Role { id: string; name: string; description: string | null; permissions: string[]; }

export function RolesAdmin() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permSelection, setPermSelection] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());

  function load() {
    setLoading(true);
    Promise.all([apiFetch('/api/roles'), apiFetch('/api/permissions')])
      .then(([r, p]) => { setRoles(r); setCatalog(p); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function togglePerm(set: Set<string>, setter: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  }

  async function addRole(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/roles', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined, permissions: Array.from(permSelection) }),
      });
      setName(''); setDescription(''); setPermSelection(new Set());
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add role');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(role: Role) {
    setEditingId(role.id);
    setEditName(role.name);
    setEditDescription(role.description ?? '');
    setEditPerms(new Set(role.permissions));
  }

  async function saveEdit(roleId: string) {
    setSaving(true);
    try {
      await apiFetch(`/api/roles/${roleId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName, description: editDescription, permissions: Array.from(editPerms) }),
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRole(roleId: string) {
    try {
      await apiFetch(`/api/roles/${roleId}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete role');
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Roles</h1>
          <p className="page-subtitle">
            Every user can already raise demand and see their own - that's the floor, not a tickbox.
            Roles below add capability on top, and stack: a user can hold several.
          </p>
        </div>
        <button onClick={() => setShowAdd((s) => !s)} className="btn btn--project" style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}>
          + Add role
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addRole} className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="login-field"><label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="login-field"><label>Description (optional)</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="goal-card__meta" style={{ marginBottom: 8 }}>Permissions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {catalog.map((p) => (
              <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={permSelection.has(p.key)}
                  onChange={() => togglePerm(permSelection, setPermSelection, p.key)}
                  style={{ marginTop: 3 }} />
                <span>
                  <strong>{p.label}</strong>
                  {p.description && <span style={{ color: 'var(--muted)' }}> - {p.description}</span>}
                </span>
              </label>
            ))}
          </div>
          <button type="submit" disabled={saving} className="btn btn--project" style={{ marginTop: 14 }}>
            {saving ? 'Adding...' : 'Add role'}
          </button>
        </form>
      )}

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && roles.map((role) => (
        <div key={role.id} className="goal-card" style={{ marginBottom: '1rem' }}>
          {editingId === role.id ? (
            <>
              <div className="login-field"><label>Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
              <div className="login-field"><label>Description</label>
                <input type="text" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></div>
              <div className="goal-card__meta" style={{ marginBottom: 8 }}>Permissions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {catalog.map((p) => (
                  <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={editPerms.has(p.key)}
                      onChange={() => togglePerm(editPerms, setEditPerms, p.key)}
                      style={{ marginTop: 3 }} />
                    <span>
                      <strong>{p.label}</strong>
                      {p.description && <span style={{ color: 'var(--muted)' }}> - {p.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => saveEdit(role.id)} disabled={saving} className="btn btn--project" style={{ fontSize: 12, padding: '6px 12px' }}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditingId(null)} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 12px' }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="goal-card__name">{role.name}</div>
                  {role.description && <div className="goal-card__meta" style={{ marginTop: 2 }}>{role.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => startEdit(role)} className="btn btn--outline" style={{ fontSize: 11, padding: '4px 10px' }}>Edit</button>
                  <button onClick={() => deleteRole(role.id)} className="btn btn--outline" style={{ fontSize: 11, padding: '4px 10px' }}>Delete</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {role.permissions.length > 0
                  ? role.permissions.map((key) => (
                      <span key={key} className="pill pill--indigo">
                        {catalog.find((p) => p.key === key)?.label ?? key}
                      </span>
                    ))
                  : <span style={{ fontSize: 12, color: 'var(--muted)' }}>No permissions granted</span>}
              </div>
            </>
          )}
        </div>
      ))}
      {!loading && roles.length === 0 && <p style={{ color: 'var(--muted)' }}>No roles defined yet.</p>}
    </div>
  );
}
