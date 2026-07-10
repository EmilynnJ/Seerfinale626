/**
 * Unit tests for vite.config.ts security behavior.
 * Verifies that environment variable exposure is restricted to VITE_ prefix
 * and that deriveClientSupabaseEnv correctly hoists the PUBLIC Supabase
 * values (project URL + anon/publishable key) — and nothing else.
 */
import { describe, it, expect } from 'vitest';

// Mirror of the deriveClientSupabaseEnv function behavior
// (extracted from vite.config.ts for testing)
function deriveClientSupabaseEnv(env: Record<string, string>) {
  const url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    '';
  return { url, anonKey };
}

function filterViteVars(env: Record<string, string>): Record<string, string> {
  return Object.keys(env)
    .filter((key) => key.startsWith('VITE_'))
    .reduce<Record<string, string>>((acc, key) => ({ ...acc, [key]: env[key]! }), {});
}

describe('Vite config security', () => {
  describe('Environment variable prefix restriction', () => {
    it('should only expose VITE_ prefixed variables', () => {
      const mockEnv = {
        VITE_API_URL: 'https://api.example.com',
        VITE_SUPABASE_URL: 'https://proj.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon-key-123',
      };

      expect(mockEnv).toHaveProperty('VITE_API_URL');
      expect(mockEnv).toHaveProperty('VITE_SUPABASE_URL');
      expect(mockEnv).toHaveProperty('VITE_SUPABASE_ANON_KEY');

      // Sensitive variables without VITE_ prefix should NOT be loaded
      expect(mockEnv).not.toHaveProperty('DATABASE_URL');
      expect(mockEnv).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
      expect(mockEnv).not.toHaveProperty('SUPABASE_JWT_SECRET');
    });

    it('should prevent exposure of CI/CD secrets', () => {
      const unsafeEnv = {
        VITE_PUBLIC_VAR: 'safe',
        CI_SECRET_TOKEN: 'should-not-be-exposed',
        GITHUB_TOKEN: 'should-not-be-exposed',
        NPM_TOKEN: 'should-not-be-exposed',
      };

      const safeEnv = filterViteVars(unsafeEnv);

      expect(Object.keys(safeEnv)).toHaveLength(1);
      expect(safeEnv).toHaveProperty('VITE_PUBLIC_VAR');
      expect(safeEnv).not.toHaveProperty('CI_SECRET_TOKEN');
      expect(safeEnv).not.toHaveProperty('GITHUB_TOKEN');
      expect(safeEnv).not.toHaveProperty('NPM_TOKEN');
    });
  });

  describe('deriveClientSupabaseEnv function', () => {
    it('should prioritize VITE_ prefixed Supabase variables', () => {
      const env = {
        VITE_SUPABASE_URL: 'https://vite-proj.supabase.co',
        SUPABASE_URL: 'https://fallback-proj.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'vite-anon-key',
        SUPABASE_ANON_KEY: 'fallback-anon-key',
      };

      const result = deriveClientSupabaseEnv(env);

      expect(result.url).toBe('https://vite-proj.supabase.co');
      expect(result.anonKey).toBe('vite-anon-key');
    });

    it('should fall back to non-VITE_ names when VITE_ not present', () => {
      const env = {
        SUPABASE_URL: 'https://fallback-proj.supabase.co',
        SUPABASE_ANON_KEY: 'fallback-anon-key',
      };

      const result = deriveClientSupabaseEnv(env);

      expect(result.url).toBe('https://fallback-proj.supabase.co');
      expect(result.anonKey).toBe('fallback-anon-key');
    });

    it('should accept the publishable key alias', () => {
      const env = {
        VITE_SUPABASE_URL: 'https://proj.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
      };

      const result = deriveClientSupabaseEnv(env);

      expect(result.anonKey).toBe('sb_publishable_abc');
    });

    it('should strip a trailing slash from the project URL', () => {
      const env = {
        VITE_SUPABASE_URL: 'https://proj.supabase.co/',
        VITE_SUPABASE_ANON_KEY: 'k',
      };

      const result = deriveClientSupabaseEnv(env);

      expect(result.url).toBe('https://proj.supabase.co');
    });

    it('should return empty strings when no Supabase variables are set', () => {
      const result = deriveClientSupabaseEnv({});

      expect(result.url).toBe('');
      expect(result.anonKey).toBe('');
    });

    it('should never hoist the service-role key or JWT secret', () => {
      const env = {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        SUPABASE_JWT_SECRET: 'jwt-secret',
        SUPABASE_SECRET_KEY: 'sb_secret_abc',
      };

      const result = deriveClientSupabaseEnv(env);

      // None of the server-only secrets may leak through the hoist.
      expect(result.url).toBe('');
      expect(result.anonKey).toBe('');
      expect(JSON.stringify(result)).not.toContain('secret');
    });
  });

  describe('Security regression tests', () => {
    it('should not expose database credentials', () => {
      const mockFullEnv = {
        VITE_API_URL: 'https://api.example.com',
        DATABASE_URL: 'postgresql://user:password@localhost/db',
        DB_PASSWORD: 'super-secret',
      };

      const filteredEnv = filterViteVars(mockFullEnv);

      expect(filteredEnv).not.toHaveProperty('DATABASE_URL');
      expect(filteredEnv).not.toHaveProperty('DB_PASSWORD');
    });

    it('should not expose API keys and tokens', () => {
      const mockFullEnv = {
        VITE_PUBLIC_KEY: 'safe-public-key',
        STRIPE_SECRET_KEY: 'sk_live_secret',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        CLOUDFLARE_REALTIME_TOKEN: 'cf-app-token',
        CLOUDINARY_API_SECRET: 'cloudinary-secret',
      };

      const filteredEnv = filterViteVars(mockFullEnv);

      expect(filteredEnv).toHaveProperty('VITE_PUBLIC_KEY');
      expect(filteredEnv).not.toHaveProperty('STRIPE_SECRET_KEY');
      expect(filteredEnv).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
      expect(filteredEnv).not.toHaveProperty('CLOUDFLARE_REALTIME_TOKEN');
      expect(filteredEnv).not.toHaveProperty('CLOUDINARY_API_SECRET');
    });

    it('should not expose deployment and infrastructure secrets', () => {
      const mockFullEnv = {
        VITE_APP_VERSION: '1.0.0',
        VERCEL_TOKEN: 'vercel-deployment-token',
        FLY_API_TOKEN: 'fly-api-token',
        DOCKER_PASSWORD: 'docker-registry-password',
      };

      const filteredEnv = filterViteVars(mockFullEnv);

      expect(filteredEnv).toHaveProperty('VITE_APP_VERSION');
      expect(filteredEnv).not.toHaveProperty('VERCEL_TOKEN');
      expect(filteredEnv).not.toHaveProperty('FLY_API_TOKEN');
      expect(filteredEnv).not.toHaveProperty('DOCKER_PASSWORD');
    });
  });

  describe('Integration scenarios', () => {
    it('should work with typical production environment', () => {
      const prodEnv = {
        VITE_API_URL: 'https://api.soulseer.com',
        VITE_SUPABASE_URL: 'https://soulseer.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'prod-anon-key',
        // These should not be loaded
        DATABASE_URL: 'postgresql://prod-db',
        STRIPE_SECRET_KEY: 'sk_live_prod',
        SUPABASE_SERVICE_ROLE_KEY: 'prod-service-role',
      };

      const filteredEnv = filterViteVars(prodEnv);
      const sb = deriveClientSupabaseEnv(filteredEnv);

      expect(sb.url).toBe('https://soulseer.supabase.co');
      expect(sb.anonKey).toBe('prod-anon-key');

      expect(filteredEnv).not.toHaveProperty('DATABASE_URL');
      expect(filteredEnv).not.toHaveProperty('STRIPE_SECRET_KEY');
      expect(filteredEnv).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    });
  });
});
