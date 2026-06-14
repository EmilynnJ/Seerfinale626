import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { Auth0Provider, type AppState } from '@auth0/auth0-react';
import { type ReactNode } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { ToastProvider } from './components/ToastProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CosmicBackground } from './components/CosmicBackground';
import { Navigation } from './components/Navigation';
import { Footer } from './components/Footer';
import { useAuth } from './hooks/useAuth';
import { LoadingPage, Button } from './components/ui';

// Pages
import { HomePage } from './pages/HomePage';
import { ReadersPage } from './pages/readers/ReadersPage';
import { ReaderProfilePage } from './pages/readers/ReaderProfilePage';
import { CommunityHubPage } from './pages/community/CommunityHubPage';
import { AdminDashboard } from './pages/dashboard/AdminDashboard';
import { ReaderDashboard } from './pages/dashboard/ReaderDashboard';
import { ClientDashboard } from './pages/dashboard/ClientDashboard';
import { ReadingSessionPage } from './pages/reading/ReadingSessionPage';
import { MessagesPage } from './pages/messages/MessagesPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RoleRoute } from './components/RoleRoute';
import { AboutPage } from './pages/AboutPage';
import { HelpPage } from './pages/HelpPage';
import { LoginPage } from './pages/LoginPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { TermsOfServicePage } from './pages/TermsOfServicePage';
import { NotFoundPage } from './pages/NotFoundPage';

const DEBUG_ENDPOINT = 'http://127.0.0.1:7530/ingest/5d16fd92-dfa5-4af3-be5e-8af5bd6919ee';

function debugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f0e72b' },
    body: JSON.stringify({
      sessionId: 'f0e72b',
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
      runId: 'pre-fix',
    }),
  }).catch(() => {});
}

/**
 * Central traffic controller for /dashboard — waits for the DB role, then
 * routes to the correct role-specific dashboard. Never falls back to /.
 */
function DashboardTrafficController() {
  const { user, isAuthenticated, isLoading, authError, refreshUser, logout } = useAuth();

  if (isLoading) {
    return <LoadingPage message="Preparing your dashboard..." />;
  }

  if (authError) {
    return (
      <div className="page-enter">
        <div className="container" style={{ maxWidth: 560, paddingTop: '4rem' }}>
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <h1 className="heading-2">We couldn't load your profile</h1>
            <p className="login-cosmic__text" style={{ marginBottom: '1rem' }}>
              You are signed in with Auth0, but the SoulSeer API returned an
              error while syncing your account.
            </p>
            <p className="caption" style={{ marginBottom: '1.5rem' }}>
              {authError}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => refreshUser?.()}>
                Retry
              </Button>
              <Button variant="ghost" onClick={() => logout()}>
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user?.role) {
    return <Navigate to="/login" replace />;
  }

  // #region agent log
  debugLog('App.tsx:DashboardTrafficController', 'Routing by role', { role: user.role }, 'E');
  // #endregion

  switch (user.role) {
    case 'admin':
      return <Navigate to="/dashboard/admin" replace />;
    case 'reader':
      return <Navigate to="/dashboard/reader" replace />;
    case 'client':
    default:
      return <Navigate to="/dashboard/client" replace />;
  }
}

function AppRoutes() {
  return (
    <ErrorBoundary>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <CosmicBackground />
      <Navigation />
      <main id="main-content" className="page-wrapper">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/readers" element={<ReadersPage />} />
          <Route path="/readers/:id" element={<ReaderProfilePage />} />
          <Route path="/community" element={<CommunityHubPage />} />
          <Route path="/dashboard" element={<DashboardTrafficController />} />
          <Route
            path="/dashboard/admin"
            element={
              <RoleRoute allow={['admin']}>
                <AdminDashboard />
              </RoleRoute>
            }
          />
          <Route
            path="/dashboard/reader"
            element={
              <RoleRoute allow={['reader']}>
                <ReaderDashboard />
              </RoleRoute>
            }
          />
          <Route
            path="/dashboard/client"
            element={
              <RoleRoute allow={['client']}>
                <ClientDashboard />
              </RoleRoute>
            }
          />
          <Route path="/reading/:id" element={<ReadingSessionPage />} />
          <Route
            path="/messages"
            element={
              <ProtectedRoute>
                <MessagesPage />
              </ProtectedRoute>
            }
          />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
    </ErrorBoundary>
  );
}

/**
 * Auth0 provider that navigates via React Router after the login callback.
 *
 * Must be rendered INSIDE <BrowserRouter> so useNavigate() is available.
 * Previous versions used window.history.replaceState in onRedirectCallback,
 * which did not trigger a React Router re-render — the URL updated but the
 * page stayed on HomePage, making it look like /dashboard didn't exist.
 */
function Auth0ProviderWithNavigate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const auth0Domain = (import.meta.env.VITE_AUTH0_DOMAIN || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID || '';
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE || '';
  const redirectUri = (
    import.meta.env.VITE_AUTH0_REDIRECT_URI ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  ).replace(/\/$/, '');

  if (!auth0Domain || !clientId) {
    console.error(
      '[SoulSeer] Auth0 env vars missing. Ensure VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID are set.',
    );
  }
  if (!audience) {
    console.warn(
      '[SoulSeer] VITE_AUTH0_AUDIENCE is not set — backend JWT validation will reject tokens.',
    );
  }

  const onRedirectCallback = (appState?: AppState) => {
    const target = appState?.returnTo || '/dashboard';
    navigate(target, { replace: true });
  };

  return (
    <Auth0Provider
      domain={auth0Domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: redirectUri,
        audience,
        scope: 'openid profile email offline_access',
      }}
      // Use rotating refresh tokens instead of silent-iframe auth. Modern
      // browsers (Safari ITP, Chrome third-party-cookie phase-out) block the
      // hidden-iframe Auth0 session cookie, which makes getAccessTokenSilently()
      // fail and the app appear "logged in but broken". Refresh tokens stored in
      // localStorage survive page reloads and do not depend on third-party
      // cookies. Requires "Allow Offline Access" enabled on the Auth0 API.
      useRefreshTokens
      useRefreshTokensFallback
      cacheLocation="localstorage"
      onRedirectCallback={onRedirectCallback}
    >
      {children}
    </Auth0Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Auth0ProviderWithNavigate>
        <ToastProvider>
          <AuthProvider>
            <WebSocketProvider>
              <AppRoutes />
            </WebSocketProvider>
          </AuthProvider>
        </ToastProvider>
      </Auth0ProviderWithNavigate>
    </BrowserRouter>
  );
}
