import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

/**
 * Central traffic controller for /dashboard – waits for the DB role, then
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
        <div className="container" style={{ maxWidth: 560, padding: '4rem' }}>
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <h1 className="heading-2">We couldn't load your profile</h1>
            <p className="login-cosmic__text" style={{ marginBottom: '1rem' }}>
              Your session was found, but the SoulSeer API returned an error
              while syncing your account.
            </p>
            <p className="caption" style={{ marginBottom: '1.5rem' }}>
              {authError}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => refreshUser?.()}>
                Retry
              </Button>
              <Button variant="ghost" onClick={() => logout?.()}>
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

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <WebSocketProvider>
            <AppRoutes />
          </WebSocketProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
