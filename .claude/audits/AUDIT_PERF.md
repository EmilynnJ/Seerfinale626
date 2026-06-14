---
agent: perf-auditor
status: warn
findings: 10
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# Performance Audit — Bundle, Render, Memory

## Summary

The Vite-based client has a reasonable build setup; the Express server uses `pino` (fast logger) and Drizzle (compile-time-checked, no runtime reflection). However, several **rendering hot-paths**, **chat-transcript JSONB writes**, and **WS reconnect storms** could become bottlenecks at scale.

| Severity | Count |
|---|---|
| critical | 0 |
| high | 2 |
| medium | 5 |
| low | 3 |

---

## Findings

### P-H1 — `chatTranscript` is read-mutated-written on every chat message
- **severity:** high
- **location:** `server/src/routes/readings.ts:751-761`
- **description:** Every `POST /readings/:id/message` does:
  ```ts
  const currentTranscript = (reading.chatTranscript as any[]) ?? [];
  currentTranscript.push(message);
  await db.update(readings).set({ chatTranscript: currentTranscript, ... });
  ```
  - O(N) read where N = number of messages so far
  - O(N) write of the full JSONB
  - Implicit row lock (Drizzle uses a transaction; the row is locked for the duration of the read-mutate-write window)
  - For a 60-min session with 30 msg/min, the 1800th message writes ~360KB and locks the row for the duration of the write. Concurrent readers (the other participant's WebSocket message handler) see stale data.
- **remediation:** Move chat to a `reading_messages` table (see DB-H2). Append with a single `INSERT`, return the new row.

### P-H2 — Vercel `maxDuration: 30` on `api/index.ts` may not be enough for a long heartbeat
- **severity:** high
- **location:** `vercel.json:7-11`
- **description:** The Vercel function has a 30-second timeout. The heartbeat handler in `readings.ts:430-459` calls `billingService.onHeartbeat()` which calls `sweepStale()`. The sweep queries stale readings platform-wide. If the readings table is large, this could exceed 30s. The next heartbeat would 504 and the client would disconnect, but billing is server-driven so the next user heartbeat will retry. Still, a 504 mid-billing is a bad UX.
- **remediation:** Move `sweepStale` to a Fly-only periodic task (e.g., `setInterval` in `index.ts` when running on Fly), not in the heartbeat hot-path. Or: bound the sweep (limit to 100 readings per heartbeat).

### P-M1 — `useReaders` polls every 30s on the homepage
- **severity:** medium
- **location:** `client/src/pages/HomePage.tsx:84`
- **description:** `useReaders({ onlineOnly: true, pollInterval: 30000 })` — every 30 seconds, the homepage re-fetches the full online-readers list. This is the build-guide's documented behavior, but the WS service already broadcasts reader online/offline events. Using WS for this would eliminate the poll.
- **remediation:** Add a `reader:online` / `reader:offline` WS event from the reader-status PATCH, and have `useReaders` subscribe instead of polling.

### P-M2 — `pendoTrack` fires on every state change with full payload
- **severity:** medium
- **location:** `server/src/services/pendo-track.ts:10-34`
- **description:** Every `pendoTrack(...)` call is a separate `fetch()` to Pendo. At peak, that's many in-flight requests. Pendo's ingest endpoint has a rate limit; if exceeded, the calls fail silently (the `.catch` swallows). The fire-and-forget pattern + the missing `AbortSignal.timeout` means sockets can stay open.
- **remediation:** Batch events with a small in-memory queue flushed every 5s or every 50 events, whichever comes first. Add a per-event timeout.

### P-M3 — `useAuth` and `useWebSocket` re-render on every auth state change
- **severity:** medium
- **location:** `client/src/contexts/AuthContext.tsx`, `client/src/contexts/WebSocketContext.tsx`
- **description:** The auth context re-renders the entire app tree on every `refreshUser()` call. With `pendo.identify` running on every state change, and a `debugLog` (see S-C1) on every state change, the cost per refresh adds up. The `WebSocketContext` similarly broadcasts to all subscribers on every message; a noisy event like `reading:message` re-renders all reading-session components.
- **remediation:** Memoize the `value` object in `AuthContext.Provider` with `useMemo`. In `WebSocketContext`, throttle high-frequency events (chat messages) to a max of 1 render per 100ms with `useDeferredValue` or `startTransition`.

### P-M4 — `messages.ts:conversations` loads up to 500 rows in memory
- **severity:** medium
- **location:** `server/src/routes/messages.ts:42-124`
- **description:** Every page load of the messages inbox reads 500 messages into Node memory, sorts, and folds. For a power user with 100+ active conversations, this is wasteful. A single `GROUP BY` with a window function would do.
- **remediation:** Refactor to a single SQL query that returns the last message per counterpart:
  ```sql
  SELECT DISTINCT ON (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id)) *
  FROM messages
  WHERE sender_id = $1 OR recipient_id = $1
  ORDER BY LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC;
  ```
  Add a composite index on `(sender_id, recipient_id, created_at DESC)`.

### P-M5 — `useEffect` cleanup in `WebSocketContext` may leak on fast unmount
- **severity:** medium
- **location:** `client/src/contexts/WebSocketContext.tsx:201-233`
- **description:** The `connect()` callback is created on every render. The `useEffect` that triggers `connect()` depends on `[isAuthenticated, user, connect]`. Every time the user object changes (refresh, role change), the effect re-runs. If a connection is in flight (`new WebSocket(url)` but `open` not yet fired), closing the old `wsRef.current` and assigning a new one orphans the in-flight handshake. The browser will GC the old socket but the server will briefly hold an `AuthenticatedSocket` for a user who has already navigated away.
- **remediation:** Use a ref for `connect` so the effect doesn't re-fire on every callback change. Or wrap the connect in a singleton pattern with a single ref.

### P-L1 — `pendo.initialize({ visitor: { id: '' } })` runs unconditionally at module load
- **severity:** low
- **location:** `client/src/main.tsx:7-11`
- **description:** A no-op `pendo.initialize` adds a small startup cost and pollutes Pendo's session log with empty-visitor events. Should be deferred to after `AuthProvider` resolves the user.
- **remediation:** Remove the top-level `pendo.initialize`. Call it from `AuthContext` after `setUser(userData)`.

### P-L2 — `global.css` and `pages.css` loaded synchronously
- **severity:** low
- **location:** `client/src/main.tsx:4-5`
- **description:** Two CSS files imported synchronously. Vite will inline them into the initial HTML if small enough. For ~50KB+ of CSS this is fine, but if the cosmic theme grows it will block first paint.
- **remediation:** If the CSS grows past ~50KB, code-split per page and lazy-load. Otherwise, no action.

### P-L3 — `cosmic-background` and `cosmic-bg` animations may cause repaints
- **severity:** low
- **location:** `client/src/components/CosmicBackground.tsx`
- **description:** Continuous animations (twinkling stars, parallax) cause repaints on every frame. Combined with `prefers-reduced-motion` not being honored, this is a perf cost on low-end devices.
- **remediation:** Use `transform` and `opacity` (GPU-accelerated) rather than `top`/`left`/`background-position`. Disable on `prefers-reduced-motion`.

---

## Bundle Size Estimates (heuristic, no build run)

| Bundle | Approx size (gzip) | Notes |
|---|---|---|
| Auth0 React SDK | ~25KB | `@auth0/auth0-react@2.2.4` |
| Stripe.js + React | ~50KB | `@stripe/stripe-js@9`, `@stripe/react-stripe-js@6` |
| Agora RTC SDK | ~250KB | `agora-rtc-sdk-ng@4.20.0` (large; loaded on /reading/* only?) |
| Agora RTM SDK | ~80KB | `agora-rtm-sdk@2.1.0` |
| React + ReactDOM | ~45KB | `react@18.3.1` |
| React Router | ~15KB | `react-router-dom@6.30.4` |
| Pendo agent | ~30KB (lazy) | loaded by index.html script tag |
| **Total (rough)** | **~500KB gzipped** | Within budget but Agora is the largest item |

The Agora SDKs are the biggest single dependency. Lazy-load them on the `ReadingSessionPage` to keep the initial bundle small.

---

## Metrics

| Metric | Value |
|---|---|
| Polling intervals | 1 (`useReaders` at 30s) |
| WS reconnect backoff | Exponential, 1s → 30s cap (`RECONNECT_INITIAL_MS`, `RECONNECT_MAX_MS`) — good |
| Bundle dependencies | 6 runtime (Auth0, Stripe, Agora, React, Router, Pendo) |
| Server hot-paths per heartbeat | 2 (settle, sweepStale) |
| DB writes per chat message | 1 (full JSONB rewrite) |
| Vite production build | Not verified — run `npm run build` to measure |
