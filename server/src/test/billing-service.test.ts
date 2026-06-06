/**
 * Unit tests for the BillingService.
 *
 * These tests mock Drizzle's query builder and the websocket service so we
 * can exercise the billing logic without a real database. The focus is the
 * contract of each public method and the side-effects emitted to the
 * websocket service:
 *
 *   - handleReaderOffline() settles then pauses all active/accepted/in_progress
 *     sessions for the reader and broadcasts `reading:partner_disconnected` to
 *     both participants. Pending requests are cancelled and broadcast
 *     `reading:cancelled` with reason=reader_offline.
 *   - handleReaderOnline() resumes paused sessions and broadcasts
 *     `reading:partner_reconnected`.
 *   - Revenue-split math: 60% floor reader, 40% to the platform, integer cents.
 *
 * settle() drives per-minute billing from the session heartbeat (no cron). Its
 * SELECT ... FOR UPDATE transaction is not exercised by this hand-rolled mock;
 * it is stubbed in the offline test so we can assert pause/broadcast behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const broadcastSpy = vi.fn();
const sendSpy = vi.fn();

vi.mock('../services/websocket-service', () => ({
  wsService: {
    broadcast: broadcastSpy,
    send: sendSpy,
  },
}));

// A tiny mutable state the mock Drizzle "database" will read from.
interface Row { id: number; clientId: number; readerId: number; status: string }
const state: {
  activeOrInProgress: Row[];
  pending: Row[];
  stale: Row[];
  users: Map<number, { id: number; balance: number }>;
  readings: Map<number, Row & { ratePerMinute: number; totalCharged: number; readerEarned: number; platformEarned: number; durationSeconds: number }>;
  lastUpdate: Record<string, unknown> | null;
} = {
  activeOrInProgress: [],
  pending: [],
  stale: [],
  users: new Map(),
  readings: new Map(),
  lastUpdate: null,
};

// Builder chain that the billing service uses. We return a thenable that
// resolves to the next queued result; when `update().set().where()` is
// invoked, we just resolve to an empty array since the billing code does
// not read the return value.
function makeSelectChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => {
    // Real promise (so `await ...where()` works) that also exposes `.for()`
    // for the `SELECT ... FOR UPDATE` calls inside settle().
    const p = Promise.resolve(result) as Promise<unknown> & { for: () => Promise<unknown> };
    p.for = () => Promise.resolve(result);
    return p;
  };
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = () => chain;
  chain.where = () => Promise.resolve([]);
  chain.returning = () => Promise.resolve([]);
  return chain;
}

function makeInsertChain() {
  const chain: Record<string, unknown> = {};
  chain.values = () => chain;
  chain.returning = () => Promise.resolve([]);
  return chain;
}

// Per-test queue of `select(...).from(...).where(...)` resolutions. Every call
// to `db.select(...)` pops one entry.
const selectQueue: unknown[][] = [];

interface MockDb {
  select: () => ReturnType<typeof makeSelectChain>;
  update: () => ReturnType<typeof makeUpdateChain>;
  insert: () => ReturnType<typeof makeInsertChain>;
  transaction: (fn: (tx: MockDb) => Promise<void>) => Promise<void>;
}
const mockDb: MockDb = {
  select: () => makeSelectChain(selectQueue.shift() ?? []),
  update: () => makeUpdateChain(),
  insert: () => makeInsertChain(),
  transaction: async (fn) => fn(mockDb),
};

vi.mock('../db/db', () => ({
  getDb: () => mockDb,
  db: mockDb,
}));

// Import AFTER mocks so the service binds to the mocked modules.
let billingService: typeof import('../services/billing-service').billingService;

beforeEach(async () => {
  broadcastSpy.mockClear();
  sendSpy.mockClear();
  selectQueue.length = 0;
  state.activeOrInProgress = [];
  state.pending = [];
  state.stale = [];
  state.lastUpdate = null;
  if (!billingService) {
    billingService = (await import('../services/billing-service')).billingService;
  }
});

describe('BillingService.handleReaderOffline', () => {
  beforeEach(() => {
    // settle() runs a SELECT ... FOR UPDATE transaction the hand-rolled mock
    // cannot model. Stub it so we can assert the pause/broadcast contract.
    vi.spyOn(billingService, 'settle').mockResolvedValue(null);
  });

  // Restore the real settle() so later suites that exercise it directly aren't
  // left with this stub.
  afterEach(() => {
    vi.mocked(billingService.settle).mockRestore();
  });

  it('pauses active + in_progress sessions and broadcasts partner_disconnected', async () => {
    const sessions: Row[] = [
      { id: 101, clientId: 7, readerId: 42, status: 'active' },
      { id: 102, clientId: 8, readerId: 42, status: 'in_progress' },
    ];
    // Call order inside handleReaderOffline:
    //   1. select active/accepted/in_progress sessions
    //   2. per session: re-read status (settle may have ended it)
    //   3. select pending sessions
    selectQueue.push(sessions, [{ status: 'active' }], [{ status: 'in_progress' }], []);

    await billingService.handleReaderOffline(42);

    expect(billingService.settle).toHaveBeenCalledWith(101, expect.any(Date));
    expect(broadcastSpy).toHaveBeenCalledTimes(2);
    expect(broadcastSpy).toHaveBeenNthCalledWith(
      1,
      [7, 42],
      'reading:partner_disconnected',
      expect.objectContaining({
        readingId: 101,
        partnerRole: 'reader',
        previousStatus: 'active',
      }),
    );
    expect(broadcastSpy).toHaveBeenNthCalledWith(
      2,
      [8, 42],
      'reading:partner_disconnected',
      expect.objectContaining({
        readingId: 102,
        partnerRole: 'reader',
        previousStatus: 'in_progress',
      }),
    );
  });

  it('does NOT re-pause a session that settle already finalized', async () => {
    const sessions: Row[] = [{ id: 110, clientId: 7, readerId: 42, status: 'active' }];
    // Re-read reports the session was completed (insufficient balance during settle).
    selectQueue.push(sessions, [{ status: 'completed' }], []);

    await billingService.handleReaderOffline(42);

    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('cancels pending requests when the reader disconnects and broadcasts reason=reader_offline', async () => {
    const pending: Row[] = [{ id: 201, clientId: 9, readerId: 42, status: 'pending' }];
    // 1. no active sessions, 2. one pending request
    selectQueue.push([], pending);

    await billingService.handleReaderOffline(42);

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(
      [9, 42],
      'reading:cancelled',
      expect.objectContaining({ readingId: 201, reason: 'reader_offline' }),
    );
  });

  it('is a no-op when reader has no active or pending sessions', async () => {
    selectQueue.push([], []);

    await billingService.handleReaderOffline(999);

    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('handles both active and pending sessions in the same call', async () => {
    const sessions: Row[] = [{ id: 301, clientId: 11, readerId: 42, status: 'active' }];
    const pending: Row[] = [{ id: 302, clientId: 12, readerId: 42, status: 'pending' }];
    // sessions, re-read status for 301, pending
    selectQueue.push(sessions, [{ status: 'active' }], pending);

    await billingService.handleReaderOffline(42);

    expect(broadcastSpy).toHaveBeenCalledTimes(2);
    const types = broadcastSpy.mock.calls.map((c) => c[1]);
    expect(types).toEqual([
      'reading:partner_disconnected',
      'reading:cancelled',
    ]);
  });
});

describe('BillingService.handleReaderOnline', () => {
  it('resumes only sessions still within grace (incl. null heartbeat w/ recent pause) and skips stale ones', async () => {
    const recent = new Date();
    const withinGrace = new Date(Date.now() - 60_000); // 1m ago, < 2m grace
    const stale = new Date(Date.now() - 10 * 60_000); // 10m ago, past grace
    const paused = [
      // 401, 402 fresh heartbeat → resume
      { id: 401, clientId: 7, durationSeconds: 180, lastHeartbeat: recent, updatedAt: recent },
      { id: 402, clientId: 8, durationSeconds: 0, lastHeartbeat: withinGrace, updatedAt: withinGrace },
      // 403 client went quiet long ago → must NOT be resurrected
      { id: 403, clientId: 9, durationSeconds: 60, lastHeartbeat: stale, updatedAt: stale },
      // 404 paused before any heartbeat but recently → updatedAt fallback → resume
      { id: 404, clientId: 10, durationSeconds: 30, lastHeartbeat: null, updatedAt: recent },
      // 405 null heartbeat AND paused long ago → must NOT be resumed
      { id: 405, clientId: 11, durationSeconds: 30, lastHeartbeat: null, updatedAt: stale },
    ];
    selectQueue.push(paused);

    await billingService.handleReaderOnline(42);

    // Only 401, 402, 404 are within grace; 403 and 405 are stale.
    expect(broadcastSpy).toHaveBeenCalledTimes(3);
    expect(broadcastSpy).toHaveBeenNthCalledWith(
      1,
      [7, 42],
      'reading:partner_reconnected',
      expect.objectContaining({ readingId: 401, partnerRole: 'reader' }),
    );
    expect(broadcastSpy).toHaveBeenNthCalledWith(
      2,
      [8, 42],
      'reading:partner_reconnected',
      expect.objectContaining({ readingId: 402, partnerRole: 'reader' }),
    );
    expect(broadcastSpy).toHaveBeenNthCalledWith(
      3,
      [10, 42],
      'reading:partner_reconnected',
      expect.objectContaining({ readingId: 404, partnerRole: 'reader' }),
    );
    // Negative assertions: stale sessions are never resumed/broadcast.
    expect(broadcastSpy).not.toHaveBeenCalledWith(
      [9, 42],
      'reading:partner_reconnected',
      expect.anything(),
    );
    expect(broadcastSpy).not.toHaveBeenCalledWith(
      [11, 42],
      'reading:partner_reconnected',
      expect.anything(),
    );
  });

  it('is a no-op when the reader has no paused sessions', async () => {
    selectQueue.push([]);

    await billingService.handleReaderOnline(42);

    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});

describe('BillingService.settle terminal snapshot', () => {
  it('reports ended:true with grace_period_expired for a missed reading', async () => {
    // 1st select: the reading row (FOR UPDATE); 2nd: the client balance.
    selectQueue.push([
      {
        id: 700,
        clientId: 5,
        readerId: 9,
        status: 'missed',
        ratePerMinute: 100,
        totalCharged: 300,
        readerEarned: 180,
        platformEarned: 120,
        durationSeconds: 180,
        startedAt: new Date(),
      },
    ]);
    selectQueue.push([{ balance: 1000 }]);

    const snap = await billingService.settle(700);

    expect(snap).not.toBeNull();
    expect(snap!.ended).toBe(true);
    expect(snap!.endReason).toBe('grace_period_expired');
    expect(snap!.status).toBe('missed');
  });

  it('reports ended:true with no end reason for a completed reading', async () => {
    selectQueue.push([
      {
        id: 701,
        clientId: 6,
        readerId: 9,
        status: 'completed',
        ratePerMinute: 100,
        totalCharged: 200,
        readerEarned: 120,
        platformEarned: 80,
        durationSeconds: 120,
        startedAt: new Date(),
      },
    ]);
    selectQueue.push([{ balance: 500 }]);

    const snap = await billingService.settle(701);

    expect(snap!.ended).toBe(true);
    expect(snap!.endReason).toBeNull();
  });
});

describe('Revenue-split math (60% reader / 40% platform)', () => {
  // Mirrors the per-minute split in BillingService.settle so we can freeze the
  // contract: 60% floor reader, 40% to platform, integer cents only.
  function split(ratePerMinute: number) {
    const readerShare = Math.floor(ratePerMinute * 0.6);
    const platformShare = ratePerMinute - readerShare;
    return { readerShare, platformShare };
  }

  it('splits 500¢ into 300¢ reader / 200¢ platform', () => {
    expect(split(500)).toEqual({ readerShare: 300, platformShare: 200 });
  });

  it('splits 333¢ into 199¢ reader / 134¢ platform (Math.floor)', () => {
    // 333 * 0.6 = 199.8 -> floor 199. Platform takes the rounding remainder.
    expect(split(333)).toEqual({ readerShare: 199, platformShare: 134 });
  });

  it('splits 1¢ into 0¢ reader / 1¢ platform (platform absorbs sub-cent)', () => {
    expect(split(1)).toEqual({ readerShare: 0, platformShare: 1 });
  });

  it('never produces negative shares for non-negative rates', () => {
    for (const rate of [0, 1, 10, 99, 100, 499, 500, 999]) {
      const { readerShare, platformShare } = split(rate);
      expect(readerShare).toBeGreaterThanOrEqual(0);
      expect(platformShare).toBeGreaterThanOrEqual(0);
      expect(readerShare + platformShare).toBe(rate);
    }
  });
});
