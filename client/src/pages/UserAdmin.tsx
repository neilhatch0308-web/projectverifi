import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/apiClient';

interface Role { id: string; name: string; description: string | null; }
interface AdminUser { id: string; display_name: string; email: string; is_active: boolean; role_ids: string[]; }

export function UserAdmin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('active');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRoleIds, setNewRoleIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createdResetLink, setCreatedResetLink] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Local edit buffer per user - lets someone tick several boxes before
  // it saves, rather than firing a request per checkbox click.
  const [pending, setPending] = useState<Record<string, Set<string>>>({});

  function load() {
    setLoading(true);
    Promise.all([apiFetch('/api/users/admin'), apiFetch('/api/roles'), apiFetch('/api/me')])
      .then(([u, r, me]: [AdminUser[], Role[], { userId: string }]) => {
        setUsers(u);
        setRoles(r);
        setCurrentUserId(me.userId);
        const initial: Record<string, Set<string>> = {};
        u.forEach((user) => { initial[user.id] = new Set(user.role_ids); });
        setPending(initial);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function toggle(userId: string, roleId: string) {
    setPending((prev) => {
      const next = new Set(prev[userId] ?? []);
      if (next.has(roleId)) next.delete(roleId); else next.add(roleId);
      return { ...prev, [userId]: next };
    });
  }

  function isDirty(userId: string) {
    const original = new Set(users.find((u) => u.id === userId)?.role_ids ?? []);
    const current = pending[userId] ?? new Set();
    if (original.size !== current.size) return true;
    for (const id of original) if (!current.has(id)) return true;
    return false;
  }

  async function save(userId: string) {
    setSavingUserId(userId);
    try {
      await apiFetch(`/api/users/${userId}/roles`, {
        method: 'PUT',
        body: JSON.stringify({ roleIds: Array.from(pending[userId] ?? []) }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save roles');
    } finally {
      setSavingUserId(null);
    }
  }

  async function toggleStatus(userId: string, makeActive: boolean) {
    setStatusChangingId(userId);
    try {
      await apiFetch(`/api/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: makeActive }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account status');
    } finally {
      setStatusChangingId(null);
    }
  }

  function toggleNewRole(roleId: string) {
    setNewRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId); else next.add(roleId);
      return next;
    });
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const result = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: newEmail,
          displayName: newDisplayName,
          roleIds: Array.from(newRoleIds),
        }),
      });
      setCreatedResetLink(result.resetLink);
      setCreatedEmail(newEmail);
      setLinkCopied(false);
      setNewEmail('');
      setNewDisplayName('');
      setNewRoleIds(new Set());
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  async function copyResetLink() {
    if (!createdResetLink) return;
    await navigator.clipboard.writeText(createdResetLink);
    setLinkCopied(true);
  }

  const filteredUsers = users.filter((user) => {
    const matchesSearch = search.trim().length === 0
      || user.display_name.toLowerCase().includes(search.toLowerCase())
      || user.email.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role_ids.includes(roleFilter);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'active' && user.is_active)
      || (statusFilter === 'suspended' && !user.is_active);
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">
            Every user is a Submitter by default - raise demand, view/edit their own. Tick additional
            roles below to grant more. Roles stack; a user can hold several at once.
          </p>
        </div>
        <button onClick={() => setShowCreate((s) => !s)} className="btn btn--project" style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}>
          + Create user
        </button>
      </div>

      {createdResetLink && (
        <div className="goal-card" style={{ marginBottom: '1.25rem', border: '1.5px solid var(--teal)' }}>
          <div className="goal-card__meta" style={{ marginBottom: 6 }}>
            Account created for {createdEmail}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
            There's no automated email for this yet - copy this password-reset link and send it to
            them yourself (email, Slack, however). It lets them set their own password; nobody here
            ever sees it.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input readOnly value={createdResetLink} onFocus={(e) => e.target.select()}
              style={{ flex: 1, fontSize: 12, padding: '6px 10px', border: '1px solid var(--hairline)', borderRadius: 8, fontFamily: 'var(--font-mono)' }} />
            <button onClick={copyResetLink} className="btn btn--outline" style={{ fontSize: 11.5, padding: '6px 12px', whiteSpace: 'nowrap' }}>
              {linkCopied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
          <button onClick={() => setCreatedResetLink(null)} className="btn btn--outline" style={{ fontSize: 11, padding: '4px 10px', marginTop: 10 }}>
            Dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <form onSubmit={createUser} className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta" style={{ marginBottom: 8 }}>Create a new user</div>
          <div className="login-field"><label>Email</label>
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required /></div>
          <div className="login-field"><label>Display name</label>
            <input type="text" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} required /></div>

          {roles.length > 0 && (
            <>
              <div className="goal-card__meta" style={{ marginTop: 4, marginBottom: 8 }}>Roles (optional)</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
                {roles.map((role) => (
                  <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={newRoleIds.has(role.id)} onChange={() => toggleNewRole(role.id)} />
                    {role.name}
                  </label>
                ))}
              </div>
            </>
          )}

          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
            This creates a real sign-in account. You'll get a password-reset link to send them
            afterward - there's no invite email sent automatically.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={creating} className="btn btn--project" style={{ fontSize: 12, padding: '6px 14px' }}>
              {creating ? 'Creating...' : 'Create user'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="btn btn--outline" style={{ fontSize: 12, padding: '6px 14px' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && (
        <div style={{ display: 'flex', gap: 10, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <input
            type="text" placeholder="Search by name or email..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 240px', padding: '8px 12px', border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 13.5 }}
          />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 13.5 }}>
            <option value="all">All roles</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            style={{ padding: '8px 10px', border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 13.5 }}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="all">All</option>
          </select>
        </div>
      )}

      {!loading && filteredUsers.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>No users match this search/filter.</p>
      )}

      {!loading && filteredUsers.map((user) => (
        <div key={user.id} className="goal-card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="goal-card__name">{user.display_name}</div>
              <div className="goal-card__meta" style={{ marginTop: 2 }}>{user.email}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!user.is_active && <span className="pill pill--muted">Deactivated</span>}
              <button
                onClick={() => toggleStatus(user.id, !user.is_active)}
                disabled={statusChangingId === user.id || (user.id === currentUserId && user.is_active)}
                title={user.id === currentUserId && user.is_active ? "You can't suspend your own account" : undefined}
                className="btn btn--outline"
                style={{ fontSize: 11.5, padding: '4px 10px' }}
              >
                {statusChangingId === user.id ? '...' : user.is_active ? 'Suspend' : 'Reactivate'}
              </button>
            </div>
          </div>

          {roles.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>
              No roles defined yet - add some on the Roles screen first.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
              {roles.map((role) => (
                <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={pending[user.id]?.has(role.id) ?? false}
                    onChange={() => toggle(user.id, role.id)}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          )}

          {isDirty(user.id) && (
            <button
              onClick={() => save(user.id)}
              disabled={savingUserId === user.id}
              className="btn btn--outline"
              style={{ fontSize: 11.5, padding: '5px 12px', marginTop: 12 }}
            >
              {savingUserId === user.id ? 'Saving...' : 'Save roles'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}