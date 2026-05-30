import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ToastProvider';
import { apiService } from '../../services/api';
import { Avatar, Button, Card, Spinner, Textarea, EmptyState } from '../../components/ui';

interface Counterpart {
  id: number;
  fullName: string | null;
  username: string | null;
  profileImage: string | null;
  role: 'client' | 'reader' | 'admin';
}

interface Conversation {
  counterpart: Counterpart;
  unread: number;
  lastMessage: {
    id: number;
    senderId: number;
    preview: string | null;
    isLocked: boolean;
    priceCents: number;
    createdAt: string;
  };
}

interface ThreadMessage {
  id: number;
  senderId: number;
  recipientId: number;
  content: string | null;
  priceCents: number;
  isLocked: boolean;
  isUnlocked: boolean;
  requiresPayment: boolean;
  readAt: string | null;
  createdAt: string;
}

interface Thread {
  counterpart: Counterpart;
  messages: ThreadMessage[];
}

const CONVERSATIONS_POLL_MS = 12_000;
const THREAD_POLL_MS = 8_000;

function displayName(c: Counterpart | null): string {
  if (!c) return 'Conversation';
  return c.fullName || c.username || (c.role === 'reader' ? 'Reader' : 'Client');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function MessagesPage() {
  const { user, isAuthenticated, isLoading, login, refreshUser } = useAuth();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [charge, setCharge] = useState(false);
  const [priceDollars, setPriceDollars] = useState('5.00');
  const [unlockingId, setUnlockingId] = useState<number | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const isReader = user?.role === 'reader';

  // Seed the selected conversation from ?to=<userId> (e.g. "Message" button).
  useEffect(() => {
    const to = searchParams.get('to');
    if (to) {
      const id = parseInt(to, 10);
      if (!isNaN(id)) setSelectedId(id);
    }
  }, [searchParams]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiService.get<Conversation[]>('/api/messages/conversations');
      setConversations(data);
    } catch {
      /* transient — keep last good list */
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadThread = useCallback(async (otherId: number, showSpinner = false) => {
    if (showSpinner) setLoadingThread(true);
    try {
      const data = await apiService.get<Thread>(`/api/messages/with/${otherId}`);
      setThread(data);
    } catch {
      /* transient */
    } finally {
      setLoadingThread(false);
    }
  }, []);

  // Poll the conversation list.
  useEffect(() => {
    if (!isAuthenticated) return;
    void loadConversations();
    const t = setInterval(() => void loadConversations(), CONVERSATIONS_POLL_MS);
    return () => clearInterval(t);
  }, [isAuthenticated, loadConversations]);

  // Load + poll the open thread.
  useEffect(() => {
    if (!isAuthenticated || selectedId == null) {
      setThread(null);
      return;
    }
    void loadThread(selectedId, true);
    const t = setInterval(() => void loadThread(selectedId), THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [isAuthenticated, selectedId, loadThread]);

  // Auto-scroll to newest message.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages.length, selectedId]);

  const handleSelect = useCallback(
    (id: number) => {
      setSelectedId(id);
      if (searchParams.get('to')) {
        searchParams.delete('to');
        setSearchParams(searchParams, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const handleSend = useCallback(async () => {
    if (selectedId == null || !draft.trim() || sending) return;
    setSending(true);
    try {
      let priceCents = 0;
      if (isReader && charge) {
        const dollars = parseFloat(priceDollars);
        if (isNaN(dollars) || dollars <= 0) {
          addToast('error', 'Enter a valid charge amount.');
          setSending(false);
          return;
        }
        priceCents = Math.round(dollars * 100);
      }
      await apiService.post(`/api/messages/with/${selectedId}`, {
        content: draft.trim(),
        priceCents,
      });
      setDraft('');
      await Promise.all([loadThread(selectedId), loadConversations()]);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }, [
    selectedId,
    draft,
    sending,
    isReader,
    charge,
    priceDollars,
    addToast,
    loadThread,
    loadConversations,
  ]);

  const handleUnlock = useCallback(
    async (m: ThreadMessage) => {
      if (unlockingId) return;
      setUnlockingId(m.id);
      try {
        await apiService.post(`/api/messages/${m.id}/unlock`);
        addToast('success', 'Message unlocked.');
        await Promise.all([
          loadThread(selectedId!),
          loadConversations(),
          Promise.resolve(refreshUser?.()),
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to unlock message.';
        addToast('error', msg);
      } finally {
        setUnlockingId(null);
      }
    },
    [unlockingId, selectedId, addToast, loadThread, loadConversations, refreshUser],
  );

  const balanceLabel = useMemo(
    () => (user ? `$${(user.accountBalance / 100).toFixed(2)}` : '$0.00'),
    [user],
  );

  if (isLoading) {
    return (
      <div className="container" style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
        <Spinner />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="page-enter container">
        <EmptyState
          title="Sign in to view your messages"
          description="Message any reader for free. Readers may charge to unlock a reply."
          action={{ label: 'Sign In', onClick: () => login() }}
        />
      </div>
    );
  }

  return (
    <div className="page-enter container messages-page">
      <section className="section section--hero">
        <h1 className="heading-2">Messages</h1>
        <div className="divider" />
        <p className="messages-balance">
          Balance: <strong>{balanceLabel}</strong>
        </p>
      </section>

      <div className="messages-layout">
        {/* Conversation list */}
        <Card className="messages-list" padding="none">
          {loadingList ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: '2rem' }}>
              <Spinner />
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: '1.5rem' }}>
              <p className="text-muted">
                No conversations yet. Open a reader's profile and tap “Message” to start one.
              </p>
            </div>
          ) : (
            <ul className="messages-conv-list">
              {conversations.map((c) => (
                <li key={c.counterpart.id}>
                  <button
                    type="button"
                    className={`messages-conv ${selectedId === c.counterpart.id ? 'messages-conv--active' : ''}`}
                    onClick={() => handleSelect(c.counterpart.id)}
                  >
                    <Avatar
                      src={c.counterpart.profileImage ?? undefined}
                      name={displayName(c.counterpart)}
                      size="sm"
                    />
                    <span className="messages-conv__body">
                      <span className="messages-conv__name">
                        {displayName(c.counterpart)}
                        {c.counterpart.role === 'reader' && (
                          <span className="messages-conv__role"> · Reader</span>
                        )}
                      </span>
                      <span className="messages-conv__preview">
                        {c.lastMessage.isLocked
                          ? `🔒 Paid message · $${(c.lastMessage.priceCents / 100).toFixed(2)}`
                          : c.lastMessage.preview ?? '—'}
                      </span>
                    </span>
                    <span className="messages-conv__meta">
                      <span className="messages-conv__time">
                        {formatTime(c.lastMessage.createdAt)}
                      </span>
                      {c.unread > 0 && (
                        <span className="messages-conv__badge">{c.unread}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Thread */}
        <Card className="messages-thread" padding="none">
          {selectedId == null ? (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: '40vh', padding: '2rem' }}>
              <p className="text-muted">Select a conversation to start messaging.</p>
            </div>
          ) : (
            <>
              <div className="messages-thread__header">
                <Avatar
                  src={thread?.counterpart.profileImage ?? undefined}
                  name={displayName(thread?.counterpart ?? null)}
                  size="sm"
                />
                <span className="messages-thread__name">
                  {displayName(thread?.counterpart ?? null)}
                </span>
              </div>

              <div className="messages-thread__body">
                {loadingThread && !thread ? (
                  <div style={{ display: 'grid', placeItems: 'center', padding: '2rem' }}>
                    <Spinner />
                  </div>
                ) : thread && thread.messages.length > 0 ? (
                  thread.messages.map((m) => {
                    const mine = m.senderId === user.id;
                    return (
                      <div
                        key={m.id}
                        className={`messages-bubble ${mine ? 'messages-bubble--mine' : ''}`}
                      >
                        {m.requiresPayment ? (
                          <div className="messages-bubble__locked">
                            <p className="messages-bubble__locked-title">
                              🔒 Paid message
                            </p>
                            <p className="messages-bubble__locked-sub">
                              Unlock to read this reply.
                            </p>
                            <Button
                              size="sm"
                              variant="primary"
                              loading={unlockingId === m.id}
                              onClick={() => handleUnlock(m)}
                            >
                              Unlock for ${(m.priceCents / 100).toFixed(2)}
                            </Button>
                          </div>
                        ) : (
                          <>
                            <p className="messages-bubble__text">{m.content}</p>
                            {m.priceCents > 0 && (
                              <span className="messages-bubble__paid">
                                Paid · ${(m.priceCents / 100).toFixed(2)}
                              </span>
                            )}
                          </>
                        )}
                        <span className="messages-bubble__time">
                          {formatTime(m.createdAt)}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-muted" style={{ padding: '1rem' }}>
                    No messages yet. Say hello!
                  </p>
                )}
                <div ref={threadEndRef} />
              </div>

              <div className="messages-composer">
                {isReader && (
                  <div className="messages-composer__charge">
                    <label className="messages-composer__charge-toggle">
                      <input
                        type="checkbox"
                        checked={charge}
                        onChange={(e) => setCharge(e.target.checked)}
                      />
                      Charge to read this reply
                    </label>
                    {charge && (
                      <span className="messages-composer__price">
                        $
                        <input
                          type="number"
                          min="0.50"
                          step="0.50"
                          value={priceDollars}
                          onChange={(e) => setPriceDollars(e.target.value)}
                          className="messages-composer__price-input"
                          aria-label="Charge amount in dollars"
                        />
                      </span>
                    )}
                  </div>
                )}
                <div className="messages-composer__row">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      isReader
                        ? 'Write your reply…'
                        : 'Message this reader for free…'
                    }
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                  />
                  <Button
                    variant="primary"
                    loading={sending}
                    disabled={!draft.trim()}
                    onClick={() => void handleSend()}
                  >
                    Send
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default MessagesPage;
