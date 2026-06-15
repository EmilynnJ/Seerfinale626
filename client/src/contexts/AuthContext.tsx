import { createContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { apiService } from '../services/api';
import type { AuthState, User } from '../types';

export interface AuthStateWithError extends AuthState {
  authError: string | null;
}

export const AuthContext = createContext<AuthStateWithError | null>(null);

/**
 * AuthProvider – Neon Auth (Stack Auth) implementation.
 *
 * Session management is handled by the Neon Auth / Stack Auth SDK loaded via
 * the VITE_STACK_PROJECT_ID + VITE_STACK_PUBLISHABLE_CLIENT_KEY env vars.
 * The SDK sets a __stack_session cookie / localStorage entry that the server
 * reads to verify identity.
 *
 * Flow:
 *   1. On mount, call GET /api/auth/session to check if there is a valid
 *      server-side session.  The server reads the Stack Auth session cookie
 *      and returns { token, sub, email } or 401.
 *   2. If a session exists, call POST /api/auth/sync to upsert the Neon row,
 *      then GET /api/me to load the full DB profile (including role).
 *   3. login()  &#8214; redirect to /api/auth/login  (Stack Auth hosted UI).
 *   4. logout() &#8214; call /api/auth/logout, clear local state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    try {
      // Step A: ask the server whether a valid Neon Auth session exists.
      const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });

      if (!sessionRes.ok) {
        // 401 = no session – not an error, just unauthenticated.
        setUser(null);
        setIsAuthenticated(false);
        setAuthError(null);
        setIsLoading(false);
        return;
      }

      const { token, sub, email: sessionEmail } = await sessionRes.json() as {
        token: string;
        sub: string;
        email: string;
      };

      // Step B: attach token for all subsequent API calls.
      apiService.setAccessToken(token);

      // Step C: upsert the Neon row (creates it on first login).
      await apiService.post('/api/auth/sync', { authId: sub, email: sessionEmail });

      // Step D: load the authoritative DB profile (includes role).
      const userData = await apiService.get<User>('/api/me');

      if (!userData.role) {
        throw new Error('Account profile is missing a role.');
      }

      setUser(userData);
      setIsAuthenticated(true);
      setAuthError(null);

      // Pendo analytics – guard in case script is not loaded.
      if (typeof pendo !== 'undefined') {
        pendo.identify({
          visitor: {
            id:         userData.id,
            email:      userData.email,
            full_name:  userData.fullName,
            username:   userData.username,
            role:       userData.role,
            is_online:  userData.isOnline,
            created_at: userData.createdAt,
            updated_at: userData.updatedAt,
          },
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to load your account profile.';
      console.error('[AuthContext] Failed to fetch/sync user profile:', err);
      setUser(null);
      setIsAuthenticated(false);
      setAuthError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(() => {
    // Redirect to the Stack Auth / Neon Auth hosted sign-in page.
    const returnTo = encodeURIComponent('/dashboard');
    const signinUrl =
      (import.meta.env.VITE_STACK_SIGNIN_URL as string | undefined) ?? '/api/auth/login';
    window.location.href = `${signinUrl}?returnTo=${returnTo}`;
  }, []);

  const logout = useCallback(async () => {
    if (typeof pendo !== 'undefined') {
      pendo.clearSession();
    }
    apiService.setAccessToken(null);
    setUser(null);
    setIsAuthenticated(false);
    setAuthError(null);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Best-effort – even if the logout call fails, clear local state.
    }
    window.location.href = '/';
  }, []);

  const value = useMemo<AuthStateWithError>(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      authError,
      login,
      logout,
      refreshUser,
    }),
    [user, isAuthenticated, isLoading, authError, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
