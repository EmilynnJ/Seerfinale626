---
agent: db-auditor
status: warn
findings: 11
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# Database Audit — N+1, Indexes, Schema, Migrations

## Summary

The Drizzle schema is well-designed: consistent enums, foreign keys, unique indexes on natural keys (`auth0Id`, `email`), and named indexes on common query columns. The transactional patterns in the billing service are correct (row-level locks, idempotency on Stripe events). However, several **missing indexes, N+1 patterns, and schema improvements** would matter at scale.

| Severity | Count |
|---|---|
| critical | 0 |
| high | 2 |
| medium | 5 |
| low | 4 |

---

## Findings

### DB-H1 — Missing composite index on `readings(status, lastHeartbeat)` for `sweepStale`
- **severity:** high
- **location:** `shared/src/schema.ts:114-170` and `server/src/services/billing-service.ts:230-249`
- **description:** `sweepStale()` runs every heartbeat (i.e., every ~30s for every active reading, multiplied by N concurrent readers) with:
  ```sql
  SELECT id FROM readings WHERE status = 'active' AND lastHeartbeat < $1;
  ```
  The schema defines a single-column `readings_status_idx` on `status` (`schema.ts:168`). Postgres can use the single-column index and then filter, but a composite `(status, lastHeartbeat)` would let it index-range-scan directly to the cutoff, especially as the table grows.
- **remediation:** Add `statusLastHeartbeatIdx: index('readings_status_last_heartbeat_idx').on(table.status, table.lastHeartbeat)` in the readings table. Generate a migration.

### DB-H2 — `chatTranscript` is unbounded JSONB; should be a separate table
- **severity:** high
- **location:** `shared/src/schema.ts:148`, `server/src/routes/readings.ts:751-761`
- **description:** `chatTranscript: jsonb('chat_transcript')` is read-mutated-written on every chat message. A 60-minute chat session with 30 messages/minute produces ~1,800 messages, each ~200 bytes = ~360KB. The row grows unboundedly; a write rewrites the whole JSONB; the implicit transaction locks the row. At scale this becomes a bottleneck.
- **remediation:** Create a `reading_messages` table:
  ```ts
  export const readingMessages = pgTable('reading_messages', {
    id: serial('id').primaryKey(),
    readingId: integer('reading_id').notNull().references(() => readings.id, { onDelete: 'cascade' }),
    senderId: integer('sender_id').notNull().references(() => users.id),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }, (t) => ({
    readingCreatedIdx: index('reading_messages_reading_id_created_at_idx').on(t.readingId, t.createdAt),
  }));
  ```
  Migrate `chatTranscript` reads to `db.query.readingMessages.findMany({ where: eq(readingMessages.readingId, id), orderBy: readingMessages.createdAt })`.

### DB-M1 — Missing index on `readings.status` alone is fine, but `readings` filter by client+status missing
- **severity:** medium
- **location:** `server/src/routes/users.ts:359-368` and other reader-lookup queries
- **description:** The "active readings for this user" lookup at `users.ts:359`:
  ```sql
  SELECT id FROM readings
  WHERE (clientId = $1 OR readerId = $1)
    AND status IN ('pending','accepted','in_progress','active','paused');
  ```
  This benefits from a composite `(clientId, status)` and `(readerId, status)`. Only `clientIdIdx` and `readerIdIdx` (single-column) are defined.
- **remediation:** Add composite indexes. Postgres can usually combine single-column indexes via BitmapAnd, but a composite is faster and more deterministic.

### DB-M2 — `users.isOnline` is a boolean flag, prone to drift
- **severity:** medium
- **location:** `shared/src/schema.ts:78`, `server/src/routes/users.ts:215-252`
- **description:** `isOnline` is a per-user boolean that the reader toggles via `PATCH /api/me/online`. If a reader's session expires or the WS disconnects without a final `isOnline=false`, the flag stays `true` indefinitely. There's no liveness check.
- **remediation:** Either (a) derive online status from active WS connections (the truth), and store the last-seen timestamp instead of a boolean, or (b) add a background sweep that marks users offline if their `lastSeenAt < now() - 5min`. The build guide mentions real-time updates but does not address the offline-on-disconnect case.

### DB-M3 — `forumFlags` doesn't enforce exactly-one of (postId, commentId) at the schema level
- **severity:** medium
- **location:** `shared/src/schema.ts:317-322`
- **description:** Both `postId` and `commentId` are `.references(...)` (nullable). The DB allows rows with both NULL (orphan flag), both set (cross-flag), or neither. The application layer validates but a future bulk-insert script could violate.
- **remediation:** Add a CHECK constraint: `CHECK ((post_id IS NULL) <> (comment_id IS NULL))`. Or in Drizzle: `check('forum_flags_target_xor').on(sql`(${table.postId} IS NULL) <> (${table.commentId} IS NULL)`)`.

### DB-M4 — `messages` thread query is N+1 with respect to participants
- **severity:** medium
- **location:** `server/src/routes/messages.ts:127-190`
- **description:** The `with/:userId` query selects all messages and marks them as read. The counterpart's profile is fetched in a separate query (acceptable — single counterpart). The follow-up `/conversations` query (line 42-124) is more concerning: it loads the last 500 messages involving the user, folds them in JS, then issues a second query for the counterpart profiles. For users with 50+ active conversations and 500 messages each, this is ~50,000 rows in memory.
- **remediation:** Add an index on `(senderId, recipientId, createdAt)` and `(recipientId, senderId, createdAt)` (or rely on the existing two single-column indexes). Replace the in-memory fold with a SQL window function (`ROW_NUMBER() OVER (PARTITION BY counterpart ORDER BY created_at DESC)`).

### DB-M5 — `users` table is read-mostly; no `updatedAt` index for `ORDER BY`
- **severity:** medium
- **location:** `server/src/routes/admin.ts:78-101`, `server/src/routes/admin.ts:506-528`
- **description:** `GET /api/admin/users` orders by `createdAt DESC`. `GET /api/admin/readings` orders by `createdAt DESC`. Both are O(N log N) sorts. With < 100K rows this is fine; at 1M+ it's a problem.
- **remediation:** Add an index on `users.createdAt` (the existing single-column `users_role_idx` etc. don't help). For most admin queries at expected scale, this is premature.

### DB-M6 — `transactions` index on `(userId, createdAt)` would help transaction history
- **severity:** medium
- **location:** `shared/src/schema.ts:199-202`
- **description:** `transactions_user_id_idx` exists (single column) and `transactions_created_at_idx` does not. The list-queries (`GET /api/payments/transactions`, `GET /api/transactions`) filter by `userId` and order by `createdAt DESC`. A composite `(userId, createdAt DESC)` would let Postgres index-range-scan directly.
- **remediation:** Add `userIdCreatedAtIdx: index('transactions_user_id_created_at_idx').on(table.userId, table.createdAt)`.

### DB-L1 — `users.deletedAt` index exists; soft-delete pattern is correct
- **severity:** low
- **location:** `shared/src/schema.ts:108`
- **description:** Index is present. Soft-delete is consistent. The `users.ts:33` listing correctly adds `isNull(users.deletedAt)`. Good.
- **remediation:** None.

### DB-L2 — No DB-level CHECK on `balance >= 0`
- **severity:** low
- **location:** `shared/src/schema.ts:81`
- **description:** The application logic never lets `balance` go negative (the billing service charges in increments of `ratePerMinute` only when `Math.floor(balance / rate) >= 1`). But a buggy future migration or manual SQL could produce a negative balance. A `CHECK (balance >= 0)` would protect.
- **remediation:** Add `check('users_balance_nonneg').on(sql`${table.balance} >= 0`)`.

### DB-L3 — `readings.paymentStatus` enum includes `refunded` but no `disputed` or `partial_refund`
- **severity:** low
- **location:** `shared/src/schema.ts:41-45`
- **description:** The enum has `pending | paid | refunded`. The `validators.ts:18` schema adds `disputed`. They disagree. The build guide mentions disputes may be added.
- **remediation:** Reconcile — either add `disputed` to the DB enum (and generate a migration) or remove it from the validator. Pick one.

### DB-L4 — `messages.readAt` is set to `now` even for locked-but-not-unlocked messages on list
- **severity:** low
- **location:** `server/src/routes/messages.ts:165-181`
- **description:** The list query updates `readAt` for `(recipientId === me && readAt === null && (priceCents === 0 || isUnlocked))`. For priced messages that have not been unlocked, `readAt` is NOT set. Correct behavior — but the in-memory loop then reflects the *un*read state for those. Worth a comment explaining why.
- **remediation:** Add an inline comment.

---

## Migrations

| Item | Status |
|---|---|
| `drizzle.config.ts` | Present, points to `shared/src/schema.ts` |
| `drizzle/` migrations directory | Not present in repo (only `drizzle.config.ts`) |
| Migration history | Drizzle Kit will generate on first `db:generate`; not committed |
| Schema sync between local and prod | Relies on `npm run db:push` (per README:94) — risky for prod |

The README says:
> Deploying schema changes: the schema lives in shared/src/schema.ts and is applied with npm run db:push (Drizzle Kit). After pulling changes that add or alter tables — e.g. the premium-messaging messages table — run npm run db:push against your production DATABASE_URL before the new code is exercised, or those endpoints will return an error due to the missing table.

`db:push` is fine for early development but **not safe for production** (no rollback, no transaction, no audit). A migration-based deploy is required before any user-facing changes.

---

## Metrics

| Metric | Value |
|---|---|
| Tables | 7 (`users`, `readings`, `transactions`, `messages`, `forum_posts`, `forum_comments`, `forum_flags`, `newsletter_subscribers`) |
| Enums | 5 |
| Indexes | 17 (single-column) + 2 (composite) |
| Foreign keys | 11 (all `references()` are explicit) |
| Composite indexes | 2 (`users_auth0_id_idx` is unique, `users_email_idx` is unique — these are inherently multi-column) |
| Tables with CHECK constraints | 0 |
| Soft-delete columns | 1 (`users.deletedAt`) |
