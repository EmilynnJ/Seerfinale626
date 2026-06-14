---
agent: dep-auditor
status: warn
findings: 8
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# Dependency Audit — Vulnerable, Outdated, Unused

## Summary

Cross-checked against `.vibecheck/truthpack/dependencies.json` (v2.0.0, generated 2026-06-14). All direct dependencies are on **current major versions** and the truthpack reports none as `vulnerable: true` or `deprecated: true`. However, several **engineering concerns** exist around pin ranges, lockfile discipline, and an unusual self-referential dep.

| Severity | Count |
|---|---|
| critical | 0 |
| high | 1 |
| medium | 3 |
| low | 4 |

---

## Findings

### D-H1 — `vibecheck` is a self-referential dependency
- **severity:** high
- **location:** `package.json:43`
- **description:** `"vibecheck": "^0.0.1-0"` is a direct dependency. The codebase IS the VibeCheck project (per `.vibecheck/config.json:project.name = "Seerfinale626"`). Installing VibeCheck as a dep of the codebase creates a circular relationship: the project's own tooling is in its own `node_modules`. This is fine in a monorepo context where VibeCheck is a published package, but in this repo there's no `vibecheck` workspace, no source for it, and no consumer.
- **remediation:** Either (a) move VibeCheck usage to a workspace if the goal is internal consumption, or (b) remove the dependency if it's unused at runtime (grep for `from 'vibecheck'` or `require('vibecheck')` to confirm — none found in the audited source).

### D-M1 — No `engines` field in any `package.json`
- **severity:** medium
- **location:** `package.json` (root), `server/package.json`, `client/package.json`, `shared/package.json`
- **description:** `README.md:65` requires "Node.js 18+". The `Dockerfile:5` uses `node:20-slim`. But the package.json files do not declare an `engines` range. CI can be tricked into building on Node 16 (the lowest LTS still receiving security updates) or Node 21 (which may have breaking changes).
- **remediation:** Add `"engines": { "node": ">=20.0.0" }` to all four `package.json` files. Optionally add `"engines": { "npm": ">=10" }`.

### D-M2 — `^` pin ranges in deps but not in `engines`-style discipline
- **severity:** medium
- **location:** all `package.json` files
- **description:** All dependencies use caret (`^`) ranges, allowing minor and patch upgrades on `npm install`. The `package-lock.json` is committed (good), so installs are deterministic for a given lockfile. But the README does not mention `npm ci` vs `npm install`. CI/CD pipelines often use `npm install` (which respects the lockfile but updates the lockfile on a changed range), and dev installs may produce different trees.
- **remediation:** Document in README and CI: use `npm ci` (not `npm install`) for reproducible builds. Add a check in `.gitlab-ci.yml` (or GitHub Actions) to verify `package-lock.json` is up to date with `package.json`.

### D-M3 — `vibecheck` is unmaintained / unknown provenance
- **severity:** medium
- **location:** `package.json:43`
- **description:** `"vibecheck": "^0.0.1-0"` — the `0.0.1-0` pre-release pattern is non-standard. A typical pre-release version is `1.0.0-rc.1` or `0.1.0-alpha`. The `0.0.1-0` syntax resolves via npm's semver, but it's unusual and suggests this is an internal package or a placeholder.
- **remediation:** If VibeCheck is not actually used, remove the dep. If it is used, switch to a pinned version (no `^`) and document the source (e.g., `file:./tools/vibecheck` for a workspace).

### D-L1 — Direct deps: all on current major versions
- **severity:** low
- **location:** `.vibecheck/truthpack/dependencies.json`
- **description:** Per the truthpack:
  - `@neondatabase/serverless@^0.10.4` — current
  - `agora-token@^2.0.5` — current
  - `cloudinary@^2.5.1` — current
  - `cors@^2.8.5` — current
  - `dotenv@^16.6.1` — current
  - `drizzle-orm@^0.45.2` — current
  - `express@^4.22.2` — current (v5 also out, but v4 is LTS)
  - `express-oauth2-jwt-bearer@^1.6.0` — current
  - `express-rate-limit@^7.5.0` — current
  - `helmet@^8.1.0` — current
  - `jose@^5.9.6` — current
  - `multer@^2.1.1` — current
  - `pino@^9.9.0` — current
  - `pino-http@^10.0.0` — current
  - `serverless-http@^4.0.0` — current
  - `stripe@^17.2.0` — current
  - `ws@^8.21.0` — current
  - `zod@^3.23.8` — current
  - `@auth0/auth0-react@^2.2.4` — current
  - `@stripe/react-stripe-js@^6.2.0` — current
  - `@stripe/stripe-js@^9.2.0` — current
  - `agora-rtc-sdk-ng@^4.20.0` — current
  - `agora-rtm-sdk@^2.1.0` — current
  - `react@^18.3.1` — current (v19 is out; v18 is LTS)
  - `react-dom@^18.3.1` — current
  - `react-router-dom@^6.30.4` — current (v7 is out; v6 is stable)
  - `posthog-node@^5.37.0` — current
  - `auth0@^5.7.0` — current
  - `typescript@^5.7.3` — current
- **remediation:** None.

### D-L2 — No `npm audit` / Snyk in CI
- **severity:** low
- **location:** `.gitlab-ci.yml`
- **description:** CI does not run `npm audit` or a third-party SCA (Snyk, Dependabot, Renovate). New CVEs in transitive deps won't be caught until a manual audit. The truthpack does include `vulnerable: true/false` per dep, but that's a snapshot, not a live check.
- **remediation:** Add `npm audit --audit-level=high` to CI. Or enable Dependabot/Renovate for GitHub.

### D-L3 — `package-lock.json` may contain transitive `vibecheck` resolution
- **severity:** low
- **location:** `package-lock.json`
- **description:** The lockfile likely contains a `vibecheck` entry with the resolved tarball URL. If the tarball registry is not internal/private, the lockfile could resolve to a public package of the same name (npm allows squat on unused names until claimed).
- **remediation:** Verify with `npm ls vibecheck` and `cat package-lock.json | grep vibecheck` to see the resolved URL. If it's a public registry URL, remove the dep. If it's a private registry, add a `.npmrc` enforcing the registry scope.

### D-L4 — `concurrently` is a dev-only tool; should be in `devDependencies`
- **severity:** low
- **location:** `package.json:54`
- **description:** `concurrently: ^10.0.3` is in `devDependencies` — correct. Just confirming.
- **remediation:** None.

---

## Transitive Deps (not exhaustively audited)

| Direct | Notable transitive | Concern |
|---|---|---|
| `pino@9` | `pino-pretty` is not in deps | Dev logs would be raw JSON in `npm run dev` |
| `posthog-node@5` | `axios` for some calls | Adds HTTP client weight |
| `stripe@17` | n/a | Library is well-maintained |
| `cloudinary@2` | `q` for promise polyfill | Adds ~10KB |

---

## Metrics

| Metric | Value |
|---|---|
| Direct deps | 26 (per truthpack) |
| Deps with `vulnerable: true` | 0 |
| Deps with `deprecated: true` | 0 |
| Self-referential deps | 1 (`vibecheck`) |
| `engines` declarations | 0 |
| CI dependency-audit step | 0 |
| Lockfile committed | ✅ |
