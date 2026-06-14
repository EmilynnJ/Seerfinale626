---
agent: api-tester
status: warn
findings: 12
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# API Contract Audit — Endpoint Validation, Contract Testing

## Summary

Every write route has a Zod validator (good), every protected route has `requireAuth` + a role check where appropriate (mostly good), and idempotency is implemented for the Stripe webhook. However, the contract has several **inconsistencies, duplications, and missing rate limits** that would surface during integration.

| Severity | Count |
|---|---|
| critical | 0 |
| high | 2 |
| medium | 5 |
| low | 5 |

---

## Findings

### API-H1 — Duplicate Stripe webhook routes
- **severity:** high
- **location:** `server/src/routes/payments.ts:22-124` (`POST /api/payments/webhook`) and `server/src/routes/webhooks.ts:21-115` (`POST /api/webhooks/stripe`)
- **description:** Two near-identical webhook handlers exist, mounted in `index.ts:79, 115`. If both URLs are configured in the Stripe dashboard (e.g., during a transition), a single Stripe event will be processed twice — but the idempotency check (`stripePaymentIntentId` lookup) would prevent double-credit, just produce a `Duplicate webhook ignored` log. Still, **divergence risk** is real: the two paths are 95% identical but drift-prone.
- **remediation:** Pick one canonical path (`/api/webhooks/stripe` is referenced in the build guide as the build-guide-canonical URL). Remove the `/api/payments/webhook` handler entirely. Keep a 301-redirect from the old path if external integrators depend on it.

### API-H2 — `GET /api/me` and `GET /api/auth/me` return overlapping but different shapes
- **severity:** high
- **location:** `server/src/routes/users.ts:152-166` vs `server/src/routes/auth.ts:152-163`
- **description:** Both endpoints return the current user but:
  - `GET /api/auth/me` (used by `AuthContext.tsx:82` for the post-sync fetch) is the **source of truth** for the client
  - `GET /api/me` is the canonical name but is not used by the client (or is it? grep for `/api/me` returns `users.ts:153` and `PATCH /me` endpoints — not the `AuthContext`)
  
  This creates a maintenance hazard: a change to one doesn't apply to the other. The client depends on the `/api/auth/me` shape; the server provides both.
- **remediation:** De-duplicate. Use `/api/me` as the canonical path (shorter, REST-idiomatic). Update `AuthContext.tsx:82` to call `/api/me`. Delete the `/api/auth/me` route. Or, if both must exist, factor a `presentUser()` helper.

### API-M1 — `GET /api/payments/transactions` and `GET /api/transactions` are duplicates
- **severity:** medium
- **location:** `server/src/routes/payments.ts:175-194` vs `server/src/routes/transactions.ts:14-32`
- **description:** Both routes serve the same data: transactions for the authenticated user. Both are paginated identically. The build guide references `GET /api/transactions` as canonical. The `/api/payments/transactions` route is unregistered to the `/api/payments` prefix in `index.ts:111` (it's `app.use('/api/payments', paymentRoutes)` — and `paymentRoutes` includes the `/transactions` GET at `payments.ts:175`, so this is reachable at `/api/payments/transactions`).
- **remediation:** Remove `GET /api/payments/transactions` from `payments.ts`. Keep `GET /api/transactions` as canonical.

### API-M2 — `POST /api/payments/create-intent` requires auth but no per-user cap on topup frequency
- **severity:** medium
- **location:** `server/src/routes/payments.ts:149-173`
- **description:** A user can create unlimited `PaymentIntent` records, generating Stripe API noise. While `strictLimiter` (20/15min) applies, each PI is a Stripe-side resource. Combined with the webhook's idempotency check (which is on the *succeeded* event, not the *creation*), creating many PIs is cheap.
- **remediation:** Add a per-user open-PI cap (e.g., max 5 unpaid PIs at a time). Reuse `generalLimiter` if `strictLimiter` is too restrictive.

### API-M3 — `GET /api/forum/posts` is unauthenticated and uncached
- **severity:** medium
- **location:** `server/src/routes/forum.ts:14-44`
- **description:** The forum list is public. Each call runs two DB queries (posts + comment counts). No `Cache-Control` header is set. Crawlers and aggregators could hammer this.
- **remediation:** Add `Cache-Control: public, max-age=30` for anonymous requests, `max-age=10` for authenticated. Apply `generalLimiter` (currently uncapped).

### API-M4 — `GET /api/readers` and `GET /api/readers/online` are unauthenticated and uncapped
- **severity:** medium
- **location:** `server/src/routes/users.ts:15-67`
- **description:** The reader list is the home page's primary content. No rate limit, no `Cache-Control`. A scraping bot can fetch the full reader DB.
- **remediation:** Apply `generalLimiter`. Set `Cache-Control: public, max-age=60` for the online-only variant. Add a per-IP rate limit at the proxy level for `/api/readers*`.

### API-M5 — `GET /api/health` and `GET /api/db-check` are unauthenticated and leak DB liveness
- **severity:** medium
- **location:** `server/src/index.ts:87-98`
- **description:** `/api/db-check` returns `{ ok: result.rows[0]?.ok === 1 }` after running `SELECT 1`. Both are unauthenticated. `/api/health` is excluded from access logs (`pinoHttp({ autoLogging: { ignore: (req) => req.url === '/api/health' } })`) but `/api/db-check` is **not** excluded — a health-check storm will fill the logs.
- **remediation:** Either (a) make `/api/db-check` admin-only, or (b) exclude it from access logs. Add both to `pinoHttp` ignore list.

### API-L1 — `POST /api/readings/:id/agora-token` does not throttle by reading
- **severity:** low
- **location:** `server/src/routes/readings.ts:276-315`
- **description:** Any participant can request an Agora token for a reading, repeatedly. While the token expires in 1 hour, a flood of requests would still hit the route. Low impact.
- **remediation:** Add a per-reading rate limit (e.g., 10 token requests / 5 min / reading).

### API-L2 — `GET /api/admin/users` does not return a `total` count
- **severity:** low
- **location:** `server/src/routes/admin.ts:78-101`
- **description:** Pagination is offset/limit but no `total` is returned. The client cannot show "Page 3 of 27" without a second count query.
- **remediation:** Run `SELECT COUNT(*) FROM users` (with the same `role` filter) in parallel and return `{ users, total }`.

### API-L3 — `POST /api/reader-applications` validates but does not persist
- **severity:** low
- **location:** `server/src/routes/applications.ts:1-52`
- **description:** The handler logs the application and returns 201 — but does not insert into any DB. The TODO comment acknowledges this: "TODO: When an email service is configured, send notification to admin and confirmation to applicant here." Applications are currently **lost** unless logs are scraped.
- **remediation:** Add a `reader_applications` table; insert before the 201 response. Email the admin on insert.

### API-L4 — `GET /api/admin/forum/flagged` returns 50 with no pagination
- **severity:** low
- **location:** `server/src/routes/admin.ts:764-778`
- **description:** The flagged-content queue caps at 50. For a busy platform, the queue overflows silently.
- **remediation:** Add `?cursor=...&limit=...` pagination.

### API-L5 — `POST /api/admin/payouts/:readerId` returns `transferId` but no audit log entry beyond `transactions`
- **severity:** low
- **location:** `server/src/routes/admin.ts:552-650`
- **description:** The transaction table records the payout, but does not capture the *admin's identity* on the trigger. A future forensic question ("who triggered this payout?") requires joining `users.role='admin'` with `transactions.userId`, which is unreliable.
- **remediation:** Add an `adminAuditLog` table (also called out in S-H1).

---

## Truthpack cross-reference (`routes.json`)

The truthpack lists routes (v2.0.0) with `confidence: medium`. Several of the listed routes do **not** match the source code:

| Truthpack `path` | Source code | Status |
|---|---|---|
| `GET /server/src/routes/webhooks` | `POST /api/webhooks/stripe` | ⚠ method mismatch (truthpack says GET) |
| `GET /server/src/routes/users` | many user routes | ⚠ imprecise (truthpack collapsed all to GET) |
| `GET /server/src/routes/transactions` | `GET /api/transactions` | ⚠ method match, path is a file |
| `GET /server/src/routes/readings` | many reading routes | ⚠ imprecise |
| `GET /server/src/routes/payments` | many payment routes | ⚠ imprecise |
| `GET /server/src/routes/newsletter` | `POST /api/newsletter/*` | ⚠ method mismatch |
| `GET /server/src/routes/forum` | many forum routes | ⚠ imprecise |
| `GET /server/src/routes/admin` | many admin routes | ⚠ imprecise |
| `GET /server/src/routes/messages` | many message routes | ⚠ imprecise |

The truthpack appears to be a **route-existence check** (file detected) rather than a **route-shape inventory**. Confidence is `medium` and the path is the source file. This is a tool limitation, not a code bug. The truthpack is helpful as a "is this file wired up?" check but not as an API contract source of truth.

---

## Contract Test Coverage

| Endpoint | Validator | Auth | Rate limit | Idempotency |
|---|---|---|---|---|
| `POST /api/auth/sync` | ✅ callbackSchema | jwtOnly (no `requireUser`) | generalLimiter | upsert is idempotent |
| `GET /api/auth/me` | ❌ | requireAuth | generalLimiter | n/a |
| `POST /api/auth/sync` body: `auth0Id, email, fullName, profileImage` | ✅ | n/a | n/a | upsert |
| `POST /api/readings/on-demand` | ✅ onDemandSchema | requireAuth, role=client | strictLimiter | n/a |
| `POST /api/readings/:id/accept` | ❌ (no body) | requireAuth, requireParticipant | generalLimiter | n/a |
| `POST /api/readings/:id/agora-token` | ❌ (no body) | requireAuth, requireParticipant | generalLimiter | n/a |
| `POST /api/readings/:id/heartbeat` | ❌ (no body) | requireAuth, requireParticipant | generalLimiter | per-minute idempotent |
| `POST /api/readings/:id/end` | ❌ (no body) | requireAuth, requireParticipant | generalLimiter | endReading idempotent |
| `POST /api/payments/create-intent` | ✅ topupSchema | requireAuth | strictLimiter | n/a (idempotency on webhook) |
| `POST /api/payments/webhook` | n/a (raw body) | n/a | webhookLimiter | ✅ on stripePaymentIntentId |
| `POST /api/webhooks/stripe` | n/a (raw body) | n/a | webhookLimiter | ✅ duplicate of above |
| `GET /api/payments/transactions` | n/a | requireAuth | generalLimiter | n/a |
| `POST /api/admin/readers` | ✅ createReaderSchema | requireAuth, requireRole(admin) | none | n/a |
| `POST /api/admin/readers/:id/image` | n/a (multipart) | requireAuth, requireRole(admin) | none | n/a |
| `POST /api/admin/balance-adjust` | ✅ adjustSchema | requireAuth, requireRole(admin) | **none** | n/a |
| `POST /api/admin/payouts/:readerId` | n/a | requireAuth, requireRole(admin) | **none** | n/a |
| `POST /api/admin/readings/:id/refund` | n/a | requireAuth, requireRole(admin) | none | n/a |
| `POST /api/admin/provision-test-accounts` | ✅ provisionSchema | requireAuth, requireRole(admin) | none | partial (per-account) |
| `POST /api/messages/with/:userId` | ✅ sendMessageSchema | requireAuth | generalLimiter | n/a |
| `POST /api/messages/:id/unlock` | n/a | requireAuth | generalLimiter | unlock is idempotent |
| `POST /api/forum/posts` | ✅ createPostSchema | requireAuth | none | n/a |
| `POST /api/forum/posts/:id/flag` | ✅ flagPostSchema | requireAuth | **none** | n/a |
| `POST /api/forum/comments/:id/flag` | ✅ flagPostSchema | requireAuth | **none** | n/a |
| `POST /api/forum/flags` (legacy) | ❌ | requireAuth | **none** | n/a |
| `DELETE /api/forum/posts/:id` | n/a | requireAuth, requireRole(admin) | none | n/a |
| `PATCH /api/forum/posts/:id/lock` | ❌ (boolean only) | requireAuth, requireRole(admin) | none | n/a |
| `POST /api/newsletter/subscribe` | ✅ subscribeSchema | n/a | generalLimiter | upsert |
| `POST /api/newsletter/unsubscribe` | ✅ subscribeSchema | n/a | generalLimiter | n/a |
| `POST /api/reader-applications` | ✅ applicationSchema | n/a | none | **lost (not persisted)** |

---

## Metrics

| Metric | Value |
|---|---|
| Total endpoints | ~50 |
| With Zod validator | ~24 (write paths) |
| With `requireAuth` | ~30 |
| With role check | ~14 (admin) |
| With rate limit | ~20 |
| Without rate limit (admin or sensitive) | 6 |
| With idempotency | 4 (Stripe webhook × 2, unlock, upsert) |
| Lost-write (no persistence) | 1 (reader-applications) |
| Duplicate routes | 4 (Stripe webhooks, /me vs /auth/me, transactions × 2) |
