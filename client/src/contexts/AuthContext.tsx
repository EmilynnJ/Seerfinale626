import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
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
    if (!auth0IsAuth || !auth0User) {
      setUser(null);
      setAuthError(null);
      setIsLoading(false);
      return;
    }

    try {
      const token = await getAccessTokenSilently();
      apiService.setAccessToken(token);

      // First try /me — works for existing users.
      let userData: User | null = null;
      try {
        userData = await apiService.get<User>('/api/auth/me');
      } catch {
        // User not found or /me failed — fall through to sync/create.
      }

      if (!userData) {
        // Sync user with backend (creates or updates the user record).
        userData = await apiService.post<User>('/api/auth/sync', {
          auth0Id: auth0User.sub,
          email: auth0User.email,
          fullName: auth0User.name,
          profileImage: auth0User.picture,
        });
      }

      setUser(userData);
      setAuthError(null);

      // Identify the signed-in user to Pendo
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
        }
      });
    } catch (err) {
      // Do NOT clear auth0 session here — that would kick the user back to
      // Auth0 and cause a redirect loop when the API is temporarily failing.
      // Instead, surface the error and let the UI show a retry banner.
      const message =
        err instanceof Error ? err.message : 'Unable to load your account profile.';
      console.error('[AuthContext] Failed to fetch/sync user profile:', err);
      setUser(null);
      setAuthError(message);
    } finally {
      setIsLoading(false);
    }
  }, [auth0IsAuth, auth0User, getAccessTokenSilently]);

  useEffect(() => {
    // Only refresh user when Auth0 has finished loading and is authenticated.
    // If not authenticated, refreshUser handles clearing the state.
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

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: auth0IsAuth && !!user,
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
