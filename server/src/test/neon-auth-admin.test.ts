import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function loadServiceWithEnv(env: Record<string, string>) {
  vi.resetModules();

  // Required so config.ts doesn't throw on load.
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/soulseer_test';
  process.env.NEON_AUTH_JWKS_URL =
    'https://test.neonauth.example/neondb/auth/.well-known/jwks.json';
  // Cleared by default; individual tests opt in.
  delete process.env.VITE_NEON_AUTH_URL;
  delete process.env.NEON_AUTH_URL;

  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const mod = await import('../services/neon-auth-admin');
  return mod.neonAuthAdminService;
}

describe('NeonAuthAdminService', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('is disabled and throws when the Neon Auth URL is not configured', async () => {
    const svc = await loadServiceWithEnv({ NEON_AUTH_URL: '' });

    expect(svc.enabled).toBe(false);
    await expect(
      svc.createUserWithPassword({ email: 'test@example.com', fullName: 'Test User' }),
    ).rejects.toThrowError(/Neon Auth is not configured/);
  });

  it('generates a strong password (length, char classes)', async () => {
    const svc = await loadServiceWithEnv({
      NEON_AUTH_URL: 'https://test.neonauth.example/neondb/auth',
    });
    const pw = svc.generatePassword();
    expect(pw.length).toBeGreaterThanOrEqual(16);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
  });

  it('creates a user via the Neon Auth sign-up endpoint', async () => {
    const svc = await loadServiceWithEnv({
      NEON_AUTH_URL: 'https://test.neonauth.example/neondb/auth',
    });

    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ user: { id: 'neon-user-123' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await svc.createUserWithPassword({
      email: 'reader@example.com',
      fullName: 'New Reader',
    });

    expect(result.auth0Id).toBe('neon-user-123');
    expect(result.password).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://test.neonauth.example/neondb/auth/sign-up/email',
    );
    expect(init?.method).toBe('POST');
  });

  it('maps a duplicate sign-up to a clear "already exists" error', async () => {
    const svc = await loadServiceWithEnv({
      NEON_AUTH_URL: 'https://test.neonauth.example/neondb/auth',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 'USER_ALREADY_EXISTS', message: 'exists' }), {
          status: 422,
        }),
      ),
    );

    await expect(
      svc.createUserWithPassword({ email: 'dupe@example.com', fullName: 'Dupe' }),
    ).rejects.toThrowError(/already exists/);
  });

  it('deleteUser is a no-op that returns false', async () => {
    const svc = await loadServiceWithEnv({
      NEON_AUTH_URL: 'https://test.neonauth.example/neondb/auth',
    });
    await expect(svc.deleteUser('neon-user-123')).resolves.toBe(false);
  });
});
