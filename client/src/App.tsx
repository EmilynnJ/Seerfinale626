import { BrowserRouter, Routes, Route, useNavigate, Navigate, Link } from 'react-router-dom';
import { NeonAuthUIProvider } from '@neondatabase/neon-js/auth/react/ui';
import { type ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { authClient } from './lib/auth';
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
import { AuthPage } from './pages/AuthPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { TermsOfServicePage } from './pages/TermsOfServicePage';
import { NotFoundPage } from './pages/NotFoundPage';

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
              You are signed in, but the SoulSeer API returned an error while
              syncing your account.
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
          {/* Neon Auth UI views: sign-in, sign-up, forgot-password, reset-password,
              magic-link, email-otp, callback, sign-out, etc. */}
          <Route path="/auth/:pathname" element={<AuthPage />} />
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
 * Neon Auth UI provider wired to React Router.
 *
 * Must be rendered INSIDE <BrowserRouter> so useNavigate()/<Link> are
 * available. The Neon Auth UI components (AuthView, SignedIn, RedirectToSignIn,
 * UserButton, …) use these to navigate between auth views and to redirect after
 * sign-in. After a successful sign-in the provider redirects to /dashboard,
 * where the DashboardTrafficController routes to the correct role dashboard.
 */
function NeonAuthProviderWithNavigate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <NeonAuthUIProvider
      authClient={authClient}
      navigate={(href: string) => navigate(href)}
      replace={(href: string) => navigate(href, { replace: true })}
      Link={({ href, ...props }) => <Link to={href} {...props} />}
      basePath="/auth"
      redirectTo="/dashboard"
      emailOTP
    >
      {children}
    </NeonAuthUIProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <NeonAuthProviderWithNavigate>
        <ToastProvider>
          <AuthProvider>
            <WebSocketProvider>
              <AppRoutes />
              <Analytics />
            </WebSocketProvider>
          </AuthProvider>
        </ToastProvider>
      </NeonAuthProviderWithNavigate>
    </BrowserRouter>
  );
}
