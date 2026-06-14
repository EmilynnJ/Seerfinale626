---
agent: ui-auditor
status: warn
findings: 10
truthpack_version: 2.0.0
git_sha: 4e17db6e68bedf663e21f218d596f8e1a6a8a014
---

# UI / Accessibility Audit

## Summary

The client has a polished **cosmic/celestial** aesthetic and demonstrates **good accessibility practices** in many places: `aria-label` on icon buttons, `role="status"`/`aria-live` on session timers, `aria-expanded`/`aria-controls` on mobile menu, `aria-hidden` on decorative elements, keyboard handlers on interactive cards, and a `Skip to main content` link. However, several **a11y gaps**, **missing focus management**, and **a few UX rough edges** remain.

| Severity | Count |
|---|---|
| critical | 0 |
| high | 1 |
| medium | 4 |
| low | 5 |

---

## Findings

### U-H1 — Modal components lack focus trap and focus return
- **severity:** high
- **location:** `client/src/components/ui/Modal.tsx`, `client/src/components/ChatTranscriptModal.tsx`, `client/src/components/AddFundsForm.tsx`
- **description:** Modals are used (chat transcript, add funds) but the codebase has no global focus-trap utility. When a modal opens, the user can Tab into the page underneath, and on close focus is not returned to the trigger button. This is a WCAG 2.1 SC 2.4.3 (Focus Order) and SC 2.1.2 (No Keyboard Trap, in this case the inverse) issue.
- **remediation:** Add a small `useFocusTrap(ref)` hook that captures Tab inside a container. Add `useFocusReturn(triggerRef)` that stores and restores the previously-focused element. Apply to every modal in the app.

### U-M1 — `onKeyDown` on `ReaderCard` does not work when not focused via Tab
- **severity:** medium
- **location:** `client/src/pages/HomePage.tsx:30-36`
- **description:** The reader card has `tabIndex={0}` and an `onKeyDown` for Enter/Space, but the inner `<Link>` "Start Reading" button is also keyboard-focusable. Tab order is: card → link → next card → next link. The card's role is `link` and the inner link is a separate link. Screen readers will announce two link destinations for the same card.
- **remediation:** Either (a) remove the `tabIndex` and onKeyDown from the outer `div` and rely on the inner Link, or (b) make the entire card a single `<a>` with the inner button as a styled span. (b) is the a11y-better pattern.

### U-M2 — `Navigation` mobile menu has no `tabindex="-1"` on container
- **severity:** medium
- **location:** `client/src/components/Navigation.tsx:148-198`
- **description:** When the mobile menu is closed, the inner links remain in the tab order (they're rendered but `aria-hidden` is not set). Keyboard users can Tab into hidden links, then "open" them with Enter on a non-visible link. Setting `aria-hidden="true"` on the closed menu container solves this.
- **remediation:** Add `aria-hidden={!mobileOpen}` to the mobile menu `div`. On close, focus the toggle button.

### U-M3 — Color-contrast on `.session-bar__value--warning` not verified
- **severity:** medium
- **location:** `client/src/styles/global.css` (or `pages.css`)
- **description:** The "Low balance" warning is rendered with `badge--danger` and the `SessionBar` shows a value styled as `--warning`. The cosmic dark theme (`#0A0A0F` background with `#FF69B4` / `#D4AF37` accents) does not have a verified WCAG AA contrast audit. The pink on dark may fail for body text; gold on dark for buttons may fail for small text.
- **remediation:** Run an automated contrast audit (axe DevTools, Lighthouse) and document the verified pairings. Add a "Verified AA" badge to `global.css` for each color combination.

### U-M4 — `ImageUploadField` has no error region
- **severity:** medium
- **location:** `client/src/components/ImageUploadField.tsx`
- **description:** When an image upload fails (5MB limit, wrong type, network error), the error is shown in a toast but the input itself does not get `aria-invalid="true"` or `aria-errormessage` pointing to a `<p id="..." role="alert">`. Screen reader users will not know the upload failed.
- **remediation:** Add `aria-invalid` and `aria-describedby` to the file input; render an inline `<p role="alert">` with the error.

### U-L1 — Hero image uses external `postimg.cc` URL with no fallback
- **severity:** low
- **location:** `client/src/pages/HomePage.tsx:121-126`
- **description:** `<img src="https://i.postimg.cc/tRLSgCPb/HERO-IMAGE-1.jpg" loading="eager" />` — if postimg.cc is down or rate-limits, the hero breaks. No `onError` handler, no fallback src.
- **remediation:** Add `onError={(e) => { e.currentTarget.src = '/fallback-hero.webp'; }}`. Better: self-host the image in `client/public/`.

### U-L2 — `CosmicBackground` animation may trigger motion-sensitivity
- **severity:** low
- **location:** `client/src/components/CosmicBackground.tsx`
- **description:** Background animations (parallax stars, twinkling) are rendered without checking `prefers-reduced-motion`. Users with vestibular disorders may experience discomfort.
- **remediation:** Add a CSS `@media (prefers-reduced-motion: reduce) { .cosmic-bg * { animation: none !important; transition: none !important; } }` rule, or check the media query in JS and skip the animation.

### U-L3 — Buttons inside `<Link>` render nested clickable elements
- **severity:** low
- **location:** `client/src/pages/HomePage.tsx:69-77`
- **description:** `<Link><Button>Start Reading</Button></Link>` — a Button is itself a `<button>` by default; nesting a button inside an anchor is invalid HTML and produces inconsistent a11y. Should be `<Link className="btn btn--primary">` or a custom `as="a"` prop.
- **remediation:** Make the `Button` component polymorphic (accept `as` prop) and render as `<a>` inside a Link, or use a styled `<Link>` with the same look.

### U-L4 — `ErrorBoundary` does not announce errors to assistive tech
- **severity:** low
- **location:** `client/src/components/ErrorBoundary.tsx`
- **description:** When a render error occurs, the user sees a fallback UI, but the boundary doesn't set `role="alert"` on the fallback or use `aria-live="assertive"` to announce the error. Screen reader users will silently see a broken page.
- **remediation:** Wrap the fallback in `role="alert"` and include a "Reload" or "Sign out" action.

### U-L5 — `ToastProvider` is mounted but toasts may not be announced
- **severity:** low
- **location:** `client/src/components/ToastProvider.tsx`
- **description:** Toasts are visually rendered with color/icon but not necessarily announced to screen readers. Add `aria-live="polite"` (info/success) or `aria-live="assertive"` (error) to the toast container, and `role="status"` to each toast.
- **remediation:** Add ARIA live regions to the toast container; add `role="status"` to each toast.

---

## Responsive Design (visual heuristic — not exhaustive)

| Breakpoint | Status | Notes |
|---|---|---|
| 375px (mobile) | ✅ likely ok | Mobile menu implemented; reader cards reflow |
| 768px (tablet) | ✅ likely ok | Two-column grids |
| 1280px (desktop) | ✅ likely ok | Max-width container |
| 1920px+ (large) | ⚠ not addressed | `max-width` likely caps the content; not verified |

The build guide (`docs/BUILD_GUIDE.md:33`) calls out 375/768/1280 as the required test points. The CSS classes (`grid--readers`, `nav__inner`) appear responsive, but the audit was static — visual confirmation in browser is recommended.

---

## Metrics

| Metric | Value |
|---|---|
| Pages audited | 13 (all `client/src/pages/`) |
| Components audited | 17 (all `client/src/components/`) |
| `aria-label`/`aria-labelledby` occurrences | 60+ (good coverage) |
| `role="alert"` / `aria-live` | 4 instances — should be more |
| Modals with focus trap | 0 (gap) |
| `prefers-reduced-motion` honored | 0 (gap) |
