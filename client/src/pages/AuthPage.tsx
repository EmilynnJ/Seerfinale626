import { useParams } from 'react-router-dom';
import { AuthView } from '@neondatabase/neon-js/auth/react/ui';

/**
 * Renders the Neon Auth UI for the current auth view. The `:pathname` segment
 * selects the view (sign-in, sign-up, forgot-password, reset-password,
 * magic-link, email-otp, callback, sign-out, …). Links between these views and
 * the post-login redirect are configured on <NeonAuthUIProvider> in App.tsx.
 */
export function AuthPage() {
  const { pathname } = useParams();

  return (
    <div className="page-enter">
      <div
        className="container"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
          paddingTop: '2rem',
          paddingBottom: '2rem',
        }}
      >
        <AuthView pathname={pathname} />
      </div>
    </div>
  );
}
