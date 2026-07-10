import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function loadServiceWithEnv(env: Record<string, string>) {
  vi.resetModules();

  // Set required variables so config.ts doesn't throw
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/soulseer_test';

  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const mod = await import('../services/supabase-admin');
  return mod.supabaseAdminService;
}

describe('SupabaseAdminService', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('throws a configuration error when credentials are not set', async () => {
    // SUPABASE_URL stays set (config requires it); only the service-role key
    // is missing, which must disable the admin API.
    const svc = await loadServiceWithEnv({
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_SECRET_KEY: '',
    });

    expect(svc.enabled).toBe(false);

    await expect(
      svc.createUserWithPassword({
        email: 'test@example.com',
        fullName: 'Test User',
      }),
    ).rejects.toThrowError(
      'Supabase admin API is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  });

  it('generates strong passwords with all required character classes', async () => {
    const svc = await loadServiceWithEnv({
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });

    for (let i = 0; i < 20; i++) {
      const pw = svc.generatePassword();
      expect(pw.length).toBeGreaterThanOrEqual(16);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[!@#$%^&*\-_=+?]/);
    }
  });
});
