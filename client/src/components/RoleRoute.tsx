// ============================================================
// RoleRoute — gates a route to specific user roles.
//
// ProtectedRoute only checks that the user is authenticated with Supabase.
// RoleRoute additionally requires the synced internal user to have one of
// the allowed roles, so e.g. a client can't open /dashboard/admin. Users
// with the wrong role are redirected to their OWN dashboard rather than
// being shown another role's shell.
// ============================================================

import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LoadingPage } from './ui';

type Role = 'admin' | 'reader' | 'client';

function dashboardPathFor(role: Role): string {
  switch (role) {
    case 'admin':
      return '/dashboard/admin';
    case 'reader':
      return '/dashboard/reader';
    default:
      return '/dashboard/client';
  }
}

interface RoleRouteProps {
  allow: Role[];
  children: ReactNode;
}

export function RoleRoute({ allow, children }: RoleRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingPage message="Loading your dashboard..." />;
  }

  // Not signed in (or the backend user record never loaded) — send to /login.
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // Signed in but wrong role — bounce to the user's own dashboard.
  if (!allow.includes(user.role as Role)) {
    return <Navigate to={dashboardPathFor(user.role as Role)} replace />;
  }

  return <>{children}</>;
}
