import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Hoist non-VITE_-prefixed Auth0 vars (AUTH0_DOMAIN_URL, AUTH0_ISSUER_BASE_URL,
// AUTH0_IDENTIFIER, AUTH0_ALLOWED_URL) into the VITE_AUTH0_* names the client
// reads, so a single Vercel env var works for both server and client.
function deriveClientAuth0Env(env: Record<string, string>) {
  const domainSource =
    env.VITE_AUTH0_DOMAIN ||
    env.AUTH0_DOMAIN ||
    env.AUTH0_DOMAIN_URL ||
    env.AUTH0_ISSUER_BASE_URL ||
    '';
  const domain = domainSource.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // SPA Client ID — the PUBLIC client id of the Single-Page-App Auth0
  // application. This is NOT the Machine-to-Machine app used for the Management
  // API (AUTH0_APP_ID / AUTH0_MGMT_CLIENT_ID). It must be hoisted here too,
  // otherwise a deployment that sets only dashboard-style env names ends up with
  // an empty client id and Auth0 login silently fails. Deliberately does NOT
  // fall back to AUTH0_APP_ID to avoid colliding with the management app.
  const clientId =
    env.VITE_AUTH0_CLIENT_ID ||
    env.AUTH0_SPA_CLIENT_ID ||
    env.AUTH0_CLIENT_ID ||
    '';

  const audience =
    env.VITE_AUTH0_AUDIENCE ||
    env.AUTH0_AUDIENCE ||
    env.AUTH0_IDENTIFIER ||
    (domain ? `https://${domain}/api/v2/` : '');

  const redirectUri = (
    env.VITE_AUTH0_REDIRECT_URI ||
    env.AUTH0_ALLOWED_URL ||
    env.AUTH0_BASE_URL ||
    ''
  ).replace(/\/$/, '');

  return { domain, clientId, audience, redirectUri };
}

export default defineConfig(({ mode }) => {
  // TODO: narrowed env loading to the "VITE_" prefix for client safety — rename any client-needed variables to use this prefix so they are still loaded.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const auth0 = deriveClientAuth0Env(env);

  const apiBase = env.VITE_API_URL || env.AUTH0_ALLOWED_URL || env.AUTH0_BASE_URL || '';

  // Fail loudly at build time if the Auth0 essentials are missing — an empty
  // domain or client id produces a bundle where login can never start.
  if (!auth0.domain || !auth0.clientId) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n⚠️  [SoulSeer build] Auth0 is missing required values:' +
        (auth0.domain ? '' : '\n   - domain (set VITE_AUTH0_DOMAIN or AUTH0_DOMAIN/AUTH0_DOMAIN_URL)') +
        (auth0.clientId
          ? ''
          : '\n   - client id (set VITE_AUTH0_CLIENT_ID or AUTH0_SPA_CLIENT_ID)') +
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
            if (id.includes('node_modules/@auth0')) return 'auth';
          },
        },
      },
    },
    envPrefix: 'VITE_',
    define: {
      'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(auth0.domain),
      'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify(auth0.clientId),
      'import.meta.env.VITE_AUTH0_AUDIENCE': JSON.stringify(auth0.audience),
      'import.meta.env.VITE_AUTH0_REDIRECT_URI': JSON.stringify(auth0.redirectUri),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiBase.replace(/\/$/, '')),
    },
  };
});
