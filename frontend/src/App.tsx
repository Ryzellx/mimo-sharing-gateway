import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProviders, useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import LoginPage from './pages/LoginPage';
import ModelsPage from './pages/ModelsPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import UsersPage from './pages/UsersPage';
import MimoAccountsPage from './pages/MimoAccountsPage';
import UsagePage from './pages/UsagePage';
import SettingsPage from './pages/SettingsPage';
import UserDashboardPage from './pages/UserDashboardPage';
import ApiKeysPage from './pages/ApiKeysPage';
import DocsPage from './pages/DocsPage';

function Require({ role, children }: { role: 'admin' | 'user'; children: ReactNode }) {
  const { role: current } = useAuth();
  if (!current) return <Navigate to="/" replace />;
  if (current !== role) return <Navigate to={current === 'admin' ? '/admin' : '/app'} replace />;
  return <>{children}</>;
}

function Landing() {
  const { role } = useAuth();
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'user') return <Navigate to="/app" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route
            element={
              <Require role="admin">
                <Shell />
              </Require>
            }
          >
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/models" element={<ModelsPage />} />
            <Route path="/admin/mimo" element={<MimoAccountsPage />} />
            <Route path="/admin/usage" element={<UsagePage />} />
            <Route path="/admin/settings" element={<SettingsPage />} />
          </Route>
          <Route
            element={
              <Require role="user">
                <Shell />
              </Require>
            }
          >
            <Route path="/app" element={<UserDashboardPage />} />
            <Route path="/app/keys" element={<ApiKeysPage />} />
            <Route path="/app/usage" element={<UsagePage />} />
            <Route path="/app/docs" element={<DocsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProviders>
  );
}
