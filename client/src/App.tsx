import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PermissionsProvider } from './context/PermissionsContext';
import { Login } from './pages/Login';
import { AppShell } from './components/AppShell';
import { AllDemand } from './pages/AllDemand';
import { RaiseDemand } from './pages/RaiseDemand';
import { DemandDetail } from './pages/DemandDetail';
import { AcceptDemand } from './pages/AcceptDemand';
import { AssessDemand } from './pages/AssessDemand';
import { BusinessCaseDetail } from './pages/BusinessCaseDetail';
import { StrategicGoals } from './pages/StrategicGoals';
import { PortfolioBudgets } from './pages/PortfolioBudgets';
import { PortfolioAdmin } from './pages/PortfolioAdmin';
import { AnnualPlanningBoard } from './pages/AnnualPlanningBoard';
import { GovernanceTiers } from './pages/GovernanceTiers';
import { RolesAdmin } from './pages/RolesAdmin';
import { UserAdmin } from './pages/UserAdmin';
import { PortfolioRollup } from './pages/PortfolioRollup';
import { MyHome } from './pages/MyHome';
import { ComingSoon } from './pages/ComingSoon';
import { IdleSessionGuard } from './components/IdleSessionGuard';

// Sends the user to My Home on every genuine sign-in - not just when
// the URL happens to be "/". Firebase persists sessions locally, so
// closing and reopening a tab (or the browser) silently re-signs the
// user in at whatever deep URL was last open, never touching "/" -
// the index-route redirect alone can't catch that. This watches the
// actual auth transition instead: the moment `user` goes from
// null/loading to a real value, redirect once, regardless of the
// current URL. Resets on sign-out so the next sign-in redirects again.
function useRedirectToHomeOnSignIn(user: unknown) {
  const navigate = useNavigate();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (user && !hasRedirected.current) {
      hasRedirected.current = true;
      navigate('/home', { replace: true });
    }
    if (!user) {
      hasRedirected.current = false;
    }
  }, [user, navigate]);
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  useRedirectToHomeOnSignIn(user);

  if (loading) return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (!user) return <Login />;

  return <IdleSessionGuard>{children}</IdleSessionGuard>;
}

function App() {
  return (
    <AuthProvider>
      <PermissionsProvider>
        <BrowserRouter>
          <AuthGate>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Navigate to="/home" replace />} />
                <Route path="/home" element={<MyHome />} />
                <Route path="/demand" element={<AllDemand />} />
                <Route path="/demand/raise" element={<RaiseDemand />} />
                <Route path="/demand/:id" element={<DemandDetail />} />
                <Route path="/demand/:id/assess" element={<AssessDemand />} />
                <Route path="/demand/:id/accept" element={<AcceptDemand />} />
                <Route path="/business-case/:id" element={<BusinessCaseDetail />} />
                <Route path="/goals" element={<StrategicGoals />} />
                <Route path="/budgets" element={<PortfolioBudgets />} />
                <Route path="/portfolio-admin" element={<PortfolioAdmin />} />
                <Route path="/planning" element={<AnnualPlanningBoard />} />
                <Route path="/governance-tiers" element={<GovernanceTiers />} />
                <Route path="/roles" element={<RolesAdmin />} />
                <Route path="/users" element={<UserAdmin />} />
                <Route path="/portfolio" element={<PortfolioRollup />} />
                <Route path="/projects" element={<ComingSoon title="Active Initiatives" />} />
              </Route>
            </Routes>
          </AuthGate>
        </BrowserRouter>
      </PermissionsProvider>
    </AuthProvider>
  );
}

export default App;