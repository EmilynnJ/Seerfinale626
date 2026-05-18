// ============================================================
// Footer — Site-wide footer with celestial theme
// ============================================================

import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { dashboardPathForRole } from '../lib/dashboardRoute';

const footerLinks = [
  { to: '/about', label: 'About' },
  { to: '/help', label: 'Help' },
  { to: '/community', label: 'Community' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms' },
] as const;

function Footer() {
  const { isAuthenticated, isAuth0Authenticated, user } = useAuth();
  const showSignedInUi = isAuth0Authenticated || isAuthenticated || !!user;
  const profileRoute = user?.id ? `/readers/${user.id}` : '/dashboard';
  const year = new Date().getFullYear();
  const { isAuthenticated, isAuth0Authenticated, user, auth0Role } = useAuth();
  const showSignedInUi = isAuth0Authenticated || isAuthenticated || !!user;
  const effectiveRole = user?.role ?? auth0Role ?? null;
  const dashboardHref = dashboardPathForRole(effectiveRole);
  const profileRoute = user?.id ? `/readers/${user.id}` : dashboardHref;

  return (
    <footer className="footer" role="contentinfo">
      <div className="footer__inner">
        <Link to="/" className="footer__brand" aria-label="SoulSeer Home">
          SoulSeer
        </Link>

        <nav aria-label="Footer navigation">
          <ul className="footer__links">
            {showSignedInUi && (
              <li>
                <Link to={dashboardHref} className="footer__link">
                  Dashboard
                </Link>
              </li>
            )}
            {footerLinks.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="footer__link">
                  {link.label}
                </Link>
              </li>
            ))}
            {isAuthenticated && (
            {showSignedInUi && (
              <li>
                <Link to="/dashboard" className="footer__link">
                  Dashboard
                </Link>
              </li>
            )}
            {profilePath && (
              <li>
                <Link to={profilePath} className="footer__link">
                  Profile
                </Link>
              </li>
            )}
            <li>
              {isAuthenticated ? (
                <button type="button" className="footer__link" onClick={() => logout()}>
                  Sign Out
                </button>
              ) : (
                <button type="button" className="footer__link" onClick={() => login()}>
                  Sign In
                </button>
              )}
            </li>
          </ul>
        </nav>

        <p className="footer__tagline">
          ✦ Where the cosmos meets clarity ✦
        </p>

        <p className="footer__copy">
          &copy; {year} SoulSeer. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export { Footer };
