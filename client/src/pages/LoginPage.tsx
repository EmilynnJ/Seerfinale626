import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button, Spinner } from '../components/ui';

type Mode = 'signin' | 'signup';

/**
 * LoginPage — Supabase Auth.
 *
 * Client self-registration: email/password plus Google and Apple social
 * login (Apple sign-in per App Store compliance). Reader accounts are
 * admin-created only — readers sign in here with the credentials the admin
 * generated for them; there is no reader self-registration.
 */
export function LoginPage() {
  const {
    isAuthenticated,
    isLoading,
    signInWithPassword,
    signUpWithPassword,
    signInWithProvider,
  } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading) {
    return (
      <div className="page-enter">
        <div className="container">
          <div className="login-cosmic">
            <div className="login-cosmic__orb" aria-hidden="true" />
            <h1 className="heading-2">Connecting to the Cosmos</h1>
            <p className="login-cosmic__text">Aligning the stars for your journey...</p>
            <Spinner size="lg" />
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signInWithPassword(email.trim(), password);
        // onAuthStateChange loads the profile; the effect above redirects.
      } else {
        const { needsConfirmation } = await signUpWithPassword(
          email.trim(),
          password,
          fullName.trim() || undefined,
        );
        if (needsConfirmation) {
          setNotice('Check your inbox — confirm your email address to finish creating your account.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleProvider = async (provider: 'google' | 'apple') => {
    setError(null);
    try {
      await signInWithProvider(provider);
      // Supabase redirects to the provider; nothing else to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social sign-in failed.');
    }
  };

  return (
    <div className="page-enter">
      <div className="container">
        <div className="login-cosmic">
          <div className="login-cosmic__orb" aria-hidden="true" />
          <h1 className="heading-2">Welcome to SoulSeer</h1>
          <p className="login-cosmic__text">
            {mode === 'signin'
              ? 'Sign in to continue your journey.'
              : 'Create your account to begin your journey.'}
          </p>

          <form onSubmit={handleSubmit} className="login-form" style={{ width: '100%', maxWidth: 380, display: 'grid', gap: '0.75rem' }}>
            {mode === 'signup' && (
              <input
                type="text"
                className="input"
                placeholder="Full name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={255}
              />
            )}
            <input
              type="email"
              className="input"
              placeholder="Email address"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
            />
            <input
              type="password"
              className="input"
              placeholder="Password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
            />

            {error && (
              <p className="caption" role="alert" style={{ color: 'var(--color-error, #ff6b81)' }}>
                {error}
              </p>
            )}
            {notice && (
              <p className="caption" role="status" style={{ color: 'var(--color-gold, #D4AF37)' }}>
                {notice}
              </p>
            )}

            <Button variant="primary" size="lg" type="submit" disabled={submitting}>
              {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <div style={{ display: 'grid', gap: '0.5rem', width: '100%', maxWidth: 380, marginTop: '1rem' }}>
            <Button variant="ghost" onClick={() => void handleProvider('google')}>
              Continue with Google
            </Button>
            <Button variant="ghost" onClick={() => void handleProvider('apple')}>
              Continue with Apple
            </Button>
          </div>

          <p className="caption" style={{ marginTop: '1rem' }}>
            {mode === 'signin' ? (
              <>
                New here?{' '}
                <button
                  type="button"
                  className="link-button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-pink, #FF69B4)', cursor: 'pointer' }}
                  onClick={() => { setMode('signup'); setError(null); setNotice(null); }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="link-button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-pink, #FF69B4)', cursor: 'pointer' }}
                  onClick={() => { setMode('signin'); setError(null); setNotice(null); }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
