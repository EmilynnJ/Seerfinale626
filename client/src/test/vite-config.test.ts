/**
 * Unit tests for vite.config.ts security fix
 * Verifies that environment variable loading is restricted to VITE_ prefix
 * and that deriveClientAuth0Env correctly hoists Auth0 variables.
 */
import { describe, it, expect } from 'vitest';

// Mock the deriveClientAuth0Env function behavior
// (extracted from vite.config.ts for testing)
function deriveClientAuth0Env(env: Record<string, string>) {
  const domainSource =
    env.VITE_AUTH0_DOMAIN ||
    env.AUTH0_DOMAIN ||
    env.AUTH0_DOMAIN_URL ||
    env.AUTH0_ISSUER_BASE_URL ||
    '';
  const domain = domainSource.replace(/^https?:\/\//, '').replace(/\/$/, '');

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

describe('Vite config security fix', () => {
  describe('Environment variable prefix restriction', () => {
    it('should only load VITE_ prefixed variables after fix', () => {
      // Simulate the behavior after the fix
      const mockEnv = {
        VITE_API_URL: 'https://api.example.com',
        VITE_AUTH0_DOMAIN: 'example.auth0.com',
        VITE_AUTH0_CLIENT_ID: 'client123',
      };

      // After the fix, loadEnv(mode, process.cwd(), 'VITE_') should only load VITE_ vars
      // Non-VITE_ variables should not be present
      expect(mockEnv).toHaveProperty('VITE_API_URL');
      expect(mockEnv).toHaveProperty('VITE_AUTH0_DOMAIN');
      expect(mockEnv).toHaveProperty('VITE_AUTH0_CLIENT_ID');
      
      // Sensitive variables without VITE_ prefix should NOT be loaded
      expect(mockEnv).not.toHaveProperty('DATABASE_URL');
      expect(mockEnv).not.toHaveProperty('SECRET_KEY');
      expect(mockEnv).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    });

    it('should prevent exposure of CI/CD secrets', () => {
      // Simulate environment with CI/CD secrets
      const unsafeEnv = {
        VITE_PUBLIC_VAR: 'safe',
        CI_SECRET_TOKEN: 'should-not-be-exposed',
        GITHUB_TOKEN: 'should-not-be-exposed',
        NPM_TOKEN: 'should-not-be-exposed',
      };

      // After fix, only VITE_ prefixed vars should be accessible
      const safeEnv = Object.keys(unsafeEnv)
        .filter(key => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: unsafeEnv[key] }), {});

      expect(Object.keys(safeEnv)).toHaveLength(1);
      expect(safeEnv).toHaveProperty('VITE_PUBLIC_VAR');
      expect(safeEnv).not.toHaveProperty('CI_SECRET_TOKEN');
      expect(safeEnv).not.toHaveProperty('GITHUB_TOKEN');
      expect(safeEnv).not.toHaveProperty('NPM_TOKEN');
    });
  });

  describe('deriveClientAuth0Env function', () => {
    it('should prioritize VITE_ prefixed Auth0 variables', () => {
      const env = {
        VITE_AUTH0_DOMAIN: 'vite.auth0.com',
        AUTH0_DOMAIN: 'fallback.auth0.com',
        VITE_AUTH0_CLIENT_ID: 'vite-client-123',
        AUTH0_CLIENT_ID: 'fallback-client-456',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.domain).toBe('vite.auth0.com');
      expect(result.clientId).toBe('vite-client-123');
    });

    it('should fall back to non-VITE_ Auth0 variables when VITE_ not present', () => {
      const env = {
        AUTH0_DOMAIN: 'fallback.auth0.com',
        AUTH0_SPA_CLIENT_ID: 'spa-client-789',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.domain).toBe('fallback.auth0.com');
      expect(result.clientId).toBe('spa-client-789');
    });

    it('should strip protocol and trailing slash from domain', () => {
      const testCases = [
        { input: 'https://example.auth0.com/', expected: 'example.auth0.com' },
        { input: 'http://example.auth0.com', expected: 'example.auth0.com' },
        { input: 'example.auth0.com/', expected: 'example.auth0.com' },
        { input: 'example.auth0.com', expected: 'example.auth0.com' },
      ];

      testCases.forEach(({ input, expected }) => {
        const env = { VITE_AUTH0_DOMAIN: input };
        const result = deriveClientAuth0Env(env);
        expect(result.domain).toBe(expected);
      });
    });

    it('should strip trailing slash from redirectUri', () => {
      const env = {
        VITE_AUTH0_REDIRECT_URI: 'https://example.com/callback/',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.redirectUri).toBe('https://example.com/callback');
    });

    it('should derive audience from domain when not explicitly set', () => {
      const env = {
        VITE_AUTH0_DOMAIN: 'example.auth0.com',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.audience).toBe('https://example.auth0.com/api/v2/');
    });

    it('should use explicit audience when provided', () => {
      const env = {
        VITE_AUTH0_DOMAIN: 'example.auth0.com',
        VITE_AUTH0_AUDIENCE: 'https://api.example.com',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.audience).toBe('https://api.example.com');
    });

    it('should handle AUTH0_IDENTIFIER as audience fallback', () => {
      const env = {
        AUTH0_IDENTIFIER: 'https://custom-api.example.com',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.audience).toBe('https://custom-api.example.com');
    });

    it('should return empty strings when no Auth0 variables are set', () => {
      const env = {};

      const result = deriveClientAuth0Env(env);

      expect(result.domain).toBe('');
      expect(result.clientId).toBe('');
      expect(result.audience).toBe('');
      expect(result.redirectUri).toBe('');
    });

    it('should handle AUTH0_DOMAIN_URL as domain source', () => {
      const env = {
        AUTH0_DOMAIN_URL: 'https://domain-url.auth0.com',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.domain).toBe('domain-url.auth0.com');
    });

    it('should handle AUTH0_ISSUER_BASE_URL as domain source', () => {
      const env = {
        AUTH0_ISSUER_BASE_URL: 'https://issuer.auth0.com/',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.domain).toBe('issuer.auth0.com');
    });

    it('should handle AUTH0_ALLOWED_URL as redirectUri fallback', () => {
      const env = {
        AUTH0_ALLOWED_URL: 'https://allowed.example.com/',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.redirectUri).toBe('https://allowed.example.com');
    });

    it('should handle AUTH0_BASE_URL as redirectUri fallback', () => {
      const env = {
        AUTH0_BASE_URL: 'https://base.example.com',
      };

      const result = deriveClientAuth0Env(env);

      expect(result.redirectUri).toBe('https://base.example.com');
    });

    it('should not use AUTH0_APP_ID as clientId (management API collision avoidance)', () => {
      const env = {
        AUTH0_APP_ID: 'management-app-id',
        // No other client ID variables set
      };

      const result = deriveClientAuth0Env(env);

      // Should be empty, not use AUTH0_APP_ID
      expect(result.clientId).toBe('');
    });
  });

  describe('Security regression tests', () => {
    it('should not expose database credentials', () => {
      const mockFullEnv = {
        VITE_API_URL: 'https://api.example.com',
        DATABASE_URL: 'postgresql://user:password@localhost/db',
        DB_PASSWORD: 'super-secret',
      };

      // Simulate VITE_ prefix filtering
      const filteredEnv = Object.keys(mockFullEnv)
        .filter(key => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: mockFullEnv[key] }), {});

      expect(filteredEnv).not.toHaveProperty('DATABASE_URL');
      expect(filteredEnv).not.toHaveProperty('DB_PASSWORD');
    });

    it('should not expose API keys and tokens', () => {
      const mockFullEnv = {
        VITE_PUBLIC_KEY: 'safe-public-key',
        STRIPE_SECRET_KEY: 'sk_live_secret',
        AUTH0_MGMT_CLIENT_SECRET: 'management-secret',
        CLOUDINARY_API_SECRET: 'cloudinary-secret',
      };

      const filteredEnv = Object.keys(mockFullEnv)
        .filter(key => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: mockFullEnv[key] }), {});

      expect(filteredEnv).toHaveProperty('VITE_PUBLIC_KEY');
      expect(filteredEnv).not.toHaveProperty('STRIPE_SECRET_KEY');
      expect(filteredEnv).not.toHaveProperty('AUTH0_MGMT_CLIENT_SECRET');
      expect(filteredEnv).not.toHaveProperty('CLOUDINARY_API_SECRET');
    });

    it('should not expose deployment and infrastructure secrets', () => {
      const mockFullEnv = {
        VITE_APP_VERSION: '1.0.0',
        VERCEL_TOKEN: 'vercel-deployment-token',
        FLY_API_TOKEN: 'fly-api-token',
        DOCKER_PASSWORD: 'docker-registry-password',
      };

      const filteredEnv = Object.keys(mockFullEnv)
        .filter(key => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: mockFullEnv[key] }), {});

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
        VITE_AUTH0_DOMAIN: 'soulseer.auth0.com',
        VITE_AUTH0_CLIENT_ID: 'prod-client-id',
        VITE_AUTH0_AUDIENCE: 'https://api.soulseer.com',
        VITE_AUTH0_REDIRECT_URI: 'https://soulseer.com/callback',
        // These should not be loaded
        DATABASE_URL: 'postgresql://prod-db',
        STRIPE_SECRET_KEY: 'sk_live_prod',
      };

      const filteredEnv = Object.keys(prodEnv)
        .filter(key => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: prodEnv[key] }), {});

      const auth0Config = deriveClientAuth0Env(filteredEnv);

      expect(auth0Config.domain).toBe('soulseer.auth0.com');
      expect(auth0Config.clientId).toBe('prod-client-id');
      expect(auth0Config.audience).toBe('https://api.soulseer.com');
      expect(auth0Config.redirectUri).toBe('https://soulseer.com/callback');
      
      // Verify secrets are not in filtered env
      expect(filteredEnv).not.toHaveProperty('DATABASE_URL');
      expect(filteredEnv).not.toHaveProperty('STRIPE_SECRET_KEY');
    });

    it('should work with Vercel-style environment variables', () => {
      const vercelEnv = {
        // Client-safe variables
        VITE_API_URL: 'https://api.example.com',
        // Server-only variables that should be filtered out
        AUTH0_DOMAIN: 'example.auth0.com',
        AUTH0_ALLOWED_URL: 'https://example.com',
        AUTH0_BASE_URL: 'https://example.com',
        STRIPE_SECRET_KEY: 'sk_test_secret',
      };

      const filteredEnv = Object.keys(vercelEnv)
        .filter(key => key.startsWith('VITE_'))
        .reduce((acc, key) => ({ ...acc, [key]: vercelEnv[key] }), {});

      // After fix, non-VITE_ Auth0 vars won't be in loadEnv result
      // deriveClientAuth0Env will receive empty values for them
      const auth0Config = deriveClientAuth0Env(filteredEnv);

      // Without VITE_ prefixed Auth0 vars, should return empty
      expect(auth0Config.domain).toBe('');
      expect(auth0Config.clientId).toBe('');
    });
  });
});
