import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import iconMark from '../assets/project-verifi-icon.svg';

const navGroups = [
  {
    label: 'Organisation',
    items: [
      { to: '/portfolio', label: 'Portfolio rollup' },
      { to: '/demand', label: 'All demand' },
      { to: '/goals', label: 'Strategic goals' },
    ],
  },
  {
    label: 'Live projects',
    items: [
      { to: '/projects', label: 'Active initiatives' },
    ],
  },
];

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <img src={iconMark} alt="" className="app-brand__icon" />
          <span>
            Project<span className="app-brand__accent"> Verifi</span>
          </span>
        </div>
        {navGroups.map((group) => (
          <div key={group.label} className="nav-group">
            <div className="nav-group__label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `app-nav-link${isActive ? ' is-active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
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
