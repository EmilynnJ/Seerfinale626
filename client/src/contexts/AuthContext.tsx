import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { apiService } from '../services/api';
import type { AuthState, User } from '../types';

export interface AuthStateWithError extends AuthState {
  authError: string | null;
}

export const AuthContext = createContext<AuthStateWithError | null>(null);

const DEBUG_ENDPOINT = 'http://127.0.0.1:7530/ingest/5d16fd92-dfa5-4af3-be5e-8af5bd6919ee';

function debugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f0e72b' },
    body: JSON.stringify({
      sessionId: 'f0e72b',
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
      runId: 'post-fix',
    }),
  }).catch(() => {});
}

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
      // #region agent log
      debugLog('AuthContext.tsx:sync:start', 'POST /api/auth/sync starting', {}, 'B');
      // #endregion

      await apiService.post('/api/auth/sync', {
        auth0Id: auth0User.sub,
        email: auth0User.email,
        fullName: auth0User.name,
        profileImage: auth0User.picture,
      });

      // #region agent log
      debugLog('AuthContext.tsx:sync:done', 'POST /api/auth/sync finished', {}, 'B');
      debugLog('AuthContext.tsx:me:start', 'GET /api/auth/me starting', {}, 'B');
      // #endregion

      // Step C: load the authoritative DB profile (includes role).
      const userData = await apiService.get<User>('/api/auth/me');

      // #region agent log
      debugLog('AuthContext.tsx:me:done', 'GET /api/auth/me finished', { role: userData.role }, 'C');
      // #endregion

      // Step D: only commit state once role is present.
      if (!userData.role) {
        throw new Error('Account profile is missing a role.');
      }

      setUser(userData);
      setAuthError(null);

      pendo.identify({
        visitor: {
          id: userData.id,
          email: userData.email,
          full_name: userData.fullName,
          username: userData.username,
          role: userData.role,
          is_online: userData.isOnline,
          balance: userData.balance,
          total_readings: userData.totalReadings,
          pricing_chat: userData.pricingChat,
          pricing_voice: userData.pricingVoice,
          pricing_video: userData.pricingVideo,
          created_at: userData.createdAt,
          updated_at: userData.updatedAt,
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to load your account profile.';
      console.error('[AuthContext] Failed to fetch/sync user profile:', err);
      // #region agent log
      debugLog('AuthContext.tsx:error', 'Auth pipeline failed', { message }, 'D');
      // #endregion
      setUser(null);
      setAuthError(message);
    } finally {
      setIsLoading(false);
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

  return (
    <AuthContext.Provider
      value={{
        user: dbUser,
        isAuthenticated: auth0IsAuth && hasDbRole,
        isLoading: auth0Loading || isLoading,
        authError,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
