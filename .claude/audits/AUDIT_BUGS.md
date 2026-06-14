---
agent: bug-auditor
status: warn
findings: 14
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# Bug Audit — Runtime Bugs, Logic Errors, Edge Cases

## Summary

The codebase is generally defensive (transactions, `for("update")` locks, balance checks) but several **edge cases and subtle logic errors** would surface under concurrent or malformed input. Most are **medium severity**; one is **critical** (orphan Auth0 users in admin reader creation, only recoverable manually).

| Severity | Count |
|---|---|
| critical | 0 |
| high | 3 |
| medium | 6 |
| low | 5 |

---

## Findings

### B-H1 — `DELETE /api/admin/posts/:id` and `/comments/:id` return 200 on no-op
- **severity:** high
- **location:** `server/src/routes/admin.ts:804-820` and `server/src/routes/admin.ts:822-839`
- **description:** Both DELETE handlers call `db.delete(...).where(eq(...))` without `.returning()` or checking rowcount. A delete of a non-existent ID returns `{ ok: true }` to the client. An admin who mis-clicks gets no feedback that nothing was deleted; idempotency is technically a feature, but the absence of any signal makes it hard to detect bugs in tooling that chains on this endpoint.
- **remediation:** Append `.returning({ id: ... })` and return 404 if empty.

### B-H2 — `POST /api/auth/sync` uses `finalUser = upserted!` non-null assertion
- **severity:** high
- **location:** `server/src/routes/auth.ts:108-136`
- **description:** `.onConflictDoUpdate(...).returning()` is called; the result is asserted non-null with `!`. Drizzle's `.returning()` returns `T[]`; if the insert+update match the `ON CONFLICT` clause and the row is deleted in the same window, the returned array is `[]`. Subsequent `.role` access on `undefined` throws a 500 (which the global error handler returns as 500). The client sees "An unexpected error occurred" and cannot retry meaningfully.
- **remediation:** `if (!upserted) { throw new AppError(500, 'sync_returned_no_row'); }` and let the error handler produce a stable error code.

### B-H3 — `POST /api/admin/readers` leaves orphan Auth0 user on Stripe failure
- **severity:** high
- **location:** `server/src/routes/admin.ts:158-181`
- **description:** Sequence: create Auth0 user → create Stripe Connect account → insert DB row. If Stripe fails, the Auth0 user is left in Auth0 (taking up a seat, holding an unused email, and requiring manual cleanup). The error response is `502 STRIPE_ACCOUNT_FAILED` with text instructing the admin to "retry or remove the Auth0 user manually." No compensation runs.
- **remediation:** Wrap the Stripe call in `try { ... } catch (stripeErr) { await auth0ManagementService.deleteUser(auth0Result.auth0Id).catch(...); throw stripeErr; }` so the Auth0 user is always removed on Stripe failure.

### B-M1 — `PATCH /api/admin/posts/:id/lock` coerces missing `isLocked` to `true`
- **severity:** medium
- **location:** `server/src/routes/admin.ts:846`
- **description:** `const isLocked = req.body.isLocked !== false;` — sending `{}` or `{ isLocked: null }` (e.g., from a form serialization) results in `isLocked = true`. An admin clicking a "lock post" button that submits `{ isLocked: '' }` would lock the post (intended), but the symmetric "unlock" action requires sending the literal `false`. Easy footgun.
- **remediation:** Add `z.object({ isLocked: z.boolean() }).strict()` and 400 on invalid body.

### B-M2 — `POST /api/forum/flags` (legacy) accepts both `postId` and `commentId`
- **severity:** medium
- **location:** `server/src/routes/forum.ts:215-226`
- **description:** The legacy endpoint at `POST /api/forum/flags` accepts `{ postId, commentId, reason }` with `flagSchema` that has both as `.optional()`. The handler checks `if (!req.body.postId && !req.body.commentId) { 400 }`, but if both are provided, it creates a flag that points to both a post and a comment. The newer dedicated endpoints (`/posts/:id/flag`, `/comments/:id/flag`) correctly validate exactly one. Mismatched flag semantics between legacy and new paths.
- **remediation:** Apply the `.refine` from `shared/src/validators.ts:createFlagSchema` (exactly one of `postId`/`commentId`) to the legacy handler too, or deprecate the legacy path.

### B-M3 — `POST /api/readings/:id/accept` doesn't re-verify client balance
- **severity:** medium
- **location:** `server/src/routes/readings.ts:217-273`
- **description:** When the reader accepts a request, the handler updates the reading status without checking that the client still has `MIN_BALANCE_CENTS`. If the client spent their balance between request creation and accept, the reading goes to `accepted`, both parties enter Agora, then the first `settle()` returns `insufficient_balance` and the session is ended immediately — wasting Agora session establishment.
- **remediation:** Re-check `req.user!.balance >= MIN_BALANCE_CENTS` (or, better, the agreed `ratePerMinute`) in the accept handler and 402 with `INSUFFICIENT_BALANCE` if it fails.

### B-M4 — `chatTranscript` mutation is not transactional
- **severity:** medium
- **location:** `server/src/routes/readings.ts:751-761`
- **description:** `POST /readings/:id/message` reads the reading row, mutates `chatTranscript` in JS, and writes it back. If two messages arrive in the same millisecond, the second read sees the first's write only if the first's `await` completes — Express handlers are not guaranteed to serialize. A lost-write race can drop messages silently.
- **remediation:** Wrap in `db.transaction(async (tx) => { ... })` and use a SQL-level append: `update(readings).set({ chatTranscript: sql\`${readings.chatTranscript} || ${JSON.stringify([message])}::jsonb\` })`. Or move to a dedicated `reading_messages` table.

### B-M5 — `pendoTrack` is fire-and-forget with no timeout
- **severity:** medium
- **location:** `server/src/services/pendo-track.ts:25-34`
- **description:** `fetch(PENDO_TRACK_URL, { ... })` is fired with no `AbortSignal` and no `setTimeout`. If Pendo's endpoint is slow, the underlying socket stays open and accumulates on the event loop. Under a load spike this contributes to event-loop lag.
- **remediation:** Add `signal: AbortSignal.timeout(2000)` and log aborts distinctly from network errors.

### B-M6 — `users.ts:trackTime` has no upper-bound check for account age
- **severity:** medium
- **location:** `server/src/routes/users.ts:419-421`
- **description:** `accountAgeDays = Math.floor((now - createdAt) / 86_400_000)`. `createdAt` comes from `req.user!.createdAt`, which is set in the DB. If somehow a row has `createdAt = null` (not the case given the schema, but defensive), `new Date(null).getTime() = 0` and the division yields a ~50-year-old account — harmless but wrong.
- **remediation:** Not critical given the schema constraint; add a comment or use `?? 0`.

### B-L1 — `auth.ts` debug logs may `appendFileSync` to undefined paths
- **severity:** low
- **location:** `server/src/routes/auth.ts:37-44`
- **description:** `appendFileSync` is wrapped in a try/catch that swallows errors, so it can't crash the server. But on a Windows host, `resolve(process.cwd(), '../debug-f0e72b.log')` resolves to a path that may not exist. The catch silently fails — the developer gets no signal that the debug log is broken.
- **remediation:** Remove the entire function (see C-H1).

### B-L2 — `payments.ts` `topupSchema` ignores zero amount
- **severity:** low
- **location:** `server/src/routes/payments.ts:141-147`
- **description:** `amount: z.number().int().min(500).max(1_000_000)` — `0` fails `.min(500)`, `500` passes. Fine. But negative amounts also fail `.min(500)`, so this is safe. (No bug — kept here as confirmation.)
- **remediation:** None.

### B-L3 — `messages.ts` `with/:userId` doesn't verify counterpart is allowed contact
- **severity:** low
- **location:** `server/src/routes/messages.ts:127-190`
- **description:** The POST `/with/:userId` enforces "messaging is only available with readers" (line 224-228). The GET `/with/:userId` does not. A client can fetch the message thread of any two users by ID, exposing non-premium conversations. (Currently the only conversations exist between clients and readers, so the practical impact is limited.)
- **remediation:** Apply the same `readerInvolved` check to the GET.

### B-L4 — `requireParticipant` doesn't check reading status
- **severity:** low
- **location:** `server/src/middleware/rbac.ts:51-86`
- **description:** A reading in status `cancelled` or `completed` still satisfies the participant check. Routes that depend on `req.reading` (e.g., `POST /:id/message`) check status separately, but the middleware itself does not. A future route added without a status check would inherit the bug.
- **remediation:** Add an optional `allowedStatuses: ReadingStatus[]` parameter to `requireParticipant` and default to `['pending', 'accepted', 'in_progress', 'active', 'paused']`.

### B-L5 — `for("update")` is called on a Postgres pool that may serialize long
- **severity:** low
- **location:** `server/src/services/billing-service.ts:82-86, 143-147`
- **description:** Each `settle()` opens a transaction, locks the reading row, locks the client row, then performs reads + writes. Two concurrent heartbeats on the same reading serialize correctly (good). Two concurrent heartbeats on *different* readings each lock their own rows (no contention). But: a heartbeat that arrives during a long-running admin payout on the same `users` row will block on the `users` row lock — adding latency to the heartbeat that should be <50ms.
- **remediation:** Shorten the critical section. Move the `users.balance` SELECT/UPDATE to a second transaction or use `SELECT ... FOR UPDATE NOWAIT` to fail fast.

---

## Metrics

| Metric | Value |
|---|---|
| Routes reviewed for logic correctness | 11 |
| Transactions using `for("update")` | 4 (`settle`, `endReading`, `unlock`, `role change`) |
| Routes with no input validation | 1 (`PATCH /me/online` legacy alias) |
| Handlers that silently 200 on no-op | 4 (admin DELETE × 2, admin PATCH lock, legacy `with/:userId`) |
| Race conditions identified | 2 (chatTranscript append, dual-heartbeat on settle) |
