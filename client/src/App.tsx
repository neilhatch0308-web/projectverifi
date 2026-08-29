import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import { ComingSoon } from './pages/ComingSoon';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading...</p>;
  if (!user) return <Login />;

  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <PermissionsProvider>
        <BrowserRouter>
          <AuthGate>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Navigate to="/demand" replace />} />
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
                <Route path="/portfolio" element={<ComingSoon title="Portfolio Rollup" />} />
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
