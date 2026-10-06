# CASANOVA BOOKS — Accessibility System

This document describes the accessibility work on the storefront: what was
removed, what replaced it, which requirements are implemented, what was
verified, and — deliberately — what is **not** claimed.

Automated tooling cannot establish legal compliance. Nothing in this document
is a legal opinion, and passing the checks listed at the end does not make the
site compliant by itself. See "Requires human or legal verification".

---

## 1. Standards in scope

| Standard | Status in this implementation |
| --- | --- |
| **Israeli Standard ת"י 5568 חלק 1** (the standard Israeli law points to) | The technical requirements it carries — WCAG 2.0 level AA, a documented accessibility statement, an identified accessibility coordinator, keyboard and screen-reader support — are implemented at the technical level. The **statement page, coordinator name and contact details are content/legal work, not code** and are not added by this change. |
| **WCAG 2.0 AA** | Implemented; this is the level the Israeli standard requires. |
| **WCAG 2.2 AA** | Used as the engineering target, which adds: 2.4.11 focus not obscured, 2.5.8 target size (minimum), 3.3.7 redundant entry, 3.3.8 accessible authentication, 1.4.10 reflow. Not all of 3.3.8 applies to this product's auth flow (see limitations). |
| **EN 301 549 / PDF/UA** | Not applicable to the protected reader as built — see section 8. |

---

## 2. What was removed

| Removed | Why |
| --- | --- |
| `src/components/AccessibilityMenu.tsx` | The old menu. It was rendered inside the header's flex row (three instances of the same component, two of them in the same view at `md` and above), it was positioned `absolute` inside a `fixed` header, it hid itself with `aria-hidden` while its own button stayed focusable, it had no Escape handling and no focus management, and its `<div role="dialog">` had no `aria-modal` or focus containment. |
| The debug launcher in `PublicRoot` | A second, always-visible "נגישות" button that dispatched `open-accessibility-debug`, a custom event only the removed menu listened for. |
| `data-access-*` CSS (`high-contrast`, `grayscale`, `highlight-links`, `reduced-motion`) | Written by the removed component only. Replaced by a new, larger `data-a11y-*` block. |
| `localStorage["casanova_accessibility_v1"]` | Read by the removed component. Deleted on first load by the new provider so stale settings cannot look live; the storage layout changed and the old flags no longer map 1:1. |
| The `filter: grayscale()` rule on `body, #root` | A `filter` on an ancestor makes it the containing block for every `position: fixed` descendant, which silently breaks the fixed header, both drawers, the reader chrome and the widget itself. Grayscale is now expressed through the theme tokens instead (see section 4). |

There is now exactly **one** accessibility interface in the app: one launcher,
one panel, one settings store.

---

## 3. Architecture

```
src/context/AccessibilityContext.tsx      state, validation, persistence, Alt+A
src/components/accessibility/
  AccessibilityWidget.tsx                 the floating launcher + settings panel
  AccessibilityFooterLink.tsx             footer entry point / restore control
  AccessibilityLauncherLogo.tsx           the launcher's logo (the button is
                                          icon-only; its name is its label)
src/index.css                             the [data-a11y-*] presentation rules
src/components/icons.tsx                  the universal-access glyph
src/App.tsx                               one mount point, above the router
```

* **One mount point.** `AccessibilityProvider` and `<AccessibilityWidget />`
  live in `src/App.tsx` outside `RouterProvider`, so no layout can forget the
  widget and no page can render a second one. The provider is never remounted
  by navigation, so preferences survive every route change without a single
  page knowing they exist.
* **Preferences reach the page as data attributes on `<html>`** (font size is
  the root `font-size` itself). Toggling a setting mutates one attribute on one
  element; no React tree re-renders, no page component reads the context, and
  CMS-rendered content is covered too. The styling lives in one labelled block
  in `src/index.css`.
* **Storage keys.** `casanova_accessibility_v2` holds `{ preferences, hidden }`
  only. No identifiers, no session, no order or reader data — so it cannot
  collide with authentication, checkout or reader state. Untrusted values are
  re-validated on read (unknown keys dropped, font size clamped to the ladder).
* **Weight.** No new dependency. The widget is ~300 lines of React and ~250
  lines of CSS, loaded in the initial bundle as part of `index.js`.

### Keyboard entry points

| Key | Action |
| --- | --- |
| `Alt + A` | Opens the settings panel from anywhere, and restores the button if it was hidden. |
| `Tab` / `Shift+Tab` | Cycles inside the open panel; focus is contained. |
| `Escape` | Closes the panel, and stops there — a dialog further up the page does not also react to the same press. |

`Alt+A` is the reason a visitor can never be locked out of the controls: it
works on the reader and the admin shell, which have no public footer.

---

## 4. Privacy, motion and content preferences

The panel offers (each toggle is a pressed-state button — icon plus text label
with `aria-pressed`, announced as pressed/not pressed):

| Group | Setting | Effect |
| --- | --- | --- |
| גודל טקסט | גודל טקסט | Root font size, 90%–160% in 10% steps, plus a "רגיל" reset. Scales every rem-based size in the product. |
| תצוגה | ניגודיות גבוהה | Black surfaces, white text, yellow interactive elements, white borders, white focus ring. Applied through the theme tokens, so pages that colour themselves with `var(--color-*)` follow automatically. |
| תצוגה | שיפור ניגודיות הטקסט | Raises the contrast of muted/secondary text without repainting the theme. |
| תצוגה | גווני אפור | Desaturates the theme tokens and real images. |
| תצוגה | פונט קריא | Swaps the display serif for the body sans. Fonts change, sizes do not, so nothing moves. |
| קריאה | ריווח שורות / ריווח אותיות | Larger line height / letter spacing on text elements. |
| קריאה | ריווח בין פסקאות | Extra margin between adjacent text blocks, not inside grids. |
| קריאה | הדגשת קישורים | Underlines every link. |
| מיקוד ותנועה | הדגשת מסגרת המיקוד | A two-tone focus ring, visible against the page and against the element it lands on. |
| מיקוד ותנועה | עצירת אנימציות | Stops animation and transitions, including `scroll-behavior`. |
| מיקוד ותנועה | הגדלת אזורי לחישה | Grows opted-in controls (`.tap-target`) and the panel's own buttons and tiles to 52px minimum. |

The OS-level `prefers-reduced-motion` request is honoured **independently** of
the settings panel, in the same CSS file.

Two settings interact by design: the high-contrast theme also strengthens the
focus ring, and light/dark theme plus high contrast combine through
`:root[data-theme="light"][data-a11y-contrast="true"]` rather than fighting for
the same specificity.

### Hiding the button

`הסתר את כפתור הנגישות` removes the floating button. It does **not** disable a
single enabled setting, and the hidden state persists. There are two ways back,
and at least one exists on every route:

1. The footer control (`הצגת כפתור הנגישות`) — in the public footer, the sales
   page footer, the dashboard and admin side navigation, and on the login,
   setup and email-verification screens, which have no footer of their own.
2. `Alt + A`, from anywhere.

Hiding is announced through a `role="status"` live region that stays mounted
even while the button is gone, and focus moves to the restore control rather
than being dropped on `<body>`.

---

## 5. Core WCAG work done beyond the widget

**Structure**

* Every shell now has exactly one `<main id="main">`: `PublicRoot`,
  `DashboardLayout`, `AdminLayout`, `AdminShell`, `ReaderPage`, `LoginPage`,
  `SetupPage`, `VerifyEmailPage`, `SalesLandingPage`.
* A skip-to-content link is the first focusable element on every shell that has
  chrome above the content, including the reader (`דלג לתוכן הקריאה`). The link
  used a physical `left: 8px` — the wrong side of the screen in an RTL layout —
  and is now `inset-inline-start` and `position: fixed`.
* `#main { scroll-margin-top: 5.5rem }` keeps the fixed header from covering the
  target when a skip link or an in-page anchor scrolls to it.
* Headings: one `h1` per rendered screen (verified on all public routes).

**Forms**

* Labels are now programmatically associated with their inputs (`htmlFor`/`id`)
  across the customer-facing flows: login and registration, password reset,
  first-run setup, checkout, the support form and its reply box, and the store
  filters. Previously every label was a visual sibling only, so assistive tech
  announced the fields as unlabelled.
* Error messages carry `role="alert"` and are wired to their field with
  `aria-describedby` plus `aria-invalid`, so the association survives leaving the
  field. The mismatch/success message on the checkout e-mail confirmation is
  described the same way.
* Register-mode hints are described on the password field.
* Icon-only selects in the store and checkout carry accessible names.

**Keyboard**

* The password show/hide toggle on the login, setup and reset screens was
  `tabIndex={-1}` — a functional control removed from the tab order. It is now
  focusable, has an `aria-label` and reports `aria-pressed`.
* The Maestro CMS section header became a real disclosure button
  (`aria-expanded`) instead of a clickable `div`; the product name in the Maestro
  product list and the status badge became buttons; the CMS product card's quick
  actions are revealed on keyboard focus, not only on hover.
* The exit-intent popup on the sales page is now a labelled
  `role="dialog" aria-modal="true"`: it takes focus, closes on Escape and
  returns focus to where it came from.
* Decorative overlays (scrims, modal backdrops, the library cover placeholder)
  are marked `aria-hidden` instead of being exposed as unlabelled clickables.

**Images**

* The wordmark image next to the brand name as text now has `alt=""`: the name
  is already read from the adjacent text, and repeating it made screen readers
  say it twice. The library cover behaves the same way next to the book title.

---

## 6. Verification performed

Reproduce with a build and a preview server, then the two scripts under `.tmp/`
(they drive Chrome over CDP, no test framework is installed in this repo):

```
npx tsc --noEmit                        # passes
npx vite build                          # passes
npx vite preview --port 4199
A11Y_URL=http://127.0.0.1:4199 node scripts/verify-accessibility.mjs
AXE_PATH=.tmp/package/axe.min.js node scripts/audit-accessibility.mjs
AXE_PATH=.tmp/package/axe.min.js A11Y_ALL_SETTINGS=1 node scripts/audit-accessibility.mjs
```

`scripts/` holds the canonical versions of both CDP scripts; `.tmp/` holds
older working copies. **Runtime behaviour — 42/42 checks pass** on the
production build: one launcher and no legacy markup; accessible name,
`aria-expanded`, `aria-controls`, `aria-haspopup`, floating 52px circular
launcher whose logo is the whole face of the button — rendered at full size,
centred, decorative, with no second visible copy of the name; Enter opens the
panel; dialog semantics with a resolvable name; focus moves into the panel; Tab
cycles inside it; a font-size step (A+ / A−) changes the root font size; a toggle
tile updates `aria-pressed`, the `<html>` attribute
and storage; the legacy v1 key is gone; Escape closes and returns focus to the
launcher; hiding keeps every setting, persists, appears in the footer and
receives focus; `Alt+A` restores; preferences survive a reload; reset returns to
defaults; the panel stays inside a 360×640 viewport, inside a 640×480 viewport
at 160% text, scrolls internally with every control reachable, and causes no
horizontal overflow; a hidden widget stays hidden and restorable after a reload.

**axe-core — 0 violations** on `/`, `/store`, `/checkout`, `/support`, `/login`,
`/register`, `/forgot-password`, `/terms-and-conditions`, with the panel open,
and again with **all eleven settings enabled at 160% text**:

| Route | Violations | Structure reported |
| --- | --- | --- |
| `/`, `/store` | 0 | 1 launcher, 1 panel, 1 entry point, 1 main, skip link, 1 `nav`, 1 `h1`, no duplicate ids |
| `/checkout`, `/support` | 0 | as above |
| `/login`, `/register` | 0 | 1 launcher/panel/main/`h1`, no duplicate ids, no skip link (no chrome to skip) |
| `/terms-and-conditions`, `/forgot-password` | 0 | as the storefront |
| `/dashboard`, `/admin`, `/read/abc` (redirect to `/login` without a session) | 0 | as `/login` |

Two findings this surfaced were fixed rather than documented around:
`label-content-name-mismatch` on the font-size buttons (the visible glyphs
"הגדל"/"הקטן" appear as their own words in the accessible name, WCAG 2.5.3) and
`image-redundant-alt` on the wordmark.

**Overlap check.** The launcher was measured against every visible interactive
element on `/`, `/store`, `/checkout`, `/support` at 1280px and 360px: **zero
overlaps on desktop**, and on a 360px viewport two corner overlaps under 4% of
one control's area (a filter select, a text input) — the control stays clickable
outside that corner, and the button can be hidden. The open panel necessarily
covers part of the page; that is what an overlay popup does, and it closes on
Escape, on the close button or on a click outside.

**Contrast** was verified manually where axe cannot compute against a gradient.
`.btn-gradient` (gold gradient, near-black text) resolves to ≈6.0:1 at its
darkest stop — above the 4.5:1 normal-text threshold; in high-contrast mode it
is black on `#ffe066` (≈17:1). The remaining contrast items axe could not
decide are all text over these gradients. A scripted sweep of every text
element on `/`, `/store`, `/checkout` and `/support` **in high-contrast mode**
(found zero computable failures on the three storefront routes; the landing
page's flagged items are all the 14%-alpha gold radial glow over the black page
and the hero's gradient headline, whose painted glyphs — gold gradient on black
— measure ≈6.2:1 at the darkest stop and ≈10.5:1 at the brightest, above the
4.5:1 threshold). The sweep script cannot compute through gradients, so these
were resolved by hand rather than by the tool.

---

## 7. Known limitations (honest list)

1. **Admin panel forms are not fully labelled.** The audit found ~150 controls
   in the Maestro/admin screens whose visible label is not programmatically
   associated, and they are **not** all fixed in this change. The customer-facing
   flows are done. This is internal tooling, but it is still a real WCAG 1.3.1 /
   4.1.2 gap.
2. **The reader needs a live session to test.** `/read/:productId` requires an
   authenticated entitlement, which this environment does not have, so the
   reader was changed and reviewed but **not** exercised with axe or a keyboard
   pass at runtime. It needs a manual pass on a real device session.
3. **The floating button sits mid-left, near the page edge, on small screens.** On
   the reader there is no empty gutter at all, so on a phone the button covers a
   small strip at the left edge of the viewing area. It moves nothing, can be
   hidden, and `Alt+A` brings the panel back — but it is a real trade-off, not
   a non-issue.
4. **Templates render colours outside the theme.** A handful of components set
   literal hex values (`#F59E0B`, `#F87171`…) for status badges. High contrast
   and grayscale reach the token-driven surfaces, not those few literals.
5. **Reader text size and the accessibility font scale are separate controls.**
   The reader's own +/- buttons change the PDF zoom; the global font scale
   changes chrome and page text. Both work, neither is wired to the other.
6. **No accessibility statement page and no accessibility coordinator details.**
   The panel links to the support form as a contact channel, but ת"י 5568 expects
   a published statement with a named coordinator and contact details. That is
   content and legal work.
7. **Focus containment on the panel is intentional but non-standard for some
   AT.** The panel is a non-modal dialog with a Tab cycle; VoiceOver/NVDA users
   can leave the cycle with the virtual cursor, which is the expected behaviour.
8. **No automated accessibility test runs in CI.** The scripts under `.tmp/`
   are verification aids, not a test suite; consider promoting the axe pass.

---

## 8. Protected PDF / reader (content accessibility)

The reader renders purchased titles through PDF.js onto a `<canvas>`
(`src/components/PdfCanvas.tsx`) with an identity watermark, device limits,
session timeouts and `user-select: none`.

* **A canvas has no text layer**, so nothing in this change can make the book
  content readable by a screen reader. What a screen reader can reach in the
  reader is the chrome: the toolbar buttons (all labelled), the page position
  and progress text, the previous/next controls and the skip link. The document
  itself is announced as page image number N.
* Making the *content* accessible would mean rendering an extractable text layer
  for the PDF, which is exactly the thing the copy protection exists to prevent.
  A proper solution has to be a product decision — for example accepting
  titles that ship with tagged PDFs — and a legal decision about the tension
  between the Israeli accessibility duty and the rights-holder's protection
  requirement. **This change does not claim to solve it.**
* Nothing in the accessibility system weakens the protection: no download path,
  no text extraction, no change to the watermark, the device limit, the grant
  flow or the signed URLs.
* The accessibility font scale and contrast settings apply to the reader's
  chrome and to the app around the canvas. The PDF page surface itself is
  rendered by PDF.js and is not recoloured — the reader's own light/dark switch
  is the control for that.

---

## 9. Requires human or legal verification

1. **A published Hebrew accessibility statement** (הצהרת נגישות) with the
   accessibility coordinator's name and contact details, the standard the site
   targets, the date, and the known limitations above.
2. **Manual testing** with a real keyboard on Windows/macOS, and with NVDA or
   VoiceOver, on: the reader (with a real entitlement), checkout end to end, the
   dashboard, the admin panel and the Maestro CMS.
3. **A manual contrast and zoom pass** on the pages that cannot be automated:
   gradients, images, the reader canvas, and 200% browser zoom in Chrome,
   Firefox and Safari on desktop and mobile.
4. **Legal review** of the PDF/DRM position in section 8 before any statement
   claims compliance for purchased content.
5. **A third-party audit** (e.g. an Israeli accessibility consultancy) before
   the site publishes a compliance claim. Automated tooling covered roughly a
   third of WCAG's success criteria — the rest was reviewed by hand and needs a
   human on real assistive technology.
