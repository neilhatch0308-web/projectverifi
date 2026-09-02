import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../context/PermissionsContext';
import iconMark from '../assets/project-verifi-icon.svg';

// requires: undefined means always visible (part of the Submitter
// baseline or generally useful reference data). A set permission means
// the link only shows if the user's role(s) grant it - purely a UI
// convenience, the real gate is server-side.
const navGroups = [
  {
    label: 'Me',
    items: [
      { to: '/home', label: 'My Home' },
    ],
  },
  {
    label: 'Organisation',
    items: [
      { to: '/portfolio', label: 'Portfolio rollup' },
      { to: '/demand', label: 'All demand' },
      { to: '/planning', label: 'Annual planning', requires: 'planning.edit' },
      { to: '/horizon', label: 'Five-year horizon' },
      { to: '/goals', label: 'Strategic goals' },
      { to: '/budgets', label: 'Portfolio budgets' },
      { to: '/portfolio-admin', label: 'Portfolio config', requires: 'org.manage' },
      { to: '/governance-tiers', label: 'Governance tiers', requires: 'org.manage' },
    ],
  },
  {
    label: 'Live projects',
    items: [
      { to: '/projects', label: 'Active initiatives' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/roles', label: 'Roles', requires: 'users.manage' },
      { to: '/users', label: 'Users', requires: 'users.manage' },
    ],
  },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const { has } = usePermissions();

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
          const visibleItems = group.items.filter((item) => !item.requires || has(item.requires));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label} className="nav-group">
              <div className="nav-group__label">{group.label}</div>
              {visibleItems.map((item) => (
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
