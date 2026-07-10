import { config } from '../config';
import { AppError } from '../middleware/error-handler';
import { logger } from '../utils/logger';

/**
 * Cloudflare Realtime (serverless SFU + Calls TURN + MoQ relay).
 *
 * Cloudflare Realtime handles ALL real-time communication for readings —
 * voice/video routing via the SFU, TURN for NAT traversal, and the MoQ relay
 * for chat-type real-time data transport. No custom WebRTC SFU is built here.
 *
 * The Cloudflare app id + app token are server-only secrets. Clients NEVER
 * talk to the Cloudflare API with account credentials: every SFU operation is
 * proxied through the participant-gated reading routes, and TURN access uses
 * short-lived credentials generated per session.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export class RealtimeService {
  private static assertConfigured(): void {
    if (!config.realtime.enabled) {
      throw new AppError(500, 'Cloudflare Realtime credentials not configured');
    }
  }

  private static appBase(): string {
    return `${config.realtime.baseUrl}/apps/${config.realtime.appId}`;
  }

  /**
   * Proxy a whitelisted SFU API call to Cloudflare Realtime, attaching the
   * server-held bearer token. `path` must be a session-scoped API path such as
   * `sessions/new`, `sessions/{id}/tracks/new`, `sessions/{id}/renegotiate`.
   */
  static async sfuRequest(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    this.assertConfigured();
    if (!/^sessions\/[A-Za-z0-9/_-]*$/.test(path) && path !== 'sessions/new') {
      throw new AppError(400, 'Invalid Realtime API path');
    }

    const res = await fetch(`${this.appBase()}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.realtime.appToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // Some responses (rare errors) may not be JSON — surface status only.
    }

    if (!res.ok) {
      logger.error(
        { status: res.status, path, body: json },
        'Cloudflare Realtime API error',
      );
    }
    return { status: res.status, body: json };
  }

  /** Create a new SFU session; returns Cloudflare's response verbatim. */
  static async createSession(offerSdp?: string): Promise<{ status: number; body: unknown }> {
    return this.sfuRequest(
      'POST',
      'sessions/new',
      offerSdp
        ? { sessionDescription: { type: 'offer', sdp: offerSdp } }
        : undefined,
    );
  }

  /**
   * Generate short-lived ICE servers (STUN + TURN) for a session using the
   * Cloudflare Calls TURN service. Falls back to Cloudflare public STUN when
   * TURN credentials are not configured.
   */
  static async getIceServers(
    ttlSeconds: number = config.realtime.tokenExpiration,
  ): Promise<IceServer[]> {
    const { turnKeyId, turnApiToken } = config.realtime;
    if (!turnKeyId || !turnApiToken) {
      return [{ urls: 'stun:stun.cloudflare.com:3478' }];
    }

    try {
      const res = await fetch(
        `${config.realtime.baseUrl}/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${turnApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: ttlSeconds }),
        },
      );
      if (!res.ok) {
        logger.error({ status: res.status }, 'Cloudflare TURN credential generation failed');
        return [{ urls: 'stun:stun.cloudflare.com:3478' }];
      }
      const data = (await res.json()) as { iceServers?: IceServer | IceServer[] };
      const servers = data.iceServers;
      if (!servers) return [{ urls: 'stun:stun.cloudflare.com:3478' }];
      return Array.isArray(servers) ? servers : [servers];
    } catch (err) {
      logger.error({ err }, 'Cloudflare TURN credential generation error');
      return [{ urls: 'stun:stun.cloudflare.com:3478' }];
    }
  }

  /**
   * Build the session bootstrap payload for a reading participant: unique
   * channel name, short-lived ICE servers, and the MoQ relay for chat-type
   * data. Never includes Cloudflare account credentials.
   */
  static async buildSessionAccess(readingId: number): Promise<{
    channel: string;
    iceServers: IceServer[];
    moqRelayUrl: string | null;
    expiresIn: number;
  }> {
    this.assertConfigured();
    return {
      channel: `reading_${readingId}`,
      iceServers: await this.getIceServers(),
      moqRelayUrl: config.realtime.moqRelayUrl || null,
      expiresIn: config.realtime.tokenExpiration,
    };
  }
}
