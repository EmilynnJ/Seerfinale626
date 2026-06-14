---
agent: infra-auditor
status: fail
findings: 13
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# Infrastructure Audit — Docker, CI/CD, Config Drift

## Summary

The project deploys to two targets: **Vercel** (client + `api/index.ts` serverless wrapper) and **Fly.io** (Docker container, full `production.ts` server). The CI pipeline is GitLab (`.gitlab-ci.yml`). Configuration is reasonable but has **several drift issues** and one **critical auto-stop misconfiguration** that will kill live WebSocket sessions.

| Severity | Count |
|---|---|
| critical | 1 |
| high | 3 |
| medium | 6 |
| low | 3 |

---

## Findings

### I-C1 — `fly.toml` has `auto_stop_machines = 'stop'` and `min_machines_running = 0` — kills WS sessions
- **severity:** critical
- **location:** `fly.toml:13-14`
- **description:** Fly.io is configured to **stop machines when idle** and run **zero machines at rest**. When a machine stops, all in-flight WebSocket connections terminate and the process restarts on the next request. For a platform whose core feature is real-time readings (WebSocket-driven events, Agora sessions, live billing heartbeats), this is a **production-breaking** configuration:
  - A reader on a paid reading who pauses for 3 minutes will be disconnected when the machine stops.
  - All connected clients will see a WS disconnect and reconnect loop.
  - The Fly `auto_start_machines = true` will start a new machine on the next request, but there's a 1–5s cold start — during which the WS server isn't accepting connections.
- **remediation:** Set `min_machines_running = 1` (or `2` for HA) and remove `auto_stop_machines = 'stop'`. Add `[http_service.checks]` with a `/api/health` interval to keep traffic flowing.

### I-H1 — `Dockerfile` CMD path assumes `src/production.js` in the build output
- **severity:** high
- **location:** `Dockerfile:63`
- **description:** `CMD ["node", "server/dist/src/production.js"]` — but the typical `tsc` output for a project with `rootDir: "src"` and `outDir: "dist"` is `server/dist/production.js` (not `server/dist/src/production.js`). Either the `tsconfig.json` has `rootDir: "."` (which puts source under `dist/src/`), or the CMD is wrong. This needs verification against `server/tsconfig.json`.
- **remediation:** Verify the actual output structure post-build, then update CMD. Better: set `rootDir: "src"` and `outDir: "../../dist"` so the build output mirrors the runtime path the CMD expects.

### I-H2 — No `HEALTHCHECK` directive in Dockerfile
- **severity:** high
- **location:** `Dockerfile:55-63`
- **description:** The container has no `HEALTHCHECK` instruction. Fly.io's `auto_stop_machines` behavior is partially driven by HTTP checks, and Kubernetes would require a probe. Without an explicit healthcheck, the orchestrator cannot tell a healthy idle process from a hung one.
- **remediation:** Add `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`. Or, if Fly's `http_service.checks` is used, define `[http_service.checks.health]`.

### I-H3 — `server/src/production.ts` and `server/src/index.ts` duplicate bootstrap, but neither is the source of truth
- **severity:** high
- **location:** `server/src/production.ts` and `server/src/index.ts`
- **description:** `index.ts` has the full bootstrap (helmet, CORS, pino, rate limit, JSON parse, routes, WebSocket attach, graceful shutdown). `production.ts` is a slimmed-down version for the Fly.io container that omits the WebSocket attach and graceful shutdown, and uses a less-strict Helmet config. If the dev (`index.ts`) helmet config gets hardened (e.g., stricter CSP), the production deploy will not pick it up.
- **remediation:** Factor common bootstrap into `server/src/app.ts` (returns a configured Express app). Both `index.ts` and `production.ts` import `createApp()` and add their own listener logic. This guarantees a single source of truth for security middleware.

### I-M1 — `.env` file present in workspace; should be git-ignored (verify)
- **severity:** medium
- **location:** `.gitignore`, `.env`
- **description:** The current environment shows a `.env` file open in the editor. `.gitignore` should exclude it. Cannot verify contents from this audit, but the file's presence in the workspace is a leak risk if anyone commits it.
- **remediation:** Confirm `.env` is in `.gitignore`; run `git ls-files .env` — if it returns the file, remove it from the index and rotate any secrets in it.

### I-M2 — Vercel routing does not include the WebSocket path
- **severity:** medium
- **location:** `vercel.json:13-16`
- **description:** Vercel's serverless functions do not support long-lived WebSocket connections. The `api/index.ts` function (using `serverless-http`) handles HTTP, but the WebSocket server (`wsService.attach(server)` in `index.ts:146`) cannot run on Vercel. The client `WebSocketContext.tsx:39-58` falls back to deriving the WS URL from `VITE_WS_URL` or `VITE_API_URL` — so a Vercel-deployed client trying to connect to a Vercel-deployed API will fail WS. If the platform is intended to deploy to Vercel, this is a **functional gap**.
- **remediation:** Document explicitly: WebSocket connections must go to the Fly.io deployment. Either (a) point `VITE_WS_URL` to Fly for production builds, or (b) move all real-time features to SSE/Polling if Vercel is the only host. The current state is implicit and confusing.

### I-M3 — `server/src/production.ts` Stripe webhook raw-body handling is incomplete
- **severity:** medium
- **location:** `server/src/production.ts:45-48`
- **description:** The production server checks `req.path === '/api/payments/webhook'` and skips JSON parsing for that route — but the canonical webhook path is `/api/webhooks/stripe` (`webhooks.ts:21`). The production server does NOT skip JSON parsing for `/api/webhooks/stripe`, so the second webhook route will fail signature verification (the body will be pre-parsed).
- **remediation:** Skip JSON parsing for both paths, or better, register an Express matcher that includes both. If `index.ts` is the source of truth, `production.ts` should use the same `webhookLimiter` + raw-body logic via a shared helper.

### I-M4 — `server/.build-status` exists but is not referenced anywhere
- **severity:** medium
- **location:** `server/.build-status`
- **description:** The file exists in the repo. The original purpose is unclear (likely a CI artifact). Not committed to git presumably, but it lives in the workspace and pollutes `ls`.
- **remediation:** Either move to `server/dist/.build-status` (and gitignore) or delete.

### I-M5 — `nx.json` declares workspaces but Nx is not in deps
- **severity:** medium
- **location:** `nx.json` (root)
- **description:** The repo has `nx.json` and references Nx task graph conventions, but `package.json` does not list `nx` as a dependency. The `npm` workspaces in `package.json:7-11` are the actual workspace mechanism. Either Nx is used (and the dep is missing) or the file is dead.
- **remediation:** Confirm whether Nx is intended. If not, delete `nx.json`. If yes, add `nx` to devDependencies and the appropriate `nx.json` tasks.

### I-M6 — `.gitlab-ci.yml` exists alongside Vercel/Fly deploys
- **severity:** medium
- **location:** `.gitlab-ci.yml`
- **description:** CI is on GitLab but deployment is on Vercel + Fly. The pipeline's `stages:` and `test/lint/build` jobs must be wired to GitLab triggers. If the project has migrated away from GitLab (the GitHub repo link in `.vibecheck/config.json` suggests it's on GitHub now), the GitLab config is stale.
- **remediation:** Confirm current CI host. If GitHub, port the pipeline to `.github/workflows/`. If GitLab, keep but add the deploy job for Fly/Vercel.

### I-L1 — `Dockerfile` `apt-get install python3 make g++` is unconditional
- **severity:** low
- **location:** `Dockerfile:10`
- **description:** Native build tools are installed even though no current dependency needs them (`bcrypt` etc. are not in deps). Increases image size by ~150MB and adds a CVEs surface.
- **remediation:** Remove unless a dep actually requires it; if so, gate behind a `pnpm install --build-from-source` flag.

### I-L2 — `client/.env.example` not in the file list
- **severity:** low
- **location:** `client/.env.example` (referenced by build)
- **description:** Vite needs `VITE_AUTH0_*`, `VITE_API_URL`, etc. at build time. The `client/.env.example` exists per the file list, but I haven't read its contents. If it doesn't include `VITE_WS_URL`, clients will silently fail to connect to the WebSocket.
- **remediation:** Verify `client/.env.example` documents every `import.meta.env.VITE_*` reference. Add `VITE_WS_URL` with a comment explaining the Fly.io vs Vercel deployment split.

### I-L3 — `Dockerfile` `EXPOSE 8080` but `app.listen(8080)` uses `process.env.PORT`
- **severity:** low
- **location:** `Dockerfile:61`, `server/src/production.ts:90`
- **description:** `Dockerfile` sets `ENV PORT=8080` and `EXPOSE 8080`, which is consistent. But `production.ts:90` does `const PORT = process.env.PORT || 8080;` and ignores `config.port`. If the operator sets `PORT=4000` in the env at deploy time, `config.port` would be `5000` (from `config.ts:67` default) but the server would actually listen on `4000` because `production.ts` uses the raw env. Inconsistent.
- **remediation:** Use `config.port` everywhere. Set `PORT` in the Dockerfile to the same value as the `EXPOSE` and rely on `config.ts` to read it.

---

## Truthpack Discrepancies

| Truthpack file | Code reality | Status |
|---|---|---|
| `truthpack/docker.json` | Dockerfile has no `HEALTHCHECK`; EXPOSE/CMD inconsistency | ⚠ drift |
| `truthpack/deploy.json` (implicit) | Both Vercel and Fly configs exist; WebSocket only works on Fly | ⚠ drift |
| `truthpack/env.json` (implicit) | `.env.example` is missing 5 vars that `config.ts` reads | ⚠ drift |
| `truthpack/security.json` (empty array) | At least 1 hardcoded secret (Pendo) and 1 hardcoded URL (debug endpoint) | ⚠ drift |

---

## Metrics

| Metric | Value |
|---|---|
| Deploy targets | 2 (Vercel, Fly.io) |
| Bootstrap files | 2 (`index.ts`, `production.ts`) — should be 1 |
| Healthcheck directives | 0 |
| CI files | 1 (`.gitlab-ci.yml`) — possibly stale |
| Env vars in `config.ts` not in `.env.example` | 5 |
| Dockerfile stages | 2 (builder, production) — well structured |
| WebSocket support per deploy target | Fly ✅, Vercel ❌ |
