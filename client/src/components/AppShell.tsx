import { useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../context/PermissionsContext';
import iconMark from '../assets/project-verifi-icon.svg';

// requires: undefined means always visible (part of the Submitter
// baseline or generally useful reference data). A set permission means
// the link only shows if the user's role(s) grant it - purely a UI
// convenience, the real gate is server-side.
//
// collapsible: true gives the group a click-to-toggle chevron instead
// of a static label, for visual consistency across every group in the
// sidebar. Default open/closed state is set per-group via defaultOpen
// (see below) - not every group should start collapsed just because
// it can be.
interface NavItem {
  to: string;
  label: string;
  requires?: string;
  requiresAny?: string[];
}

interface NavGroup {
  label: string;
  collapsible?: boolean;
  // Only relevant when collapsible. Defaults to true (open) if omitted -
  // Reporting is the one exception, closed by default since it's a set
  // of pages people dip into occasionally rather than the core
  // day-to-day navigation the other groups hold.
  defaultOpen?: boolean;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Me',
    collapsible: true,
    items: [
      { to: '/home', label: 'My Home' },
    ],
  },
  {
    label: 'Organisation',
    collapsible: true,
    items: [
      { to: '/demand', label: 'All demand' },
      { to: '/planning', label: 'Annual planning', requiresAny: ['planning.view', 'planning.edit'] },
      { to: '/horizon', label: 'Five-year horizon', requires: 'planning.edit' },
      { to: '/goals', label: 'Strategic goals' },
      { to: '/budgets', label: 'Portfolio budgets', requiresAny: ['budgets.view', 'budgets.manage'] },
      { to: '/portfolio-admin', label: 'Portfolio config', requires: 'org.manage' },
      { to: '/governance-tiers', label: 'Governance tiers', requires: 'org.manage' },
    ],
  },
  {
    label: 'Reporting',
    collapsible: true,
    defaultOpen: false,
    items: [
      { to: '/portfolio-report', label: 'Portfolio report', requiresAny: ['budgets.view', 'budgets.manage'] },
      { to: '/variance-report', label: 'Variance report', requiresAny: ['budgets.view', 'budgets.manage'] },
      { to: '/aging-report', label: 'Aging report', requiresAny: ['budgets.view', 'budgets.manage'] },
    ],
  },
  {
    label: 'Live projects',
    collapsible: true,
    items: [
      { to: '/projects', label: 'Active initiatives', requiresAny: ['delivery.view', 'delivery.edit'] },
    ],
  },
  {
    label: 'Admin',
    collapsible: true,
    items: [
      { to: '/roles', label: 'Roles', requires: 'users.manage' },
      { to: '/users', label: 'Users', requires: 'users.manage' },
    ],
  },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const { has } = usePermissions();
  const location = useLocation();
  // Each collapsible group starts at its own defaultOpen (true unless
  // specified otherwise) - computed once, lazily, so it's stable across
  // re-renders while still reflecting the navGroups config above.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navGroups.map((g) => [g.label, g.defaultOpen ?? true]))
  );

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <img src={iconMark} alt="" className="app-brand__icon" />
          <span>
            Project<span className="app-brand__accent"> Verifi</span>
          </span>
        </div>

        <Link
          to="/demand/raise"
          className="btn btn--project"
          style={{ width: '100%', justifyContent: 'center', marginBottom: '1.5rem', textDecoration: 'none', fontSize: 13, padding: '9px 0' }}
        >
          + Raise demand
        </Link>

        {navGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) =>
              (!item.requires || has(item.requires)) &&
              (!item.requiresAny || item.requiresAny.some((k) => has(k)))
          );
          if (visibleItems.length === 0) return null;

          const isOpen = !group.collapsible || !!openGroups[group.label] ||
            visibleItems.some((item) => location.pathname.startsWith(item.to));

          return (
            <div key={group.label} className="nav-group">
              {group.collapsible ? (
                <button
                  type="button"
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [group.label]: !prev[group.label] }))}
                  className="nav-group__label"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                  }}
                  aria-expanded={isOpen}
                >
                  {group.label}
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  >
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>
              ) : (
                <div className="nav-group__label">{group.label}</div>
              )}
              {isOpen && visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `app-nav-link${isActive ? ' is-active' : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </aside>
      <main className="app-main">
        <div className="app-topbar">
          <span>{user?.email}</span>
          <span className="btn btn--outline" onClick={logout} style={{ cursor: 'pointer' }}>
            Sign out
          </span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}