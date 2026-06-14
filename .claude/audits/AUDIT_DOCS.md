---
agent: doc-auditor
status: fail
findings: 11
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# Documentation Audit — Stale, Missing, Inconsistent

## Summary

The project has a `README.md` and a detailed `docs/BUILD_GUIDE.md`, plus per-package summaries (`client/CHANGES_SUMMARY.md`, `client/ENV_SECURITY_GUIDE.md`, `client/TEST_SUMMARY.md`). However, **the build guide is significantly out of date** — it describes a different billing architecture (cron-driven, 70/30 split) than what is in code (heartbeat-driven, 60/40 split), and a number of doc-stale issues would mislead a new contributor.

| Severity | Count |
|---|---|
| critical | 0 |
| high | 3 |
| medium | 5 |
| low | 3 |

---

## Findings

### D-H1 — Build guide describes cron-based 70/30 billing; code uses heartbeat 60/40
- **severity:** high
- **location:** `docs/BUILD_GUIDE.md:96-100` and `docs/BUILD_GUIDE.md:8.4`
- **description:** The guide states:
  - "Server-side billing timer fires every 60 seconds"
  - "Each tick: deduct pricePerMinute from client balance, credit reader **70%**, platform keeps **30%**"
  - "When both participants join Agora and call POST /api/readings/:id/start, server records startedAt timestamp"

  The actual code (`server/src/services/billing-service.ts:24-39`):
  - Billing is **heartbeat-driven**, not cron-driven. Each `POST /api/readings/:id/heartbeat` calls `settle()` which charges the owed minutes.
  - The split is `READER_SHARE = 0.6` (60/40) in `shared/src/validators.ts:177` and confirmed in `shared/src/index.ts` re-export.
  - Vercel cron was explicitly removed because the serverless runtime cannot hold a setInterval between invocations.

  This is a **major drift**. A new developer reading the build guide and looking for the cron job will not find it. A new finance auditor will see 70% in docs and 60% in code.
- **remediation:** Rewrite `docs/BUILD_GUIDE.md` §8.4 to describe the heartbeat model, including the `GRACE_PERIOD_MS = 120_000` (2-min) constant and the `sweepStale` opportunistic cleanup. Update the split to 60/40. Reference the actual route `POST /api/readings/:id/heartbeat`.

### D-H2 — Three sources of truth disagree on revenue split
- **severity:** high
- **location:** `shared/src/types.ts:57-58`, `shared/src/validators.ts:177`, `docs/BUILD_GUIDE.md`
- **description:**
  - `shared/src/types.ts:57-58` exports `PLATFORM_FEE_PERCENT = 30` and `READER_SHARE_PERCENT = 70` — **unused** (grep for these names returns no callers).
  - `shared/src/validators.ts:177` exports `READER_SHARE = 0.6` (60/40) — **used** by `billing-service.ts:8` and `messages.ts:11`.
  - `docs/BUILD_GUIDE.md:97` says "credit reader 70%, platform keeps 30%" — **stale**.
- **remediation:** Delete `PLATFORM_FEE_PERCENT` and `READER_SHARE_PERCENT` from `shared/src/types.ts`. Update the build guide to match `READER_SHARE = 0.6`. Add a one-line comment in `shared/src/validators.ts` above `READER_SHARE` noting it is the single source of truth.

### D-H3 — `.env.example` claims `BREVO_SENDER_EMAIL` defaults to `hello@soulseerpsychics.com` but config defaults to the same
- **severity:** high
- **location:** `.env.example:43-46`, `server/src/config.ts:85-86`, `server/src/services/brevo-service.ts:121, 136, 155`
- **description:** Email templates hardcode `https://soulseerpsychics.com` in:
  - `unsubscribeUrl` (line 121)
  - "Browse Readers" CTA (line 136)
  - Text footer (line 155)

  `.env.example:11` shows the deployed frontend URL is `https://soulseerpsychics.vercel.app`. The `soulseerpsychics.com` domain is referenced in copy but is **not the production URL**. Customers clicking these links will hit a domain that may not exist (or be a different product).
- **remediation:** Replace hardcoded `soulseerpsychics.com` in `brevo-service.ts` with `config.frontendUrl`. Add `FRONTEND_URL` to `config.ts` with a sensible default. Note the change in `.env.example`.

### D-M1 — `README.md` directory tree is stale
- **severity:** medium
- **location:** `README.md:30-55`
- **description:** The tree lists:
  - `client/src/app/` — actual: `client/src/` directly (no `app/` subdir)
  - `client/src/services/` — accurate
  - `server/src/utils/` — accurate
  - `shared/src/` — accurate
  The tree is otherwise a good orientation but the `app/` path will lead a new dev to grep for files that don't exist there.
- **remediation:** Run `tree client/src server/src shared/src -L 2` and replace the manual tree with the output (or use a script that regenerates on build).

### D-M2 — `README.md` setup steps omit `shared` build
- **severity:** medium
- **location:** `README.md:69-86`
- **description:** Step "5. Start development servers" works because Vite/tsc compile `shared` on the fly via `tsx`. But step 4 (`npm run db:push`) requires the schema to be loadable as TS — which works for the dev tools. For production (`npm run build`), `shared` must be built first. The README doesn't say so.
- **remediation:** Add: "Before deploying, run `npm run build` which builds `shared` first, then `server`, then `client`."

### D-M3 — No CHANGELOG.md
- **severity:** medium
- **location:** repo root
- **description:** The project has `client/CHANGES_SUMMARY.md` (presumably a per-client changelog) but no top-level `CHANGELOG.md` and no release notes. `git log` is the only source of history.
- **remediation:** Adopt [Keep a Changelog](https://keepachangelog.com/) format. Initial entries can be backfilled from `git log --oneline` grouped by milestone.

### D-M4 — No API documentation
- **severity:** medium
- **location:** repo root
- **description:** There is no `docs/API.md` or OpenAPI spec. The 30+ API routes are documented only by their Zod schemas in `shared/src/validators.ts` and by inline JSDoc on a few handlers. External integrators (and new client devs) have no canonical request/response reference.
- **remediation:** Generate an OpenAPI 3.1 spec from the Zod schemas using [`zod-to-openapi`](https://github.com/asteasolutions/zod-to-openapi) and commit it to `docs/openapi.yaml`. Or, if out of scope, add a `docs/API.md` index of routes grouped by domain (auth, readings, payments, messages, forum, admin).

### D-M5 — `.env.example` is missing the PostHog, Pendo, and Brevo sender vars
- **severity:** medium
- **location:** `.env.example:1-49`
- **description:** `config.ts:84-93` reads:
  - `BREVO_SENDER_EMAIL` (defaulted to `hello@soulseerpsychics.com` — **not** in `.env.example`)
  - `BREVO_SENDER_NAME` (defaulted to `SoulSeer` — **not** in `.env.example`)
  - `NEWSLETTER_WELCOME_ENABLED` (defaulted to `true` — **not** in `.env.example`)
  - `POSTHOG_API_KEY` (defaulted to `''` — **not** in `.env.example`)
  - `POSTHOG_HOST` (defaulted to `https://us.i.posthog.com` — **not** in `.env.example`)
  - `ADMIN_EMAILS` (defaulted to `emilynnj14@gmail.com` — **not** in `.env.example`)

  These vars affect behavior at runtime; their absence from `.env.example` makes onboarding harder.
- **remediation:** Add all five to `.env.example` with comments explaining the default and when to override.

### D-L1 — `client/CHANGES_SUMMARY.md` is referenced in the file tree but contents are stale
- **severity:** low
- **location:** `client/CHANGES_SUMMARY.md`
- **description:** A summary of recent client changes. Without reading the file I can't confirm staleness, but the doc-auditor convention is to flag any document that lives alongside active code without a "Last updated" header.
- **remediation:** Add a "Last updated: YYYY-MM-DD" header to every markdown file under `client/`, `server/`, `docs/`, and root. Optionally enable a CI check that fails if any `.md` in these paths is older than 90 days.

### D-L2 — JSDoc coverage is sparse on public services
- **severity:** low
- **location:** `server/src/services/*.ts`
- **description:** `auth0-management.ts`, `cloudinary-service.ts`, `brevo-service.ts` have header JSDoc but per-method documentation is missing. New contributors will read the class header and then face implementation details.
- **remediation:** Add JSDoc to each public method (`createUserWithPassword`, `upsertUserWithPassword`, `deleteUser`, `uploadBuffer`, `send`, `sendNewsletterWelcome`) describing params, return value, and side effects.

### D-L3 — `docs/BUILD_GUIDE.md` extracted from a document with `(None)` prefix artifacts
- **severity:** low
- **location:** `docs/BUILD_GUIDE.md:1-100`
- **description:** The file begins with `(None) SoulSeer`, `(None) Initial Launch Build Guide`, etc. The `(None)` prefix is a Word/PDF export artifact (e.g., from Pandoc with `--no-wrap` of empty style names). It clutters the document and looks like a parsing bug to readers.
- **remediation:** Strip the `(None)` prefixes. Either re-export the source, or run `sed -i 's/^(None) //g' docs/BUILD_GUIDE.md` and verify the rest still makes sense.

---

## Metrics

| Metric | Value |
|---|---|
| Markdown files in repo | 9 (root, docs/, client/) |
| Markdown files with "Last updated" header | 0 |
| Truthpack-disagreeing facts in docs | 3 (revenue split, billing model, frontend URL) |
| Unused exported constants in `shared/src` | 2 (`PLATFORM_FEE_PERCENT`, `READER_SHARE_PERCENT`) |
| API routes documented in any markdown | 0 (only JSDoc on individual handlers) |
