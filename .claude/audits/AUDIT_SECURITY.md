---
agent: security-auditor
status: fail
findings: 16
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# Security Audit — OWASP, Injection, Auth, Secrets

## Summary

The platform follows **good security practices** in the auth, payments, and DB layers: helmet, CORS allowlist, rate limiting, JWT via Auth0, Stripe webhook signature verification, Zod input validation, idempotency on credit, and transactional balance updates. However, the audit found **1 critical, 4 high, and 7 medium** issues, primarily in admin endpoints, dead-code debug paths shipping to production, and missing rate limits on sensitive flows.

| Severity | Count |
|---|---|
| critical | 1 |
| high | 4 |
| medium | 7 |
| low | 4 |

---

## Findings

### S-C1 — Hardcoded dev-only debug endpoint shipped to client production bundle
- **severity:** critical
- **location:** `client/src/App.tsx:33-54`, `client/src/contexts/AuthContext.tsx:12-33`
- **description:** Two files contain:
  ```ts
  const DEBUG_ENDPOINT = 'http://127.0.0.1:7530/ingest/5d16fd92-dfa5-4af3-be5e-8af5bd6919ee';
  ```
  `debugLog()` is called on every render of `DashboardTrafficController` and on every `AuthContext` state change. In production it fails silently (no listener at `127.0.0.1:7530`), but the function still:
  1. Allocates and serializes a payload that **may include PII** (user role, internal `userData.role`, error messages)
  2. Exposes an internal session ID `f0e72b` in headers and body
  3. Reveals deployment-time information to anyone reading the bundle
  Beyond privacy, this is an **insecure-by-default anti-pattern** — any future developer could plug a real endpoint into `DEBUG_ENDPOINT` and the code would silently exfiltrate data.
- **remediation:** Delete both `DEBUG_ENDPOINT` constants and `debugLog` functions. Add a build-time Vite plugin that fails the build if either literal is present. If structured logging is wanted, use Sentry/Datadog SDKs with explicit opt-in.

### S-H1 — `POST /api/admin/balance-adjust` has no rate limit and no audit trail beyond the transactions table
- **severity:** high
- **location:** `server/src/routes/admin.ts:451-503`
- **description:** Any admin can move arbitrary sums to/from any user's balance (`amount: z.number().int()`, no min/max). The handler is reachable by any account whose `users.role === 'admin'`. While the action is recorded in the `transactions` table, there is no separate audit log capturing the *admin's identity vs. their request* beyond `transactions.userId` (which is the recipient, not the actor). A compromised admin account could drain the platform or create fake balances without leaving a clear trail.
- **remediation:**
  1. Add a `strictLimiter` (or tighter, 5 req/min) to the route
  2. Cap `amount` (e.g., ±$10,000 single adjustment, ±$50,000 daily aggregate)
  3. Add a dedicated `admin_audit_log` table (adminId, action, targetUserId, amount, ip, userAgent, timestamp)
  4. Require a confirmation token for adjustments > $500

### S-H2 — `POST /api/admin/payouts/:readerId` has no rate limit
- **severity:** high
- **location:** `server/src/routes/admin.ts:552-650`
- **description:** The Stripe transfer is performed first, then the DB balance is zeroed with an optimistic-lock update. A compromised admin could repeatedly trigger payouts to the same reader; each successful Stripe call is final. There is no rate limit and no per-admin daily cap.
- **remediation:** Apply `strictLimiter`; enforce a single payout per `(readerId, day)`; require a confirmation step (re-enter amount or token).

### S-H3 — Pendo integration key hardcoded in source
- **severity:** high
- **location:** `server/src/services/pendo-track.ts:3-4`
- **description:** The literal `3e8ba4b6-557e-47a2-aec3-09ac7185088f` is the Pendo integration key. Pendo keys are not as sensitive as Stripe or Auth0 secrets, but they identify the workspace and allow anyone with the key to ingest events. A leaked key is non-revocable without a Pendo support ticket.
- **remediation:** Move to `PENDO_INTEGRATION_KEY` env var with `z.string().default('')` in `config.ts`. Document in `.env.example`.

### S-H4 — Admin endpoints expose raw `auth0Id`, `stripeAccountId`, `stripeCustomerId`
- **severity:** high
- **location:** `server/src/routes/admin.ts:78-101` (`GET /api/admin/users`), `server/src/routes/admin.ts:804-820` (delete post)
- **description:** `GET /api/admin/users` returns the full user row, including `auth0Id` and Stripe IDs. While the route is admin-gated, the response shape is the same as the DB row, which means a frontend bug or a copy/paste into a non-admin context could leak the IDs. The same pattern leaks `authorEmail` in `GET /api/admin/forum/posts`.
- **remediation:** Use a `presentAdminUser(row)` helper that redacts `auth0Id`, `stripeAccountId`, and `stripeCustomerId`. Return PII only when explicitly required (e.g., the moderation list) and only to admins.

### S-M1 — Modulo-bias in `generatePassword` (low impact, crypto best-practice)
- **severity:** medium
- **location:** `server/src/services/auth0-management.ts:55-58`
- **description:** `chars.push(required[i]![bytes[i]! % required[i]!.length]!);` — `required[i].length` is 26/26/8/12, not powers of 2, so `bytes[i] % length` produces a non-uniform distribution (modulo bias). For 18-character passwords the bias is < 1% per character; Auth0 password policy doesn't require uniformity. Crypto-clean fix: use `crypto.randomInt(length)` (already imported on line 61 — use it everywhere).
- **remediation:** Replace `bytes[i]! % required[i]!.length` with `randomInt(required[i]!.length)`.

### S-M2 — Forum `POST /posts/:id/flag` and `/comments/:id/flag` have no rate limit
- **severity:** medium
- **location:** `server/src/routes/forum.ts:151-211`
- **description:** Any authenticated user can repeatedly flag the same post (or all posts of a target user) — no rate limit, no per-(user, content) dedup. A user with 1000 free accounts (or a single hostile user) could rack up flag counts and trigger a manual moderation queue.
- **remediation:** Apply `strictLimiter` (20 req/15min); add a unique index on `(reporterId, postId)` and `(reporterId, commentId)` to prevent duplicate flags; reject the insert on conflict (return 200 with `alreadyFlagged: true`).

### S-M3 — `GET /api/messages/with/:userId` does not enforce premium-messaging policy
- **severity:** medium
- **location:** `server/src/routes/messages.ts:127-190`
- **description:** POST `/with/:userId` enforces that at least one party is a reader (premium messaging only). GET `/with/:userId` does not — a client can fetch the thread of any other user by ID. Combined with the missing rate limit on this endpoint, enumeration is trivial.
- **remediation:** Apply the same `readerInvolved` check to GET. Apply `generalLimiter`.

### S-M4 — `POST /api/forum/flags` (legacy) accepts both `postId` and `commentId`
- **severity:** medium
- **location:** `server/src/routes/forum.ts:215-226`
- **description:** Schema is `flagSchema = { postId?, commentId?, reason }`. Validation: `if (!postId && !commentId) → 400`. If both are provided, a flag is created referencing both — semantically incorrect and harder to query for moderation.
- **remediation:** Apply `createFlagSchema` from `shared/src/validators.ts:93-99` (which uses `.refine` for exactly-one). Reject both-present with 400.

### S-M5 — Account deletion does not invalidate active sessions / sockets
- **severity:** medium
- **location:** `server/src/routes/users.ts:353-433`
- **description:** `DELETE /api/me` scrubs the DB row but does not:
  1. Call `wsService.disconnect(userId)` — the user keeps receiving WS messages until the JWT expires (1 hour)
  2. Force-set `isOnline = false` in the WS clients map (the `users.update` does it but the WS service holds its own state in `clients: Map<userId, Set<ws>>`)
  3. Notify the partner on any active/paused reading (handled by the active-reading check, but if no active reading exists, the WS service still thinks they're connected)
  A deleted user with a cached JWT could continue interacting with the system until token expiry.
- **remediation:** In `users.ts` after the scrub, call `wsService.disconnect(userId)`. Or short-circuit JWT validation in `resolveUser` to also check `users.deletedAt IS NULL`.

### S-M6 — `brevo-service` has host-pinning but URL is constructed from a string
- **severity:** medium
- **location:** `server/src/services/brevo-service.ts:54-67`
- **description:** `new URL('https://api.brevo.com/v3/smtp/email')` plus a hostname re-check (`if (url.hostname !== 'api.brevo.com') throw`) is defensive against URL-parsing surprises. The API key is sent in the `api-key` header. A future refactor that passes the URL through a config would be wise to keep the same re-check. Currently safe, but the SSRF protection is only as good as the constant string.
- **remediation:** Move the URL to `config.brevo.apiUrl` and keep the `hostname === 'api.brevo.com'` assertion. Add a test for the SSRF guard.

### S-M7 — `GET /api/admin/forum/posts` exposes `authorEmail` (PII)
- **severity:** medium
- **location:** `server/src/routes/admin.ts:730-761`
- **description:** The admin moderation list includes `authorEmail`. Necessary for "contact the author about a takedown" but excessive for the default list view. A bulk export would leak all user emails.
- **remediation:** Make `authorEmail` opt-in via `?withEmail=true` query param, or require a second admin click to expand the field.

### S-L1 — `req.body = result.data` cast in `validate.ts` mutates the request object
- **severity:** low
- **location:** `server/src/middleware/validate.ts:18, 40`
- **description:** After Zod validation, the body is replaced with `result.data`. If a route later reads `req.body.someField` it gets the *parsed/coerced* value (e.g., a string `"500"` becomes the number `500`). This is intentional, but downstream code that re-stringifies the body (e.g., for logging) will write the coerced value, not the original. No bug, but worth a comment.
- **remediation:** Add a comment in `validate.ts` documenting the coercion behavior.

### S-L2 — `pendoTrack` swallows all errors
- **severity:** low
- **location:** `server/src/services/pendo-track.ts:32-34`
- **description:** `.catch((err) => logger.warn({ err, event }, 'Pendo track event failed'))` — fine for production, but errors include the full request body. If a future change adds PII to the event properties, the warn log will leak it.
- **remediation:** Strip the body from the log line; only keep the event name and error code.

### S-L3 — `pendo.identify` in client sends full user object to Pendo
- **severity:** low
- **location:** `client/src/contexts/AuthContext.tsx:96-112`
- **description:** Every `refreshUser()` call sends `email, fullName, username, role, is_online, balance, total_readings, pricing_chat, pricing_voice, pricing_video, created_at, updated_at` to Pendo. Pendo is a product-analytics tool and not in the platform's data-handling disclosure for end users. The current Pendo privacy policy applies, but `balance` and `total_readings` are arguably sensitive for a financial-services-adjacent product.
- **remediation:** Strip `balance` and `total_readings` from the identify payload. Add a `PRIVACY.md` noting what fields are sent to Pendo.

### S-L4 — `JWT_VERIFY` is async, no per-token rate limit
- **severity:** low
- **location:** `server/src/middleware/auth.ts:7-11`
- **description:** `express-oauth2-jwt-bearer` does a JWKS fetch on cache miss and then verifies the signature per request. JWKS is cached for 10 minutes by default. A flood of tokens signed with rotated keys could trigger JWKS refetch storms; not a vuln, but worth setting explicit cache TTL.
- **remediation:** Configure `cacheMaxAge: 600_000` and `cooldownDuration: 30_000` explicitly. (See library docs.)

---

## OWASP Top 10 (2021) Coverage

| OWASP Category | Status | Notes |
|---|---|---|
| A01 Broken Access Control | ⚠ partial | Admin endpoints leak raw PII; messages GET bypasses premium-messaging check |
| A02 Cryptographic Failures | ✅ ok | Helmet + HSTS, JWT RS256, Stripe sig verify, bcrypt-quality passwords (auth0-managed) |
| A03 Injection | ✅ ok | Drizzle parameterized queries; no string-concat SQL; Zod on all inputs |
| A04 Insecure Design | ⚠ partial | Admin flows have no rate limit / no confirmation |
| A05 Security Misconfiguration | ⚠ partial | Hardcoded Pendo key, debug endpoints in prod, `fly.toml` auto-stop kills WS server |
| A06 Vulnerable Components | ✅ ok | All deps on current major versions; no known critical CVEs in direct deps |
| A07 Identification & Auth Failures | ✅ ok | Auth0, RS256, audience + issuer verify, no password storage in app |
| A08 Software & Data Integrity | ⚠ partial | Duplicate Stripe webhook routes could double-process if both are configured in Stripe dashboard |
| A09 Security Logging & Failures | ✅ ok | Pino structured logs, `unhandledRejection`/`uncaughtException` shutdown |
| A10 SSRF | ✅ ok | Brevo URL is constant + hostname-reasserted; no user-controlled URL fetches |

---

## Metrics

| Metric | Value |
|---|---|
| Admin routes | 14 |
| Admin routes with `strictLimiter` | 1 (`/api/admin/readers/:id/image` only) |
| Public routes (no auth) | 6 (health, db-check, newsletter, applications, forum list/posts/comments, readers public) |
| Routes returning raw DB rows (no field redaction) | 5 |
| Hardcoded secrets in source | 1 (Pendo integration key) |
| Hardcoded URLs in client bundle | 2 (debug endpoint, Pendo CDN key) |
| PII fields in client telemetry | 6 (`balance`, `total_readings`, `pricing_*`, `email`, `created_at`) |
