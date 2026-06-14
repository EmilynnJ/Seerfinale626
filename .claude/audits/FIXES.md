---
agent: fix-planner
status: fail
total_unique_findings: 99
critical: 2
high: 13
medium: 36
low: 33
info: 15
sources: [AUDIT_CODE, AUDIT_BUGS, AUDIT_SECURITY, AUDIT_DOCS, AUDIT_INFRA, AUDIT_UI, AUDIT_DB, AUDIT_PERF, AUDIT_DEPS, AUDIT_SEO, AUDIT_API]
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
generated_at: 2026-06-14T19:00:30Z
---

# Consolidated Fixes — Full Audit, 2026-06-14

This file is the consolidated, deduplicated output of the 11 auditors (`AUDIT_CODE.md`, `AUDIT_BUGS.md`, `AUDIT_SECURITY.md`, `AUDIT_DOCS.md`, `AUDIT_INFRA.md`, `AUDIT_UI.md`, `AUDIT_DB.md`, `AUDIT_PERF.md`, `AUDIT_DEPS.md`, `AUDIT_SEO.md`, `AUDIT_API.md`).

Findings are grouped by severity and **fix order** (independent fixes first, coupled ones later).

---

## P0 — Critical (fix immediately, blocks production)

### F-001 — Remove hardcoded dev debug endpoint from client production bundle
- **sources:** [S-C1](../audits/AUDIT_SECURITY.md)
- **files:** `client/src/App.tsx:33-54`, `client/src/contexts/AuthContext.tsx:12-33`
- **action:** Delete `DEBUG_ENDPOINT` constant and `debugLog()` function in both files. Remove all `debugLog(...)` call sites. Add a Vite build-time check that fails if `127.0.0.1:7530` appears in any source file.

### F-002 — Fix Fly.io `auto_stop_machines` killing WebSocket sessions
- **sources:** [I-C1](../audits/AUDIT_INFRA.md)
- **file:** `fly.toml:13-16`
- **action:** Remove `auto_stop_machines = 'stop'` and set `min_machines_running = 1`. Add `[http_service.checks.health]` block polling `/api/health` every 15s.

---

## P1 — High (this sprint)

### F-003 — Remove server-side `debugLog` and disk-write artifacts
- **sources:** [C-H1](../audits/AUDIT_CODE.md)
- **file:** `server/src/routes/auth.ts:16-45`
- **action:** Delete `debugLog` function, `DEBUG_LOG_PATHS` constant, and all `#region agent log` call sites.

### F-004 — De-duplicate Stripe webhook routes
- **sources:** [API-H1](../audits/AUDIT_API.md), [C-H2](../audits/AUDIT_CODE.md)
- **files:** `server/src/routes/payments.ts:22-124`, `server/src/routes/webhooks.ts:1-115`, `server/src/index.ts:79, 115`
- **action:** Extract `processStripePaymentIntentSucceeded(pi)` in `server/src/services/stripe-service.ts`. Make `webhooks.ts` the single mount. Remove the duplicate from `payments.ts`. Update `index.ts` accordingly.

### F-005 — Add compensation in admin reader creation
- **sources:** [B-H3](../audits/AUDIT_BUGS.md), [C-M2](../audits/AUDIT_CODE.md)
- **file:** `server/src/routes/admin.ts:158-181`
- **action:** Wrap Stripe call in try/catch. On Stripe failure, call `auth0ManagementService.deleteUser(auth0Result.auth0Id)` as compensation. Log outcome to pino.

### F-006 — Make admin DELETE handlers return 404 on no-op
- **sources:** [B-H1](../audits/AUDIT_BUGS.md)
- **files:** `server/src/routes/admin.ts:804-820`, `server/src/routes/admin.ts:822-839`
- **action:** Append `.returning({ id })` and 404 on empty result.

### F-007 — Add rate limit + audit log to `/api/admin/balance-adjust`
- **sources:** [S-H1](../audits/AUDIT_SECURITY.md)
- **file:** `server/src/routes/admin.ts:451-503`
- **action:** Apply `strictLimiter`; cap `amount` (±$10,000 single, ±$50,000 daily aggregate per admin); write to a new `admin_audit_log` table.

### F-008 — Add rate limit to `/api/admin/payouts/:readerId`
- **sources:** [S-H2](../audits/AUDIT_SECURITY.md)
- **file:** `server/src/routes/admin.ts:552-650`
- **action:** Apply `strictLimiter`; enforce one payout per `(readerId, day)`; write to `admin_audit_log`.

### F-009 — Move Pendo integration key to env var
- **sources:** [S-H3](../audits/AUDIT_SECURITY.md), [C-L2](../audits/AUDIT_CODE.md)
- **files:** `server/src/services/pendo-track.ts:4`, `server/src/config.ts`, `.env.example`
- **action:** Add `PENDO_INTEGRATION_KEY` to `config.ts` Zod schema with `default('')`. Read from `config.posthog.*` pattern. Update `pendo-track.ts` to use it. Add to `.env.example`.

### F-010 — Redact PII in admin responses
- **sources:** [S-H4](../audits/AUDIT_SECURITY.md)
- **files:** `server/src/routes/admin.ts:78-101`, `server/src/routes/admin.ts:506-528`
- **action:** Use a `presentAdminUser(row)` helper that redacts `auth0Id`, `stripeAccountId`, `stripeCustomerId`. Add `?withEmail=true` opt-in for moderation list.

### F-011 — Fix revenue-split constants drift
- **sources:** [D-H2](../audits/AUDIT_DOCS.md)
- **files:** `shared/src/types.ts:57-58`
- **action:** Delete `PLATFORM_FEE_PERCENT` and `READER_SHARE_PERCENT`. Add comment to `READER_SHARE` in `shared/src/validators.ts:177` marking it the single source of truth.

### F-012 — Fix hardcoded `soulseerpsychics.com` URLs
- **sources:** [D-H3](../audits/AUDIT_DOCS.md), [C-I1](../audits/AUDIT_CODE.md)
- **files:** `server/src/services/brevo-service.ts:121, 136, 155`, `server/src/config.ts`
- **action:** Add `FRONTEND_URL` env var to `config.ts` (default `https://soulseerpsychics.vercel.app`). Replace hardcoded URLs in `brevo-service.ts`. Update `.env.example`.

### F-013 — Update build guide for heartbeat billing + 60/40 split
- **sources:** [D-H1](../audits/AUDIT_DOCS.md)
- **file:** `docs/BUILD_GUIDE.md:96-100, 8.4`
- **action:** Rewrite §8.4 to describe the heartbeat-driven billing model with `GRACE_PERIOD_MS = 120_000` and `sweepStale`. Change split to 60/40. Reference `POST /api/readings/:id/heartbeat`.

### F-014 — Add focus trap to modals
- **sources:** [U-H1](../audits/AUDIT_UI.md)
- **files:** `client/src/components/ui/Modal.tsx`, `client/src/components/ChatTranscriptModal.tsx`, `client/src/components/AddFundsForm.tsx`
- **action:** Create `useFocusTrap(ref)` and `useFocusReturn(triggerRef)` hooks. Apply to all modals.

### F-015 — Add HEALTHCHECK to Dockerfile
- **sources:** [I-H2](../audits/AUDIT_INFRA.md)
- **file:** `Dockerfile`
- **action:** Add `HEALTHCHECK` instruction that pings `/api/health`. Define `[http_service.checks]` in `fly.toml`.

---

## P2 — Medium (next sprint)

### F-016 — Replace non-null assertions with explicit guards
- **sources:** [C-M1](../audits/AUDIT_CODE.md)
- **files:** ~10 in `server/src/routes/`
- **action:** Add `must<T>(v, msg): T` helper in `server/src/utils/`. Replace `!` after `.returning()` with `must(row, 'unexpected_empty_returning')`.

### F-017 — Add Zod validation to `PATCH /api/admin/posts/:id/lock`
- **sources:** [B-M1](../audits/AUDIT_BUGS.md), [C-M3](../audits/AUDIT_CODE.md)
- **file:** `server/src/routes/admin.ts:842-863`
- **action:** Add `const lockSchema = z.object({ isLocked: z.boolean() }).strict();` and use `validateBody`.

### F-018 — Fix `POST /api/forum/flags` XOR validation
- **sources:** [B-M2](../audits/AUDIT_BUGS.md), [S-M4](../audits/AUDIT_SECURITY.md)
- **file:** `server/src/routes/forum.ts:215-226`
- **action:** Use `createFlagSchema` from `shared/src/validators.ts` (which has the `.refine` for exactly-one).

### F-019 — Enforce premium-messaging policy on GET
- **sources:** [S-M3](../audits/AUDIT_SECURITY.md), [B-L3](../audits/AUDIT_BUGS.md)
- **file:** `server/src/routes/messages.ts:127-190`
- **action:** Apply the same `readerInvolved` check to `GET /with/:userId` as the POST.

### F-020 — Disconnect WS on account deletion
- **sources:** [S-M5](../audits/AUDIT_SECURITY.md)
- **files:** `server/src/routes/users.ts:353-433`, `server/src/services/websocket-service.ts`
- **action:** Add `disconnect(userId)` method to `wsService`. Call it in the DELETE handler after the DB scrub. Also short-circuit `resolveUser` to reject if `users.deletedAt IS NOT NULL`.

### F-021 — Add skip-JSON for both Stripe webhook paths in `production.ts`
- **sources:** [I-M3](../audits/AUDIT_INFRA.md)
- **file:** `server/src/production.ts:45-48`
- **action:** Add `/api/webhooks/stripe` to the skip-JSON set, or factor a shared raw-body middleware.

### F-022 — Add composite index on `readings(status, lastHeartbeat)`
- **sources:** [DB-H1](../audits/AUDIT_DB.md)
- **file:** `shared/src/schema.ts:114-170`
- **action:** Add `statusLastHeartbeatIdx`. Generate Drizzle migration.

### F-023 — Move chat to a `reading_messages` table
- **sources:** [DB-H2](../audits/AUDIT_DB.md), [P-H1](../audits/AUDIT_PERF.md)
- **files:** `shared/src/schema.ts`, `server/src/routes/readings.ts:725-779`
- **action:** New table with `(readingId, createdAt)` composite index. Migrate `chatTranscript` reads to the new table.

### F-024 — Add `forumFlags` CHECK constraint for XOR
- **sources:** [DB-M3](../audits/AUDIT_DB.md)
- **file:** `shared/src/schema.ts:309-335`
- **action:** Add `check('forum_flags_target_xor').on(sql\`(${table.postId} IS NULL) <> (${table.commentId} IS NULL)\`)`.

### F-025 — Add composite indexes for messages and transactions
- **sources:** [DB-M4, DB-M6](../audits/AUDIT_DB.md)
- **files:** `shared/src/schema.ts`
- **action:** Add `(userId, createdAt DESC)` to `transactions`, `(senderId, recipientId, createdAt)` to `messages`.

### F-026 — Move `sweepStale` out of the heartbeat hot-path
- **sources:** [P-H2](../audits/AUDIT_PERF.md)
- **files:** `server/src/services/billing-service.ts:55-63`, `server/src/index.ts`
- **action:** Schedule `sweepStale` on a `setInterval` (Fly-only) or external cron (Vercel). The heartbeat hot-path only calls `settle(readingId)`.

### F-027 — Add missing env vars to `.env.example`
- **sources:** [D-M5](../audits/AUDIT_DOCS.md), [I-M1](../audits/AUDIT_INFRA.md)
- **file:** `.env.example`
- **action:** Add `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `NEWSLETTER_WELCOME_ENABLED`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `ADMIN_EMAILS`, `PENDO_INTEGRATION_KEY`, `FRONTEND_URL`.

### F-028 — Add `engines` field to all `package.json`
- **sources:** [D-M1](../audits/AUDIT_DEPS.md)
- **files:** root, `server/`, `client/`, `shared/`
- **action:** Add `"engines": { "node": ">=20.0.0", "npm": ">=10" }`.

### F-029 — Remove `vibecheck` self-referential dependency
- **sources:** [D-H1](../audits/AUDIT_DEPS.md)
- **file:** `package.json:43`
- **action:** Verify unused; if so, remove and run `npm install`. If used, switch to a workspace.

### F-030 — Add `react-helmet-async` for per-route meta
- **sources:** [S-M1](../audits/AUDIT_SEO.md)
- **files:** `client/src/main.tsx`, all `client/src/pages/*.tsx`
- **action:** Install `react-helmet-async`. Wrap `<App />` in `<HelmetProvider>`. Add `<Helmet>` blocks to each page with unique title/description/canonical.

### F-031 — Add OG image, Twitter card, canonical, JSON-LD
- **sources:** [S-H1, S-H2, S-H3](../audits/AUDIT_SEO.md)
- **file:** `client/index.html`
- **action:** Add `og:image`, `og:url`, `og:site_name`, `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`, `<link rel="canonical">`, JSON-LD `Organization`.

### F-032 — Add `robots.txt` and `sitemap.xml`
- **sources:** [S-M2](../audits/AUDIT_SEO.md)
- **files:** `client/public/robots.txt`, `client/public/sitemap.xml`
- **action:** Create both. `robots.txt` disallows `/api/`. `sitemap.xml` lists `/`, `/readers`, `/community`, `/about`, `/help`.

### F-033 — Persist reader applications
- **sources:** [API-L3](../audits/AUDIT_API.md)
- **files:** `server/src/routes/applications.ts`, `shared/src/schema.ts`
- **action:** New `reader_applications` table. Insert before 201 response. Email admin on insert (if email configured).

### F-034 — De-duplicate `/me` and `/auth/me`
- **sources:** [API-H2](../audits/AUDIT_API.md)
- **files:** `server/src/routes/auth.ts:152-163`, `client/src/contexts/AuthContext.tsx:82`
- **action:** Make `/api/me` the canonical. Update `AuthContext` to call `/api/me`. Remove `/api/auth/me`. Or factor a `presentUser()` helper used by both.

### F-035 — Remove duplicate `/api/payments/transactions` route
- **sources:** [API-M1](../audits/AUDIT_API.md)
- **file:** `server/src/routes/payments.ts:175-194`
- **action:** Remove the handler. Keep `GET /api/transactions` as canonical.

### F-036 — Add Stripe-fail compensation + rate limit to flag endpoints
- **sources:** [S-M2](../audits/AUDIT_SECURITY.md)
- **file:** `server/src/routes/forum.ts:151-211`
- **action:** Apply `strictLimiter`; add unique `(reporterId, postId)` / `(reporterId, commentId)` indexes; reject duplicates with 200 `{ alreadyFlagged: true }`.

---

## P3 — Low (backlog)

### F-037 — Use Drizzle relational queries in `requireParticipant`
- **sources:** [C-M5](../audits/AUDIT_CODE.md)
- **file:** `server/src/middleware/rbac.ts:51-86`

### F-038 — Move all message types to a single `presentMessage` helper
- **sources:** [C-M4](../audits/AUDIT_CODE.md)
- **files:** `server/src/routes/messages.ts`, `shared/src/`

### F-039 — Centralize magic numbers in `shared/src/constants.ts`
- **sources:** [C-L1](../audits/AUDIT_CODE.md)
- **files:** all routes

### F-040 — Wrap `POST /api/admin/provision-test-accounts` in per-account transactions
- **sources:** [C-L5](../audits/AUDIT_CODE.md)
- **file:** `server/src/routes/admin.ts:903-985`

### F-041 — Add `aria-hidden` to closed mobile menu
- **sources:** [U-M2](../audits/AUDIT_UI.md)
- **file:** `client/src/components/Navigation.tsx`

### F-042 — Honor `prefers-reduced-motion`
- **sources:** [U-L2, P-L3](../audits/AUDIT_UI.md)
- **files:** `client/src/styles/global.css`, `client/src/components/CosmicBackground.tsx`

### F-043 — Make `Button` polymorphic
- **sources:** [U-L3](../audits/AUDIT_UI.md)
- **file:** `client/src/components/ui/Button.tsx`

### F-044 — Add `aria-invalid` and inline error region to `ImageUploadField`
- **sources:** [U-M4](../audits/AUDIT_UI.md)
- **file:** `client/src/components/ImageUploadField.tsx`

### F-045 — Strip `balance` and `total_readings` from Pendo identify
- **sources:** [S-L3](../audits/AUDIT_SECURITY.md)
- **file:** `client/src/contexts/AuthContext.tsx:96-112`

### F-046 — Remove `pendo.initialize` from `main.tsx`
- **sources:** [P-L1](../audits/AUDIT_PERF.md)
- **file:** `client/src/main.tsx:7-11`

### F-047 — Add `pendoTrack` batching and timeout
- **sources:** [P-M2](../audits/AUDIT_PERF.md)
- **file:** `server/src/services/pendo-track.ts`

### F-048 — Add per-IP rate limit at proxy level for `/api/readers*`
- **sources:** [API-M4](../audits/AUDIT_API.md)
- **file:** `vercel.json` or Fly reverse proxy config

### F-049 — Add `Cache-Control` to public read endpoints
- **sources:** [API-M3, API-M4](../audits/AUDIT_API.md)
- **files:** `server/src/routes/forum.ts`, `server/src/routes/users.ts`

### F-050 — Add `db-check` to access-log ignore list
- **sources:** [API-M5](../audits/AUDIT_API.md)
- **file:** `server/src/index.ts:67-72`

### F-051 — Add `npm audit` to CI
- **sources:** [D-L2](../audits/AUDIT_DEPS.md)
- **file:** `.gitlab-ci.yml` or `.github/workflows/`

### F-052 — Strip `(None)` prefix artifacts from `docs/BUILD_GUIDE.md`
- **sources:** [D-L3](../audits/AUDIT_DOCS.md)
- **file:** `docs/BUILD_GUIDE.md`

### F-053 — Add `Last updated` header to every markdown doc
- **sources:** [D-L1](../audits/AUDIT_DOCS.md)
- **files:** all `.md` in repo

### F-054 — Adopt Keep-a-Changelog format
- **sources:** [D-M3](../audits/AUDIT_DOCS.md)
- **file:** `CHANGELOG.md` (new)

### F-055 — Generate OpenAPI spec from Zod schemas
- **sources:** [D-M4](../audits/AUDIT_DOCS.md)
- **file:** `docs/openapi.yaml` (new)

### F-056 — Add `presentUser` helper in `shared/src/`
- **sources:** [C-I2](../audits/AUDIT_CODE.md)
- **file:** `shared/src/index.ts`

### F-057 — Drop unused `MAX_RATING`/`MIN_RATING` (or use in validators)
- **sources:** [C-L7](../audits/AUDIT_CODE.md)
- **file:** `shared/src/types.ts`

### F-058 — Use `crypto.randomInt` to remove modulo bias in `generatePassword`
- **sources:** [S-M1](../audits/AUDIT_SECURITY.md)
- **file:** `server/src/services/auth0-management.ts:55-58`

### F-059 — Add `isOnline` liveness sweep
- **sources:** [DB-M2](../audits/AUDIT_DB.md)
- **file:** new `services/presence-service.ts`

### F-060 — Add `CHECK (balance >= 0)` to users
- **sources:** [DB-L2](../audits/AUDIT_DB.md)
- **file:** `shared/src/schema.ts`

### F-061 — Reconcile `paymentStatus` enum with validator
- **sources:** [DB-L3](../audits/AUDIT_DB.md)
- **files:** `shared/src/schema.ts:41-45`, `shared/src/validators.ts:18`

### F-062 — Verify/fix Dockerfile CMD path
- **sources:** [I-H1](../audits/AUDIT_INFRA.md)
- **file:** `Dockerfile:63`, `server/tsconfig.json`

### F-063 — Share bootstrap between `index.ts` and `production.ts`
- **sources:** [I-H3](../audits/AUDIT_INFRA.md)
- **files:** `server/src/index.ts`, `server/src/production.ts`, new `server/src/app.ts`

### F-064 — Use Drizzle `webSocketContext` ref to prevent orphan in-flight WS
- **sources:** [P-M5](../audits/AUDIT_PERF.md)
- **file:** `client/src/contexts/WebSocketContext.tsx`

### F-065 — Memoize `value` in `AuthContext.Provider`
- **sources:** [P-M3](../audits/AUDIT_PERF.md)
- **file:** `client/src/contexts/AuthContext.tsx`

### F-066 — Add `* -r--` filesystem hardening to Dockerfile
- **sources:** [I-L1](../audits/AUDIT_INFRA.md)
- **file:** `Dockerfile`

### F-067 — Document Vercel vs Fly WS routing gap
- **sources:** [I-M2](../audits/AUDIT_INFRA.md)
- **file:** `README.md` or `docs/DEPLOY.md` (new)

### F-068 — Verify `client/.env.example` documents all `VITE_*` refs
- **sources:** [I-L2](../audits/AUDIT_INFRA.md)
- **file:** `client/.env.example`

### F-069 — Use `config.port` in `production.ts` instead of raw env
- **sources:** [I-L3](../audits/AUDIT_INFRA.md)
- **file:** `server/src/production.ts:90`

### F-070 — Remove `nx.json` if not used
- **sources:** [I-M5](../audits/AUDIT_INFRA.md)
- **file:** `nx.json`

### F-071 — Port CI to GitHub Actions if GitLab is stale
- **sources:** [I-M6](../audits/AUDIT_INFRA.md)
- **files:** `.gitlab-ci.yml`, `.github/workflows/`

### F-072 — Delete `server/.build-status` or move to `server/dist/`
- **sources:** [I-M4](../audits/AUDIT_INFRA.md)
- **file:** `server/.build-status`

### F-073 — Add per-reading rate limit to agora-token
- **sources:** [API-L1](../audits/AUDIT_API.md)
- **file:** `server/src/routes/readings.ts:276-315`

### F-074 — Return `total` count from `/api/admin/users`
- **sources:** [API-L2](../audits/AUDIT_API.md)
- **file:** `server/src/routes/admin.ts:78-101`

### F-075 — Add cursor pagination to `/api/admin/forum/flagged`
- **sources:** [API-L4](../audits/AUDIT_API.md)
- **file:** `server/src/routes/admin.ts:764-778`

### F-076 — Add `aria-live` to toasts
- **sources:** [U-L5](../audits/AUDIT_UI.md)
- **file:** `client/src/components/ToastProvider.tsx`

### F-077 — Add `role="alert"` to ErrorBoundary fallback
- **sources:** [U-L4](../audits/AUDIT_UI.md)
- **file:** `client/src/components/ErrorBoundary.tsx`

### F-078 — Add hero image fallback
- **sources:** [U-L1](../audits/AUDIT_UI.md)
- **file:** `client/src/pages/HomePage.tsx`

---

## Observations (info only)

### F-079 — `PLATFORM_FEE_PERCENT = 30` in `shared/src/types.ts:57` is unused (covered by F-011)
### F-080 — `READER_SHARE_PERCENT = 70` in `shared/src/types.ts:58` is unused (covered by F-011)
### F-081 — `MAX_RATING`/`MIN_RATING` in `shared/src/types.ts:64-65` are unused (covered by F-057)
### F-082 — Hardcoded production URL in email templates (covered by F-012)
### F-083 — `auth.ts` debug `appendFileSync` to undefined paths (covered by F-003)
### F-084 — Pendo integration key hardcoded (covered by F-009)
### F-085 — PII in Pendo identify (covered by F-045)
### F-086 — Mixed return shapes on `/me` and `/auth/me` (covered by F-034)
### F-087 — Server uses `cors` middleware with parsed origins but no debug log (U-I3)
### F-088 — `as any` casts scattered across routes (cosmetic, no fix)
### F-089 — `chatTranscript` mutation not transactional (covered by F-023)
### F-090 — `pendoTrack` swallows all errors (U-L2)
### F-091 — `JWT_VERIFY` async, no per-token rate limit (U-L4)
### F-092 — `accountAgeDays` no upper-bound check (cosmetic)
### F-093 — `req.body = result.data` mutates request object (documented behavior)

---

## Suggested Fix Order (Epic View)

1. **Security & Production Blockers** (F-001 → F-015): Remove debug endpoints, fix Fly, add rate limits, move secrets, fix URL drift, focus traps, healthcheck. ~2-3 days.
2. **Bug Fixes** (F-016 → F-020): Non-null assertions, lock validation, forum XOR, premium messaging check, WS disconnect. ~2 days.
3. **Schema & DB** (F-021 → F-025): Indexes, chat table migration, CHECK constraints. ~2 days.
4. **Performance & Infra** (F-026, F-021): sweepStale out of hot-path, raw body for both webhook paths. ~1 day.
5. **Docs & SEO** (F-027, F-030 → F-032, F-052 → F-055): Env vars, helmet-async, OG/Twitter, sitemap, build guide, changelog. ~2-3 days.
6. **API Cleanup** (F-033 → F-036, F-048 → F-050): Persist applications, de-dup /me, remove /api/payments/transactions, flag dedup. ~1-2 days.
7. **Backlog (P3)** (F-037 → F-078): Refactors, hardening, code quality. ~5-7 days.

Total estimate: **~15-20 engineer-days** for P0–P2; P3 is open-ended.
