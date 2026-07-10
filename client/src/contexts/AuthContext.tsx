import { createContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { apiService } from '../services/api';
import type { AuthState, User } from '../types';

export interface AuthStateWithError extends AuthState {
  authError: string | null;
  /** Email/password sign in via Supabase Auth. */
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Email/password self-registration via Supabase Auth (clients only). */
  signUpWithPassword: (email: string, password: string, fullName?: string) => Promise<{ needsConfirmation: boolean }>;
  /** Social login (Google / Apple) via Supabase OAuth. */
  signInWithProvider: (provider: 'google' | 'apple') => Promise<void>;
}

export const AuthContext = createContext<AuthStateWithError | null>(null);

/**
 * AuthProvider — Supabase Auth implementation.
 *
 * Session management is handled by supabase-js (persisted session +
 * automatic token refresh). The Supabase access token (a JWT signed by the
 * project) is attached to every API call; the server validates it on every
 * protected route and resolves the internal user row (which owns the role —
 * role NEVER lives in Supabase Auth metadata).
 *
 * Flow:
 *   1. On mount, read the current session (supabase.auth.getSession()).
 *   2. If a session exists: attach the access token, POST /api/auth/sync to
 *      upsert the internal users row, then GET /api/me for the full profile
 *      (including role).
 *   3. onAuthStateChange keeps the token fresh (TOKEN_REFRESHED) and reloads
 *      the profile on SIGNED_IN / clears it on SIGNED_OUT.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Serialize profile loads so a SIGNED_IN event racing the initial
  // getSession() doesn't double-sync.
  const loadSeqRef = useRef(0);

  const loadProfile = useCallback(async (session: Session | null) => {
    const seq = ++loadSeqRef.current;
    setIsLoading(true);
    try {
      if (!session) {
        apiService.setAccessToken(null);
        if (seq !== loadSeqRef.current) return;
        setUser(null);
        setIsAuthenticated(false);
        setAuthError(null);
        return;
      }

      // Attach the token for all subsequent API calls.
      apiService.setAccessToken(session.access_token);

      // Upsert the internal users row (creates it on first login). Identity
      // is taken from the verified JWT server-side; profile hints are extras.
      const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
      await apiService.post('/api/auth/sync', {
        email: session.user.email,
        fullName:
          (meta.full_name as string | undefined) ??
          (meta.name as string | undefined) ??
          undefined,
        profileImage: (meta.avatar_url as string | undefined) ?? undefined,
      });

      // Load the authoritative DB profile (includes role).
      const userData = await apiService.get<User>('/api/me');
      if (!userData.role) {
        throw new Error('Account profile is missing a role.');
      }

      if (seq !== loadSeqRef.current) return;
      setUser(userData);
      setIsAuthenticated(true);
      setAuthError(null);

      // Pendo analytics — guard in case script is not loaded.
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
      if (seq !== loadSeqRef.current) return;
      const message =
        err instanceof Error ? err.message : 'Unable to load your account profile.';
      console.error('[AuthContext] Failed to fetch/sync user profile:', err);
      setUser(null);
      setIsAuthenticated(false);
      setAuthError(message);
    } finally {
      if (seq === loadSeqRef.current) setIsLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session);
  }, [loadProfile]);

  useEffect(() => {
    void refreshUser();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') {
        // Keep API calls working without a full profile reload.
        apiService.setAccessToken(session?.access_token ?? null);
        return;
      }
      if (event === 'SIGNED_IN') {
        void loadProfile(session);
      } else if (event === 'SIGNED_OUT') {
        apiService.setAccessToken(null);
        setUser(null);
        setIsAuthenticated(false);
        setAuthError(null);
        setIsLoading(false);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [refreshUser, loadProfile]);

  const login = useCallback(async () => {
    // Send the user to the on-platform login page (email/password + social).
    window.location.href = '/login';
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    // onAuthStateChange(SIGNED_IN) triggers the profile load.
  }, []);

  const signUpWithPassword = useCallback(
    async (email: string, password: string, fullName?: string) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: fullName ? { full_name: fullName } : undefined,
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw new Error(error.message);
      // When email confirmation is enabled there is no session yet.
      return { needsConfirmation: !data.session };
    },
    [],
  );

  const signInWithProvider = useCallback(async (provider: 'google' | 'apple') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) throw new Error(error.message);
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
      await supabase.auth.signOut();
    } catch {
      // Best-effort — even if the sign-out call fails, clear local state.
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
      signInWithPassword,
      signUpWithPassword,
      signInWithProvider,
    }),
    [
      user,
      isAuthenticated,
      isLoading,
      authError,
      login,
      logout,
      refreshUser,
      signInWithPassword,
      signUpWithPassword,
      signInWithProvider,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
