import { describe, it, expect, vi, beforeEach } from 'vitest';

async function loadServiceWithConfig(realtimeConfig: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('../config', () => ({
    config: {
      realtime: {
        baseUrl: 'https://rtc.live.cloudflare.com/v1',
        tokenExpiration: 3600,
        moqRelayUrl: '',
        turnKeyId: '',
        turnApiToken: '',
        ...realtimeConfig,
      },
    },
  }));
  const mod = await import('../services/realtime-service');
  return mod.RealtimeService;
}

describe('RealtimeService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws when Cloudflare Realtime credentials are not configured', async () => {
    const RealtimeService = await loadServiceWithConfig({
      appId: '',
      appToken: '',
      enabled: false,
    });
    await expect(RealtimeService.buildSessionAccess(123)).rejects.toThrowError(
      'Cloudflare Realtime credentials not configured',
    );
  });

  it('rejects non-session SFU API paths', async () => {
    const RealtimeService = await loadServiceWithConfig({
      appId: 'app-id',
      appToken: 'app-token',
      enabled: true,
    });
    await expect(
      RealtimeService.sfuRequest('POST', '../other-app/sessions/new'),
    ).rejects.toThrowError('Invalid Realtime API path');
  });

  it('proxies session creation with the server-held bearer token', async () => {
    const RealtimeService = await loadServiceWithConfig({
      appId: 'app-id',
      appToken: 'app-token',
      enabled: true,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sessionId: 'sess-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await RealtimeService.createSession();
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ sessionId: 'sess-1' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/apps/app-id/sessions/new');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer app-token',
    });
  });

  it('falls back to Cloudflare STUN when TURN credentials are missing', async () => {
    const RealtimeService = await loadServiceWithConfig({
      appId: 'app-id',
      appToken: 'app-token',
      enabled: true,
    });
    const servers = await RealtimeService.getIceServers();
    expect(servers).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
  });

  it('generates short-lived TURN credentials when configured', async () => {
    const RealtimeService = await loadServiceWithConfig({
      appId: 'app-id',
      appToken: 'app-token',
      enabled: true,
      turnKeyId: 'turn-key',
      turnApiToken: 'turn-token',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        iceServers: {
          urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
          username: 'u',
          credential: 'c',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const servers = await RealtimeService.getIceServers(600);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ username: 'u', credential: 'c' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/turn-key/credentials/generate-ice-servers',
    );
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ ttl: 600 });
  });

  it('builds session access with the reading channel and MoQ relay', async () => {
    const RealtimeService = await loadServiceWithConfig({
      appId: 'app-id',
      appToken: 'app-token',
      enabled: true,
      moqRelayUrl: 'https://relay.example.mediaoverquic.com',
    });

    const access = await RealtimeService.buildSessionAccess(42);
    expect(access.channel).toBe('reading_42');
    expect(access.expiresIn).toBe(3600);
    expect(access.moqRelayUrl).toBe('https://relay.example.mediaoverquic.com');
    expect(access.iceServers.length).toBeGreaterThan(0);
  });
});
