import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The Neon Auth base URL is PUBLIC — it ships in the browser bundle by design.
// We hard-code the production value as a LAST-RESORT fallback so that a
// missing/misnamed env var (or one that doesn't reach the client build) can
// never blank it out and break login. Any env var, if present, takes precedence.
const FALLBACK_NEON_AUTH_URL =
  'https://ep-young-star-ae2aja7j.neonauth.c-2.us-east-2.aws.neon.tech/neondb/auth';

function deriveClientNeonAuthEnv(env: Record<string, string>) {
  const neonAuthUrl = (
    env.VITE_NEON_AUTH_URL ||
    env.NEON_AUTH_URL ||
    FALLBACK_NEON_AUTH_URL
  ).replace(/\/$/, '');

  return { neonAuthUrl };
}

export default defineConfig(({ mode }) => {
  // Load ALL env vars (empty prefix), not just VITE_-prefixed ones, so the
  // alias-hoisting in deriveClientNeonAuthEnv can see a server-style NEON_AUTH_URL
  // name. This does NOT leak secrets to the client — only the specific values
  // placed in `define` below are baked into the bundle, and `envPrefix: 'VITE_'`
  // still governs what is auto-exposed via import.meta.env.
  const env = loadEnv(mode, process.cwd(), '');
  const { neonAuthUrl } = deriveClientNeonAuthEnv(env);

  const apiBase = env.VITE_API_URL || env.AUTH0_ALLOWED_URL || env.AUTH0_BASE_URL || '';

  // Fail loudly at build time if the Neon Auth base URL is missing — an empty
  // value produces a bundle where login can never start.
  if (!neonAuthUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n⚠️  [SoulSeer build] Neon Auth is missing its base URL ' +
        '(set VITE_NEON_AUTH_URL). The deployed app will not be able to log in ' +
        'until it is set.\n',
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
            if (id.includes('node_modules/@neondatabase')) return 'auth';
          },
        },
      },
    },
    envPrefix: 'VITE_',
    define: {
      'import.meta.env.VITE_NEON_AUTH_URL': JSON.stringify(neonAuthUrl),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiBase.replace(/\/$/, '')),
    },
  };
});
