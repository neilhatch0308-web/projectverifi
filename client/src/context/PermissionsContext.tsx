import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from './AuthContext';

interface PermissionsContextValue {
  permissions: string[];
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPermissions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch('/api/me')
      .then((data: { permissions: string[] }) => setPermissions(data.permissions ?? []))
      .catch(() => setPermissions([]))
      .finally(() => setLoading(false));
  }, [user]);

  function has(key: string) {
    return permissions.includes(key);
  }

  return (
    <PermissionsContext.Provider value={{ permissions, loading, has }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used inside PermissionsProvider');
  return ctx;
}
