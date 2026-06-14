---
agent: seo-auditor
status: fail
findings: 9
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# SEO Audit — Meta, OG, Structured Data

## Summary

The site has **basic meta tags** on the root HTML (title, description, OG title/description/type) but is missing **canonical URLs, OG image, Twitter card, structured data, sitemap, robots.txt**, and per-page meta management. The SPA is fundamentally a JavaScript-only app, which adds a layer of SEO complexity. Without SSR/SSG or per-route meta, only the root page is discoverable.

| Severity | Count |
|---|---|
| critical | 0 |
| high | 3 |
| medium | 4 |
| low | 2 |

---

## Findings

### S-H1 — No `<link rel="canonical">` to prevent duplicate-content issues
- **severity:** high
- **location:** `client/index.html:1-29`
- **description:** Without a canonical link, search engines and social platforms may index multiple variants of the same URL (with/without trailing slash, with query params, http vs https). For a Vite SPA, this is amplified because the client may not signal the active route to crawlers.
- **remediation:** Add `<link rel="canonical" href="https://soulseerpsychics.vercel.app/" />` to the root. Better: use `react-helmet-async` to set per-route canonicals.

### S-H2 — No `og:image` / `twitter:card` — link previews are blank
- **severity:** high
- **location:** `client/index.html:6-11`
- **description:** When a SoulSeer URL is shared on Twitter, LinkedIn, Slack, Discord, Facebook, etc., the preview card has the title and description but **no image**. The hero image is hardcoded at `https://i.postimg.cc/tRLSgCPb/HERO-IMAGE-1.jpg` in `client/src/pages/HomePage.tsx:122` — it should also be the `og:image`.
- **remediation:** Add to `index.html`:
  ```html
  <meta property="og:image" content="https://i.postimg.cc/tRLSgCPb/HERO-IMAGE-1.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="SoulSeer — A Community of Gifted Psychics" />
  <meta name="twitter:description" content="Ethical, compassionate spiritual guidance from gifted psychics." />
  <meta name="twitter:image" content="https://i.postimg.cc/tRLSgCPb/HERO-IMAGE-1.jpg" />
  ```

### S-H3 — No JSON-LD structured data
- **severity:** high
- **location:** `client/index.html` (no `<script type="application/ld+json">`)
- **description:** Search engines reward structured data with rich results. For a platform with:
  - A business (`Organization` / `LocalBusiness` schema)
  - Many reader profiles (`Person` schema with `aggregateRating`)
  - Reviews (`Review` schema on the reader-profile page)
  - Forum posts (`DiscussionForumPosting` schema)
  
  Adding JSON-LD would improve SERP presence significantly.
- **remediation:** Add the following to `index.html`:
  ```html
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "SoulSeer",
    "url": "https://soulseerpsychics.vercel.app",
    "logo": "https://i.postimg.cc/tRLSgCPb/HERO-IMAGE-1.jpg",
    "description": "Ethical, compassionate spiritual guidance from gifted psychics.",
    "sameAs": []
  }
  </script>
  ```
  For per-page structured data, use `react-helmet-async` to inject JSON-LD on the reader profile and home pages.

### S-M1 — All pages share the root `<title>` and `<meta description>`
- **severity:** medium
- **location:** `client/index.html:6-7`
- **description:** Every route (`/readers`, `/community`, `/readers/:id`, etc.) renders the same `<title>SoulSeer — A Community of Gifted Psychics</title>` and same description. Search engines and social previews cannot differentiate between pages.
- **remediation:** Install `react-helmet-async`, wrap `<App />` in `<HelmetProvider>`, and add per-page meta:
  ```tsx
  <Helmet>
    <title>{reader.fullName} — Psychic Reader on SoulSeer</title>
    <meta name="description" content={reader.bio?.slice(0, 160)} />
  </Helmet>
  ```

### S-M2 — No `robots.txt` and no `sitemap.xml`
- **severity:** medium
- **location:** `client/public/` (doesn't exist) or served by Vercel
- **description:** Crawlers hitting the root have no `robots.txt` to learn crawl rules and no `sitemap.xml` to discover routes. For a Vite SPA, the Vercel rewrite in `vercel.json:13-16` means every unknown route returns `index.html` — the crawler will then need to enumerate links.
- **remediation:**
  - Add `client/public/robots.txt`:
    ```
    User-agent: *
    Allow: /
    Disallow: /api/
    Sitemap: https://soulseerpsychics.vercel.app/sitemap.xml
    ```
  - Generate `client/public/sitemap.xml` (static for now, dynamic when more routes exist) with all top-level pages.

### S-M3 — Vite SPA needs SSR/SSG for full SEO
- **severity:** medium
- **location:** client architecture
- **description:** The SPA renders only after JS executes. Google's crawler can execute JS but is rate-limited; Bing's crawler is weaker; AI assistants and link-preview bots often don't. For a public-facing site that should rank for "online psychic readings" etc., an SSR/SSG pass is needed for the home, readers, and reader-profile pages.
- **remediation:** Either (a) accept the SEO limitation and rely on paid acquisition, (b) add Vite SSG via `vite-plugin-ssr` or migrate to Next.js, or (c) pre-render the home page and `/readers` to static HTML at build time.

### S-M4 — No `<html lang>` attribute variation for i18n
- **severity:** medium
- **location:** `client/index.html:2`
- **description:** `<html lang="en">` is correctly set. Good. But the build guide mentions the site is targeted at "SoulSeer" — there's no `hreflang` for any other locale. If international expansion is planned, document the i18n strategy.
- **remediation:** None for now; revisit when adding a second locale.

### S-L1 — `viewport` meta is correct
- **severity:** low
- **location:** `client/index.html:4`
- **description:** `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` — present. Good.
- **remediation:** None.

### S-L2 — `theme-color` is correct
- **severity:** low
- **location:** `client/index.html:8`
- **description:** `<meta name="theme-color" content="#0A0A0F" />` — present. Good.
- **remediation:** None.

---

## Missing Tags (Consolidated)

| Tag | Status |
|---|---|
| `<title>` (root) | ✅ present |
| `<title>` (per page) | ❌ all routes share root |
| `<meta name="description">` (root) | ✅ present |
| `<meta name="description">` (per page) | ❌ |
| `<link rel="canonical">` | ❌ |
| `<meta property="og:title">` | ✅ present |
| `<meta property="og:description">` | ✅ present |
| `<meta property="og:image">` | ❌ |
| `<meta property="og:url">` | ❌ |
| `<meta property="og:site_name">` | ❌ |
| `<meta property="og:type">` | ✅ present (website) |
| `<meta name="twitter:card">` | ❌ |
| `<meta name="twitter:title">` | ❌ |
| `<meta name="twitter:description">` | ❌ |
| `<meta name="twitter:image">` | ❌ |
| JSON-LD `Organization` | ❌ |
| JSON-LD `WebSite` | ❌ |
| JSON-LD `Person` (per reader) | ❌ |
| JSON-LD `BreadcrumbList` | ❌ |
| `robots.txt` | ❌ |
| `sitemap.xml` | ❌ |
| `favicon.ico` | ⚠ only `favicon.svg` referenced; not all browsers support svg favicon |

---

## Metrics

| Metric | Value |
|---|---|
| Meta tags in `index.html` | 7 (basic) |
| Open Graph tags | 3 (title, description, type — missing image, url, site_name) |
| Twitter card tags | 0 |
| Structured data blocks | 0 |
| Sitemap | none |
| robots.txt | none |
| Per-route meta | 0 |
| Lighthouse SEO score (estimate) | ~70-80 (good but not great) |
