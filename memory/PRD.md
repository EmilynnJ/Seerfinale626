# SoulSeer — PRD & Build Memory

## Original Problem Statement
Build SoulSeer, a pay-per-minute spiritual reading platform (chat/voice/video) + community forum, per the attached build guide PDF, with critical overrides:
- **Supabase** (Postgres + Auth) replaces Neon/Drizzle/Auth0
- **Cloudflare Realtime** (SFU + TURN + MoQ) replaces Agora
- **Commission split: reader 60% / platform 40%**, single configurable value (upgradeable to 70/30)
- All three dashboards (Client/Reader/Admin) fully wired to live data — no stubs

## Architecture
- **Backend**: FastAPI (port 8001, `/api` prefix) — `/app/backend/`
  - `server.py` (routes), `billing.py` (per-second billing loop, WS session manager), `auth.py` (Supabase JWT via /auth/v1/user + cache), `db.py` (psycopg async pool), `seed.py` (schema + admin/reader seed)
  - DB: Supabase Postgres via session pooler `aws-1-us-east-2.pooler.supabase.com:5432`
  - Tables: users, readings, transactions, payment_transactions, forum_posts/comments/flags, rtc_sessions, platform_settings (reader_commission_pct=60), newsletter_subscribers. RLS enabled.
- **Frontend**: React CRA + Tailwind — `/app/frontend/` (dark celestial theme, Alex Brush + Playfair Display, pink #FF69B4 / gold #D4AF37)
- **Auth**: Supabase Auth. Client self-reg via backend `POST /api/auth/register` (admin API, email auto-confirmed). Readers admin-created only. Admin seeded. Roles live in `users` table, never in Supabase metadata.
- **Billing**: server-side, starts when both join WS (`/api/ws/readings/{id}?token=`), tick every 60s (charge client ppm, credit reader 60%), balance check before each tick, 2-min disconnect grace period, transcript saved on end.
- **Payments**: Stripe checkout (emergentintegrations lib) with **user's LIVE key**. Packages $10/$25/$50/$100 + custom ≥$5. Polling + webhook `/api/webhook/stripe`, idempotent crediting.
- **Voice/Video**: Cloudflare Calls SFU proxied through backend (`/api/rtc/*` — session/tracks/renegotiate). Client WebRTC in `src/lib/rtc.js`.
- **Old codebase**: deprecated Neon/Auth0/Agora TS repo remains untouched at /app/client, /app/server (reference only).

## What's Implemented (2026-07-02) — all tested (30/30 backend, frontend verified)
- Home (hero, tagline, online readers, newsletter, FB/Discord links), Browse Readers + filters, Reader Profile + reviews + Start Reading, About (founder Emilynn), Community forum (posts, 1-level comments, flagging), Login/Signup, Help/FAQ
- Full chat reading flow E2E: request → balance check ($5 min) → reader accept/decline → live session → 60s billing ticks (60/40 split verified) → end → rate/review
- Client dashboard: balance, Add Funds (Stripe), reading history, active sessions, transaction ledger
- Reader dashboard: online toggle (live on browse page), per-minute rates, earnings (today/pending/historical), session history (Client #id privacy), reviews
- Admin dashboard: searchable users, Create Reader (Supabase auth + initial password + image upload to Supabase Storage), Edit Reader, all readings w/ revenue split, transaction ledger, manual balance adjust w/ reason, payouts (≥$15), forum moderation queue w/ delete

## Known Gaps / Flags
1. **Cloudflare Realtime App ID invalid** — CF API returns `appId does not exist`. Voice/video request/accept/billing/chat all work, but A/V media won't connect until user provides a valid Calls App ID + secret (Cloudflare Dashboard → Realtime → SFU app). Update `CLOUDFLARE_REALTIME_APP_ID/TOKEN` in `/app/backend/.env`.
2. **Stripe LIVE keys in preview** — real charges possible; consider test keys for staging.
3. Google/Apple social login deferred by user choice (email/password only). Buttons noted "coming soon"; enable providers in Supabase Dashboard when ready.
4. Stripe Connect Express payouts deferred — admin "Record Payout" logs manual payouts instead.
5. MoQ relay: chat uses backend WebSocket (transcript, presence, billing events) instead — functionally equivalent for launch.

## Backlog
- P0: Valid Cloudflare credentials → verify voice/video media E2E
- P1: Google + Apple social login (Supabase providers); Stripe Connect payouts; reconnection auto-rejoin UX polish
- P2: Commission admin UI (change 60→70), reader application flow, notifications via email, deferred features (live streaming, shop, gifting, scheduled bookings, DMs)

## Credentials
See /app/memory/test_credentials.md
