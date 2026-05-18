import { describe, expect, it, vi } from 'vitest';
import { validateSyncJwtSubject } from '../routes/auth';

describe('auth sync JWT subject validation', () => {
  it('allows sync when the JWT subject matches the requested Auth0 id', () => {
    const req = {
      auth: { payload: { sub: 'auth0|abc123' } },
      body: { auth0Id: 'auth0|abc123' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    validateSyncJwtSubject(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects sync when the request body tries to sync a different Auth0 id', () => {
    const req = {
      auth: { payload: { sub: 'auth0|abc123' } },
      body: { auth0Id: 'auth0|other' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    validateSyncJwtSubject(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Auth0 subject mismatch' });
  });
});
