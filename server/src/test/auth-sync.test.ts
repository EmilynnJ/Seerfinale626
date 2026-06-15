import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

const mockUpsertReturning = vi.fn();
const mockUpdateReturning = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();

vi.mock('../middleware/auth', () => ({
  checkJwt: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      header: {},
      token: 'mock-token',
      payload: {
        sub: 'neon-user-123',
        email: 'newuser@example.com',
      },
    } as any;
    next();
  },
  requireAuth: vi.fn((_req: Request, res: Response) => {
    res.status(401).json({ error: 'requireAuth should not run on /sync' });
  }),
}));

vi.mock('../db/db', () => ({
  getDb: () => ({
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  }),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('../config', () => ({
  config: {
    adminEmails: ['admin@example.com'],
    readerEmails: ['reader@example.com'],
  },
}));

describe('POST /api/auth/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: mockUpsertReturning,
        }),
      }),
    });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: mockUpdateReturning,
        }),
      }),
    });
  });

  it('upserts via jwtOnly without calling requireAuth/resolveUser', async () => {
    const now = new Date();
    mockUpsertReturning.mockResolvedValue([
      {
        id: 42,
        auth0Id: 'neon-user-123',
        email: 'newuser@example.com',
        fullName: 'New User',
        profileImage: null,
        role: 'client',
        balance: 0,
        username: null,
        bio: null,
        specialties: null,
        pricingChat: 0,
        pricingVoice: 0,
        pricingVideo: 0,
        isOnline: false,
        totalReadings: 0,
        stripeAccountId: null,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);

    const authRoutes = (await import('../routes/auth')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/auth/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({
        auth0Id: 'neon-user-123',
        email: 'newuser@example.com',
        fullName: 'New User',
      }),
    });

    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.role).toBe('client');
    expect(body.id).toBe(42);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('accepts profileImage without strict URL validation', async () => {
    const now = new Date();
    mockUpsertReturning.mockResolvedValue([
      {
        id: 43,
        auth0Id: 'neon-user-123',
        email: 'newuser@example.com',
        fullName: null,
        profileImage: 'not-a-valid-url',
        role: 'client',
        balance: 0,
        username: null,
        bio: null,
        specialties: null,
        pricingChat: 0,
        pricingVoice: 0,
        pricingVideo: 0,
        isOnline: false,
        totalReadings: 0,
        stripeAccountId: null,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);

    const authRoutes = (await import('../routes/auth')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/auth/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth0Id: 'neon-user-123',
        email: 'newuser@example.com',
        profileImage: 'not-a-valid-url',
      }),
    });

    server.close();
    expect(res.status).toBe(200);
  });
});
