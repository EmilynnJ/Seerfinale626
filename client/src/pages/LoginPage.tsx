import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button, Spinner } from '../components/ui';

/**
 * LoginPage
 *
 * Safe login entrypoint.
 *
 *  - If the user is already fully authenticated (Neon Auth session AND internal
 *    user record loaded), redirect straight to /dashboard.
 *  - Otherwise show a "Sign in" button that takes the user to the Neon Auth UI
 *    at /auth/sign-in. We never auto-redirect into the auth flow, so a failing
 *    backend sync can't bounce the user in a loop — they stay here and can
 *    retry.
 */
export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  // Show a spinner while Neon Auth resolves the session / the profile syncs.
  if (isLoading) {
    return (
      <div className="page-enter">
        <div className="container">
          <div className="login-cosmic">
            <div className="login-cosmic__orb" aria-hidden="true" />
            <h1 className="heading-2">Connecting to the Cosmos</h1>
            <p className="login-cosmic__text">
              Aligning the stars for your journey...
            </p>
            <Spinner size="lg" />
            <p className="caption">One moment while we check your session.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <div className="container">
        <div className="login-cosmic">
          <div className="login-cosmic__orb" aria-hidden="true" />
          <h1 className="heading-2">Welcome to SoulSeer</h1>
          <p className="login-cosmic__text">
            Sign in with your email or a social provider to continue your journey.
          </p>
          <Button
            variant="primary"
            size="lg"
            onClick={() => navigate('/auth/sign-in')}
          >
            Sign in
          </Button>
          <p className="caption">
            New here?{' '}
            <Button variant="ghost" size="sm" onClick={() => navigate('/auth/sign-up')}>
              Create an account
            </Button>
          </p>
        </div>
      </div>
    </div>
  );
}
