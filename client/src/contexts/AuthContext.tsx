import { createContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { apiService } from '../services/api';
import type { AuthState, User } from '../types';

export interface AuthStateWithError extends AuthState {
  authError: string | null;
}

export const AuthContext = createContext<AuthStateWithError | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    isAuthenticated: auth0IsAuth,
    isLoading: auth0Loading,
    user: auth0User,
    getAccessTokenSilently,
    loginWithRedirect,
    logout: auth0Logout,
  } = useAuth0();

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    // Step A: wait until Auth0 reports authenticated with a profile.
    if (!auth0IsAuth || !auth0User) {
      setUser(null);
      setAuthError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const token = await getAccessTokenSilently();
      apiService.setAccessToken(token);

      // Step B: sync first — creates/updates the Neon row before /me can resolve it.
      await apiService.post('/api/auth/sync', {
        auth0Id: auth0User.sub,
        email: auth0User.email,
        fullName: auth0User.name,
        profileImage: auth0User.picture,
      });

      // Step C: load the authoritative DB profile (includes role).
      const userData = await apiService.get<User>('/api/me');

      // Step D: only commit state once role is present.
      if (!userData.role) {
        throw new Error('Account profile is missing a role.');
      }

      setUser(userData);
      setAuthError(null);
      setIsLoading(false);

      // F-045: strip sensitive financial fields from product analytics.
      pendo.identify({
        visitor: {
          id: userData.id,
          email: userData.email,
          full_name: userData.fullName,
          username: userData.username,
          role: userData.role,
          is_online: userData.isOnline,
          created_at: userData.createdAt,
          updated_at: userData.updatedAt,
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to load your account profile.';
      console.error('[AuthContext] Failed to fetch/sync user profile:', err);
      setUser(null);
      setAuthError(message);
      // Intentionally do NOT setIsLoading(false) here. Staying in the loading
      // state prevents the DashboardTrafficController from redirecting to /
      // while the Auth0/db sync is broken. The error boundary/UI can render
      // the authError toast instead.
    }
  }, [auth0IsAuth, auth0User, getAccessTokenSilently]);

  useEffect(() => {
    if (!auth0Loading) {
      void refreshUser();
    }
  }, [auth0Loading, refreshUser, auth0IsAuth]);

  const login = useCallback(
    () => loginWithRedirect({ appState: { returnTo: '/dashboard' } }),
    [loginWithRedirect],
  );

  const logout = useCallback(() => {
    pendo.clearSession();
    apiService.setAccessToken(null);
    setUser(null);
    setAuthError(null);
    auth0Logout({ logoutParams: { returnTo: window.location.origin } });
  }, [auth0Logout]);

  const dbUser = user;
  const hasDbRole = !!dbUser?.role;

  // F-065: memoize the context value so consumers don't re-render on every
  // parent render. The deps are exactly the values that affect downstream UIs.
  const value = useMemo<AuthStateWithError>(
    () => ({
      user: dbUser,
      isAuthenticated: auth0IsAuth && hasDbRole,
      isLoading: auth0Loading || isLoading,
      authError,
      login,
      logout,
      refreshUser,
    }),
    [dbUser, auth0IsAuth, hasDbRole, auth0Loading, isLoading, authError, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
