import { apiService } from './api';

/**
 * Cloudflare Realtime (serverless SFU) client for reading sessions.
 *
 * All Cloudflare API calls are proxied through the participant-gated
 * /api/readings/:id/rtc/* endpoints — the browser never holds Cloudflare
 * account credentials. TURN connectivity uses short-lived ICE servers issued
 * by the server (Cloudflare Calls TURN service).
 *
 * Flow per participant:
 *   1. POST /rtc-session        → ICE servers + role (+ MoQ relay for data)
 *   2. POST /rtc/sessions/new   → Cloudflare SFU session id
 *   3. addTransceiver(local tracks) + offer → POST tracks/new (push)
 *   4. POST /rtc/announce       → publish my session id + track names
 *   5. Peer discovery (WS push `reading:rtc_peer` or GET /rtc/peers poll)
 *      → POST tracks/new (pull remote tracks) → renegotiate if required
 */

export interface RtcSessionAccess {
  readingId: number;
  role: 'client' | 'reader';
  channel: string;
  iceServers: RTCIceServer[];
  moqRelayUrl: string | null;
  expiresIn: number;
}

export interface AnnouncedPeer {
  sessionId: string;
  tracks: Array<{ trackName: string; kind: 'audio' | 'video' }>;
  userId: number;
  updatedAt: number;
}

interface TracksNewResponse {
  sessionDescription?: { type: 'answer' | 'offer'; sdp: string };
  requiresImmediateRenegotiation?: boolean;
  tracks?: Array<{ trackName?: string; mid?: string; error?: unknown }>;
  errorCode?: string;
  errorDescription?: string;
}

export interface ReadingRtcCallbacks {
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

export class ReadingRtcClient {
  private readonly readingId: number;
  private readonly wantVideo: boolean;
  private readonly callbacks: ReadingRtcCallbacks;

  private pc: RTCPeerConnection | null = null;
  private sessionId: string | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pulledPeerSessionId: string | null = null;
  private closed = false;

  access: RtcSessionAccess | null = null;

  constructor(readingId: number, wantVideo: boolean, callbacks: ReadingRtcCallbacks = {}) {
    this.readingId = readingId;
    this.wantVideo = wantVideo;
    this.callbacks = callbacks;
  }

  get localMediaStream(): MediaStream | null {
    return this.localStream;
  }

  /** Acquire media, create the SFU session, push local tracks, announce. */
  async join(): Promise<MediaStream> {
    this.access = await apiService.post<RtcSessionAccess>(
      `/api/readings/${this.readingId}/rtc-session`,
    );

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: this.wantVideo,
    });
    if (this.closed) {
      this.stopLocalTracks();
      throw new Error('closed');
    }

    const pc = new RTCPeerConnection({
      iceServers: this.access.iceServers,
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;

    pc.ontrack = (event) => {
      if (!this.remoteStream) this.remoteStream = new MediaStream();
      this.remoteStream.addTrack(event.track);
      this.callbacks.onRemoteStream?.(this.remoteStream);
    };
    pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionStateChange?.(pc.connectionState);
    };

    // 1) Create the Cloudflare SFU session.
    const created = await apiService.post<{ sessionId?: string }>(
      `/api/readings/${this.readingId}/rtc/sessions/new`,
    );
    if (!created.sessionId) {
      throw new Error('Cloudflare Realtime did not return a session id');
    }
    this.sessionId = created.sessionId;

    // 2) Push local tracks (sendonly transceivers + offer).
    const role = this.access.role;
    const transceivers = this.localStream.getTracks().map((track) =>
      pc.addTransceiver(track, { direction: 'sendonly' }),
    );
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const pushBody = {
      sessionDescription: { type: 'offer', sdp: offer.sdp },
      tracks: transceivers.map((t) => ({
        location: 'local',
        mid: t.mid,
        trackName: `${role}-${t.sender.track?.kind ?? 'media'}`,
      })),
    };
    const pushRes = await apiService.post<TracksNewResponse>(
      `/api/readings/${this.readingId}/rtc/sessions/${this.sessionId}/tracks/new`,
      pushBody,
    );
    if (!pushRes.sessionDescription) {
      throw new Error(pushRes.errorDescription || 'SFU track publish failed');
    }
    await pc.setRemoteDescription(
      new RTCSessionDescription(pushRes.sessionDescription),
    );

    // 3) Announce so the other participant can pull our tracks.
    await apiService.post(`/api/readings/${this.readingId}/rtc/announce`, {
      sessionId: this.sessionId,
      tracks: this.localStream.getTracks().map((track) => ({
        trackName: `${role}-${track.kind}`,
        kind: track.kind as 'audio' | 'video',
      })),
    });

    return this.localStream;
  }

  /** Ask the server who the peer is; pull their tracks if not yet pulled. */
  async syncPeer(): Promise<boolean> {
    if (this.closed || !this.pc || !this.sessionId) return false;
    const { peer } = await apiService.get<{ peer: AnnouncedPeer | null }>(
      `/api/readings/${this.readingId}/rtc/peers`,
    );
    if (!peer) return false;
    return this.pullPeer(peer);
  }

  /** Pull the announced peer's tracks from the SFU (idempotent per session). */
  async pullPeer(peer: AnnouncedPeer): Promise<boolean> {
    if (this.closed || !this.pc || !this.sessionId) return false;
    if (!peer.sessionId || peer.sessionId === this.pulledPeerSessionId) {
      return this.pulledPeerSessionId !== null;
    }

    const res = await apiService.post<TracksNewResponse>(
      `/api/readings/${this.readingId}/rtc/sessions/${this.sessionId}/tracks/new`,
      {
        tracks: peer.tracks.map((t) => ({
          location: 'remote',
          sessionId: peer.sessionId,
          trackName: t.trackName,
        })),
      },
    );

    if (res.requiresImmediateRenegotiation && res.sessionDescription) {
      // Server sends a new offer describing the pulled tracks; answer it.
      await this.pc.setRemoteDescription(
        new RTCSessionDescription(res.sessionDescription),
      );
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await apiService.put(
        `/api/readings/${this.readingId}/rtc/sessions/${this.sessionId}/renegotiate`,
        { sessionDescription: { type: 'answer', sdp: answer.sdp } },
      );
    }

    this.pulledPeerSessionId = peer.sessionId;
    return true;
  }

  setAudioEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  setVideoEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  private stopLocalTracks(): void {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  close(): void {
    this.closed = true;
    this.stopLocalTracks();
    this.remoteStream = null;
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
  }
}
