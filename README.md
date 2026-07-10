# ✨ SoulSeer

**A Community of Gifted Psychics**

SoulSeer is a premium platform connecting spiritual readers with clients seeking guidance. The app embodies a mystical yet professional atmosphere while providing robust functionality for seamless spiritual consultations.

## 🔮 Initial Launch Features

- **Pay-Per-Minute Readings** — Live chat, voice, and video sessions via Cloudflare Realtime
- **Spiritual Community** — On-platform forum + Discord & Facebook community links
- **Prepay Balance System** — Clients add funds, billed per-minute during sessions
- **Reader Dashboard** — Earnings tracking, availability toggle, rate management
- **Admin Dashboard** — Full platform control, reader onboarding, financial oversight

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Vite) + TypeScript |
| Backend | Node.js + Express + TypeScript |
| Database | Supabase (PostgreSQL) + Drizzle ORM |
| Auth | Supabase Auth (email/password + Google + Apple) |
| Payments | Stripe + Stripe Connect |
| Real-Time | Cloudflare Realtime (serverless SFU + Calls TURN + MoQ relay) |
| Architecture | Monorepo (client / server / shared) |

## 📁 Project Structure

```
soulseer/
├── client/          # React frontend (Vite)
│   ├── src/
│   │   ├── app/         # App root & router
│   │   ├── components/  # Reusable UI components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── pages/       # Page components
│   │   ├── services/    # API client
│   │   ├── styles/      # Global CSS
│   │   └── types/       # TypeScript types
│   └── index.html
├── server/          # Express API server
│   ├── src/
│   │   ├── db/          # Database connection & migrations
│   │   ├── middleware/   # Auth, rate limiting
│   │   ├── routes/      # API route handlers
│   │   ├── services/    # Business logic
│   │   └── utils/       # Logger, helpers
│   └── drizzle.config.ts
├── shared/          # Shared types & schema
│   └── src/
│       ├── schema.ts    # Drizzle schema (source of truth)
│       └── index.ts     # Exports
├── .env.example     # Environment variable template
└── package.json     # Root monorepo config
```

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- npm 10+
- Supabase project (database + auth)
- Stripe account
- Cloudflare account (Realtime app + Calls TURN key)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/EmilynnJ/soulseer.git
cd soulseer

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# 4. Apply the database schema + RLS policies to Supabase Postgres
npm run db:migrate -w server   # runs server/drizzle against DATABASE_URL

# 4b. Seed the admin account (manual DB seed per launch guide)
cd server && ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/seed-admin.ts && cd ..

# 5. Start development servers
npm run dev
```

This starts both the client (port 3000) and server (port 5000) concurrently.

> **Deploying schema changes:** the schema lives in `shared/src/schema.ts` (Drizzle,
> pointed at the Supabase connection string). Generate migrations with
> `npm run db:generate -w server` and apply them with `npm run db:migrate -w server`
> against your production `DATABASE_URL` before the new code is exercised.
> Row Level Security policies live in `server/drizzle/0001_enable_rls_policies.sql`
> as an additional enforcement layer — server-side role checks remain mandatory.

## ✉️ Premium Messaging

Clients can message any reader for free from the reader's profile or the **Messages**
page. A reader may price their reply — the body stays locked until the client pays to
unlock it (60/40 reader/platform split, same as readings). Endpoints:

| Method | Route | Access | Purpose |
|--------|-------|--------|---------|
| GET | /api/messages/conversations | Auth | Conversation list |
| GET | /api/messages/with/:userId | Auth | Thread with a counterpart |
| POST | /api/messages/with/:userId | Auth | Send a message (readers may set `priceCents`) |
| POST | /api/messages/:id/unlock | Auth | Pay to unlock & read a priced message |

## 📝 API Routes

All routes prefixed with `/api`. Protected routes require a Supabase Auth JWT in the Authorization header.

| Method | Route | Access | Purpose |
|--------|-------|--------|---------|
| POST | /api/auth/sync | Auth | Sync Supabase Auth user to DB |
| GET | /api/auth/me | Auth | Current user profile |
| GET | /api/readers | Public | All reader profiles |
| GET | /api/readers/online | Public | Online readers |
| POST | /api/readings/on-demand | Client | Create reading request |
| POST | /api/readings/:id/accept | Reader | Accept reading |
| POST | /api/readings/:id/rtc-session | Participant | Cloudflare Realtime session access (ICE + channel) |
| POST | /api/readings/:id/start | Participant | Start session |
| POST | /api/readings/:id/end | Participant | End session |
| POST | /api/payments/create-intent | Auth | Top up balance |
| GET | /api/forum/posts | Public | Forum posts |
| POST | /api/admin/readers | Admin | Create reader |

See `docs/BUILD_GUIDE.md` for full API reference.

## 🎨 Design System

- **Aesthetic**: Celestial, mystical, ethereal
- **Mode**: Dark mode default
- **Colors**: Pink (#FF69B4), Gold (#D4AF37), Deep Black (#0A0A0F)
- **Fonts**: Alex Brush (headings), Playfair Display (body)

## 💰 Business Model

- Clients prepay by adding funds to their account balance
- Per-minute billing during reading sessions
- 60/40 revenue split: readers keep 60%, platform retains 40%
- Reader payouts via Stripe Connect

## 📋 License

Proprietary — All rights reserved © SoulSeer
