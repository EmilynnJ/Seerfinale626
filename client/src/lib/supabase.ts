import { createClient } from '@supabase/supabase-js';

/**
 * Supabase browser client — handles ALL client authentication:
 * email/password self-registration plus Google and Apple social login
 * (Apple sign-in required for App Store compliance).
 *
 * Only the public URL + publishable/anon key ship in the bundle. The
 * service-role key and JWT secret are server-only and never appear here.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);

if (!supabaseUrl || !supabaseKey) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — authentication will not work.',
  );
}

export const supabase = createClient(supabaseUrl ?? 'https://invalid.supabase.co', supabaseKey ?? 'invalid', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
