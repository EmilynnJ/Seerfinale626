import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Hoist non-VITE_-prefixed Supabase vars (SUPABASE_URL, SUPABASE_ANON_KEY)
// into the VITE_SUPABASE_* names the client reads, so a single deployment
// env var can serve both server and client.
//
// These values (project URL + publishable/anon key) are PUBLIC — they ship in
// the browser bundle by design. The service-role key, JWT secret, database
// URL, and every other secret are NEVER hoisted: only the specific values
// placed in `define` below are baked into the bundle, and `envPrefix:
// 'VITE_'` still governs what is auto-exposed via import.meta.env.
function deriveClientSupabaseEnv(env: Record<string, string>) {
  const url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    '';
  return { url, anonKey };
}

export default defineConfig(({ mode }) => {
  // Load ALL env vars (empty prefix), not just VITE_-prefixed ones, so the
  // alias-hoisting above can see dashboard-style names. This does NOT leak
  // secrets to the client — see the note on deriveClientSupabaseEnv.
  const env = loadEnv(mode, process.cwd(), '');
  const sb = deriveClientSupabaseEnv(env);

  const apiBase = env.VITE_API_URL || '';

  // Fail loudly at build time if the Supabase essentials are missing — an
  // empty URL or anon key produces a bundle where login can never start.
  if (!sb.url || !sb.anonKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n⚠️  [SoulSeer build] Supabase is missing required values:' +
        (sb.url ? '' : '\n   - project URL (set VITE_SUPABASE_URL or SUPABASE_URL)') +
        (sb.anonKey
          ? ''
          : '\n   - anon/publishable key (set VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY)') +
        '\n   The deployed app will not be able to log in until these are set.\n',
    );
  }

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:5000',
          ws: true,
        },
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-router')
            )
              return 'vendor';
            if (id.includes('node_modules/@supabase')) return 'auth';
          },
        },
      },
    },
    envPrefix: 'VITE_',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(sb.url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(sb.anonKey),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiBase.replace(/\/$/, '')),
    },
  };
});
