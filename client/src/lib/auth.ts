/**
 * Neon Auth client.
 *
 * Neon Auth is built on Better Auth. `createInternalNeonAuth` returns both the
 * Better Auth React client (`adapter` — exposes `useSession`, `signIn`,
 * `signOut`, …) and `getJWTToken()`, which mints the short-lived JWT we send to
 * the SoulSeer API as a Bearer token.
 */
import { createInternalNeonAuth } from '@neondatabase/neon-js/auth';
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react';

const NEON_AUTH_URL = import.meta.env.VITE_NEON_AUTH_URL || '';

if (!NEON_AUTH_URL) {
  // eslint-disable-next-line no-console
  console.error(
    '[SoulSeer] VITE_NEON_AUTH_URL is not set — authentication will not work. ' +
      'Set it to your Neon Auth base URL (…/neondb/auth).',
  );
}

const neonAuth = createInternalNeonAuth(NEON_AUTH_URL, {
  adapter: BetterAuthReactAdapter(),
});

/**
 * Better Auth React client. Pass to <NeonAuthUIProvider> and use its hooks
 * (e.g. `authClient.useSession()`).
 */
export const authClient = neonAuth.adapter;

/**
 * Resolve a JWT for the current session to authenticate API requests.
 * Returns `null` when there is no active session.
 */
export const getJWTToken = neonAuth.getJWTToken;
