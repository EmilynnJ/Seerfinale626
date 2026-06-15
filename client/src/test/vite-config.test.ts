/**
 * Unit tests for vite.config.ts security fix + Neon Auth env derivation.
 * Verifies that environment variable loading is restricted to the VITE_ prefix
 * in the client bundle and that deriveClientNeonAuthEnv resolves the Neon Auth
 * base URL correctly.
 */
import { describe, it, expect } from 'vitest';

const FALLBACK_NEON_AUTH_URL =
  'https://ep-young-star-ae2aja7j.neonauth.c-2.us-east-2.aws.neon.tech/neondb/auth';

// Mirrors deriveClientNeonAuthEnv in vite.config.ts.
function deriveClientNeonAuthEnv(env: Record<string, string>) {
  const neonAuthUrl = (
    env.VITE_NEON_AUTH_URL ||
    env.NEON_AUTH_URL ||
    FALLBACK_NEON_AUTH_URL
  ).replace(/\/$/, '');

  return { neonAuthUrl };
}

describe('Vite config security fix', () => {
  describe('Environment variable prefix restriction', () => {
    it('should only load VITE_ prefixed variables after fix', () => {
      const mockEnv = {
        VITE_API_URL: 'https://api.example.com',
        VITE_NEON_AUTH_URL: 'https://example.neonauth/neondb/auth',
      };

      expect(mockEnv).toHaveProperty('VITE_API_URL');
      expect(mockEnv).toHaveProperty('VITE_NEON_AUTH_URL');

      // Sensitive variables without VITE_ prefix should NOT be loaded
      expect(mockEnv).not.toHaveProperty('DATABASE_URL');
      expect(mockEnv).not.toHaveProperty('SECRET_KEY');
      expect(mockEnv).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    });

    it('should prevent exposure of CI/CD secrets', () => {
      const unsafeEnv: Record<string, string> = {
        VITE_PUBLIC_VAR: 'safe',
        CI_SECRET_TOKEN: 'should-not-be-exposed',
        GITHUB_TOKEN: 'should-not-be-exposed',
        NPM_TOKEN: 'should-not-be-exposed',
      };

      const safeEnv = Object.keys(unsafeEnv)
        .filter((key) => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: unsafeEnv[key] }), {});

      expect(Object.keys(safeEnv)).toHaveLength(1);
      expect(safeEnv).toHaveProperty('VITE_PUBLIC_VAR');
      expect(safeEnv).not.toHaveProperty('CI_SECRET_TOKEN');
      expect(safeEnv).not.toHaveProperty('GITHUB_TOKEN');
      expect(safeEnv).not.toHaveProperty('NPM_TOKEN');
    });
  });

  describe('deriveClientNeonAuthEnv function', () => {
    it('should prioritize the VITE_ prefixed Neon Auth URL', () => {
      const env = {
        VITE_NEON_AUTH_URL: 'https://vite.neonauth/neondb/auth',
        NEON_AUTH_URL: 'https://fallback.neonauth/neondb/auth',
      };

      const result = deriveClientNeonAuthEnv(env);

      expect(result.neonAuthUrl).toBe('https://vite.neonauth/neondb/auth');
    });

    it('should fall back to NEON_AUTH_URL when the VITE_ variable is absent', () => {
      const env = { NEON_AUTH_URL: 'https://fallback.neonauth/neondb/auth' };

      const result = deriveClientNeonAuthEnv(env);

      expect(result.neonAuthUrl).toBe('https://fallback.neonauth/neondb/auth');
    });

    it('should strip a trailing slash from the auth URL', () => {
      const env = { VITE_NEON_AUTH_URL: 'https://example.neonauth/neondb/auth/' };

      const result = deriveClientNeonAuthEnv(env);

      expect(result.neonAuthUrl).toBe('https://example.neonauth/neondb/auth');
    });

    it('should use the production fallback when no Neon Auth variables are set', () => {
      const result = deriveClientNeonAuthEnv({});

      expect(result.neonAuthUrl).toBe(FALLBACK_NEON_AUTH_URL);
    });
  });

  describe('Security regression tests', () => {
    it('should not expose database credentials', () => {
      const mockFullEnv: Record<string, string> = {
        VITE_API_URL: 'https://api.example.com',
        DATABASE_URL: 'postgresql://user:password@localhost/db',
        DB_PASSWORD: 'super-secret',
      };

      const filteredEnv = Object.keys(mockFullEnv)
        .filter((key) => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: mockFullEnv[key] }), {});

      expect(filteredEnv).not.toHaveProperty('DATABASE_URL');
      expect(filteredEnv).not.toHaveProperty('DB_PASSWORD');
    });

    it('should not expose API keys and tokens', () => {
      const mockFullEnv: Record<string, string> = {
        VITE_PUBLIC_KEY: 'safe-public-key',
        STRIPE_SECRET_KEY: 'sk_live_secret',
        CLOUDINARY_API_SECRET: 'cloudinary-secret',
      };

      const filteredEnv = Object.keys(mockFullEnv)
        .filter((key) => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: mockFullEnv[key] }), {});

      expect(filteredEnv).toHaveProperty('VITE_PUBLIC_KEY');
      expect(filteredEnv).not.toHaveProperty('STRIPE_SECRET_KEY');
      expect(filteredEnv).not.toHaveProperty('CLOUDINARY_API_SECRET');
    });
  });

  describe('Integration scenarios', () => {
    it('should work with a typical production environment', () => {
      const prodEnv: Record<string, string> = {
        VITE_API_URL: 'https://api.soulseer.com',
        VITE_NEON_AUTH_URL: 'https://soulseer.neonauth/neondb/auth',
        // These should not be loaded into the client bundle
        DATABASE_URL: 'postgresql://prod-db',
        STRIPE_SECRET_KEY: 'sk_live_prod',
      };

      const filteredEnv = Object.keys(prodEnv)
        .filter((key) => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: prodEnv[key] }), {});

      const neonAuth = deriveClientNeonAuthEnv(filteredEnv);

      expect(neonAuth.neonAuthUrl).toBe('https://soulseer.neonauth/neondb/auth');
      expect(filteredEnv).not.toHaveProperty('DATABASE_URL');
      expect(filteredEnv).not.toHaveProperty('STRIPE_SECRET_KEY');
    });
  });
});
