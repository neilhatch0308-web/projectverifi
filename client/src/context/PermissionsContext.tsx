import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from './AuthContext';

interface PermissionsContextValue {
  permissions: string[];
  userId: string | null;
  loading: boolean;
  has: (key: string) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue | undefined>(undefined);

// Fetched once per session from GET /me and cached here - every screen
// that needs to hide/show an Edit button or a nav link reads from this
// instead of re-fetching. This is a UI convenience only: the real gate
// is server-side (requirePermission in the API), so a stale or spoofed
// client-side permission list can hide a button but can never grant
// access the server wouldn't already allow.
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPermissions([]);
      setUserId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch('/api/me')
      .then((data: { permissions: string[]; userId: string }) => {
        setPermissions(data.permissions ?? []);
        setUserId(data.userId ?? null);
      })
      .catch(() => { setPermissions([]); setUserId(null); })
      .finally(() => setLoading(false));
  }, [user]);

  function has(key: string) {
    return permissions.includes(key);
  }

  return (
    <PermissionsContext.Provider value={{ permissions, userId, loading, has }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used inside PermissionsProvider');
  return ctx;
}
