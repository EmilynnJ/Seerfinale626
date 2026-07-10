import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ToastProvider';
import { useWebSocketEvent } from '../../hooks/useWebSocket';
import { apiService } from '../../services/api';
import {
  Button,
  StarRating,
  Textarea,
  ConfirmDialog,
  LoadingPage,
  EmptyState,
} from '../../components/ui';
import type { Reading } from '../../types';
import { ReadingRtcClient, type AnnouncedPeer } from '../../services/realtime';

/* ================================================================
   TYPES
   ================================================================ */
interface ChatMessage {
  id: string;
  senderId: number;
  content: string;
  timestamp: number;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface SessionSummary {
  duration: number;
  totalCost: number;
  ratePerMinute: number;
}

/* ================================================================
   HELPERS
   ================================================================ */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatCost(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/* ================================================================
   AUDIO VISUALIZATION SUB-COMPONENT
   ================================================================ */
function AudioVisualization() {
  return (
    <div className="audio-vis" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="audio-vis__bar" />
      ))}
    </div>
  );
}

/* ================================================================
   CONNECTION STATUS SUB-COMPONENT
   ================================================================ */
function ConnectionStatus({ state }: { state: ConnectionState }) {
  const labels: Record<ConnectionState, string> = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting...',
  };

  return (
    <div className={`connection-status connection-status--${state}`} role="status" aria-live="polite">
      <span className="connection-status__dot" />
      <span>{labels[state]}</span>
    </div>
  );
}

/* ================================================================
   SESSION BAR (Timer, Cost, Balance)
   ================================================================ */
function SessionBar({
  elapsed,
  costCents,
  balanceCents,
  rateCents,
}: {
  elapsed: number;
  /** Accrued cost in cents. */
  costCents: number;
  /** Current balance in cents. */
  balanceCents: number;
  /** Rate in cents-per-minute. */
  rateCents: number;
}) {
  const remainingCents = balanceCents - costCents;
  const minutesLeft = rateCents > 0 ? remainingCents / rateCents : Infinity;
  const isLow = minutesLeft < 2 && minutesLeft > 0;

  return (
    <div className="session-bar" role="timer" aria-label="Session information">
      <div className="session-bar__item">
        <span className="session-bar__label">Elapsed</span>
        <span className="session-bar__value session-bar__value--time">{formatTime(elapsed)}</span>
      </div>
      <div className="session-bar__item">
        <span className="session-bar__label">Cost</span>
        <span className="session-bar__value session-bar__value--cost">
          {formatCost(costCents / 100)}
        </span>
      </div>
      <div className="session-bar__item">
        <span className="session-bar__label">Balance</span>
        <span className={`session-bar__value ${isLow ? 'session-bar__value--warning' : 'session-bar__value--balance'}`}>
          {formatCost(Math.max(0, remainingCents) / 100)}
        </span>
      </div>
      {isLow && (
        <div className="badge badge--danger" role="alert">
          ⚠ Low balance — less than 2 minutes remaining
        </div>
      )}
    </div>
  );
}

/* ================================================================
   CHAT MODE
   ================================================================ */
function ChatMode({
  messages,
  userId,
  onSend,
}: {
  messages: ChatMessage[];
  userId: number;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="chat">
      <div className="chat__messages" role="log" aria-label="Chat messages" aria-live="polite">
        {messages.length === 0 && (
          <p className="caption text-center" style={{ margin: 'auto' }}>
            Your reading has begun. Send a message to start the conversation...
          </p>
        )}
        {messages.map((msg) => {
          const isSent = msg.senderId === userId;
          return (
            <div
              key={msg.id}
              className={`chat__bubble ${isSent ? 'chat__bubble--sent' : 'chat__bubble--received'}`}
            >
              <div>{msg.content}</div>
              <div className="chat__bubble-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat__input-bar" onSubmit={handleSubmit}>
        <input
          className="form-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          aria-label="Chat message input"
          autoComplete="off"
        />
        <Button type="submit" variant="primary" size="sm" disabled={!input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}

/* ================================================================
   VOICE MODE
   ================================================================ */
function VoiceMode({
  isMuted,
  onToggleMute,
  onEnd,
  connectionState,
}: {
  isMuted: boolean;
  onToggleMute: () => void;
  onEnd: () => void;
  connectionState: ConnectionState;
}) {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="call-video">
        <div className="call-video__placeholder">
          <span className="call-video__placeholder-icon">🎙️</span>
          <span>Voice Reading in Progress</span>
          {connectionState === 'connected' && <AudioVisualization />}
        </div>
      </div>
      <div className="call-controls">
        <button
          className={`call-controls__btn ${isMuted ? '' : 'call-controls__btn--active'}`}
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={!isMuted}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button
          className="call-controls__btn call-controls__btn--end"
          onClick={onEnd}
          aria-label="End voice call"
        >
          📞
        </button>
      </div>
    </div>
  );
}

/* ================================================================
   VIDEO MODE
   ================================================================ */
function VideoMode({
  localVideoRef,
  remoteVideoRef,
  hasRemoteStream,
  isMuted,
  isCameraOff,
  onToggleMute,
  onToggleCamera,
  onEnd,
}: {
  localVideoRef: React.RefObject<HTMLVideoElement>;
  remoteVideoRef: React.RefObject<HTMLVideoElement>;
  hasRemoteStream: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="call-area">
        <div className="call-video">
          {!hasRemoteStream && (
            <div className="call-video__placeholder">
              <span className="call-video__placeholder-icon">🔮</span>
              <span>Waiting for the other participant...</span>
            </div>
          )}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: hasRemoteStream ? 'block' : 'none' }}
          />
          <span className="call-video__label">Reader</span>
        </div>
        <div className="call-video">
          {isCameraOff && (
            <div className="call-video__placeholder">
              <span className="call-video__placeholder-icon">📷</span>
              <span>Camera off</span>
            </div>
          )}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: isCameraOff ? 'none' : 'block' }}
          />
          <span className="call-video__label">You</span>
        </div>
      </div>
      <div className="call-controls">
        <button
          className={`call-controls__btn ${isMuted ? '' : 'call-controls__btn--active'}`}
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={!isMuted}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button
          className={`call-controls__btn ${isCameraOff ? '' : 'call-controls__btn--active'}`}
          onClick={onToggleCamera}
          aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
          aria-pressed={!isCameraOff}
        >
          {isCameraOff ? '📷' : '📹'}
        </button>
        <button
          className="call-controls__btn call-controls__btn--end"
          onClick={onEnd}
          aria-label="End video call"
        >
          📞
        </button>
      </div>
    </div>
  );
}

/* ================================================================
   POST-SESSION SUMMARY
   ================================================================ */
function PostSessionSummary({
  summary,
  readingId,
  onDone,
}: {
  summary: SessionSummary;
  readingId: number;
  onDone: () => void;
}) {
  const { addToast } = useToast();
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmitReview = async () => {
    if (rating === 0) {
      addToast('warning', 'Please select a star rating');
      return;
    }
    setSubmitting(true);
    try {
      await apiService.post(`/api/readings/${readingId}/rate`, {
        rating,
        review: reviewText.trim() || undefined,
      });
      addToast('success', 'Thank you for your review! ✨');
      setSubmitted(true);
    } catch {
      addToast('error', 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="session-summary">
      <h2 className="heading-2">Reading Complete</h2>
      <p className="hero__tagline">Thank you for your session</p>
      <div className="divider" />

      <div className="session-summary__stats">
        <div className="session-summary__stat">
          <span className="session-summary__stat-label">Duration</span>
          <span className="session-summary__stat-value">{formatTime(summary.duration)}</span>
        </div>
        <div className="session-summary__stat">
          <span className="session-summary__stat-label">Total Cost</span>
          <span className="session-summary__stat-value price">{formatCost(summary.totalCost)}</span>
        </div>
        <div className="session-summary__stat">
          <span className="session-summary__stat-label">Rate</span>
          <span className="session-summary__stat-value caption">{formatCost(summary.ratePerMinute)}/min</span>
        </div>
      </div>

      {!submitted ? (
        <div className="card card--elevated w-full">
          <div className="flex flex-col gap-4 items-center">
            <h3 className="heading-4">Rate Your Experience</h3>
            <StarRating value={rating} onChange={setRating} size="lg" />
            <div className="w-full">
              <Textarea
                placeholder="Share your experience (optional)..."
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                aria-label="Review text"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onDone}>Skip</Button>
              <Button
                variant="gold"
                onClick={handleSubmitReview}
                loading={submitting}
              >
                Submit Review
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 items-center">
          <p className="body-text">Your review has been submitted. ✨</p>
          <Button variant="primary" onClick={onDone}>
            Return to Dashboard
          </Button>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   MAIN — READING SESSION PAGE
   ================================================================ */
export function ReadingSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { addToast } = useToast();

  // ── Session State ──
  const [reading, setReading] = useState<Reading | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Timer/Cost ──
  const [elapsed, setElapsed] = useState(0);
  const [cost, setCost] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // ── Connection ──
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // ── Chat ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // ── Voice/Video controls ──
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const rtcClientRef = useRef<ReadingRtcClient | null>(null);

  // ── End Session ──
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  /* ── Load reading data ── */
  useEffect(() => {
    async function loadReading() {
      try {
        const data = await apiService.get<Reading>(`/api/readings/${id}`);
        setReading(data);

        // Seed chat history from the stored transcript so both parties see
        // the full conversation after a reload/reconnect.
        if (data.type === 'chat' && Array.isArray(data.chatTranscript)) {
          setMessages(
            (data.chatTranscript as Array<{ senderId: number; content: string; timestamp: number }>).map(
              (m, i) => ({
                id: `transcript-${i}-${m.timestamp}`,
                senderId: m.senderId,
                content: m.content,
                timestamp: m.timestamp,
              }),
            ),
          );
        }

        // If already completed, show summary
        if (data.status === 'completed') {
          setSummary({
            duration: data.duration,
            totalCost: data.totalCost,
            ratePerMinute: data.ratePerMinute,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load reading session');
      } finally {
        setPageLoading(false);
      }
    }
    loadReading();
  }, [id]);

  /* ── Initialize the real-time connection (Cloudflare Realtime) ── */
  useEffect(() => {
    if (!reading || reading.status === 'completed') return;

    let mounted = true;

    if (reading.type === 'chat') {
      // Chat rides the authenticated API + WebSocket push: messages are sent
      // via POST /message (which appends to the server-side transcript) and
      // received via the `reading:message` WS event handled below.
      setConnectionState('connected');
      return () => {
        mounted = false;
      };
    }

    // Voice/video: WebRTC through the Cloudflare Realtime SFU, proxied by the
    // participant-gated server endpoints (short-lived ICE, no CF secrets here).
    const rtc = new ReadingRtcClient(reading.id, reading.type === 'video', {
      onRemoteStream: (stream) => {
        if (mounted) setRemoteStream(stream);
      },
      onConnectionStateChange: (state) => {
        if (!mounted) return;
        if (state === 'connected') setConnectionState('connected');
        else if (state === 'connecting') setConnectionState('connecting');
        else if (state === 'disconnected') setConnectionState('reconnecting');
        else if (state === 'failed' || state === 'closed') setConnectionState('disconnected');
      },
    });
    rtcClientRef.current = rtc;

    let peerPollTimer: ReturnType<typeof setInterval> | null = null;

    async function initRealtime() {
      try {
        setConnectionState('connecting');
        const localStream = await rtc.join();
        if (!mounted) return;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }
        setConnectionState('connected');

        // Pull the other participant's tracks as soon as they announce.
        // WS push (`reading:rtc_peer`) is instant; this poll is the fallback.
        const trySync = async () => {
          try {
            const pulled = await rtc.syncPeer();
            if (pulled && peerPollTimer) {
              clearInterval(peerPollTimer);
              peerPollTimer = null;
            }
          } catch {
            /* transient — retried on the next tick */
          }
        };
        void trySync();
        peerPollTimer = setInterval(() => void trySync(), 3000);
      } catch (err) {
        if (mounted) {
          setConnectionState('disconnected');
          addToast('error', 'Failed to connect. Please check your connection.');
          console.error('Realtime init error:', err);
        }
      }
    }

    void initRealtime();

    return () => {
      mounted = false;
      if (peerPollTimer) clearInterval(peerPollTimer);
      rtcClientRef.current = null;
      rtc.close();
    };
  }, [reading, addToast]);

  /* ── Attach the remote stream to the video/audio elements ── */
  useEffect(() => {
    if (!remoteStream) return;
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  /* ── Timer tick ── */
  useEffect(() => {
    if (!reading || reading.status === 'completed' || summary) return;

    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        setCost(next / 60 * reading.ratePerMinute);
        return next;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [reading, summary]);

  /* ── Server-side heartbeat keeps this session out of the grace-period sweeper ── */
  const isLive =
    !!reading &&
    !summary &&
    reading.status !== 'completed' &&
    reading.status !== 'cancelled';

  useEffect(() => {
    if (!isLive || !reading?.id) return;
    let cancelled = false;

    // The heartbeat both keeps the session alive AND drives server-side
    // per-minute billing (there is no cron). The response carries an
    // authoritative billing snapshot — on serverless deployments without a
    // live WebSocket this is how the client learns the session was ended by
    // the server (e.g. the client ran out of balance).
    const ping = async () => {
      try {
        const res = await apiService.post<{
          ok: boolean;
          billing?: {
            durationSeconds: number;
            totalCharged: number;
            ended: boolean;
            endReason: string | null;
          } | null;
        }>(`/api/readings/${reading.id}/heartbeat`);
        if (cancelled) return;
        const b = res?.billing;
        if (b?.ended) {
          if (timerRef.current) clearInterval(timerRef.current);
          setSummary(
            (prev) =>
              prev ?? {
                duration: b.durationSeconds,
                totalCost: b.totalCharged / 100,
                ratePerMinute: (reading.ratePerMinute ?? 0) / 100,
              },
          );
          if (b.endReason === 'insufficient_balance') {
            addToast(
              'warning',
              'Your balance ran out. The session has ended — top up to start a new reading.',
            );
          } else if (b.endReason === 'grace_period_expired') {
            addToast(
              'warning',
              'The session ended because the other party did not reconnect in time.',
            );
          }
        }
      } catch {
        /* non-fatal — the grace-period sweeper handles prolonged silence */
      }
    };

    const interval = setInterval(() => void ping(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLive, reading?.id, reading?.ratePerMinute, addToast]);

  /* ── WebSocket-pushed real-time events for this reading ───────── */
  const readingIdNum = reading?.id ?? null;

  const handleEndedPush = useCallback(
    (payload: unknown) => {
      const p = (payload ?? {}) as {
        readingId?: number;
        reason?: string;
        duration?: number;
        durationSeconds?: number;
        totalCost?: number;
        totalCharged?: number;
        ratePerMinute?: number;
      };
      if (readingIdNum == null || p.readingId !== readingIdNum) return;

      // If the HTTP /end handler (handleEndSession) already rendered the
      // summary, don't overwrite it — unit conventions differ slightly and
      // the HTTP response is authoritative for the initiating user.
      if (summary) return;

      if (timerRef.current) clearInterval(timerRef.current);

      // Fall back to locally tracked values when the server payload is
      // missing financial fields (e.g. auto-end triggered by the billing
      // service's insufficient-balance / grace-period sweeper).
      const totalCostCents = p.totalCost ?? p.totalCharged ?? Math.round(cost);
      setSummary({
        duration: p.durationSeconds ?? p.duration ?? elapsed,
        totalCost: totalCostCents / 100,
        ratePerMinute: (p.ratePerMinute ?? reading?.ratePerMinute ?? 0) / 100,
      });

      if (p.reason === 'insufficient_balance') {
        addToast(
          'warning',
          'Your balance ran out. The session has ended — top up to start a new reading.',
        );
      } else if (p.reason === 'grace_period_expired') {
        addToast(
          'warning',
          'The session ended because the other party did not reconnect in time.',
        );
      }
    },
    [readingIdNum, elapsed, cost, reading, summary, addToast],
  );
  useWebSocketEvent('reading:ended', handleEndedPush);

  const handleInsufficientBalance = useCallback(
    (payload: unknown) => {
      const p = (payload ?? {}) as { readingId?: number; balance?: number };
      if (readingIdNum == null || p.readingId !== readingIdNum) return;
      addToast(
        'error',
        'Your balance is too low to continue. The session will end shortly.',
      );
    },
    [readingIdNum, addToast],
  );
  useWebSocketEvent('reading:insufficient_balance', handleInsufficientBalance);

  const handlePartnerDisconnect = useCallback(
    (payload: unknown) => {
      const p = (payload ?? {}) as { readingId?: number };
      if (readingIdNum == null || p.readingId !== readingIdNum) return;
      setConnectionState('reconnecting');
      addToast(
        'warning',
        'The other party disconnected. Waiting up to 2 minutes for them to return…',
      );
    },
    [readingIdNum, addToast],
  );
  useWebSocketEvent('reading:partner_disconnected', handlePartnerDisconnect);

  const handlePartnerReconnect = useCallback(
    (payload: unknown) => {
      const p = (payload ?? {}) as { readingId?: number };
      if (readingIdNum == null || p.readingId !== readingIdNum) return;
      setConnectionState('connected');
      addToast('success', 'The other party is back online.');
    },
    [readingIdNum, addToast],
  );
  useWebSocketEvent('reading:partner_reconnected', handlePartnerReconnect);

  /* Incoming chat messages pushed by the server (chat readings). */
  const handleIncomingMessage = useCallback(
    (payload: unknown) => {
      const p = (payload ?? {}) as {
        readingId?: number;
        message?: { senderId: number; content: string; timestamp: number };
      };
      if (readingIdNum == null || p.readingId !== readingIdNum || !p.message) return;
      // Our own messages are appended locally on send — only add the peer's.
      if (user && p.message.senderId === user.id) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `${p.message!.timestamp}-${p.message!.senderId}`,
          senderId: p.message!.senderId,
          content: p.message!.content,
          timestamp: p.message!.timestamp,
        },
      ]);
    },
    [readingIdNum, user],
  );
  useWebSocketEvent('reading:message', handleIncomingMessage);

  /* Peer announced their SFU tracks — pull them immediately. */
  const handleRtcPeer = useCallback(
    (payload: unknown) => {
      const p = (payload ?? {}) as { readingId?: number; peer?: AnnouncedPeer };
      if (readingIdNum == null || p.readingId !== readingIdNum || !p.peer) return;
      void rtcClientRef.current?.pullPeer(p.peer).catch(() => {});
    },
    [readingIdNum],
  );
  useWebSocketEvent('reading:rtc_peer', handleRtcPeer);

  /* Low-balance client-side warning when < 2 minutes of runway remains */
  const lowBalanceWarning = useMemo(() => {
    if (!user || !reading || summary) return null;
    if (reading.ratePerMinute <= 0) return null;
    const remainingCents = Math.max(0, user.balance - Math.round(cost));
    const minutesLeft = remainingCents / reading.ratePerMinute;
    if (minutesLeft < 2) return { minutesLeft, remainingCents };
    return null;
  }, [user, reading, cost, summary]);

  /* ── Send chat message ── */
  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!reading || !user) return;

      // Add to local messages immediately
      const msg: ChatMessage = {
        id: `${Date.now()}-local`,
        senderId: user.id,
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg]);

      // Send via API — stores it in the transcript and pushes it to the
      // other participant over the WebSocket.
      try {
        await apiService.post(`/api/readings/${reading.id}/message`, {
          content: text,
        });
      } catch {
        addToast('error', 'Failed to send message');
      }
    },
    [reading, user, addToast]
  );

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      rtcClientRef.current?.setAudioEnabled(!next);
      return next;
    });
  }, []);

  const handleToggleCamera = useCallback(() => {
    setIsCameraOff((prev) => {
      const next = !prev;
      rtcClientRef.current?.setVideoEnabled(!next);
      return next;
    });
  }, []);

  /* ── End session ── */
  const handleEndSession = useCallback(async () => {
    if (!reading) return;
    setEnding(true);
    try {
      const result = await apiService.post<{
        duration: number;
        totalCost: number;
        ratePerMinute: number;
      }>(`/api/readings/${reading.id}/end`);

      clearInterval(timerRef.current);
      // Server returns financial fields in cents; convert to dollars for
      // PostSessionSummary (which uses formatCost that expects dollars).
      setSummary({
        duration: result.duration,
        totalCost: result.totalCost / 100,
        ratePerMinute: result.ratePerMinute / 100,
      });
      setShowEndConfirm(false);
    } catch {
      addToast('error', 'Failed to end session');
    } finally {
      setEnding(false);
    }
  }, [reading, addToast]);

  /* ── Guards ── */
  if (!isAuthenticated || !user) {
    return (
      <div className="page-enter">
        <div className="container">
          <EmptyState
            icon="🔒"
            title="Sign In Required"
            description="You must be signed in to join a reading session."
            action={{ label: 'Sign In', onClick: () => navigate('/login') }}
          />
        </div>
      </div>
    );
  }

  if (pageLoading) return <LoadingPage message="Preparing your reading session..." />;

  if (error || !reading) {
    return (
      <div className="page-enter">
        <div className="container">
          <EmptyState
            icon="🔮"
            title="Session Not Found"
            description={error || 'This reading session could not be loaded.'}
            action={{ label: 'Go to Dashboard', onClick: () => navigate('/dashboard') }}
          />
        </div>
      </div>
    );
  }

  /* ── Post-session summary ── */
  if (summary) {
    return (
      <div className="page-enter">
        <div className="container">
          <section className="section">
            <PostSessionSummary
              summary={summary}
              readingId={reading.id}
              onDone={() => navigate('/dashboard')}
            />
          </section>
        </div>
      </div>
    );
  }

  const readingTypeLabel = reading.type.charAt(0).toUpperCase() + reading.type.slice(1);

  return (
    <div className="page-enter">
      <div className="container container--narrow">
        {/* ── Header ── */}
        <section className="section" style={{ paddingBottom: 0 }}>
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h1 className="heading-3">
                {readingTypeLabel} Reading
              </h1>
              <ConnectionStatus state={connectionState} />
            </div>
            <Button
              variant="danger"
              onClick={() => setShowEndConfirm(true)}
              aria-label="End reading session"
            >
              End Session
            </Button>
          </div>
        </section>

        {/* ── Session Bar ── */}
        <section className="section" style={{ paddingTop: 'var(--space-4)' }}>
          <SessionBar
            elapsed={elapsed}
            costCents={cost}
            balanceCents={user.accountBalance}
            rateCents={reading.ratePerMinute}
          />
        </section>

        {/* ── Low-balance warning (< 2 min of runway) ── */}
        {lowBalanceWarning && (
          <div className="card card--glow-gold text-center" role="alert">
            <div className="flex flex-col gap-2 items-center">
              <span className="empty-state__icon" aria-hidden="true">⚠️</span>
              <p className="body-text">
                Only{' '}
                <strong>
                  {Math.max(0, lowBalanceWarning.minutesLeft).toFixed(1)} min
                </strong>{' '}
                of balance remaining. Your session will end automatically when
                your balance runs out.
              </p>
            </div>
          </div>
        )}

        {/* ── Reconnecting / Disconnected UI ── */}
        {(connectionState === 'reconnecting' || connectionState === 'disconnected') && (
          <div className="card card--glow-pink text-center" role="status">
            <div className="flex flex-col gap-3 items-center">
              <span className="empty-state__icon" aria-hidden="true">⚠️</span>
              <p className="body-text">
                {connectionState === 'reconnecting'
                  ? 'The other party disconnected. Holding the session for up to 2 minutes…'
                  : 'Connection lost. The session timer has paused.'}
              </p>
              {connectionState === 'disconnected' && (
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Reconnect
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Reading Content ── */}
        <section className="section">
          {reading.type === 'chat' && (
            <ChatMode
              messages={messages}
              userId={user.id}
              onSend={handleSendMessage}
            />
          )}
          {reading.type === 'voice' && (
            <>
              {/* Remote party's audio (voice readings have no video element). */}
              <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
              <VoiceMode
                isMuted={isMuted}
                onToggleMute={handleToggleMute}
                onEnd={() => setShowEndConfirm(true)}
                connectionState={connectionState}
              />
            </>
          )}
          {reading.type === 'video' && (
            <VideoMode
              localVideoRef={localVideoRef}
              remoteVideoRef={remoteVideoRef}
              hasRemoteStream={remoteStream !== null}
              isMuted={isMuted}
              isCameraOff={isCameraOff}
              onToggleMute={handleToggleMute}
              onToggleCamera={handleToggleCamera}
              onEnd={() => setShowEndConfirm(true)}
            />
          )}
        </section>

        {/* ── End Confirmation ── */}
        <ConfirmDialog
          open={showEndConfirm}
          onClose={() => setShowEndConfirm(false)}
          onConfirm={handleEndSession}
          title="End Reading Session?"
          message={`You've been in this ${readingTypeLabel.toLowerCase()} reading for ${formatTime(elapsed)}. Your total will be ${formatCost(cost / 100)}. Are you sure you want to end the session?`}
          confirmLabel="End Session"
          cancelLabel="Continue Reading"
          variant="danger"
          loading={ending}
        />
      </div>
    </div>
  );
}
