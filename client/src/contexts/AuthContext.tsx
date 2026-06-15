import { createContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { authClient, getJWTToken } from '../lib/auth';
import { apiService } from '../services/api';
import type { AuthState, User } from '../types';

export interface AuthStateWithError extends AuthState {
  authError: string | null;
}

export const AuthContext = createContext<AuthStateWithError | null>(null);

/**
 * Minimal shape we read from the Neon Auth (Better Auth) session hook. The
 * client types `useSession` as a `hook | atom` union, so we narrow it to its
 * callable hook form here.
 */
type SessionResult = {
  data: {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
    };
  } | null;
  isPending: boolean;
};
const useNeonSession = authClient.useSession as unknown as () => SessionResult;

export function AuthProvider({ children }: { children: ReactNode }) {
  // Neon Auth (Better Auth) session. `isPending` is true until the client has
  // determined whether a session exists.
  const { data: session, isPending: sessionLoading } = useNeonSession();
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const sessionUser = session?.user ?? null;

  const refreshUser = useCallback(async () => {
    // Step A: no Neon Auth session → signed out. Resolve loading immediately.
    if (!sessionUser) {
      apiService.setAccessToken(null);
      setUser(null);
      setAuthError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      // Step B: mint a JWT for the API and attach it as the Bearer token.
      const token = await getJWTToken();
      if (!token) {
        throw new Error('Could not obtain an authentication token.');
      }
      apiService.setAccessToken(token);

      // Step C: sync first — creates/updates the Neon row before /me resolves it.
      await apiService.post('/api/auth/sync', {
        auth0Id: sessionUser.id,
        email: sessionUser.email,
        fullName: sessionUser.name,
        profileImage: sessionUser.image,
      });

      // Step D: load the authoritative DB profile (includes role).
      const userData = await apiService.get<User>('/api/me');

      if (!userData.role) {
        throw new Error('Account profile is missing a role.');
      }

      setUser(userData);
      setAuthError(null);

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
      apiService.setAccessToken(null);
      setUser(null);
      setAuthError(message);
    } finally {
      // Always resolve the loading state — even on error. The previous Auth0
      // implementation intentionally left isLoading=true on failure, which
      // deadlocked the app on a spinner whenever the sync call failed. The UI
      // (DashboardTrafficController / LoginPage) handles the authError state and
      // offers a Retry instead.
      setIsLoading(false);
    }
  }, [sessionUser]);

  useEffect(() => {
    // Re-run whenever the Neon Auth session finishes loading or changes.
    if (!sessionLoading) {
      void refreshUser();
    }
  }, [sessionLoading, refreshUser]);

  const login = useCallback(async () => {
    navigate('/auth/sign-in');
  }, [navigate]);

  const logout = useCallback(() => {
    pendo.clearSession();
    apiService.setAccessToken(null);
    setUser(null);
    setAuthError(null);
    void authClient.signOut().finally(() => {
      navigate('/', { replace: true });
    });
  }, [navigate]);

  const dbUser = user;
  const hasDbRole = !!dbUser?.role;
  const hasSession = !!sessionUser;

  // F-065: memoize the context value so consumers don't re-render on every
  // parent render. The deps are exactly the values that affect downstream UIs.
  const value = useMemo<AuthStateWithError>(
    () => ({
      user: dbUser,
      isAuthenticated: hasSession && hasDbRole,
      isLoading: sessionLoading || isLoading,
      authError,
      login,
      logout,
      refreshUser,
    }),
    [dbUser, hasSession, hasDbRole, sessionLoading, isLoading, authError, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
