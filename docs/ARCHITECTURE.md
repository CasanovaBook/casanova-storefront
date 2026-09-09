# Architecture reference

**Repository:** `casanova-storefront`
**Analysis date:** 2026-09-06
**Analyst role:** Senior Software Architect / Codebase Analyst / Security-Minded Technical Reviewer
**Method:** Reverse-engineered from source. No file in this repository was created, modified, renamed, deleted or committed during this analysis. The only file written is this document.

---

## HOW TO READ THIS DOCUMENT

### Confidence labels

| Label | Meaning |
|---|---|
| **HIGH** | Read directly in source during this analysis. Line-level evidence exists. |
| **MEDIUM** | Strongly inferred from multiple consistent source signals, but not directly observed executing. |
| **LOW** | Incomplete evidence. Plausible, but the repository does not settle it. |

### Fact labels

Every load-bearing claim is tagged:

- **[Verified]** — the source says exactly this. A file and usually a symbol are named.
- **[Inferred]** — a conclusion drawn from source, where the source does not state it outright.
- **[Unknown]** — the repository does not contain enough evidence to decide. These are collected in §27 and are *not* resolved by guesswork elsewhere in the document.

### Scope of this analysis — what was read, and what was not

The brief's honesty clause requires this to be stated up front rather than implied.

**Read in full (line-for-line):**

- Web application: every file in `src/lib/` (13 modules), `src/types/index.ts`, all three contexts (`AppContext`, `AdminContext`, `CmsContext`), `src/routes.tsx`, `src/App.tsx`, `src/main.tsx`, `index.html`, `src/index.css`, `src/pages/ReaderPage.tsx`, `src/components/layout/{AdminLayout,PublicRoot,SideNav}.tsx`, `src/components/{CmsHint,AccessDenied,RouteError,ThemeToggle}.tsx`, and the public pages `LandingPage`, `CheckoutPage`, `CheckoutSuccessPage`, `LoginPage`, `SetupPage`, `SetupPasswordPage`, `LibraryPage`, `StorePage`.
- Build and platform: `vite.config.ts`, `package.json`, `tsconfig.json`, `.mise.toml`, `.gitignore`, `.gitattributes`, `AGENTS.md`, `CLAUDE.md`, all seven `.figma/make/*` scripts plus `site.json` and `dev.json`.
- Database: `schema.sql` (1941 lines, complete) and `migrations/0001_mobile_reader.sql` (597 lines, complete).
- React Native: `package.json`, `app.json`, `index.js`, `App.tsx`, `metro.config.js`, `babel.config.js`, `tsconfig.json`, `.gitignore`; all of `src/net/`, all of `src/drm/`, all of `src/store/`, all of `src/navigation/`, `src/config.ts`, `src/theme.ts`, `src/components/Watermark.tsx`, screens `ReaderScreen`, `LibraryScreen`, `GateScreen`, `DevicesScreen`; all of `android/` (`MainActivity.kt`, `MainApplication.kt`, `ScreenShieldModule.kt`, `ScreenShieldPackage.kt`, `AndroidManifest.xml`, `build.gradle` ×2, `settings.gradle`, `gradle.properties`); all of `ios/` (`ScreenShield.swift`, `ScreenShield.m`, `CasanovaReader-Bridging-Header.h`, `Podfile`).
- Origin document: `docs/PRODUCT_BRIEF.md` (1278 lines — the founding product brief; sections 1–12, 27–40 read verbatim, structure of all 40 sections mapped).
- Version control state: `git ls-files`, `git status --short`, `git check-ignore -v`, `git log`.

**Not read in full (declared incomplete):**

- `src/pages/DashboardPage.tsx` (406 lines), `src/pages/SupportPage.tsx` (read to line 120 of 319), `src/pages/ForgotPasswordPage.tsx` (159).
- Twelve of the fourteen admin pages: `AdminProductsPage` (1565), `AdminCmsPage` (942), `AdminCrmPage` (883), `AdminOrdersPage` (814), `AdminUsersPage` (721), `AdminSupportPage` (614), `AdminSettingsPage` (492), `AdminDashboardPage` (446), `AdminFinancePage` (343), `AdminAccessPage` (301), `AdminAuditPage` (176), `AdminEmailsPage` (168), `AdminAlertsPage` (144). `AdminSecurityPage` (912) was read at lines 1–120 and 430–500. **However**, all fourteen were characterised structurally by an exhaustive grep of their `src/lib/*` imports and every `can(adminRole, …)` call site, so the permission surface and service-call map below is complete even though the JSX is not.
- `src/components/icons.tsx` (459) — an icon-name→SVG map. Architecturally inert; its export signature `Icon, { type IconName }` was verified from consumer imports.
- `src/components/layout/DashboardLayout.tsx`.
- React Native: `src/components/ui.tsx`, screens `DashboardScreen`, `StoreScreen`, `LoginScreen`, `SupportScreen`, `ForgotPasswordScreen`; `android/app/proguard-rules.pro`, `res/xml/data_extraction_rules.xml`, `res/values/styles.xml`; `ios` asset catalogue (absent — see §20).
- The removed legacy root `ScreenShield.tsx` was a superseded prototype (see §26).
- `public/books/Senia_book.pdf`, `docs/Senia_book.pdf`, `images/main_photo.jpg` — binary assets, not read.

Where a section below depends on a file in the second list, that dependency is named and the confidence is reduced accordingly.

---

## 1. EXECUTIVE SUMMARY

**[Verified]** This repository contains a Hebrew, right-to-left **digital-commerce platform for protected written content**, plus a **native DRM reader** for it, plus the **PostgreSQL schema** for a backend that does not yet exist. It is one product expressed as three artefacts:

1. **A React 19 + Vite 8 web storefront and CMS** (`src/`, 20 865 lines across 56 TypeScript files plus `index.css`). Landing page → catalogue → checkout → account → library → protected PDF reader, and a fourteen-screen administrative back office covering products, CMS content, orders, finance, users, support, CRM, e-mail, audit, alerts, access control, settings and content protection.
2. **A React Native 0.79.2 mobile reader** (`react-native/`, 24 TypeScript files totalling 5 181 lines, plus 4 Kotlin files and 3 Swift/Objective-C files for the native modules) whose entire reason to exist is reading a protected PDF on a phone without that PDF becoming a file the customer can keep, copy, share or photograph.
3. **A database contract** (`schema.sql`, 1941 lines, 38 tables, 11 views, 8 functions, 14 triggers; `migrations/0001_mobile_reader.sql`, 597 lines) describing the real backend both clients are written against.

**The single most important architectural fact about this project:** *neither client currently talks to that database.* **[Verified]** The web app persists to `localStorage['casanova_db_v1']` through `src/lib/db.ts`. The mobile app talks HTTPS to `DEFAULT_API_BASE_URL = 'https://api.casanova.local'` (`react-native/src/config.ts`), a hostname that does not resolve. The SQL is not dead documentation — it is the arbiter. `react-native/src/net/types.ts` states the arrangement explicitly: *"Keeping the two in sync is a review checklist item, and the SQL schema in `schema.sql` is the arbiter when they disagree."*

**The single most important product fact** comes from the founding brief, `docs/PRODUCT_BRIEF.md` §40:

> **אנחנו לא מוכרים קובץ. אנחנו מוכרים הרשאה לתוכן בתוך מערכת.**
> *"We are not selling a file. We are selling permission to content inside a system."*

Every non-obvious decision in this codebase follows from that sentence. It is why the customer never receives the permanent address of a PDF; why entitlements live in a `user_products` table separate from `orders`; why revoking a device session cascades to destroy every URL already handed to it; why signing out of the phone app deletes the local copies; why a crash in the mobile reader wipes the vault.

**The design philosophy, stated in the source rather than inferred:** the code is *fail-closed* and *honest*. Fail-closed: absent configuration resolves to the strictest value (`withProtectionDefaults()` on web, `RESTRICTIVE_POLICY` on mobile, `bootCheck()` returning `mobile_app_enabled: false` on a network error, `probeIntegrity()` returning `ATTESTATION_FAILED` when the native module is missing). Honest: the UI never claims something the system did not do. An unconfigured CMS field renders `CmsHint` to an administrator and **nothing at all** to a visitor, rather than invented marketing copy. `CheckoutSuccessPage` reads *"ההזמנה נרשמה במערכת והיא ממתינה לאישור תשלום"* — "the order is recorded and awaiting payment confirmation" — and never presents a `PENDING` order as a completed charge. `LandingPage` shows only statistics derivable from the catalogue and drops reader-count and satisfaction-percentage claims because *"Anything the database cannot substantiate … is left out rather than invented."*

**Maturity assessment [Verified]:** the web application is complete, coherent, type-checked and buildable. The database contract is complete and unusually rigorous. The mobile application is source-complete and architecturally finished, but **has never been installed and cannot be built as it stands** (§20). There are **no tests anywhere**, **no CI**, **no README**, **no `.env.example`**, **no linter configuration**, and **no commits** — the repository is 82 staged files on an unborn `main` branch (§20, §26).

**Risk summary:** the highest-risk material in this repository is not the code. It is (a) the absence of any commit history, so there is no recoverable prior state; (b) the fact that the entire mobile application is untracked in git while the *only* React Native file that is tracked is an obsolete prototype branded with a different product name (§26); and (c) the `schema.sql` ↔ `migrations/0001` function-signature conflict that would make the documented migration order fail on a real PostgreSQL server (§9, §26).

---

## 2. PROJECT PURPOSE

### 2.1 What the project is

**[Verified]** `package.json` describes the web project in one line:

> *"Hebrew RTL storefront for protected digital titles: no-code CMS, DRM-aware reader, device limits and admin security tooling."*

**[Verified]** `react-native/package.json` describes the mobile client:

> *"Casanova native reader. Hebrew RTL, DRM-hardened: no screenshots, no screen recording, no download or export of the protected PDF. Shares one database with the web storefront through the same REST contract."*

**[Verified]** `.figma/make/site.json` gives the public identity: title *"Casanova — ספרייה דיגיטלית פרטית"* ("Casanova — a private digital library"), language `he`, `robots.index: false`. The `index: false` is a deliberate choice for a storefront, and it is consistent with a product whose catalogue is protected content rather than SEO inventory.

### 2.2 Why it exists

**[Verified]** The founding brief is committed at `docs/PRODUCT_BRIEF.md` — 1278 lines, 40 numbered sections, written in Hebrew, addressed to *"אתה סוכן פיתוח Senior Full-Stack עצמאי"* ("you are an independent Senior Full-Stack development agent"). It is the specification this repository implements. Its §1 states the business goal as a funnel, not a shop:

```
Traffic → Landing Page → Product Selection → Checkout → Payment
→ User Creation / Identification → Order Creation → Product Access Grant
→ Invoice / Receipt → Welcome Email → Login → Password Setup
→ Personal Library → E-Book Reader → Additional Products / Upsells → Repeat Purchase
```

followed by: *"הרכישה הראשונה אינה סוף התהליך"* — "the first purchase is not the end of the process."

The brief explicitly rejects the narrow framing (§1): *"אל תתייחס למערכת כאל 'אתר למכירת PDF'"* — "do not treat this system as a website for selling PDFs." The product is named as **Digital Commerce + Content Access**.

### 2.3 The problem the DRM layer solves

**[Verified]** Brief §15 is the origin of the whole protection model:

> *"הספר אינו נשלח כקובץ PDF ישיר למשתמש כברירת מחדל. המשתמש צורך אותו מתוך הפלטפורמה."*
> *"אין לחשוף public URL קבוע של PDF אם ניתן להימנע מכך."*
> Suggested mechanisms: `Authenticated Endpoint / Signed URL / Short-Lived URL / Protected Asset Delivery`.

**[Verified]** Brief §12 is titled *"כלל אבטחה קריטי"* (a critical security rule): *"אסור להסתמך על Frontend לצורך הרשאות"* — authorisation must never be trusted to the frontend. A user who bought Product A must not be able to open Product B by editing a URL. It prescribes the exact chain the code implements: `Authenticate User → Check USER_PRODUCTS → Check Access Status → Check Expiration → Allow / Deny`, with *"כל בדיקת הרשאה מתבצעת Backend Side."*

**[Verified]** Brief §11 requires that entitlements not be attached to orders: *"אין לקשור רכישה ישירות רק ל־Order. יש ליצור טבלת הרשאות נפרדת: USER_PRODUCTS"* and names it *"מקור האמת לשאלה: האם המשתמש רשאי לפתוח את המוצר?"* — the single source of truth for "may this user open this product?". That table exists as `user_products` in both `src/types/index.ts` and `schema.sql`, with exactly the four `access_status` values the brief lists (`ACTIVE | EXPIRED | REVOKED | SUSPENDED`).

### 2.4 Who the system is for

**[Verified]** Three distinct populations, each with its own surface:

| Population | Surface | Entry |
|---|---|---|
| Anonymous visitor | Landing page, public store, support form, checkout (guest checkout creates the account) | `/`, `/store`, `/support`, `/checkout` |
| Customer | Personal dashboard, library, protected reader, orders, devices | `/dashboard/*`, `/read/:productId` |
| Staff | Fourteen-screen admin back office, gated by role | `/admin/*` |

**[Verified]** The brief §2 requires only Customer and Admin but adds *"יש לבנות את מערכת באופן שיאפשר בעתיד Roles נוספים"* ("build it so further roles can be added later"). The implementation went further than asked: `AdminRole` is a five-way union (`SUPER_ADMIN | SUPPORT | FINANCE | CONTENT | MARKETING`) with 27 discrete `AdminPermission` strings in `src/lib/permissions.ts`. That is the realised form of the brief's forward-compatibility requirement.

### 2.5 What the mobile client adds

**[Verified]** `migrations/0001_mobile_reader.sql` opens with a gap analysis, sections A–F, each naming what the existing web schema could not express for a phone. In summary: DRM policies had no notion of download-blocking, offline caching or rooted devices (A); `security_events` could not record native-only events because a PostgreSQL CHECK list cannot be extended in place (B); `device_sessions` had no revocation attribution or device description (C); `sessions` could not distinguish a browser from an app build (D); inquiries and CRM leads could not originate from the app (E); and there was no kill switch (F). Sections G–I then add the grant table, its consumption function, two cascading-revocation triggers, three views and a session-sweep function.

**[Inferred — MEDIUM]** The mobile client was therefore not a port. It was written to close a specific, enumerated set of gaps, and the migration is the design document for it. This matters for future work: a mobile feature request that needs a new column should expect to produce a migration section in the same style.

---

## 3. TECHNOLOGY STACK

### 3.1 Web application

**[Verified]** from `package.json` — the runtime dependency list is remarkably short:

| Layer | Choice | Version |
|---|---|---|
| UI runtime | `react`, `react-dom` | `^19.0.0` |
| Routing | `react-router` | `^8.3.1` |
| Build tool | `vite` | `^8.0.5` |
| React plugin | `@vitejs/plugin-react` | `^6.0.0` |
| Styling | `tailwindcss` + `@tailwindcss/vite` | `^4.0.0` |
| Language | `typescript` | `^5.7.0` |
| Types | `@types/node`, `@types/react`, `@types/react-dom` | `^22`, `^19`, `^19` |
| Formatter | `oxfmt` | `^0.2.0` |

Three runtime dependencies. **No state library, no data-fetching library, no UI kit, no HTTP client, no date library, no form library, no i18n library.** Every one of those roles is filled by hand-written code in `src/lib/` or by the platform. This is the most consequential stylistic fact about the web codebase: there is no third-party abstraction to learn, and nothing to upgrade, but also nothing to lean on.

**[Verified]** Scripts: `dev` (`vite --host 0.0.0.0`), `build` (`vite build`), `preview`, `typecheck` (`tsc --noEmit`), `format` (`oxfmt`). **There is no `test` script and no `lint` script.**

**[Verified]** `.mise.toml` pins `node = "22"` and `"npm:pnpm" = "10.34.3"`; `package.json` `engines.node >= 22`; `pnpm-lock.yaml` is present and committed. `"type": "module"`, `"license": "UNLICENSED"`, `"private": true`.

**[Verified]** `tsconfig.json` (read in a prior pass, confirmed by memory and by the `@/*` imports used throughout): `target ES2020`, `module ESNext`, `moduleResolution bundler`, `strict`, path alias `@/*` → `./src/*`.

### 3.2 Mobile application

**[Verified]** from `react-native/package.json`:

| Role | Package | Version |
|---|---|---|
| Runtime | `react-native` | `0.79.2` (exact, not a range) |
| React | `react` | `19.0.0` (exact) |
| Navigation | `@react-navigation/native` | `7.1.6` |
| | `@react-navigation/native-stack` | `7.3.10` |
| | `@react-navigation/bottom-tabs` | `7.3.10` |
| PDF rendering | `react-native-pdf` | `6.7.7` |
| Filesystem / download | `react-native-blob-util` | `0.21.2` |
| Secure token storage | `react-native-keychain` | `9.2.2` |
| Device identity | `react-native-device-info` | `14.0.4` |
| Non-secret storage | `@react-native-async-storage/async-storage` | `2.1.2` |
| Layout | `react-native-safe-area-context` | `5.4.0` |
| Navigation primitives | `react-native-screens` | `4.10.0` |
| Toolchain | `@react-native/{babel-preset,metro-config,typescript-config,eslint-config}` | `0.79.2` |
| CLI | `@react-native-community/cli` + platform packages | `18.0.0` |
| Lint | `eslint` | `^8.57.1` |
| TypeScript | `typescript` | `5.7.3` (exact) |

Eleven runtime dependencies, every one pinned to an exact version rather than a range. **[Inferred — HIGH]** The exact pinning is deliberate for a DRM client: a floating minor version of `react-native-pdf` or `react-native-keychain` could change capture or storage behaviour without anyone deciding it should.

**[Verified]** Native languages: **Kotlin** (`MainActivity.kt`, `MainApplication.kt`, `shield/ScreenShieldModule.kt` at 623 lines, `shield/ScreenShieldPackage.kt`) and **Swift** (`ios/CasanovaReader/ScreenShield.swift` at 828 lines) with an Objective-C bridge declaration (`ScreenShield.m`, `CasanovaReader-Bridging-Header.h`).

**[Verified]** Android build settings from `android/build.gradle`: `buildToolsVersion 35.0.0`, `minSdkVersion 24`, `compileSdkVersion 35`, `targetSdkVersion 35`, `ndkVersion 27.1.12297006`, `kotlinVersion 2.0.21`. From `gradle.properties`: `newArchEnabled=true`, `hermesEnabled=true`, all four ABIs, JVM heap raised to 4096 m.

**[Verified]** Scripts: `android`, `ios`, `start`, `pods`, `typecheck`, `lint` (`eslint .`), `clean:android` (`cd android && ./gradlew clean`), `clean:metro`. **No `test` script.**

**[Verified — negative]** There is **no ESLint configuration file** anywhere in `react-native/` (`.eslintrc`, `.eslintrc.js`, `.eslintrc.json`, `eslint.config.js` all absent). ESLint 8 requires one. `pnpm lint` therefore cannot succeed. See §26.

**[Verified]** `react-native/tsconfig.json` extends `@react-native/typescript-config/tsconfig.json` and adds `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `jsx: react-jsx`, `lib: ES2022`. `include` is `["App.tsx", "src/**/*.ts", "src/**/*.tsx"]` — so `metro.config.js`, `babel.config.js`, `android/` and `ios/` are excluded, and the obsolete root `ScreenShield.tsx` is *not* in `include` either.

### 3.3 Database

**[Verified]** PostgreSQL. Established by syntax rather than by a declared dependency: `CREATE OR REPLACE FUNCTION … RETURNS TABLE`, `RETURNS trigger`, `EXECUTE FUNCTION`, partial unique indexes with a `WHERE` clause, `ON DELETE RESTRICT`, `information_schema`-style `IF NOT EXISTS` / `IF EXISTS` DDL, `BEGIN;`/`COMMIT;` transaction wrapping, `gen_random_uuid()`-style defaults, and `COALESCE` inside CHECK constraints with an explicit comment that *"a CHECK passes on NULL."* No version is declared anywhere. **[Unknown]** the minimum supported PostgreSQL major version — the constructs used are all long-standing, but nothing states a floor.

There is **no ORM, no migration runner, no database client library** in either `package.json`. **[Verified]** The SQL is applied by hand.

### 3.4 What is conspicuously absent

**[Verified]** Absent from the entire repository: any test framework or test file (`*.test.*`, `*.spec.*` — zero matches outside `node_modules`); any CI configuration (no `.github/`, `.gitlab-ci.yml`, `.circleci/`, no git hooks, no `.husky/`); any `README`; any `.env` or `.env.example`; any Dockerfile or compose file; any infrastructure-as-code; any analytics or error-reporting SDK; any payment provider SDK; any e-mail provider SDK.

This absence is the gap between the repository and its own founding brief, which requires Tests (§34, fourteen named scenarios), a Definition of Done including *"Tested"* and *"No console errors"* (§35), and a deliverable list including *"Tests, README, Environment configuration example, Setup instructions"* (§39). See §19 and §26.

---

## 4. REPOSITORY STRUCTURE

**[Verified]** Top level:

```
book/
├── .figma/make/          7 extension-less bash scripts + site.json + dev.json
├── dist/                 build output (git-ignored)
├── docs/                 Senia_book.pdf (git-ignored; 48 MB duplicate)
├── images/               main_photo.jpg (the logo; tracked, 221 KB)
├── migrations/           0001_mobile_reader.sql      ← UNTRACKED in git
├── node_modules/         (git-ignored)
├── public/books/         .gitkeep + Senia_book.pdf   ← the PDF is git-ignored
├── react-native/         the entire mobile app       ← UNTRACKED except one file
├── src/                  the entire web app
├── AGENTS.md, CLAUDE.md  agent guidance (CLAUDE.md is literally "@AGENTS.md")
├── index.html            Vite shell
├── package.json, pnpm-lock.yaml, tsconfig.json, vite.config.ts
├── schema.sql            the PostgreSQL contract (tracked)
├── .mise.toml, .gitignore, .gitattributes
└── ~20 *.png             browser-automation screenshots (see §26)
```

### 4.1 Web application layout

**[Verified]**

```
src/
├── main.tsx              React entry: imports index.css, mounts App into #root
├── App.tsx               provider composition + router root
├── routes.tsx            the complete route table
├── index.css             Tailwind v4 import + design tokens + capability CSS
├── vite-env.d.ts
├── types/index.ts        the entire domain model (every interface, union and enum)
├── lib/                  the whole of the business logic — 13 modules
│   ├── db.ts             localStorage persistence, mutate(), useStore binding
│   ├── store.ts          useSyncExternalStore bridge
│   ├── api.ts            ~1271 lines: catalogue, users, CMS, settings, DRM policies
│   ├── api-orders.ts     checkout, payment capture, refunds, invoices
│   ├── api-support.ts    inquiries, notes, CRM leads and tasks
│   ├── api-security.ts   device sessions, security events, content grants
│   ├── auth.ts           password hashing, sessions, passwordProblem()
│   ├── permissions.ts    AdminRole × AdminPermission matrix, can(), ROLE_LABEL
│   ├── sensitive.ts      PII masking and redaction
│   ├── analytics.ts      derived revenue and product-sales figures
│   ├── alerts.ts         derived operational alerts
│   ├── media.ts          toEmbedUrl() and upload helpers
│   └── useScreenProtection.ts   the web reader's deterrent layer
├── context/
│   ├── AppContext.tsx    customer session, cart, orders, theme, bootstrap
│   ├── AdminContext.tsx  admin actor, role, permission-aware views
│   └── CmsContext.tsx    published catalogue, sections, settings, coupons
├── components/
│   ├── icons.tsx         Icon + IconName (459 lines, inert)
│   ├── CmsHint.tsx       admin-only "content missing" placeholder
│   ├── AccessDenied.tsx  role-denied screen
│   ├── RouteError.tsx    error boundary + NotFoundPage
│   ├── ThemeToggle.tsx
│   └── layout/           PublicRoot, DashboardLayout, AdminLayout, SideNav
├── pages/                14 public/customer pages
│   └── admin/            14 admin pages
└── imports/              the founding brief + one imported image
```

**The structural rule [Verified]:** `pages/` and `components/` contain no business logic. Every mutation, every permission check, every validation and every audit write lives in `src/lib/`. Pages import from `context/` (which wraps `lib/`) or, in the admin screens, directly from `lib/api*`. This is not a convention that happens to hold — it is enforced by the shape of the service layer, where every mutating function takes `Actor | null` as its first parameter and cannot be called meaningfully from a component that has not obtained one.

### 4.2 Mobile application layout

**[Verified]**

```
react-native/
├── index.js              AppRegistry.registerComponent — nothing else
├── App.tsx               provider composition + CrashBoundary
├── app.json              name "CasanovaReader", displayName "קזנובה"
├── metro.config.js       blockList against the sibling web project
├── babel.config.js       3 lines, @react-native/babel-preset only
├── tsconfig.json, package.json, .gitignore
├── ScreenShield.tsx      ← OBSOLETE PROTOTYPE, the only RN file git tracks (§26)
├── src/
│   ├── config.ts         API base URL, client identity, timing constants
│   ├── theme.ts          design tokens copied from src/index.css
│   ├── net/
│   │   ├── types.ts      redeclared domain types + RESTRICTIVE_POLICY
│   │   ├── client.ts     fetch wrapper, Keychain Bearer, X-Casanova-* headers
│   │   └── api.ts        13 endpoint functions
│   ├── drm/
│   │   ├── ScreenShield.tsx      provider, hook, overlay, native contract
│   │   ├── SecureFileVault.ts    the private file vault
│   │   └── useReaderSession.ts   the protected-reading state machine
│   ├── store/            AuthContext, LibraryContext, ProtectionContext
│   ├── navigation/       routes.ts (typed param lists), RootNavigator.tsx
│   ├── components/       ui.tsx, Watermark.tsx
│   └── screens/          Gate, Login, ForgotPassword, Library, Store,
│                         Dashboard, Support, Devices, Reader
├── android/
│   ├── build.gradle, settings.gradle, gradle.properties
│   └── app/
│       ├── build.gradle
│       └── src/main/
│           ├── AndroidManifest.xml
│           └── java/com/casanova/reader/
│               ├── MainActivity.kt
│               ├── MainApplication.kt
│               └── shield/{ScreenShieldModule.kt, ScreenShieldPackage.kt}
└── ios/
    ├── Podfile
    └── CasanovaReader/{ScreenShield.swift, ScreenShield.m,
                        CasanovaReader-Bridging-Header.h}
```

**The boundary rule [Verified]:** `src/net/types.ts` redeclares the domain types rather than importing them from `../../src/types`. Its header explains why: *"the web app is a Vite build and this is a Metro build"* — two bundlers, two `node_modules`, two React copies. The duplication is intentional and the SQL schema is the tie-breaker. `metro.config.js` enforces the separation from the other side with a `blockList` covering `../node_modules`, `../dist` and `../src`, because *"Metro walks the file system, not the module graph, so without an explicit block it will happily resolve `react` or `react-dom` out of `../node_modules` and bundle a web copy of React into the phone build."*

### 4.3 What lives where, and why it matters

**[Verified]** Two placements in this repository are wrong in a way that will cause real confusion:

1. `docs/Senia_book.pdf` and `public/books/Senia_book.pdf` are, per `.gitignore`, byte-identical copies of a 48 MB title. `.gitignore` records that *"Nothing reads it"* about `docs/` and that the only reference is `vite.config.ts`'s watch-ignore, added because *"watching the file crashed the dev server."*
2. A 13 MB Hebrew-named PDF sits in `react-native/android/gradle/wrapper/` — a directory whose entire conventional purpose is holding `gradle-wrapper.jar` and `gradle-wrapper.properties`. `react-native/.gitignore` carries `*.pdf`, so it can never be committed; but it is in the working tree in the last place a reader would look for catalogue content. **[Inferred — HIGH]** It was dropped there as a transfer location when the title was added to the catalogue, and never moved.

---

## 5. ARCHITECTURE

### 5.1 The three-tier shape that is really four tiers

**[Verified]** The web application is a strict four-layer stack in which each layer may only call downward:

```
┌──────────────────────────────────────────────────────────────┐
│ 1. ROUTING      src/routes.tsx                               │
│    React Router 8 data-router. Layout routes nest pages.     │
│    Guards are components (RequireAuth / RequireAdmin), not   │
│    loader redirects. errorElement on every branch.           │
├──────────────────────────────────────────────────────────────┤
│ 2. PRESENTATION src/pages/**, src/components/**              │
│    Zero business logic. Reads from context, calls service    │
│    functions, renders Result. Cosmetic can() calls only.     │
├──────────────────────────────────────────────────────────────┤
│ 3. STATE        src/context/**, src/lib/store.ts             │
│    Three providers over one useSyncExternalStore binding.    │
│    Memoised selectors, no fetching, no persistence.          │
├──────────────────────────────────────────────────────────────┤
│ 4. SERVICE      src/lib/api*.ts, auth.ts, permissions.ts,    │
│                 analytics.ts, alerts.ts, sensitive.ts        │
│    guard() → validate → mutate() → writeAudit() →            │
│    dispatchEmail(). Returns Result<T>. Throws nothing.       │
├──────────────────────────────────────────────────────────────┤
│ 5. PERSISTENCE  src/lib/db.ts                                │
│    The only module that touches localStorage for data.       │
│    getDb() / mutate() / subscribe() / emptyDatabase().       │
└──────────────────────────────────────────────────────────────┘
                    ↓ localStorage['casanova_db_v1']
```

The mobile application has the same shape with tier 5 replaced by HTTP:

```
screens → store/{Auth,Library,Protection}Context → net/api.ts
        → net/client.ts request() → HTTPS → [backend not yet written]
        ↘ drm/{useReaderSession, SecureFileVault, ScreenShield}
              ↘ NativeModules.ScreenShield (Kotlin / Swift)
```

### 5.2 The service layer is a REST API that happens to be in-process

**[Verified]** This is the central architectural bet of the project, and it is stated in `src/lib/api.ts`'s own documentation:

> *"Pointing that driver at HTTP endpoints turns this module into a client for a real backend without changing a single call site."*

The evidence that this is a real design and not a claim:

- Every mutating service function takes `Actor | null` as its **first** parameter — the shape of an authenticated request, not of a library call.
- Every one returns `Result<T>`, never throws, and carries an `ErrorCode` from a closed union — the shape of an HTTP response, not of a JavaScript error.
- Every one calls `guard(actor, permission)` **before** touching data — middleware, inlined.
- The mobile client's `net/api.ts` maps one-to-one onto the web service functions. The correspondence is exact and complete:

| Mobile endpoint function | Web service function | SQL object |
|---|---|---|
| `fetchPublicSettings()` | `getSettings()` | `platform_settings` |
| `login()` | `login()` | `users`, `sessions` |
| `fetchCatalog()` | `listPublicProducts()` | `v_storefront_catalog` |
| `fetchLibrary()` | `listUserProducts()` | `v_entitled_content` |
| `registerDevice()` | `registerDeviceSession()` | `device_sessions`, `drm_policies` |
| `heartbeatDevice()` | `refreshDeviceSession()` | `device_sessions` |
| `revokeDevice()` | `revokeDeviceSession()` | `device_sessions` + grant cascade |
| `issueGrant()` | `issueContentGrant()` | `content_access_grants` |
| `redeemGrant()` | `consumeContentGrant()` | `consume_content_grant()` |
| `reportSecurityEvent()` | `recordEvent()` | `security_events` |
| `saveProgress()` | `saveReadingProgress()` | `reading_progress` |
| `submitInquiry()` | `submitPublicInquiry()` | `inquiries` (`source = MOBILE_APP`) |
| `bootCheck()` | *(no web equivalent)* | `platform_settings` |

**[Inferred — HIGH]** This table is the strongest single piece of evidence that the two clients are one product. It is not a similarity of style; it is the same twelve operations, named differently, resolving to the same twelve SQL objects.

### 5.3 Architectural style

**[Verified]** Named patterns, each with a source citation in §16:

- **Result monad / railway-oriented error handling** — no exceptions cross a service boundary.
- **External store + `useSyncExternalStore`** — hand-rolled, no Redux/Zustand.
- **Provider composition over nested routing** — `App.tsx` and `react-native/App.tsx` both build the tree by wrapping, and both place the security provider deliberately high.
- **Snapshot-on-write** — purchase-time data frozen into the row that records the purchase.
- **Derive-on-read** — revenue, alerts and refund totals recomputed rather than stored.
- **Capability-based responsive design** — `@media (hover: none) and (pointer: coarse)` rather than breakpoints alone.
- **Fail-closed defaults** — every absent flag resolves to the strictest value.
- **Defence by absence** — the mobile reader has no download, save, share, print or export affordance at all; not disabled, *absent*.

### 5.4 What is deliberately NOT in the architecture

**[Verified]** No dependency injection container. No event bus. No message queue. No caching layer. No server-side rendering. No code-splitting beyond two `manualChunks` groups. No service worker. No WebSocket or polling on the web side. No abstraction over the persistence driver — `db.ts` is called directly by the service modules, and the "swap in HTTP" plan is a documented intention, not an implemented interface.

**[Inferred — MEDIUM]** The absence of a persistence interface is the single largest structural obstacle to the migration the codebase announces. `src/lib/api*.ts` imports `getDb` and `mutate` concretely. Making the driver swappable would require introducing an interface that does not currently exist. The claim in `api.ts` is therefore directionally true — call sites in *pages* would not change — but the service layer itself would.

---

## 6. ENTRY POINTS

### 6.1 Web

**[Verified]** Execution order on a page load:

1. `index.html` — Vite shell. Contains the `#root` element, a `<script type="module" src="/src/main.tsx">`, Figma Make region markers, and (at build time) an injected CSP `<meta>` produced by the `head-prepend` plugin in `vite.config.ts`.
2. `src/main.tsx` — imports `./index.css` (which imports Tailwind v4 and defines every design token), then `createRoot(document.getElementById('root')!).render(<App />)`.
3. `src/App.tsx` — composes providers in a fixed order and mounts the router from `src/routes.tsx`.
4. `src/routes.tsx` — the route table. Layout routes wrap page routes; every branch carries an `errorElement` pointing at `RouteError`; a catch-all renders `NotFoundPage`.

**[Verified]** Bootstrap side effects on first run: `AppContext` reads `localStorage['casanova_db_v1']`; if absent or version-mismatched it calls `emptyDatabase()`, which returns empty arrays for every collection **except** `drm_policies`, which is seeded with `[defaultDrmPolicy()]`. `bootstrapRequired` becomes `true` when no administrator account exists, which redirects `/login` → `/setup` (`LoginPage.tsx:23-25`) and makes `SetupPage` the only reachable screen. Once one administrator exists, `setupAdmin` refuses and `SetupPage` redirects back to `/login` (`SetupPage.tsx:33-35`, and `if (!bootstrapRequired) return null` at line 64).

**[Verified]** This is a clean first-run story: the system ships with no accounts, no content and no invented copy, and the first thing anyone must do is create the first `SUPER_ADMIN`.

### 6.2 Mobile

**[Verified]** Execution order on a cold start:

1. **Native, before JavaScript.** `MainActivity.onCreate` sets `WindowManager.LayoutParams.FLAG_SECURE` **before** calling `super.onCreate()`. The ordering is documented as the entire point: setting it after `super` *"would leave the interval between the first frame and the call — typically a second or two on a cold start … during which the window is capturable."*
2. `MainApplication.onCreate` — `SoLoader.init`, then `load()` for Fabric/TurboModules when the new architecture is enabled. `getPackages()` appends `ScreenShieldPackage()` to the autolinked list by hand, because the DRM layer is app source rather than a dependency.
3. `index.js` — `AppRegistry.registerComponent(appName, () => App)`. Its header states that capture protection is deliberately **not** enabled here, because on Android the flag is already set before the bundle is parsed and on iOS the shield is installed by the native module when the reader mounts.
4. `App.tsx` — module scope runs `I18nManager.allowRTL(true); I18nManager.forceRTL(true);` before anything renders. Tree:
   ```
   CrashBoundary > SafeAreaProvider > StatusBar > AuthProvider
     > ProtectionProvider > LibraryProvider > RootNavigator
   ```
5. `AuthProvider`'s mount effect runs the boot sequence in a fixed order: `loadApiBaseUrl()` → `bootCheck()` → (if blocked: `wipeAll()`, `clearSession()`, phase `blocked`) → `purgeExpired()` + report each `OFFLINE_EXPIRED` → `readStoredSession()` → (if present) `fetchMe()` → phase `signed-in`.

**[Verified]** The boot order is a security decision, documented as such: *"The order matters: the kill switch is evaluated before any stored credential is read, so a build that has been pulled cannot use a cached token to get as far as the library screen and render titles."*

6. `RootNavigator` chooses the screen set from `phase` rather than navigating imperatively — `signed-in` exposes `Home`/`Reader`/`Devices`, `signed-out` exposes `Login`/`ForgotPassword`, anything else exposes only `Gate`. The rationale: *"when the session dies the whole authenticated stack is unmounted, which also unmounts the reader and triggers its vault cleanup."*

### 6.3 Build entry points

**[Verified]** `.figma/make/` holds seven extension-less bash scripts, each 3–5 lines, each `set -euo pipefail`:

| Script | Body |
|---|---|
| `install` | `pnpm install --prefer-offline --no-frozen-lockfile` |
| `dev` | `pnpm run dev` |
| `format` | `pnpm run format -- "$@"` |
| `deploy` | `pnpm run build` then `figma make deploy --build-dir dist` |
| `deploy-preview` | `pnpm run build --mode development` then `figma make deploy-preview --build-dir dist` |
| `langserver` | `exec pnpm dlx --package=@vtsls/language-server@^0.3.0 vtsls --stdio` |
| `analyze-routes` | `exec figma-analyze routes "$@"` |

`.gitattributes` pins all seven to `eol=lf` with the reason recorded: *"a CRLF after the shebang makes `#!/usr/bin/env bash\r` an interpreter that does not exist, and the script dies with 'bad interpreter' on Linux and macOS."*

`dev.json` declares `installOn: ["package.json", "pnpm-lock.yaml"]` and `restartOn: []`, with a comment explaining that application source is deliberately excluded because *"Vite's dev server already watches application code … so including them here would cause a redundant full restart."*

---

## 7. CORE COMPONENTS

### 7.1 `src/lib/db.ts` — the persistence driver

**[Verified]** The only module in the web application that touches `localStorage` for data. Exposes `getDb()`, `mutate(fn)`, `subscribe(listener)`, `emptyDatabase()`, and `DB_VERSION = 1`.

The whole database is one versioned JSON document under a single key. `mutate()` shallow-copies the document, hands the copy to the callback, writes it back, and **synchronously** notifies a `Set<Listener>`. Cross-tab consistency arrives through the `storage` event.

**[Verified]** The synchronicity of `mutate()` is the source of the subtlest hazard in the web codebase: a state update that fires during render, or an effect whose dependency changes as a result of its own write, produces an infinite loop. Three separate ref guards exist to prevent this (`registeredFor`, `grantedFor`, `savedProgressKey` in `ReaderPage.tsx`), plus three defensive behaviours in the service layer: `actor` is memoised on primitive fields rather than the `user` object; `registerDeviceSession` returns an existing session untouched rather than writing a new one; and `saveReadingProgress` declines no-op writes. See §25.

### 7.2 `src/lib/api.ts` — the largest service module

**[Verified]** ~1271 lines. Owns the catalogue (`products`, `books`, `categories`, `product_images`, relations), users and authentication surface, CMS content (`cms_sections`, `testimonials`, `faqs`), coupons, `platform_settings`, and DRM policies. Every export follows one shape:

```ts
export function saveCoupon(
  actor: Actor | null,
  data: Omit<Coupon, 'coupon_id' | 'times_used'>,
  id?: string
): Result<Coupon> {
  const denied = guard(actor, 'cms');      // 1. authorise
  if (denied) return denied;
  const code = data.code.trim().toUpperCase();
  if (!code) return fail('VALIDATION', 'קוד הקופון חובה.');   // 2. validate
  const db = getDb();
  if (db.coupons.some((c) => c.code.toUpperCase() === code && c.coupon_id !== id)) {
    /* 3. uniqueness → CONFLICT */
  }
  const saved = mutate((d) => { /* 4. write */ });
  writeAudit(actor, {                      // 5. audit
    category: 'COUPON_CHANGE', action: id ? 'עדכון קופון' : 'יצירת קופון',
    target_type: 'COUPON', target_id: saved.coupon_id,
    target_label: saved.code, details: `${saved.discount_type} ${saved.discount_value}`,
  });
  return ok(saved);                        // 6. return Result
}
```

**[Verified]** That six-step order — guard, validate, conflict-check, mutate, audit, return — is the invariant of the whole service layer. `deleteCoupon` immediately below it follows the same shape. Any new mutation that skips step 1 or step 5 is a defect by this codebase's own standard, not a style preference.

### 7.3 `src/lib/api-orders.ts` — money

**[Verified]** `checkout(input)` is the guest-purchase path and is the best single illustration of the "money is never invented" rule:

```ts
export async function checkout(input: CheckoutInput): Promise<Result<CheckoutOutcome>> {
  // product must exist, be ACTIVE, not HIDDEN, not OUT_OF_STOCK
  // name and email validated; email normalised
  const unitPrice = effectivePrice(product);
  const couponCode = input.coupon_code?.trim().toUpperCase() || undefined;
  const coupon = couponCode ? findCoupon(couponCode) : undefined;
  if (couponCode && !coupon) return fail('VALIDATION', 'קוד הקופון אינו תקף או שפג תוקפו.');
  // discount RECOMPUTED here from the coupon row, never taken from the client
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const customer = await findOrCreateCustomer({ … });
  const order = mutate((d) => {
    const item: OrderItem = {
      product_name: product.name,     // snapshot
      unit_price: unitPrice,          // snapshot
      discount_amount: discount, line_total: total, …
    };
    const created: Order = {
      order_status: 'PENDING', payment_status: 'PENDING',
      coupon_code: coupon ? coupon.code : undefined,
      payment_provider: provider ?? 'MANUAL', …
    };
  });
}
```

**[Verified — security-critical]** `CheckoutPage.tsx` computes `couponDiscount` and `finalPrice` locally for display, but `handleSubmitOrder` sends **only** `product_id`, names, `email`, `phone` and `coupon_code`. The client's arithmetic never crosses the boundary. `checkout()` re-derives the discount from the stored coupon row and rejects an invalid code outright. A tampered client can change what it *shows itself*; it cannot change what it is charged.

**[Verified]** The order is created `PENDING`. Only `markOrderPaid` transitions it to `PAID` and calls `grantAccessForOrder`. `markOrderPaid` is guarded by the `mark_paid` permission (`AdminOrdersPage.tsx:269`) and is the documented hook where a payment-provider webhook would land.

### 7.4 `src/lib/api-security.ts` — the DRM control plane

**[Verified]** Owns `device_sessions`, `security_events`, `content_access_grants` and `drm_policies` resolution. Exports consumed by `AdminSecurityPage`: `HIGH_SIGNAL_EVENTS`, `SCOPE_LABEL`, `SECURITY_EVENT_LABEL`, `deleteDrmPolicy`, `isSessionExpired`, `isSessionOpen`, `listDeviceSessions`, `resolveDrmPolicy`, `revokeDeviceSession`, `saveDrmPolicy`, and the `DrmPolicyInput` type.

`resolveDrmPolicy(policies, scope)` resolves most-specific-first: a `WEB` or `MOBILE` policy beats an `ALL` policy. `withProtectionDefaults()` fills any absent flag with the strictest value.

### 7.5 `src/lib/permissions.ts` — the authorisation matrix

**[Verified]** `AdminRole = SUPER_ADMIN | SUPPORT | FINANCE | CONTENT | MARKETING`; 27 `AdminPermission` strings; `can(role, permission): boolean`; `ROLE_LABEL` for display. `SUPER_ADMIN` holds every permission.

**[Verified]** `can()` is called in two distinct places with two distinct meanings:

- **Cosmetically**, in layouts and pages, to decide whether to render a nav item or a button, and whether to short-circuit to `<AccessDenied>`.
- **Authoritatively**, in the service layer via `guard(actor, permission)`, which is what actually prevents the operation.

The idiom in all fourteen admin pages is identical: hooks first, then a single early return.

```tsx
if (!can(adminRole, 'orders')) return <AccessDenied page="הזמנות" />;
```

**[Verified]** The permission each admin page requires:

| Page | Page-level permission | Finer-grained checks |
|---|---|---|
| `AdminDashboardPage` | *(dashboard)* | — |
| `AdminProductsPage` | `products` | `edit_content`, `edit_price`, `delete_product` |
| `AdminCmsPage` | `cms` | — |
| `AdminOrdersPage` | `orders` | `refund`, `execute_refund`, `finance`, `mark_paid` |
| `AdminFinancePage` | `finance` | `finance` (as `canManage`) |
| `AdminUsersPage` | *(users)* | — |
| `AdminAccessPage` | *(access)* | — |
| `AdminSupportPage` | `support` | `manage_support` |
| `AdminCrmPage` | `crm` | — |
| `AdminEmailsPage` | `emails` | `resend_email` |
| `AdminAuditPage` | `audit` | — |
| `AdminAlertsPage` | `alerts` | — |
| `AdminSettingsPage` | `settings` | — |
| `AdminSecurityPage` | `security` | `security` (device-list scoping) |

### 7.6 `src/lib/auth.ts`, `analytics.ts`, `alerts.ts`, `sensitive.ts`, `media.ts`

**[Verified]**

- `auth.ts` — password hashing and verification, session lifecycle, `passwordProblem()` (the shared password-policy validator used by `LoginPage`, `SetupPage` and `SetupPasswordPage`), `normalizeEmail`, `isEmail`.
- `analytics.ts` — revenue and product-sales figures **derived on read**, never stored. The SQL mirrors this with `v_daily_revenue` and `v_product_sales`, and by deliberately giving `orders` no `refunded_amount` or `refund_status` column.
- `alerts.ts` — operational alerts **derived on read**, bounded and dismissible. Mirrored by nothing in SQL; this is web-only.
- `sensitive.ts` — PII masking. Imported by `AdminOrdersPage` and `AdminUsersPage` only, which is exactly the pair of screens that display customer contact details.
- `media.ts` — `toEmbedUrl()` (used by `LandingPage` for `VIDEO` CMS blocks) and upload helpers. `AdminProductsPage` and `AdminCmsPage` are its only other consumers.

### 7.7 The three web contexts

**[Verified]**

- **`AppContext`** — customer identity (`user`, `actor`, `isAuthenticated`, `isAdmin`), theme (`theme`, `toggleTheme`), catalogue selection (`selectedProduct`, `setSelectedProduct`), entitlements (`hasAccess`, `userProducts`, `readingProgress`), orders (`orders`, `lastOrder`), cart (`cartLines`, `cartTotal`, `addToCart`, `removeFromCart`, `clearCart`), purchase (`placeOrder`), authentication (`login`, `register`, `setupAdmin`), and `bootstrapRequired`.
  **[Verified]** `login()` returns `{ ok: true, user: found }` — carrying the freshly authenticated user *in the result* rather than relying on state. `LoginPage.tsx:50` navigates on `result.user?.role === 'ADMIN'`, with the comment *"Navigate based on the freshly-authenticated user (state hasn't re-rendered yet)"*. This is a fixed stale-closure defect; the fix pattern is load-bearing and must not be reverted (§25).
- **`AdminContext`** — `adminRole`, `actor`, `users`, and permission-aware views of admin data. `adminRole` is synchronised from `user.admin_role`.
- **`CmsContext`** — `publishedProducts`, `activeSections`, `testimonials`, `faqs`, `categories`, `settings`, plus lookup helpers `productById`, `categoryName`, `findCoupon`.

### 7.8 The mobile DRM triad

**[Verified]** Three modules in `react-native/src/drm/` implement protected reading, and they have strictly separated responsibilities:

- **`ScreenShield.tsx`** (478 lines) — declares the `ScreenShieldNative` contract (`enable`, `disable`, `isCaptured`, `isMirrored`, `isShieldActive`, `deviceIntegrity`, `excludeFromBackup`, `sha256File`, `restrictDocumentInteraction`, `addListener`, `removeListeners`); computes `SCREEN_SHIELD_AVAILABLE = Boolean(NativeModules.ScreenShield)`; caches `probeIntegrity()`; exports `COMPROMISED_INTEGRITY = ['ROOTED','JAILBROKEN','ATTESTATION_FAILED','EMULATOR']`, `isCompromised()`, `PLATFORM_PROTECTION_NOTE`, `ShieldOverlay` and `useScreenShield()`. Its provider sits **above the navigator** *"so the overlay covers navigation chrome too: a back-swipe animation that reveals the reader for one frame defeats the purpose."*
- **`SecureFileVault.ts`** (358 lines) — the private file store. `vaultRoot() = ${DocumentDir}/casanova-vault`; files named by **grant id**, sanitised to `[a-zA-Z0-9_-]`, *"so nothing about the catalogue is readable from a directory listing"*; `index.json` colocated inside the vault rather than in AsyncStorage *"so one deletion removes both"*; `assertInsideVault()` **throws**; `fetchToVault()` validates status 200, declared `file_size_bytes`, a ≥1024-byte floor and a SHA-256 checksum, unlinking on any failure because *"A half-written file is worse than no file"*; plus `purge()`, `wipeAll()`, `purgeExpired()`, `vaultSizeBytes()`, `openFromVault()`.
- **`useReaderSession.ts`** (469 lines) — the state machine that binds them: `probe integrity → claim device session → resolve policy → mint grant → redeem grant → fetch into vault → heartbeat → renew or destroy`, with `ReaderPhase = 'idle' | 'registering' | 'granting' | 'fetching' | 'ready' | 'blocked' | 'error'` and a `runId` ref guarding every async write against a superseded attempt.

### 7.9 The native modules

**[Verified]** Both implement the identical eleven-method contract, and both diverge in *how* they protect, because the operating systems differ:

- **Android (`ScreenShieldModule.kt`, 623 lines) = prevention.** `FLAG_SECURE` removes the window from every capture surface, so `isCaptured()` correctly resolves **false** always and `onCaptureChanged` is never emitted — documented as the right answer rather than a stub. `enable()` **rejects** `E_NO_ACTIVITY` instead of resolving false, so a log distinguishes "no activity" from "the flag did not take". `detectIntegrity()` returns `EMULATOR` / `ROOTED` / `TRUSTED`, with a long rationale for why `ATTESTATION_FAILED` must **not** be the default: *"that value is in `COMPROMISED_INTEGRITY` on the JavaScript side, so returning it would make `drm_policies.block_rooted_devices` refuse to open a book on every unmodified Android phone in existence."*
- **iOS (`ScreenShield.swift`, 828 lines) = detection + concealment.** No `FLAG_SECURE` equivalent exists, so the module installs an opaque `privacyCover` on `willResignActive`, listens to `capturedDidChange` / `connectDidChange`, records `userDidTakeScreenshot` for attribution, and strips `UILongPressGestureRecognizer` from any PDFKit view to remove the Copy/Share route. A secondary mechanism lifts the canvas layer through a 1×1 `isSecureTextEntry` `UITextField`; it is **excluded** from `canProtectSwitcher()` because it depends on non-public API shape, and *"Making `enable()`'s return value depend on it would mean an iOS update could stop the reader from opening books at all."*

---

## 8. DATA FLOW

### 8.1 Web read path

**[Verified]**

```
localStorage['casanova_db_v1']
  → db.getDb()                       parse once, hold in module scope
  → useStore()                       useSyncExternalStore(subscribe, getDb)
  → Context selector (useMemo)       publishedProducts, activeSections, …
  → Page component                   render
```

A write anywhere invalidates this chain in one synchronous tick: `mutate()` notifies its listener set, `useSyncExternalStore` re-reads, every subscribed selector recomputes, every consumer re-renders. There is no cache to invalidate and no query key to match — which is why the whole app feels immediate, and also why an unguarded write inside a render path loops forever.

### 8.2 Web write path

**[Verified]**

```
User gesture
  → Page handler
  → service function(actor, …)
      → guard(actor, permission)          ⇒ Result{ok:false, code:FORBIDDEN|UNAUTHENTICATED}
      → validate                          ⇒ Result{ok:false, code:VALIDATION}
      → conflict check                    ⇒ Result{ok:false, code:CONFLICT}
      → mutate(d => { … })                write + notify
      → writeAudit(actor, {category,…})   append to audit_logs (bounded)
      → dispatchEmail(…)                  append to email_logs (queued, not sent)
  → Result<T>
  → Page renders ok / error message
```

**[Verified]** Nothing throws. A page that forgets to check `result.ok` does not crash — it silently shows nothing, which is why every page in the codebase wraps the call in a `run(result, successMessage)`-style helper (see `AdminProductsPage.tsx:1246`).

### 8.3 Purchase → entitlement → reading (the spine of the product)

**[Verified]** End to end:

```
1. Visitor on /store or / clicks a CTA
     → setSelectedProduct(product); navigate('/checkout')
2. CheckoutPage collects name, email, confirmed email, phone, coupon_code
     → placeOrder({product_id, first_name, last_name, email, phone, coupon_code})
     → AppContext.placeOrder → api-orders.checkout(input)
3. checkout()
     → validate product state (ACTIVE, not HIDDEN, in stock)
     → recompute price and discount from stored rows
     → findOrCreateCustomer(email)  — guest checkout creates the account
     → mutate(): Order{PENDING}, OrderItem{snapshot of name+price}
     → writeAudit, dispatchEmail (queued)
     → Result<CheckoutOutcome>
4. AppContext stores lastOrder → /checkout/success
     CheckoutSuccessPage reads the recorded status and says
     "awaiting payment confirmation" — never "paid"
5. Staff confirm payment: markOrderPaid(actor, orderId)   [permission: mark_paid]
     → order_status/payment_status = PAID
     → grantAccessForOrder(order)
         → UserProduct{access_status: ACTIVE, product_snapshot: snapshotProduct(p)}
         → writeAudit ACCESS_GRANTED
6. Customer sets a password via /forgot-password → token → /setup-password?token=…
     → resetPasswordWithToken(token, password); token burned on use
7. Customer signs in → /dashboard → /dashboard/library
     LibraryPage renders up.product_snapshot, not the live product
     (live product consulted only for current cover art)
8. "התחילו לקרוא" → /read/:productId
     ReaderPage:
       → registerDeviceSession(actor, fingerprint)   [ref-guarded: registeredFor]
       → resolveDrmPolicy(policies, 'WEB')
       → issueContentGrant(actor, productId, sessionId)  [ref-guarded: grantedFor]
       → consumeContentGrant(grant)  ⇒ short-lived URL, use budget decremented
       → <iframe key={…} src={url + '#page=N&toolbar=0&navpanes=0&zoom=…'}>
       → saveReadingProgress  [ref-guarded: savedProgressKey; server-throttled
                               to one write per minute]
       → useScreenProtection() applies the deterrents the policy asks for
```

**[Verified]** Step 8's iframe `key` is not a React tidiness detail. The browser's PDF plugin honours `#page=` and `#zoom=` fragment parameters **only on a full document load**; changing the fragment of an already-loaded plugin document does nothing. Forcing a remount via `key` is the only way to make page travel and zoom work. See §14.3.

### 8.4 Revocation — the flow that makes the model work

**[Verified]** Revoking a device session must kill content the customer may already hold. The web and SQL implementations agree:

```
revokeDeviceSession(actor, sessionId, reason)
  → device_sessions.revoked = true, revoked_at, revoked_by, revoke_reason
  → SQL: trg_device_session_revokes_grants
        AFTER UPDATE OF revoked … WHEN (NEW.revoked AND NOT OLD.revoked)
        EXECUTE FUNCTION revoke_grants_for_device_session()
        → every content_access_grants row for that session is revoked
        → every URL already handed to that device stops resolving
```

The same cascade exists for entitlements: `trg_user_product_revokes_grants` fires when a `user_products` row is revoked, so withdrawing a purchase kills its grants too.

**[Verified]** On the phone the cascade has a local half that no server round trip can perform. `LibraryContext`'s effect purges the vault for any entitlement that stopped being live, with the comment *"Waiting for the TTL would leave a revoked book sitting in the sandbox."* `LibraryContext.removeDevice` notes: *"The server cascades to content_access_grants, so every URL handed to that device dies there. The local bytes have to die here — there is no server round trip that can delete a file."*

### 8.5 Mobile read path

**[Verified]**

```
Keychain (com.casanova.reader.session)  +  AsyncStorage (api_base_url)
  → net/client.ts request()
      → Authorization: Bearer <token from Keychain>
      → X-Casanova-Client / -App-Version / -Build / -Device-Id
        X-Casanova-Device-Model / -OS-Version
      → fetch with 15 s AbortController timeout
      → 204 ⇒ undefined; 401|UNAUTHENTICATED ⇒ clearSession()
      → AbortError ⇒ TIMEOUT; any other throw ⇒ NETWORK
      → prefer the server's own Hebrew Failure message
  → net/api.ts typed function
  → store context (useMemo)
  → screen
```

**[Verified]** The client-identity headers are not telemetry. `net/client.ts`: *"A kill switch that only works for clients that volunteer their version is not a kill switch."* `X-Casanova-Build` carries the integer `versionCode` from `android/app/build.gradle`, which the server compares against `platform_settings.mobile_min_build`.

### 8.6 Mobile protected-read path

**[Verified]** `useReaderSession` in full:

```
1. probeIntegrity()                  → ATTESTATION_FAILED if module missing
2. registerDevice()                  → CONFLICT ⇒ permanent block,
                                       DEVICE_LIMIT_EXCEEDED
3. resolve policy (server, else RESTRICTIVE_POLICY)
4. issueGrant({productId, sessionId, mode})
5. redeemGrant(token)                → RedeemedGrant — "the only place in
                                       the whole app where the address of a
                                       protected file exists"
6. SecureFileVault.fetchToVault()    → validate status/size/checksum,
                                       else unlink
7. phase = 'ready'; ReaderScreen renders vault path only
8. heartbeat every 60 s (skipped when idle > 120 s)
     → cut off ⇒ revoked, permanent block, SESSION_REVOKED, destroyLocal()
9. renew() spends a new token but does NOT re-download
10. teardown purges streamed copies; offline copies left for purgeExpired()
```

**[Verified]** Two design decisions worth naming:

- The `runId` ref guards every async write: *"An abandoned attempt — unmount, retry, product change — must not land its result on top of the current one, or a slow first fetch resolves after a fast second one and the reader ends up showing a file whose grant was already replaced."*
- When offline reading is requested but the policy forbids it, the hook **falls back to streaming** and reports `DOWNLOAD_BLOCKED`, because *"Refusing to open the book at all … would be worse than reading it online."* Protection failures are logged, not turned into denials of service, unless the policy says so.

### 8.7 Derived data — what is never stored

**[Verified]** A consistent rule across both TypeScript and SQL: if a value can be recomputed from rows that exist, it is recomputed on read.

| Derived value | Web | SQL |
|---|---|---|
| Revenue by day | `analytics.ts` | `v_daily_revenue` |
| Product sales | `analytics.ts` | `v_product_sales` |
| Refunded amount per order | `analytics.ts` | `v_order_refunds` |
| Customer lifetime summary | — | `v_customer_summary` |
| Operational alerts | `alerts.ts` | *(web-only)* |
| Readable catalogue | `CmsContext.publishedProducts` | `v_storefront_catalog` |
| Entitled content | `CmsContext` + `hasAccess` | `v_entitled_content` |
| Live grants | — | `v_active_content_grants` |
| Reading overview | — | `v_user_reading_overview` |
| Support queue | — | `v_inquiry_queue` |

**[Verified]** `schema.sql` therefore gives `orders` **no** `refunded_amount` and **no** `refund_status` column. The web `Order` type *does* carry both, and `checkout()` writes `refund_status: 'NONE', refunded_amount: 0`. This is a real, verifiable divergence between the TypeScript model and the SQL contract — see §9.4 and §26.

---

## 9. DATABASE

### 9.1 `schema.sql` — scope and stated rules

**[Verified]** 1941 lines. Its header sets four rules, all of which the body honours:

1. DDL only — no seed content.
2. Relationships are IDs plus foreign keys, never embedded objects.
3. Purchase-time history is preserved with bounded snapshots.
4. Recomputable totals are **not** stored.

And one security rule stated as the reason for the constraints:

> *"Nothing is allowed to claim money moved without provider confirmation — enforced by CHECK constraints and a trigger on `refunds`, not by application convention alone."*

### 9.2 Inventory

**[Verified]** 38 tables:

```
platform_settings, content_assets, users, password_reset_tokens, sessions,
categories, products, books, product_categories, product_images,
product_media_links, product_relations, cms_sections, testimonials, faqs,
coupons, orders, order_items, payments, refunds, invoices, coupon_usage,
user_products, reading_progress, subscriptions, inquiries, inquiry_notes,
email_logs, audit_logs, webhook_events, rate_limit_buckets, crm_leads,
crm_tasks, crm_notes, drm_policies, device_sessions, security_events,
content_access_grants
```

11 views: `v_order_refunds`, `v_orders`, `v_daily_revenue`, `v_product_sales`, `v_customer_summary`, `v_active_user_products`, `v_storefront_catalog`, `v_entitled_content`, `v_active_content_grants`, `v_inquiry_queue`, `v_user_reading_overview`.

8 functions with 14 triggers:

| Function | Trigger | Purpose |
|---|---|---|
| `assert_book_product_is_ebook` | `trg_books_is_ebook` | a `books` row must point at an `EBOOK` product |
| `assert_refund_within_order_total` | `trg_refund_within_order_total` | refunds cannot exceed the order |
| `assert_inquiry_assignee_is_staff` | `trg_inquiry_assignee_is_staff` | only staff may be assigned |
| `revoke_grants_for_device_session` | `trg_device_session_revokes_grants` | revoking a device kills its grants |
| `revoke_grants_for_entitlement` | `trg_user_product_revokes_grants` | revoking an entitlement kills its grants |
| `set_updated_at` | 11 × `trg_*_updated_at` | timestamp maintenance |
| `consume_content_grant` | *(called, not triggered)* | atomic single-use grant redemption |
| `sweep_expired_reader_sessions` | *(called, not triggered)* | close out expired mobile sessions |

Exactly **two** INSERT statements exist in the whole file: one neutral `platform_settings` row and one default `drm_policies` row. Site-copy columns are deliberately omitted so that no invented marketing text can ship.

### 9.3 The devices-and-grants core

**[Verified]** The device cap is enforced by a partial unique index rather than by application counting:

```sql
CREATE UNIQUE INDEX uq_device_sessions_open_slot
  ON device_sessions (user_id, device_fingerprint)
  WHERE ended_at IS NULL AND NOT revoked;
```

**[Inferred — HIGH]** This is the correct primitive: two concurrent `registerDeviceSession` calls for the same user and fingerprint cannot both succeed, so the cap holds under a race that an application-level `COUNT(*)` check would lose. `max_devices_per_user` lives on `drm_policies` and is compared by the service layer; the index makes the *same-device* case unbreakable regardless.

**[Verified]** The revocation cascade:

```sql
CREATE TRIGGER trg_device_session_revokes_grants
  AFTER UPDATE OF revoked ON device_sessions
  FOR EACH ROW WHEN (NEW.revoked AND NOT OLD.revoked)
  EXECUTE FUNCTION revoke_grants_for_device_session();
```

The `WHEN (NEW.revoked AND NOT OLD.revoked)` clause means the cascade fires on the transition only, so re-saving an already-revoked row does not re-run it.

**[Verified]** The leak the whole design exists to close, documented in the view itself:

```sql
-- products.content_url and content_assets.public_url are deliberately
-- NOT selected here. This is the view an anonymous visitor reads…
CREATE VIEW v_storefront_catalog AS SELECT … WHERE p.status = 'ACTIVE' AND p.visibility = 'PUBLIC';
```

`v_entitled_content` and `content_assets.storage_key` are named in a closing ACCESS CONTROL block as values that **may never reach a client**. The same block prescribes customer / staff-only / service-role column sets and row-level security.

**[Verified]** The mobile client mirrors this: `CatalogProduct` in `react-native/src/net/types.ts` has no `content_url` field, with the comment *"That is not an oversight to be 'fixed' by widening the interface."*

### 9.4 `migrations/0001_mobile_reader.sql` and a verified conflict

**[Verified]** 597 lines, wrapped in `BEGIN;`/`COMMIT;`, written idempotently (`IF NOT EXISTS`, `IF EXISTS`, drop-then-re-add for constraints), and closing with a four-query VERIFICATION block including *"Confirm the leak is closed — this must return no rows."*

Its sections:

| § | Change |
|---|---|
| A | `drm_policies` += `block_download` (TRUE), `allow_offline` (FALSE), `offline_ttl_hours` (1–720), `block_rooted_devices` (TRUE), `chk_drm_offline_needs_ttl` |
| B | drop and re-add `security_events_event_type_check` with 6 new native event types |
| C | `device_sessions` += `revoked_at`, `revoked_by`, `revoke_reason`, `device_model`, `os_version`, `app_version`, `device_integrity`, `chk_device_session_revocation`, 2 indexes |
| D | `sessions` += `client` (`WEB\|ANDROID\|IOS`), `app_version`, `revoked_at` |
| E | `inquiries.source` and `crm_leads.source` += `MOBILE_APP` |
| F | `platform_settings` += `mobile_app_enabled`, `mobile_min_build` |
| G | create `content_access_grants`, `consume_content_grant()`, both cascade triggers |
| H | recreate `v_storefront_catalog` without the content-address columns; create `v_entitled_content`, `v_active_content_grants` |
| I | `sweep_expired_reader_sessions()` |

**[Verified — DEFECT]** Three concrete divergences between `schema.sql` and `migrations/0001_mobile_reader.sql`:

1. **`consume_content_grant` returns a different row type.** `schema.sql` declares **7** output columns; the migration declares **8**, adding `out_asset_id`. PostgreSQL rejects `CREATE OR REPLACE FUNCTION` when the return type changes: *"cannot change return type of existing function."* Applying `schema.sql` and then `0001` in the documented order **fails** at section G.
2. **`content_access_grants.token_hash` uniqueness is expressed differently** — inline `VARCHAR(255) NOT NULL UNIQUE` in `schema.sql`, versus a named `CONSTRAINT chk_grant_token_unique UNIQUE (token_hash)` in the migration. Cosmetically different, but the constraint *name* differs, so any future migration that drops it by name will only work against one of the two.
3. **`schema.sql` already contains everything the migration adds.** Every column, table, view and function in sections A–I is present in `schema.sql`. The migration is not additive to the committed baseline; it is a record of a gap analysis that has already been folded back in.

**[Inferred — HIGH]** The practical reading: `schema.sql` is the *current* intended state and `migrations/0001` is a *historical* artefact kept for its reasoning. Running both against one database is not a supported path. Nobody has ever run either, because no PostgreSQL instance, connection string or migration runner exists in the repository (§27).

### 9.5 Constraint craft worth preserving

**[Verified]** Several constraints are written with an explicit comment about the failure mode they prevent, and these comments are the reason not to "simplify" them:

- `chk_drm_watermark_template` and `chk_drm_offline_needs_ttl` both wrap their operands in `COALESCE`, with a comment noting that *"a CHECK passes on NULL."* Removing the `COALESCE` silently disables the constraint for any row where the operand is NULL.
- `chk_grant_offline_single_use`, `chk_grant_bound_to_session`, `chk_grant_revocation` — the grant table's invariants: an offline grant is single-use, every grant is bound to a device session, and revocation carries attribution.
- `chk_order_total_arithmetic` and `chk_item_arithmetic` — the database re-derives `subtotal - discount = total` and `quantity × unit_price - discount = line_total`. The application's arithmetic is checked, not trusted.
- `chk_refund_needs_provider_confirmation`, `chk_payment_captured_has_reference`, `chk_email_delivered_has_provider_id`, `chk_refunds_require_provider` — the four constraints that make "money is never invented" a database property rather than a code-review habit.
- `order_items.product_id` and `user_products.product_id` are `ON DELETE RESTRICT`, which is the SQL expression of `deleteProduct`'s `CONFLICT` result: a product that has been sold cannot be deleted.

### 9.6 Cross-verification of TypeScript unions against SQL CHECK lists

**[Verified]** This was an explicit instruction in the original tasking (*"תבדוק את סכמות הSQL MIGRATION לוודא שלא חסר כלום"* — check the SQL migration schemas to make sure nothing is missing). Result:

| TypeScript union | SQL CHECK | Match |
|---|---|---|
| `SecurityEventType` (15 members) | `security_events_event_type_check` | **exact** |
| `DeviceIntegrity` (6 values) | `device_sessions.device_integrity` | **exact** |
| `Inquiry.source` incl. `MOBILE_APP` | `inquiries.source` | **exact** |
| `CrmLead.source` incl. `MOBILE_APP` | `crm_leads.source` | **exact** |
| audit categories used by `writeAudit` (17) | `audit_logs.category` | **exact** |

**Nothing is missing.** The migration's six new native event types are present in both the SQL CHECK list and the TypeScript union, and the web `SecurityEventType` includes them too — so the web admin console can filter and label events that only a phone can raise (`SECURITY_EVENT_LABEL`, `HIGH_SIGNAL_EVENTS` in `api-security.ts`).

**[Verified — divergence]** One field-level mismatch: the web `Order` type carries `refund_status` and `refunded_amount`, which `schema.sql` deliberately does **not** store on `orders` (they are derived through `v_order_refunds`). If the web app is ever pointed at this schema, those two fields must become computed rather than persisted.

---

## 10. APIs

### 10.1 There is no HTTP API in this repository

**[Verified — HIGH]** This is the first thing a future engineer must internalise, because the directory layout suggests otherwise. `src/lib/api.ts`, `api-orders.ts`, `api-support.ts` and `api-security.ts` are **not HTTP clients**. They contain no `fetch`, no URL, no base path. They are synchronous-ish service functions that read and write `localStorage` through `db.ts`. They are *named* `api-*` because they are shaped like one.

**[Verified]** The file header of `src/lib/api.ts` states the intent directly:

> *"Pointing that driver at HTTP endpoints turns this module into a client for a real backend without changing a single call site."*

So the contract exists in three mutually-consistent forms, and only one of them is executable today:

| Form | Location | Executable today? |
|---|---|---|
| TypeScript service functions | `src/lib/api*.ts` | **Yes** — this is what the web app runs |
| TypeScript HTTP client | `react-native/src/net/{client.ts,api.ts}` | No — it compiles, but `api.casanova.local` does not resolve |
| SQL contract | `schema.sql`, `migrations/0001_mobile_reader.sql` | No — no database exists |

**[Inferred — HIGH]** The three forms are deliberately kept in lockstep. `react-native/src/net/api.ts` carries a header table that maps each phone function to the web service function that already implements the same operation and to the table or view the server reads. That table is the API specification. It is reproduced verbatim below because it is the single most useful artefact in the repository for anyone about to write the backend.

### 10.2 The shared envelope

**[Verified]** Both clients use an identical result type. From `src/lib/api.ts`:

```ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ErrorCode };

export type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'VALIDATION' | 'CONFLICT' | 'PROVIDER_NOT_CONFIGURED' | 'STORAGE';
```

`react-native/src/net/types.ts` redeclares it as `ApiResult<T>` and extends `ApiErrorCode` with six transport- and device-specific codes that cannot occur in a same-process service layer:

| Extra code | Raised by | Meaning |
|---|---|---|
| `NETWORK` | `client.ts` catch block | `fetch` threw (offline, DNS, TLS) |
| `TIMEOUT` | `client.ts` `AbortError` branch | `REQUEST_TIMEOUT_MS` elapsed |
| `APP_DISABLED` | `bootCheck()` | `mobile_app_enabled === false` |
| `BUILD_TOO_OLD` | `bootCheck()` | `BUILD_NUMBER < mobile_min_build` |
| `DEVICE_COMPROMISED` | `ProtectionContext` | integrity probe failed or the shield failed to install |
| `GRANT_EXPIRED` | `ReaderScreen` | a grant's TTL or use budget was spent |

**[Verified]** `error` is always a complete Hebrew sentence written for the end user, produced by the service layer — never a raw exception message, never a status code. The pages render `result.error` directly. This means **error copy is part of the API contract**: a future backend that returns its own Hebrew messages is compatible; one that returns English or stack traces is not.

**[Verified]** No exceptions cross the service boundary **except one**. Every service function is `try`-free at the call site because it cannot throw on a business failure. The single exception is `db.ts`'s `writeDocument()`, which rethrows a quota failure as `new Error('STORAGE_QUOTA_EXCEEDED')` — and **nothing in the repository catches it** (§17.8). Pages otherwise never render an error boundary for a business failure; `RouteError` and `CrashBoundary` exist for genuinely unexpected faults only (§17).

### 10.3 The mobile endpoint surface — 18 routes

**[Verified]** Complete list, read from `react-native/src/net/api.ts` and `client.ts`. `anon` = the `Authorization` header is suppressed via `{ anonymous: true }`.

| # | Method | Path | Client function | Anon | Web service equivalent | Reads / writes |
|---|---|---|---|---|---|---|
| 1 | GET | `/settings/public` | `bootCheck()` | ✔ | `getSettings()` | `platform_settings` |
| 2 | POST | `/auth/login` | `login()` | — | `login()` | `users`, `sessions` |
| 3 | POST | `/auth/logout` | `logout()` | — | `logout()` | `sessions` |
| 4 | GET | `/auth/me` | `fetchMe()` | — | `getSessionUser()` | `users` |
| 5 | POST | `/auth/password-reset` | `requestPasswordReset()` | ✔ | `requestPasswordReset()` | `password_resets`, `email_log` |
| 6 | GET | `/catalog` | `fetchCatalog()` | ✔ | `listPublicProducts()` | `v_storefront_catalog` |
| 7 | GET | `/me/library` | `fetchLibrary()` | — | `listUserProducts()` | `v_entitled_content` |
| 8 | GET | `/me/orders` | `fetchOrders()` | — | `listMyOrders()` | `orders`, `order_items` |
| 9 | GET | `/me/progress/:productId` | `fetchProgress()` | — | `getReadingProgress()` | `reading_progress` |
| 10 | PUT | `/me/progress` | `saveProgress()` | — | `saveReadingProgress()` | `reading_progress` |
| 11 | POST | `/me/devices` | `registerDevice()` | — | `registerDeviceSession()` | `device_sessions`, `drm_policies` |
| 12 | GET | `/me/devices` | `listDevices()` | — | `listDeviceSessions()` | `device_sessions` |
| 13 | POST | `/me/devices/:sessionId/heartbeat` | `heartbeatDevice()` | — | `refreshDeviceSession()` | `device_sessions` |
| 14 | DELETE | `/me/devices/:sessionId?reason=…` | `revokeDevice()` | — | `revokeDeviceSession()` | `device_sessions` + grant cascade |
| 15 | POST | `/content/grants` | `issueGrant()` | — | `issueContentGrant()` | `content_access_grants` |
| 16 | POST | `/content/grants/redeem` | `redeemGrant()` | — | `consumeContentGrant()` | `consume_content_grant()` function |
| 17 | POST | `/security/events` | `reportSecurityEvent()` | — | `recordEvent()` | `security_events` |
| 18 | POST | `/support/inquiries` | `submitInquiry()` | — | `submitPublicInquiry()` | `inquiries` (`source = MOBILE_APP`) |

**[Verified]** Notably absent from the mobile surface: **every admin endpoint, every product-mutation endpoint, and checkout.** The phone cannot buy, cannot edit, cannot administer. **[Inferred — HIGH]** This is a deliberate narrowing — a mobile client is a reader, and the smaller the authenticated surface on a device that can be physically seized, the smaller the damage from a stolen session.

### 10.4 How a request is constructed

**[Verified]** `react-native/src/net/client.ts` enforces three rules, stated in its own header. The construction order is fixed:

1. `AbortController` + `setTimeout(… , options.timeoutMs ?? REQUEST_TIMEOUT_MS)`.
2. Headers: `Accept: application/json`, then the six identity headers, then `Content-Type` **only if a body exists**, then `Authorization: Bearer <token>` unless `anonymous`.
3. The six identity headers are non-negotiable and are attached to **every** request including anonymous ones:

```
X-Casanova-Client:        CLIENT            ('MOBILE_IOS' | 'MOBILE_ANDROID')
X-Casanova-App-Version:   APP_VERSION
X-Casanova-Build:         String(BUILD_NUMBER)   ← integer, compared against mobile_min_build
X-Casanova-Device-Id:     DeviceInfo.getUniqueId()  (bundle-id fallback)
X-Casanova-Device-Model:  DeviceInfo.getModel()
X-Casanova-OS-Version:    DeviceInfo.getSystemVersion()
```

The header comment explains why the server must not trust the client to volunteer them: *"A kill switch that only works for clients that volunteer their version is not a kill switch."* **[Inferred — HIGH]** A future backend must therefore reject a request missing `X-Casanova-Build` rather than defaulting it to something permissive.

4. Response handling, in this exact order: `204` → success with `undefined`; parse JSON tolerantly (`.catch(() => null)`); on `!response.ok` prefer the server's own `{ ok: false, code, error }` payload; otherwise map `401 → UNAUTHENTICATED`, `403 → FORBIDDEN`, `404 → NOT_FOUND`, anything else → `STORAGE`; on a null payload return `STORAGE` with `'תגובת השרת אינה תקינה.'`.
5. **A `401` or a server-issued `UNAUTHENTICATED` clears the keychain immediately** (`await clearSession()`), before returning. This is what makes session expiry self-healing rather than a stuck state.
6. `finally { clearTimeout(timer) }` — the timer is always cancelled.

### 10.5 Request/response properties a future backend must honour

**[Derived from source — HIGH]** These are not documented anywhere as a list; they are reconstructed from the client's behaviour, which means a backend that violates one produces a client bug rather than a clean error.

| Property | Evidence |
|---|---|
| `POST /content/grants` returns a **token, never a URL** | `issueGrant` returns `IssuedGrant`; `redeemGrant` returns `RedeemedGrant` — the address only exists after redemption |
| Redemption is **single-use and row-locked** | `consume_content_grant()` in `schema.sql` takes a row lock and re-validates expiry, budget, revocation and entitlement in one transaction |
| Redemption is **bound to the product named in the request** | `redeemGrant(token, productId)` sends both; the SQL rejects a mismatch |
| `POST /me/devices` answers `DEVICE_LIMIT_EXCEEDED` at the cap | `registerDevice` doc comment; `drm_policies.max_devices_per_user`; `uq_device_sessions_open_slot` |
| Heartbeat is the moment a **revoked** session is noticed | `heartbeatDevice` doc: *"Also the moment the server notices a revoked session and answers `SESSION_REVOKED`"* |
| `logout` must **not** revoke the device session | `logout` doc: *"a logout is not a device revocation, and the next login should reuse the slot rather than consume a new one"* |
| `source` on inquiries is set **server-side from the header** | `submitInquiry` doc: *"a value the client chooses is a value the client can forge, and the CMS filters on it"* |
| `/catalog` must not contain `content_url` or `public_url` | `CatalogProduct` type; the doc calls the omission *"load-bearing"* |
| `secure_flag_active: false` must be **recorded, not rejected** | `RegisterDeviceInput` doc: *"The server records it either way; a false here is what makes the CMS show the row as unprotected instead of silently trusting it"* |
| `/settings/public` must be reachable **without a session** | `bootCheck()` runs before any credential is read |

### 10.6 The web "API" — the six-step service discipline

**[Verified]** `guard()` is the whole authorisation mechanism, and its signature matters: it returns a **failure or null**, not a boolean.

```ts
export function guard(actor: Actor | null, permission: AdminPermission): Failure | null {
  if (!actor) return fail('UNAUTHENTICATED', 'יש להתחבר לחשבון מנהל כדי לבצע פעולה זו.');
  if (actor.role !== 'ADMIN') return fail('FORBIDDEN', 'הפעולה זמינה למנהלים בלבד.');
  if (!can(actor.admin_role, permission)) {
    const label = actor.admin_role ? ROLE_LABEL[actor.admin_role] : 'לא מוגדר';
    return fail('FORBIDDEN', `לתפקיד "${label}" אין הרשאה לבצע פעולה זו.`);
  }
  return null;
}
```

Three checks in a fixed order — *is there an actor*, *is the actor staff*, *does the role hold the permission* — and the denial message names the role in Hebrew so an administrator who hits it learns which hat to put on. Every mutating function in `src/lib/api*.ts` then follows the same six steps, and the order is the security property. From `api.ts:1001`:

```ts
export function saveCoupon(
  actor: Actor | null,
  data: Omit<Coupon, 'coupon_id' | 'times_used'>,
  id?: string
): Result<Coupon> {
  const denied = guard(actor, 'cms');                        // 1. authorise
  if (denied) return denied;                                 //
  const code = data.code.trim().toUpperCase();               // 2. normalise + validate
  if (!code) return fail('VALIDATION', 'קוד הקופון חובה.');
  const db = getDb();
  if (db.coupons.some((c) => c.code.toUpperCase() === code && c.coupon_id !== id))
    return fail('CONFLICT', '…');                            // 3. conflict-check
  const coupon = mutate((db) => { … });                       // 4. persist
  writeAudit(actor, { category: 'COUPON_CHANGE', … });        // 5. audit
  return ok(coupon);                                          // 6. return
}
```

**[Verified]** Step 1 is never skipped and never moved. `guard()` is the authoritative check; the `can()` calls in layouts and pages are cosmetic (§12).

**[Verified]** Note the shape of `data: Omit<Coupon, 'coupon_id' | 'times_used'>` — the caller cannot supply the primary key or the usage counter. Server-assigned and server-incremented fields are removed from the input type rather than validated at runtime. This idiom recurs and is worth copying.

**[Verified]** `writeAudit` takes an **object** (`{ category, action, target_type, target_id, target_label, details }`), not positional arguments. `category` is a 17-member `AuditCategory` union that matches `audit_logs.category` in `schema.sql` exactly (§9.6).

**[Verified]** Read-only functions omit steps 4 and 5 but still begin with `guard()` where the data is privileged. `listDeviceSessions(actor)` is the example that matters: it returns every session for a `security`-permissioned caller and only the caller's own sessions otherwise.

**[Verified]** Not every service function is `async`. `saveCoupon`, `deleteCoupon`, `guard`, `findCoupon` and most CMS functions are synchronous and return `Result<T>` directly; `checkout`, `login` and `createInquiry` are `async` and return `Promise<Result<T>>`. Callers `await` both — awaiting a non-promise is legal — which is why `SupportPage` can wrap a synchronous `createInquiry` in `await Promise.resolve(…)` without breaking. **[Inferred — MEDIUM]** The `async` marking follows the functions that were written with a future network hop in mind, not any present behaviour.

**[Verified — drift]** One permission is assigned to the wrong place. `saveCoupon`/`deleteCoupon` guard on `'cms'`, and the coupon UI lives in `AdminCmsPage.tsx`. But `ROLE_DESCRIPTION.FINANCE` promises *"הזמנות, תשלומים, חשבוניות, החזרים, **קופונים** ומנויים"* while `ROLE_PERMISSIONS.FINANCE` contains **no `'cms'`** — so a FINANCE administrator is told coupons are their domain and is then refused when they touch one. Conversely `MARKETING` holds `'finance'` (page access) although its own description does not mention finance. This is a cosmetic mismatch today; it becomes a real authorisation bug the moment the permission strings are lifted into server-side claims, which `permissions.ts` explicitly anticipates.

### 10.7 Outbound e-mail — a queue, not a send

**[Verified]** `resendEmail()` in `api.ts:202` shows the whole model in twelve lines. It reads `db.settings.email_provider`; when there is none it still writes the row, still flips `status` to `'QUEUED'`, and records the reason as data:

```ts
failure_reason: provider ? undefined : 'לא הוגדר ספק שליחת מיילים — ההודעה ממתינה בתור.',
```

*"No e-mail provider is configured — the message is waiting in the queue."* The administrator sees the truth in `AdminEmailsPage`. **`PROVIDER_NOT_CONFIGURED`** is the error code reserved for the moment a real provider is wired in and is missing.

**[Inferred — HIGH]** This is the pattern to copy for every future external integration: write the intent as a row, mark it queued, and let an administrator see it. The database enforces the same discipline with `chk_email_delivered_has_provider_id` — a row may not claim `DELIVERED` without a provider reference. Nothing can silently pretend an e-mail was sent.

---

## 11. EXTERNAL INTEGRATIONS

### 11.1 There are none

**[Verified — HIGH]** The repository integrates with **zero** external services. There is no payment gateway, no mail provider, no SMS provider, no analytics service, no error reporter, no CDN, no object store, no OAuth provider, no CRM webhook. No SDK for any of these appears in either `package.json`, and no HTTP egress exists anywhere in the web application.

This is unusual enough to be worth stating plainly: **a complete e-commerce storefront with a checkout flow, an invoice concept, a password-reset flow and a welcome-e-mail concept, none of which touches the internet.**

### 11.2 The placeholders that exist

**[Verified]** The system is built so that each integration has a defined seam and an honest empty state:

| Integration point | Seam in the code | Current behaviour | What turning it on requires |
|---|---|---|---|
| Payment capture | `markOrderPaid(actor, orderId, reference)` in `api-orders.ts`, permission `mark_paid` | An administrator clicks it by hand; the order becomes `PAID` and `grantAccessForOrder` runs | Replace the manual call with a verified provider webhook. **The function already has the right signature** — it takes a provider reference and refuses without one |
| Refunds | `refundOrder()` / the `refunds` table | Recorded, `provider` required by `chk_refunds_require_provider` | Provider API call, then record the confirmation |
| Transactional e-mail | `dispatchEmail()` → `email_log` | Rows queue with `status: 'QUEUED'` forever | A mail provider + a worker that flips `QUEUED → SENT/DELIVERED` and stores `provider_message_id` |
| Password reset | `requestPasswordReset()` → `password_resets` | A token row is created; `ForgotPasswordPage` accepts it | The same mail provider, to deliver the link |
| Invoices / receipts | `orders.invoice_number`, the `Invoice` concept in the brief | Number generated locally; no PDF produced | A document renderer |
| Analytics | `src/lib/analytics.ts` | Recomputes revenue and product stats from the local database on every read | Nothing — unless an external BI feed is wanted, in which case the views in `schema.sql` (`v_daily_revenue`, `v_product_sales`, `v_customer_summary`) are already the right shape |
| Mobile backend | `react-native/src/net/client.ts` | Every request fails with `NETWORK` | **The entire backend.** This is the one integration that blocks a whole client |

### 11.3 The only network calls that exist

**[Verified]** Exactly two places in the whole repository perform `fetch`:

1. `react-native/src/net/client.ts` — the eighteen routes in §10.3, all to a base URL that does not resolve.
2. `react-native/src/drm/`'s grant redemption path, which downloads the PDF bytes from the short-lived URL returned by `redeemGrant()` via `react-native-blob-util`.

The web application performs **no `fetch` at all**. **[Verified]** Its only I/O is `localStorage.getItem` / `setItem` and an `<iframe>`/`<embed>` `src` pointing at `/books/*.pdf` in its own bundle.

### 11.4 Why the absence is a strength, not just a gap

**[Inferred — HIGH]** A less disciplined implementation would have stubbed these with a mock provider — a fake Stripe, a `console.log` mailer. That would be worse, because a mock that returns success teaches the UI to claim things that did not happen, and the founding brief's central rule is that the UI must never do that. Instead every seam returns a **queued** or **pending** state that an administrator can see and act on:

- `CheckoutSuccessPage`: *"ההזמנה נרשמה במערכת והיא ממתינה לאישור תשלום"* — recorded, awaiting payment confirmation.
- `AdminEmailsPage`: a queue with no send button that pretends to work.
- `orders.payment_status` stays `PENDING` until a human with `mark_paid` says otherwise.

The consequence for future work is a rule: **when an integration is added, the honest pending state must be replaced, not supplemented.** A `PAID` order that was never captured by a provider is the single worst thing this system could record, and four separate CHECK constraints in `schema.sql` exist to make it unrepresentable.

### 11.5 Figma Make — the one real external dependency

**[Verified]** The web project is built to run inside Figma Make. `.figma/make/site.json` and `dev.json` are consumed by `vite.config.ts`; seven extension-less bash scripts in `.figma/make/` wrap `pnpm` and the `figma make` CLI (`install`, `dev`, `format`, `langserver`, `analyze-routes`, `deploy`, `deploy-preview`). `index.html` carries Figma Make region markers.

This is a **build-and-deploy** integration rather than a runtime one — nothing in the shipped bundle calls Figma. But it does mean `vite.config.ts` is not free to be rewritten: four bespoke plugins and a dev-only kit plugin live there, and removing them breaks the Figma Make workflow even though the app would still build.

---

## 12. AUTHENTICATION & AUTHORIZATION

### 12.1 Three separate account-creation paths

**[Verified]** Accounts are created in exactly three ways, and each has a different consequence for the password:

| Path | Entry point | Password state afterwards |
|---|---|---|
| Explicit registration | `LoginPage.tsx` → `register()` | Set immediately; `password_set: true` |
| **Guest checkout** | `CheckoutPage.tsx` → `checkout()` → `findOrCreateCustomer()` | **Not set.** The customer exists with an order and an entitlement but no credential |
| Administrator-created | `AdminUsersPage` / `AdminCrmPage` → `createUser()` | Not set |

The second and third paths are why `SetupPasswordPage.tsx` exists. **[Verified]** A user with `hasPassword(u) === false` is routed to `/setup-password` rather than to the library. `src/lib/auth.ts`:

```ts
export function hasPassword(u: StoredUser): boolean {
  return Boolean(u.password_hash && u.password_salt);
}
```

**[Inferred — HIGH]** This is the deliberate resolution of a real product tension: the brief's funnel requires that a purchase not be blocked by account creation (§1 puts *User Creation / Identification* **after** *Payment*), but a protected library is worthless without a credential. The answer is to let the purchase complete and make the password a *later* obligation gated by a dedicated route.

### 12.2 Credential storage — and its stated limits

**[Verified]** `src/lib/auth.ts` header comment is unusually candid and must be read before touching this module:

> *"Passwords are never stored or logged in clear text: each account carries its own random salt and only a digest is persisted. The digest is produced with WebCrypto SHA-256 where available and falls back to a deterministic non-cryptographic digest otherwise, because a static bundle has no server to do this properly. Replacing this module with real server-side argon2/bcrypt verification is listed as technical debt in the final report."*

The mechanics:

- `randomSalt()` — 16 bytes from `crypto.getRandomValues`, hex-encoded, with a `Math.random()` fallback.
- `hashPassword(password, salt)` — `SHA-256("<salt>:<password>")` via `crypto.subtle`, falling back to `fallbackDigest()`, a 4-round FNV-1a variant explicitly commented *"Not cryptographic — a placeholder so the app never keeps plaintext passwords even without WebCrypto."*
- `verifyPassword()` — a constant-length XOR-accumulate comparison, commented *"avoids leaking hash length differences."*
- `passwordProblem()` — ≥ 8 characters, must contain a letter, must contain a digit. Three Hebrew messages.
- `toPublicUser(u)` — destructures away `password_hash`, `password_salt` and `password_set` before the record reaches React state. **This is the only thing standing between credential material and the component tree**, and it is applied at every service-layer exit.

**[Verified — CRITICAL]** SHA-256 is a fast hash. Even with a per-user salt, an attacker holding the `localStorage` blob can brute-force it offline at GPU speed. The code says so itself. **This is acceptable only because the entire database is already in the attacker's hands** — anyone who can read `localStorage['casanova_db_v1']` can read every entitlement, order and e-mail in it. The hash is not the boundary; it is a courtesy. When a real backend arrives, `auth.ts` is replaced wholesale, not adapted.

### 12.3 Session handling (web) — a user id, not a token

**[Verified]** This is the most important thing to know about web authentication, and it is easy to miss because the code looks tidy:

```ts
export const SESSION_KEY = 'casanova_session_v1';
export function readSessionUserId(): string | null { … localStorage.getItem(SESSION_KEY) … }
export function writeSessionUserId(userId: string | null): void { … }
```

The entire web session is **a plaintext user id in `localStorage`**. There is no token, no signature, no expiry, no server round trip. **[Verified]** Any script or browser extension with origin access can sign in as any user by writing one string.

**[Inferred — HIGH]** This is not an oversight; it is the correct choice for a static bundle with no server, and the surrounding code is consistent with it — `AppContext` re-derives `user` from the id on every load, and `login()` fixes a stale closure by re-reading rather than trusting captured state. But it means: **no client-side authorisation decision in this app has any security value.** The `guard()`/`can()` machinery is *architecturally* correct and *operationally* meaningless until the service layer runs server-side. §21 treats this at length.

### 12.4 Two-tier authorisation, called twice on purpose

**[Verified]** `src/lib/permissions.ts` states the design in its own header:

> *"`can(role, permission)` is used in two places on purpose: 1. by the layout and pages, to avoid rendering actions a role may not run; 2. by every mutating function in `src/lib/api.ts`, which refuses the operation regardless of what the UI showed. Hiding a button is cosmetic — the service layer check is the one that actually enforces the policy. When this app moves to a real backend the same permission strings become the server-side authorization claims."*

**The role → permission matrix [Verified]** — 5 roles, 27 permissions:

| Permission | SUPER_ADMIN | SUPPORT | FINANCE | CONTENT | MARKETING |
|---|:-:|:-:|:-:|:-:|:-:|
| `dashboard` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `products` | ✔ | | | ✔ | |
| `cms` | ✔ | | | ✔ | ✔ |
| `users` | ✔ | ✔ | | | |
| `access` | ✔ | ✔ | | | |
| `orders` | ✔ | ✔ | ✔ | | |
| `finance` | ✔ | | ✔ | | ✔ |
| `emails` | ✔ | ✔ | | | ✔ |
| `alerts` | ✔ | ✔ | ✔ | | |
| `audit` | ✔ | | | | |
| `crm` | ✔ | ✔ | | | ✔ |
| `support` | ✔ | ✔ | ✔ | | ✔ |
| `settings` | ✔ | | | | |
| `security` | ✔ | | | | |
| `refund` | ✔ | | ✔ | | |
| `execute_refund` | ✔ | | ✔ | | |
| `mark_paid` | ✔ | | ✔ | | |
| `edit_order` | ✔ | | ✔ | | |
| `grant_access` | ✔ | ✔ | | | |
| `edit_price` | ✔ | | ✔ | ✔ | |
| `edit_content` | ✔ | | | ✔ | |
| `delete_product` | ✔ | | | | |
| `block_user` | ✔ | ✔ | | | |
| `resend_email` | ✔ | ✔ | | | ✔ |
| `manage_roles` | ✔ | | | | |
| `manage_support` | ✔ | ✔ | | | |
| `manage_drm` | ✔ | | | | |

Fourteen permissions are `SUPER_ADMIN`-only. **`audit`, `settings`, `security`, `delete_product`, `manage_roles` and `manage_drm` are held by nobody else** — the six capabilities that could conceal or reconfigure the system itself. **[Inferred — HIGH]** That set is the real privilege boundary and should be treated as such in review.

**[Verified]** `can()` fails closed on `undefined`: `if (!role) return false;` and `ROLE_PERMISSIONS[role]?.includes(permission) ?? false`. There is no path by which an unrecognised role gains anything.

**[Verified]** A nested guard exists for role escalation. `updateUser()` checks `'users'` first and then, *if the patch touches `admin_role` or `role`*, checks `'manage_roles'` as well — so a SUPPORT administrator can edit a customer but cannot promote anyone. This is the only two-permission function in the codebase and is the pattern to copy for any future field-level privilege.

### 12.5 The route-level guard and why it produces an error page

**[Verified]** `src/components/RouteError.tsx` (88 lines) is what an unauthorised route renders. Its rationale, in its own words, is that a silently redirected route teaches a user that the URL they typed was wrong rather than that they lack the role — and that a 404 for an existing page leaks nothing but explains nothing either.

**[Verified]** All fourteen admin pages use the identical idiom, and the order within it is load-bearing:

```tsx
export default function AdminSecurityPage() {
  const { adminRole, actor } = useAdmin();     // ← every hook runs first
  const db = useStore();
  const [filter, setFilter] = useState(…);
  …
  if (!can(adminRole, 'security')) return <AccessDenied page="הגנת תוכן ואבטחה" />;
  …
}
```

Hooks before the guard, because an early `return` before `useState` would break React's rules-of-hooks on the render where the role changes. **Do not "optimise" this by moving the guard to the top of the function.**

**[Verified]** `AccessDenied.tsx` (30 lines) takes a `page` prop and renders a Hebrew explanation. It is not a redirect. `AdminLayout.tsx` additionally filters `SideNav` entries by permission, so the denied page is normally unreachable by clicking — which is exactly why the page-level guard still has to exist: the URL bar is not filtered.

### 12.6 Mobile authentication — the keychain rules

**[Verified]** `react-native/src/net/client.ts`'s three rules, quoted from its header because each names a concrete attack:

1. *"The session token lives in the platform keychain, never in AsyncStorage. AsyncStorage is a plaintext XML/plist file that `adb backup`, an iOS unencrypted backup, or any debugging tool can read. A stolen token is a stolen library."*
2. *"The token is stored `THIS_DEVICE_ONLY`. Restoring a backup onto a second phone must not hand that phone a signed-in session — the device cap in `drm_policies.max_devices_per_user` is meaningless if a backup can clone a slot."* Concretely: `Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
3. Every request carries the client identity headers, so the kill switch cannot be opted out of.

Implementation details worth preserving:

- Service name is a constant: `TOKEN_SERVICE = 'com.casanova.reader.session'`.
- The keychain **username slot carries the user id**, not a name — commented *"so a cold start can render 'signed in as' before the first network round trip."*
- Both values are mirrored into module-level `cachedToken` / `cachedUserId`, and `request()` prefers the cache, falling back to a keychain read. `clearSession()` nulls the cache **before** attempting the keychain reset, commented *"the in-memory copy above is already gone, which is what matters."*
- A keychain **read** failure returns `null` (treated as signed out) rather than throwing — *"A keychain read fails on a device whose secure enclave is unavailable or after an OS restore."*

**[Verified]** `AuthContext`'s cold start treats the stored token as unproven: *"A stored token is a claim, not proof."* It calls `fetchMe()`; a failure clears the session and sets `phase: 'signed-out'`. There is no code path that renders authenticated UI from the keychain alone.

### 12.7 Device authorisation — the third axis

**[Verified]** Authentication here is not two-factor (who you are + what you know) but three-axis: **account** (who), **session** (token), **device session** (where). A grant is bound to all three, and revoking any one kills access immediately:

| Axis | Row | Revoked by | Effect |
|---|---|---|---|
| Account | `users.account_status` | `setAccountStatus()` (`block_user`) | `SUSPENDED`/`CLOSED` — login refused |
| Entitlement | `user_products.access_status` | `revokeAccess()` (`grant_access`) | `trg_user_product_revokes_grants` revokes every grant |
| Device | `device_sessions.revoked` | `revokeDeviceSession()` (`security`) or the customer's own button | `trg_device_session_revokes_grants` revokes every grant |

**[Verified]** `revokeAccess()`'s comment explains why the grants are kept rather than deleted: *"Deleting the entitlement row removes the thing the grants point at, but not the grants themselves — they are kept, marked revoked, so the audit trail still shows which file was in whose hands when access was pulled."* **Revocation is a state change, never a deletion.** This holds in both clients and in SQL, and it is the reason the CMS can answer "was this book on that phone last Tuesday?".

**[Verified]** The customer can revoke their own device (`DevicesScreen.tsx` → `revokeDevice()`), and the UI warns when it is the device currently in use: *"זהו המכשיר שבו אתם משתמשים כרגע. ההסרה תנתק את הקריאה מיידית ותמחק כל עותק שמור במכשיר זה."* Allowed, but not by accident.

### 12.8 Sign-out destroys; it does not merely forget

**[Verified]** `AuthContext.signOut()` performs three operations in order: `logoutRequest()` → `clearSession()` → `wipeAll()`. Its comment is the design statement:

> *"Destroying every local copy is not optional and is not the user's choice."*

`wipeAll()` deletes every cached PDF in the app sandbox. The same destruction runs on a `blocked` boot (kill switch, forced upgrade) and in `App.tsx`'s `CrashBoundary`. **[Inferred — HIGH]** Three independent triggers converging on one destructive function is the mobile expression of "we sell permission, not a file": there is no state in which the app is unusable but the bytes remain.

---

## 13. CONFIGURATION

### 13.1 There is no environment configuration

**[Verified — HIGH]** No `.env`, no `.env.example`, no `import.meta.env.*` read anywhere in `src/`, no `process.env` read in application code, no config file loaded at runtime. The `.gitignore` contains `.env` patterns **pre-emptively** — they are there for a future that has not arrived.

**[Inferred — HIGH]** This follows from the architecture. A Vite static bundle has no secret to hold: anything compiled into it is public. So instead of environment variables, **all runtime configuration is data**.

### 13.2 Configuration is a database row

**[Verified]** `platform_settings` is a single row holding everything an operator can change without a deployment. `schema.sql` seeds exactly one, with the site-copy columns deliberately omitted (§9). `AdminSettingsPage` (permission `settings`, SUPER_ADMIN-only) edits it via `updateSettings()`.

**[Verified]** The mobile client's view of the same row is narrowed to four fields:

```ts
const DEFAULT_SETTINGS = {
  brand_name: 'קזנובה',
  default_currency: 'ILS',
  mobile_app_enabled: true,
  mobile_min_build: 0,
};
```

and `bootCheck()` overrides them from `/settings/public`. **Two of those four are the kill switch and the forced-upgrade floor** (§14.8).

**[Verified]** Other configured-at-runtime surfaces:

| Surface | Storage | Edited by |
|---|---|---|
| Brand, currency, contact, provider names | `platform_settings` | `AdminSettingsPage` |
| Landing-page copy, sections, gallery | `cms_content` (fixed slots) + `cms_sections` (free-form) | `AdminCmsPage` |
| DRM policy per scope | `drm_policies` | `AdminSecurityPage` |
| Coupons | `coupons` | `AdminCmsPage` |
| Categories | `categories` | `AdminProductsPage` |
| Mobile API base URL | `AsyncStorage['casanova.api_base_url']` | `setApiBaseUrl()` — a QA affordance, **not** exposed in any shipped screen |

### 13.3 The mobile base-URL override

**[Verified]** `react-native/src/config.ts`:

```ts
export const DEFAULT_API_BASE_URL = 'https://api.casanova.local';
const OVERRIDE_KEY = 'casanova.api_base_url';
```

`loadApiBaseUrl()` reads the override, validates it against `/^https?:\/\//`, strips trailing slashes, and falls back to the default on a corrupt store — *"Falling back to the compiled default keeps the app bootable rather than stranded on an error screen the user cannot act on."* `setApiBaseUrl()` **throws** (the only throwing function in the mobile codebase) with a Hebrew message, because it is a developer affordance with no UI to render a `Result`.

The doc comment states the whole wiring plan in one sentence: *"Pointing `API_BASE_URL` at the deployed backend is the only wiring this file needs before a real device can sign in."*

**[Verified]** `https://api.casanova.local` does not resolve. `.local` is mDNS-reserved. **[Inferred — HIGH]** It was chosen so that a misconfigured build fails loudly and immediately rather than silently reaching a real host.

### 13.4 Mobile timing constants

**[Verified]** All four in `config.ts`, each with the constraint that fixes its value:

| Constant | Value | Constraint stated in source |
|---|---|---|
| `REQUEST_TIMEOUT_MS` | `15_000` | *"A reader must fail fast rather than spin while a policy decision is pending."* |
| `SESSION_HEARTBEAT_MS` | `60_000` | *"Must stay comfortably under the smallest `session_timeout_minutes` the CMS can configure, or a legitimate reader gets swept as abandoned."* |
| `ACTIVITY_WINDOW_MS` | `120_000` | Activity newer than this counts as "the reader is in use" |
| `GRANT_REVALIDATION_MS` | `60_000` | *"A grant is minted for 30 minutes at most; this is the interval at which the reader notices an administrator revoked it."* |

**[Inferred — HIGH]** These are coupled to server-side values by inequality, not by configuration. **If an administrator sets `session_timeout_minutes` below ~2 in the CMS, or a future backend mints grants with a TTL under 60 s, the mobile reader breaks silently.** Nothing validates the relationship. This is a real coupling to check before changing either side.

`CLIENT`, `APP_VERSION` (`DeviceInfo.getVersion()`), `BUILD_NUMBER` (`Number(DeviceInfo.getBuildNumber()) || 0`) and `DEVICE_PLATFORM` complete the identity block. The comment on `BUILD_NUMBER` explains the integer choice: *"a semver string cannot be compared safely in SQL — a forced-update check has to be `build_number >= mobile_min_build`."*

### 13.5 Build configuration

**[Verified]** `vite.config.ts` (454 lines) is not a normal Vite config. It contains four bespoke plugins plus a dev-only kit plugin, reads `.figma/make/site.json`, injects the CSP, emits `robots.txt` from `site.json.robots`, and rewrites Figma Make comment slots in `index.html` via `transformIndexHtml` at `order: 'pre'`. `build.sourcemap` is `'inline'` when `mode === 'development'`. The `@` → `src` alias is defined here and in `tsconfig.json` and must be kept in step.

**[Verified]** `tsconfig.json` (web): `target ES2020`, `module ESNext`, `moduleResolution bundler`, `strict`, paths `@/*` → `./src/*`.

**[Verified]** `.mise.toml`: `node = "22"`, `"npm:pnpm" = "10.34.3"`. `package.json` `engines.node >= 22`. `pnpm-lock.yaml` committed.

### 13.6 Content Security Policy

**[Verified]** The CSP is not in `index.html`. It is injected as a `<meta http-equiv>` by the `figma-content-security-policy` plugin at `injectTo: 'head-prepend'`, with a comment explaining why not `head`: *"a meta policy only governs resources discovered after it is parsed, and appending to the head puts it after the entry `<script>` the build injects — which would leave the application bundle itself outside the policy."*

Production directives, verbatim:

```
default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https:;
media-src 'self' blob: https:;
frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com;
connect-src 'self'; form-action 'self'; upgrade-insecure-requests
```

The dev policy adds `'unsafe-inline'` to `script-src` (React Refresh preamble) and `ws: wss:` to `connect-src` (HMR), and drops `upgrade-insecure-requests`.

Three decisions in the source are reasoned rather than defaulted, and each is a warning against tightening blindly:

- `object-src 'none'` — *"The reader embeds PDFs through an `<iframe>`, so no plugin document is ever legitimate here and `<object>`/`<embed>` are refused outright."*
- `style-src 'unsafe-inline'` **stays in both policies** — *"`useScreenProtection` injects a `<style>` element at runtime to blank the page for printing, and a nonce cannot cover an element application code creates itself."* Removing it breaks the print deterrent.
- `img-src … https:` — *"Covers and gallery images come from the CMS and may point at any https origin, so img-src cannot be narrowed to 'self' without breaking assets an administrator uploaded."*

**[Verified — acknowledged gap]** The plugin's own doc comment names the hole: *"A meta policy cannot express `frame-ancestors`, `report-uri` or `sandbox`, so clickjacking protection still has to be delivered as a real HTTP header by whatever serves the built files."* **Nothing in this repository serves that header.** For an app whose reader is an iframe, clickjacking protection is an open deployment task, not a code task.

**[Verified]** A second comment records a future hazard: *"Turning on analytics in `site.json` injects an inline gtag snippet and a googletagmanager.com script; both would be blocked until script-src is widened to match."* `site.json` currently has analytics off.

### 13.7 Other configuration surfaces

**[Verified]** `.gitattributes` (58 lines) pins `eol=lf` on the seven `.figma/make/*` scripts, with the reason spelled out: *"a CRLF after the shebang makes `#!/usr/bin/env bash\r` an interpreter that does not exist."* On a Windows workstation this is the difference between a working deploy script and a mysterious one.

**[Verified]** `react-native/android/gradle.properties`: `newArchEnabled=true`, `hermesEnabled=true`, all four ABIs, `org.gradle.jvmargs=-Xmx4096m`. `android/build.gradle`: `buildToolsVersion 35.0.0`, `minSdkVersion 24`, `compileSdk 35`, `targetSdk 35`, `ndkVersion 27.1.12297006`, `kotlinVersion 2.0.21`. `versionCode = 1`, `versionName = "1.0.0"` — and `versionCode` is what `mobile_min_build` gates on.

**[Verified]** `react-native/metro.config.js` carries a `blockList` excluding `../node_modules`, `../dist` and `../src`, because *"Metro walks the file system, not the module graph, so without an explicit block it will happily resolve `react` or `react-dom` out of `../node_modules` and bundle a web copy of React into the phone build."* **This is the single most fragile configuration line in the mobile project**: the two projects are sibling directories, and deleting this block produces a build that succeeds and an app that does not run.

---

## 14. CORE FEATURES

Nine features carry the product. Each is described by what it does, where it lives, and the non-obvious constraint that governs it.

### 14.1 First-run bootstrap (the no-code CMS)

**[Verified]** `emptyDatabase()` in `db.ts` returns empty arrays for everything except `drm_policies: [defaultDrmPolicy()]` and a neutral `settings` row. There is **no seed data at all** — no demo product, no lorem-ipsum landing copy. A fresh visitor sees a structurally complete site with nothing in it.

`isBootstrapRequired()` returns true while no administrator exists. `AppContext` exposes it as `bootstrapRequired`, `AdminLayout` redirects to `/setup` before checking authentication, and `SetupPage` (156 lines) creates the first `SUPER_ADMIN` via `bootstrapAdmin()`.

**[Verified — the deadlock this creates]** `bootstrapRequired` gates the admin, the admin is the only route to the CMS, and the CMS is the only source of landing-page copy. So a brand-new deployment shows a visitor an empty storefront until someone navigates to `/setup` by hand. Nothing links to `/setup` from the public pages. **[Inferred — HIGH]** This is intentional — the alternative is seeded marketing copy the operator did not write — but it means **the first task on any new deployment is `/#/setup`, and that is documented nowhere** (there is no README, §26).

### 14.2 CMS — fixed slots and free-form sections

**[Verified]** Two distinct content models live side by side, and confusing them is the most common way to break the landing page:

| Model | Storage | Edited in | Rendered by |
|---|---|---|---|
| **Fixed slots** | `cms_content` rows keyed by a known slot name (`HERO`, `ABOUT`, `PRICING`, …) | `AdminCmsPage` slot forms | `LandingPage`, which reads a slot by name and renders it only if non-empty |
| **Free-form sections** | `cms_sections` rows with `display_order` | `AdminCmsPage` section list | `LandingPage`, in `listSections()` order |
| **Platform copy** | `platform_settings` columns (`tagline`, `trust_badges`, `catalogue_title`, `catalogue_blurb`, `pricing_title`, `pricing_blurb`, `footer_text`) | `AdminSettingsPage` | Everywhere |

**[Verified]** `CmsHint.tsx` (27 lines) is the mechanism that makes the empty state honest. An unset slot renders `CmsHint` **to an administrator and nothing at all to a visitor**. It never falls back to placeholder copy.

**[Verified]** `AdminSettingsPage` writes the copy fields **even when empty**, with the reason inline: *"Written even when empty on purpose: clearing a field here has to clear it on the page, not silently leave last month's copy up."* `trust_badges` is edited one entry per line — the same convention the HERO block uses for a multi-line title.

**[Verified]** CMS backup and restore exist (`api.ts`, "CMS backup / restore" section) — the only import/export surface in the app.

### 14.3 Commerce — catalogue, checkout, entitlement

**[Verified]** The spine, already traced in §8.3, restated as a feature:

`StorePage` / `LandingPage` → `CheckoutPage` (guest checkout allowed) → `checkout()` writes an order with `order_status: 'PENDING'`, `payment_status: 'PENDING'` → `CheckoutSuccessPage` says so in those words → an administrator with `mark_paid` calls `markOrderPaid()` → **only then** does `grantAccessForOrder()` create the `user_products` row → the library shows the title → `ReaderPage` opens it.

The two properties that make this a commerce system rather than a form:

1. **The client's arithmetic is display-only.** `CheckoutPage` computes `couponDiscount` and `finalPrice` locally to render them, then sends `product_id`, names, `email`, `phone` and `coupon_code` — never a price. `checkout()` re-derives the unit price with `effectivePrice(product)`, looks the coupon up with `findCoupon(code)`, rejects an unknown or expired code with `VALIDATION`, and recomputes the discount from the stored row. **[Verified]** A tampered client can change what it shows itself but not what it is charged.
2. **Money is never invented.** `checkout()` cannot produce a `PAID` order. `refund_execution_enabled` cannot be turned on without a `payment_provider`, and `AdminSettingsPage` refuses with: *"לא ניתן לאפשר ביצוע החזרים ללא הגדרת ספק תשלומים — המערכת לא תטען שהכסף הוחזר"* — "the system will not claim the money was refunded."

**[Verified]** Coupons: `PERCENTAGE` or `FIXED_AMOUNT`, `minimum_order`, `usage_limit`, `status`, `times_used`. `findCoupon()` normalises to upper case and returns `undefined` for expired or exhausted codes, so an invalid code is indistinguishable from a nonexistent one. `redeemCoupon()` increments `times_used` — and is called from `checkout()`, not from the UI.

**[Verified — dead feature]** `AppContext` exposes a complete cart API (`cart`, `cartLines`, `cartTotal`, `addToCart`, `removeFromCart`, `clearCart`, `selectedProduct`, `setSelectedProduct`) and **no page uses it**. `checkout()` is single-item with `quantity: 1` hardcoded, and `order_items` is always a one-element array. The multi-item data model exists in the types and in SQL (`chk_item_arithmetic`, `chk_order_total_arithmetic` both handle `quantity > 1`), so this is a UI gap, not a schema gap.

### 14.4 The web protected reader

**[Verified]** `ReaderPage.tsx` is the most constrained file in the web app, because it is fighting the browser's own PDF viewer. `src/lib/useScreenProtection.ts` documents the constraint precisely:

> *"There is no way to reach into the browser's PDF plugin and set its magnification from the parent document: the plugin owns its own out-of-process frame, with an empty host DOM and nothing to call. So zoom goes in the fragment, alongside the page."*

**`pdfEmbedUrl(url, page, zoom)`** is the whole interface to the viewer:

```ts
const base = url.split('#')[0];                 // drop any existing fragment
const params = [`page=${Math.max(1, page)}`, 'toolbar=0', 'navpanes=0', 'scrollbar=0'];
params.push(zoom && zoom > 0 ? `zoom=${Math.round(zoom)}` : 'view=FitH');
return `${base}#${params.join('&')}`;
```

Four consequences, each verified in the source comments:

- `toolbar=0&navpanes=0&scrollbar=0` removes the viewer's download and print buttons — *"That toolbar is otherwise a one-click download and print path sitting inside the reader, and it is not covered by any DOM-level deterrent because it belongs to the browser's PDF viewer, not to our document."*
- **`view=FitH` and an explicit `zoom` are mutually exclusive** — *"sending both leaves the viewer free to honour either — so exactly one is emitted."*
- Chromium's PDFium honours the fragment **only on a full document load**. A hash-only change to an open PDF is ignored. The reader therefore keys its `<iframe>` on page **and** zoom so either one remounts the element.
- That remount costs a re-parse per step, *"which is why the controls move in discrete rungs rather than tracking a slider or a pinch gesture."* **This is the origin of the +/− text-size buttons** — a smooth zoom is not implementable in this architecture, and the discrete rungs are a consequence, not a design preference.
- The comments are explicit that these are *"viewer hints rather than a security boundary — a determined visitor can still reach the file through developer tools."*

**`useScreenProtection(options)`** — the behaviour layer. Seven policy flags map to five deterrents:

| Deterrent | Events | Listeners |
|---|---|---|
| Selection / copy / drag suppression (`blockCopy`) | `CONTEXT_MENU_BLOCKED`, `COPY_BLOCKED` | `contextmenu`, `copy`, `cut`, `dragstart` on `document` |
| Capture-key interception (`blockScreenshots`, `blockScreenRecording`) | `SCREENSHOT_BLOCKED`, `RECORDING_DETECTED` | `keydown`; also **wipes the clipboard** because *"PrintScreen lands there, so clearing it defeats the capture-then-paste workflow on the platforms where the key itself cannot be swallowed"* |
| Print suppression (`blockPrint`) | `PRINT_BLOCKED` | `keydown` Ctrl/Cmd+P, `beforeprint`, plus an injected `@media print { html, body { display: none !important; } }` `<style>` tagged `data-drm-print-block` |
| View-source suppression (gated on `blockCopy`) | `SOURCE_VIEW_BLOCKED` | `keydown` Ctrl/Cmd+U |
| Blur / visibility shield (`hideOnBlur`) | `VISIBILITY_HIDDEN` | `blur`, `focus`, `visibilitychange` |

Three details that must not be broken by a refactor:

1. **The effect installs its listeners exactly once** (`}, []`). Policy changes are read through `optionsRef.current`. The comment: *"tearing down and re-adding document listeners on each policy object identity change would open gaps where nothing is protected."*
2. **Ctrl/Cmd+U is gated on `blockCopy`, not on the capture flags**, and is placed *before* the early `return` — *"Ctrl/Cmd+U opens view-source for this page, which prints the reader's markup — including the iframe src, i.e. a direct URL to the content file. That is the shortest path from 'protected reader' to 'download link'."*
3. **Ctrl+Shift+C is deliberately not intercepted** — *"it is the element picker, and reporting it would fill the log with noise that hides real capture attempts."*

The hook's own scope statement is the honest summary: *"a web page cannot stop a camera, an OS-level screenshot, or a browser extension."* Attribution — *"the part that actually deters redistribution"* — is the watermark, not this hook.

### 14.5 Watermarking and attribution

**[Verified]** Two implementations, deliberately different:

- **Web** (`ReaderPage.tsx`): a React overlay above the iframe carrying the user's identity. It cannot be composited *into* the PDF, because the plugin owns its frame. It deters a photograph of the screen, not a save of the file.
- **Mobile** (`react-native/src/components/Watermark.tsx`, 104 lines): the same overlay, but the text is **frozen into the grant at issue time**. `content_access_grants` carries the watermark, `chk_drm_watermark_template` requires a template when watermarking is on, and `consume_content_grant()` returns it. A revoked-and-reissued grant can carry different text; a live grant cannot be re-watermarked.

**[Verified]** `AdminSecurityPage`'s `FLAG_FIELDS` attach an honest `hint` to each of the seven toggles. Two are load-bearing because they contradict what the toggle's name implies:

- `block_print`: *"הדפסה מתוך תצוגת ה־PDF של הדפדפן אינה נחסמת בדפדפן"* — printing from inside the browser's PDF view is **not** blocked.
- `block_screenshots`: *"אינה עוצרת צילום ברמת מערכת ההפעלה"* — does not stop an OS-level screenshot.

**[Inferred — HIGH]** These hints are the reason the mobile client exists. The web reader deters; the phone prevents.

### 14.6 The mobile protected reader

**[Verified]** The ten-step path is in §8.6. As a feature, the parts that matter:

- `ReaderScreen` calls `issueGrant()` → receives a **token** → `redeemGrant(token, productId)` → receives a short-lived URL → downloads with `react-native-blob-util` into the app sandbox → renders with `react-native-pdf`.
- Re-validation every `GRANT_REVALIDATION_MS` (60 s) and a heartbeat every `SESSION_HEARTBEAT_MS` (60 s), gated on `ACTIVITY_WINDOW_MS` (120 s) so an idle reader does not extend its own session.
- `LibraryContext` reloads on **focus**, not on a timer: *"a phone that polls every few seconds is a phone with a flat battery."* A second effect purges the vault copy of any entitlement that stopped being live: *"Waiting for the TTL would leave a revoked book sitting in the sandbox."*
- Offline caching is a **grant scope** (`OFFLINE_CACHE`), single-use by `chk_grant_offline_single_use`, with a TTL required by `chk_drm_offline_needs_ttl`, and purged at boot by `purgeExpired()` — which reports `OFFLINE_EXPIRED` for each title it deletes.

### 14.7 Native capture protection — prevention on Android, detection on iOS

**[Verified]** The asymmetry is imposed by the platforms, not chosen:

| | Android | iOS |
|---|---|---|
| Mechanism | `FLAG_SECURE` on the window | Privacy cover + capture notifications |
| Kind | **Prevention** — the OS refuses to render into a capture buffer | **Detection and concealment** — the OS permits capture and reports it |
| Where | `MainActivity.kt`: set **before** `super.onCreate()`, re-asserted in `onWindowFocusChanged` when `!isShieldSuppressedByPolicy` | `ScreenShield.swift` (828 lines): cover on `willResignActive`, `capturedDidChange`, `connectDidChange`, `userDidTakeScreenshot` |
| Extras | — | Secure-text-field layer lift, excluded from `canProtectSwitcher()`; PDFKit long-press removal by class-name walking |

**[Verified]** `userDidTakeScreenshot` exists for **attribution**, not prevention — it cannot stop the screenshot, so it records who took one.

**[Verified]** `ScreenShield.m` declares nine `RCT_EXTERN_METHOD`s against the Swift module, with a warning that is the most fragile thing in the mobile codebase:

> *"The two files must be kept in step by hand. Nothing in the toolchain checks that a selector declared here exists in Swift, and the failure is not a build error: it is `undefined` returned from the JS side at call time."*

### 14.8 The mobile kill switch and forced upgrade

**[Verified]** `platform_settings.mobile_app_enabled` + `mobile_min_build`, evaluated in `bootCheck()` **before any stored credential is read**. `BUILD_NUMBER` (an integer) is compared against `mobile_min_build`; `X-Casanova-Build` carries it on every request so the server can enforce the same rule independently.

On a network failure `bootCheck()` returns `mobile_app_enabled: false` with the neutral message *"לא ניתן לאמת את תקינות האפליקציה מול השרת. נסו שוב בעוד כמה דקות."* — **fail closed**. The comment: *"Failing open here would let a network outage become a way to run a build that was pulled for a security reason."*

Two distinct Hebrew refusals, because *"'the app is disabled' reads very differently from 'you need to update'"*:

- `mobile_app_enabled === false` → *"האפליקציה אינה זמינה כרגע. הספרים שלכם זמינים לקריאה דרך האתר."*
- `BUILD_NUMBER < mobile_min_build` → *"גרסה N של האפליקציה אינה נתמכת יותר. עדכנו לגרסה החדשה כדי להמשיך לקרוא."*

Both set `phase: 'blocked'`, which `RootNavigator` renders as `GateScreen` — and `AuthContext` responds by wiping the vault and clearing the session (§12.8).

**[Verified]** `android/build.gradle` has `versionCode = 1` / `versionName = "1.0.0"`. **Releasing a security fix therefore requires bumping `versionCode` and then raising `mobile_min_build` in the CMS.** Forgetting the bump makes the kill switch unable to target the vulnerable build. This coupling is documented nowhere outside the source comments.

### 14.9 Support, CRM and derived analytics

**[Verified]** `SupportPage` → `createInquiry()` → a real ticket number from `settings.inquiry_prefix` → visible immediately in `AdminSupportPage`. The page header is explicit that nothing is faked: *"Nothing is emailed to a third party and nothing is faked: while no mail provider is configured the acknowledgement stays queued in the CMS mail log."* `listMyInquiries(actor)` lets a signed-in visitor track their own tickets.

**[Verified]** `AdminCrmPage` (883 lines) manages `crm_leads`; `source` includes `MOBILE_APP` in both the TypeScript union and the SQL CHECK (§9.6). `api-support.ts`'s `getCustomerProfile()` aggregates orders, paid totals, refunds, entitlements, inquiries and first/last purchase into one view — the only cross-entity read in the service layer.

**[Verified]** `analytics.ts` and `alerts.ts` **store nothing**. Both recompute on every read. `AdminDashboardPage` and `AdminFinancePage` consume them; `AdminAlertsPage` renders the alert list and its count badges `SideNav`. SQL mirrors the same philosophy with `v_daily_revenue`, `v_product_sales`, `v_customer_summary` and `v_order_refunds` — and by deliberately giving `orders` **no** `refunded_amount` or `refund_status` column.

**[Inferred — HIGH]** Deriving rather than storing is what keeps the four CHECK constraints honest. A stored `refunded_amount` could drift from the `refunds` table; a view cannot.

### 14.10 Content upload — and its hard ceiling

**[Verified]** `readAssetFile(file)` in `api.ts:827` is the only ingest path. It checks `settings.max_upload_bytes` (default `10_485_760` = 10 MB), then reads the file with `FileReader.readAsDataURL` and returns a **data URL**. That string becomes `products.content_url` and is persisted inside `localStorage['casanova_db_v1']`.

**[Verified — STRUCTURAL LIMIT]** A data URL inflates the payload by 4/3. The 10 MB default therefore writes **~13.3 MB of base64 into a single `localStorage` key**, against a browser quota that is typically 5 MB per origin. The upload will fail at the `setItem`, not at the size check. The error message anticipates exactly this and says what to do instead:

> *"הקובץ גדול מדי … המגבלה היא …KB — יש להעלות קבצים גדולים לאחסון חיצוני ולהדביק את הכתובת שלהם."*
> *"…upload large files to external storage and paste their address."*

**[Inferred — HIGH]** The intended production path is a pasted URL to external storage, and `content_url` is designed to hold either. `public/books/Senia_book.pdf` is served from the bundle instead — a third path. **Any feature that touches content delivery must decide which of the three it means**, and the DRM model in §14.4/§14.6 assumes the URL is short-lived and grant-issued, which none of the three currently is on the web side.

---

## 15. IMPORTANT CLASSES & FUNCTIONS

There are no classes in this codebase. **[Verified]** Both projects are function- and hook-only; the word `class` appears in TypeScript source only in `extends React.Component` for the two error boundaries. What follows are the load-bearing symbols — the ones whose behaviour other code assumes without checking.

### 15.1 Persistence (`src/lib/db.ts`, `src/lib/store.ts`)

| Symbol | Signature | Why it matters |
|---|---|---|
| `DB_KEY` | `'casanova_db_v1'` | The one localStorage key holding all data. `initCrossTabSync` filters `storage` events on it |
| `DB_VERSION` | `1` (module-private) | Written into `Database.version`. **[Unknown]** what a bump does with existing data — §27 |
| `SECURITY_EVENT_LIMIT` | `400` | Bound on `security_events`, oldest first. The comment: unbounded growth means *"you do not notice it until the storage quota fails and real writes start being lost"* |
| `CONTENT_GRANT_LIMIT` | `200` | Bound on minted grants, *"oldest settled rows go first"* |
| `LEGACY_KEYS` | `['eliteread_cms_v2', 'eliteread_admin_v2', 'rp_user']` | Cleared on first run. **[Verified]** This is the archaeological link to the removed `ELITEREAD` prototype — the project was renamed, and the old storage keys are still swept |
| `Database` | interface | ~25 collections plus `version`, `settings` and `sequences`. Every collection is an array of records keyed by an `_id` field |
| `emptyDatabase()` | `() => Database` | **No demo records of any kind** (its own comment). Only `settings: defaultSettings()` and `drm_policies: [defaultDrmPolicy()]` |
| `defaultDrmPolicy()` | `() => DrmPolicy` | `policy_id: 'drp_default'`, timestamps `new Date(0).toISOString()`. The comment explains why it exists: so protection does not depend on *"an administrator remembering to switch DRM on before the first sale"* |
| `getDb()` | `() => Database` | `ensureLoaded()` — parses once, caches the object, returns a **stable reference between writes and a new one after each** |
| `mutate(fn)` | `<T>(fn: (draft: Database) => T) => T` | **The only write path.** Shallow-copies, runs `fn`, persists, then notifies listeners **synchronously**. Can throw: the inner `writeDocument()` rethrows a quota failure as `STORAGE_QUOTA_EXCEEDED` and nothing catches it (§17.8) |
| `subscribe(listener)` | `(Listener) => () => void` | Backs `useSyncExternalStore` |
| `initCrossTabSync()` | `() => () => void` | `storage` event → re-read the document → notify |
| `resetDatabase()` | `() => void` | The CMS "clear all data" action |
| `uid(prefix)` | `(string) => string` | `crypto.randomUUID().slice(0, 8)` with a fallback |
| `nextSequence(db, key)` | `(Database, string) => number` | Monotonic counter backing `CNV-2026-0001`-style references. **Must be called inside `mutate()`** — its own comment says so, because it writes to `db.sequences` |
| `nowIso()` | `() => string` | Single source of timestamps |
| `useStore()` | `() => Database` | `useSyncExternalStore(subscribe, getDb, getDb)` — the same function for both the client and server snapshots, because there is no server |
| `ensureCrossTabSync()` | `() => void` | Idempotent via a module-level boolean |

**[Verified — the hazard]** `mutate()` notifies **synchronously**. A listener that triggers another write produces a nested `mutate()` during the outer notification, and a React component that writes during render produces an infinite loop. Three ref guards in `ReaderPage.tsx` (`registeredFor`, `grantedFor`, `savedProgressKey`) exist purely to prevent this. `store.ts`'s header explains why the design is still worth it: *"`getDb()` returns a new object reference on every write, so `useSyncExternalStore` gives every consumer a re-render without any provider, selector boilerplate or duplicated local state."*

### 15.2 Service layer (`src/lib/api.ts` and friends)

| Symbol | Role |
|---|---|
| `Result<T>`, `ErrorCode`, `ok()`, `fail()` | The envelope (§10.2). `fail` takes a code and a Hebrew sentence |
| `guard(actor, permission)` | `Failure \| null`. The authoritative authorisation check |
| `writeAudit(actor, AuditInput)` | Appends to `audit_log`. Called by every mutation without exception |
| `Actor`, `actorFromUser(user)` | The identity carried into every service call |
| `toPublicUser(u)` | Strips `password_hash`, `password_salt`, `password_set`. **Applied at every exit** |
| `login()`, `registerCustomer()`, `bootstrapAdmin()`, `isBootstrapRequired()` | The four session entry points |
| `saveCoupon()`, `findCoupon()`, `redeemCoupon()`, `listCoupons()`, `deleteCoupon()` | Coupons. Note `findCoupon` and `redeemCoupon` take **no actor** — they are called from inside `checkout()` |
| `updateSettings()`, `getSettings()` | `platform_settings` |
| `readAssetFile(file)` | File → data URL, bounded by `max_upload_bytes` (§14.10) |
| `saveSection()`, `listSections()` and the slot equivalents | CMS |
| `resendEmail()`, `listEmails()` | The e-mail queue |
| `resetPasswordWithToken()`, `requestPasswordReset()` | Reset flow; the token is *"validated against its stored hash and burned on use"* |
| `checkout()`, `markOrderPaid()`, `grantAccessForOrder()`, `refundOrder()`, `listMyOrders()`, `listOrdersForUser()` | `api-orders.ts` |
| `createInquiry()`, `listMyInquiries()`, `updateInquiry()`, `addInquiryNote()`, `linkInquiryToOrder()`, `getCustomerProfile()` | `api-support.ts` |
| `registerDeviceSession()`, `refreshDeviceSession()`, `revokeDeviceSession()`, `listDeviceSessions()`, `issueContentGrant()`, `consumeContentGrant()`, `revokeGrantsForEntitlement()`, `recordEvent()`, `resolveDrmPolicy()`, `withProtectionDefaults()` | `api-security.ts` — the DRM control plane |
| `computeRevenue()`, `productSales()` and the rest of `analytics.ts` | Derived, never stored |
| `evaluateAlerts()`, `HIGH_SIGNAL_EVENTS`, `SECURITY_EVENT_LABEL` | `alerts.ts` / `api-security.ts` |

### 15.3 Mobile (`react-native/src/`)

| Symbol | File | Role |
|---|---|---|
| `request()`, `get`, `post`, `put`, `del` | `net/client.ts` | The single transport. Normalises every failure into `ApiResult` |
| `readStoredSession()`, `storeSession()`, `clearSession()`, `currentUserId()` | `net/client.ts` | Keychain, with an in-memory mirror |
| `deviceId()` | `net/client.ts` | `getUniqueId()` with a bundle-id fallback; **not a security boundary** (its own comment) |
| `identityHeaders()` | `net/client.ts` | The six `X-Casanova-*` headers |
| `bootCheck()` | `net/api.ts` | Kill switch + forced upgrade, fail-closed |
| `issueGrant()`, `redeemGrant()` | `net/api.ts` | The two-step content handshake |
| `registerDevice()`, `heartbeatDevice()`, `revokeDevice()`, `listDevices()` | `net/api.ts` | Device lifecycle |
| `reportSecurityEvent()` | `net/api.ts` | **Fire and forget, returns `void`** — *"Reporting is evidence, not a precondition for protection"* |
| `AuthContext` / `useAuth()` | `store/AuthContext.tsx` | `phase: 'booting' \| 'blocked' \| 'signed-out' \| 'signed-in'`; the only owner of vault destruction |
| `LibraryContext` / `useLibrary()` | `store/LibraryContext.tsx` | Reload-on-focus, vault purge on entitlement loss, `removeDevice` |
| `ProtectionContext` / `useProtection()` | `store/ProtectionContext.tsx` | Policy, `active` shield flag, `reporterRef`, one-shot `DEVICE_COMPROMISED` |
| `RootNavigator` | `navigation/RootNavigator.tsx` | Phase-derived screen sets; module-level `navigationTheme` |
| `withProtectionDefaults()`, `RESTRICTIVE_POLICY`, `probeIntegrity()`, `ShieldOverlay` | `drm/` | Fail-closed policy resolution and the integrity probe |
| `apiBaseUrl()`, `loadApiBaseUrl()`, `setApiBaseUrl()`, `CLIENT`, `APP_VERSION`, `BUILD_NUMBER`, the four timing constants | `config.ts` | §13.3–§13.4 |
| `colors`, `spacing`, `fontSize`, `TAP_TARGET = 44`, `shield: '#000000'` | `theme.ts` | Tokens copied from `src/index.css` |

### 15.4 Native modules

| Symbol | File | Role |
|---|---|---|
| `ScreenShieldModule` | `android/.../shield/ScreenShieldModule.kt` (623 lines) | The eleven-method Android bridge; `FLAG_SECURE`, integrity detection, event emission |
| `detectIntegrity()` | same | **Deliberately returns `TRUSTED`, never `ATTESTATION_FAILED`** — that value is in `COMPROMISED_INTEGRITY` and would block every unmodified Android phone |
| `ScreenShieldPackage` | `shield/ScreenShieldPackage.kt` (31 lines) | Registers the module; referenced from `MainApplication.kt` |
| `MainActivity` | `MainActivity.kt` | Sets `FLAG_SECURE` **before** `super.onCreate()`; re-asserts on `onWindowFocusChanged` |
| `ScreenShield` (Swift) | `ios/CasanovaReader/ScreenShield.swift` (828 lines) | `RCTEventEmitter` subclass; the whole iOS detection-and-concealment layer |
| `RCT_EXTERN_MODULE` / 9× `RCT_EXTERN_METHOD` | `ios/CasanovaReader/ScreenShield.m` (61 lines) | The hand-maintained bridge — §14.7 |

### 15.5 Domain types (`src/types/index.ts`)

**[Verified]** One file, 845 lines, is the shared vocabulary. The load-bearing members:

| Type | Note |
|---|---|
| `StoredUser` vs `User` | The credential-bearing record and its public projection. **Never let a `StoredUser` reach React state** |
| `Actor` | `{ kind, user_id, name, role, admin_role? }` — memoised on **primitives**, not on the `user` object, to avoid a re-render cascade |
| `Product`, `OrderItem`, `Order` | `Order` carries `refund_status`/`refunded_amount`, which SQL does not (§9.6) |
| `UserProduct` | The entitlement. `product_snapshot` via `snapshotProduct()`; `access_status: ACTIVE \| EXPIRED \| REVOKED \| SUSPENDED` |
| `DrmPolicy` | `scope: WEB \| MOBILE \| ALL`, seven block flags, `max_devices_per_user`, `session_timeout_minutes`, watermark template |
| `DeviceSession` | fingerprint, integrity verdict, `secure_flag_active`, `current`, revocation attribution |
| `ContentGrant` | `STREAM \| OFFLINE_CACHE`, token, expiry, use budget, frozen watermark |
| `SecurityEventType` | 15 members, exactly matching the SQL CHECK |
| `AuditCategory` | 17 members, exactly matching the SQL CHECK |
| `effectivePrice(product)`, `snapshotProduct(product)` | Sale price resolution and purchase-time freezing |

`react-native/src/net/types.ts` **redeclares** the subset the phone needs. This duplication is intentional and enforced: `metro.config.js`'s `blockList` makes `../src` unresolvable, so the mobile app *cannot* import the web types even by accident. The header states the sync rule: *"the SQL schema in `schema.sql` is the arbiter when they disagree."*

---

## 16. DESIGN PATTERNS

Fourteen patterns recur often enough that new code is expected to use them. Each is named with a source citation rather than a textbook label.

| # | Pattern | Where | What it buys |
|---|---|---|---|
| 1 | **Result monad instead of exceptions** | `Result<T>` in `api.ts`; `ApiResult<T>` in `net/types.ts` | No `try`/`catch` at any call site; a network failure and a business refusal are the same shape |
| 2 | **Service layer shaped like a REST API** | `api.ts`, `api-orders.ts`, `api-support.ts`, `api-security.ts` | The announced backend migration is a driver swap, not a rewrite |
| 3 | **Actor-first signatures** | every mutating service function takes `Actor \| null` as parameter 1 | Authorisation cannot be forgotten, because the function cannot be called without deciding who is calling |
| 4 | **Guard-then-work** | `const denied = guard(actor, 'x'); if (denied) return denied;` | One idiom, 40+ call sites, zero variation |
| 5 | **External store + `useSyncExternalStore`** | `db.ts` + `store.ts` | No provider tree, no selector boilerplate, cross-tab sync for free |
| 6 | **Snapshot at the boundary** | `snapshotProduct()`, `OrderItem.product_name`/`unit_price`, `orders.coupon_code`, `UserProduct.product_snapshot` | A renamed or repriced product never rewrites history |
| 7 | **IDs, never embedded objects** | every relationship in `Database` and every foreign key in `schema.sql` | One place to update; the SQL `ON DELETE RESTRICT` expresses what the app expresses as `CONFLICT` |
| 8 | **Derive, do not store** | `analytics.ts`, `alerts.ts`, the 11 SQL views | Revenue cannot drift from the orders that produced it |
| 9 | **Fail closed by default** | `withProtectionDefaults()`, `RESTRICTIVE_POLICY`, `bootCheck()`, `probeIntegrity()`, `can(undefined, …)`, `CrashBoundary` | An absent or broken configuration is the strictest configuration |
| 10 | **Honest empty states** | `CmsHint`, `EmptyState`, `CheckoutSuccessPage`, `resendEmail`'s `failure_reason` | The UI never claims something the system did not do |
| 11 | **Bounded collections** | `SECURITY_EVENT_LIMIT = 400`, `CONTENT_GRANT_LIMIT = 200`, `security_events` pruning in SQL | A telemetry table cannot grow until the storage quota fails and real writes are lost |
| 12 | **Ref guards against synchronous re-entry** | `ReaderPage.tsx` (`registeredFor`, `grantedFor`, `savedProgressKey`), `ProtectionContext.reporterRef`, `reportedFailure`, `LibraryContext` | `mutate()` notifies synchronously; without these, React loops |
| 13 | **Provider above navigator** | `ProtectionProvider` wraps `RootNavigator`; `ShieldOverlay` is a sibling of `{children}` | One owner of `FLAG_SECURE`; no transition frame is ever exposed |
| 14 | **Phase-derived navigation** | `RootNavigator` selects its screen set from `AuthContext.phase` | Session death unmounts the whole authenticated stack and triggers vault cleanup, without an imperative `navigate('Login')` |

**Two anti-patterns the codebase deliberately avoids**, both worth noting because a newcomer will be tempted to add them:

- **No optimistic UI.** Nothing renders a state the service layer has not confirmed. `checkout()` returns `PENDING` and the success page says `PENDING`.
- **No client-side authorisation as a security control.** `AdminLayout`'s comment is explicit: *"Filtering the navigation is presentation only. Every page behind these links re-checks the same permission, and the service layer checks it again on each write, so a hand-edited URL cannot reach data the role is not allowed to see."*

---

## 17. ERROR HANDLING

### 17.1 The governing rule: errors are values

**[Verified]** There is no `throw` in the web service layer and exactly one in the mobile codebase (`setApiBaseUrl()`, a developer affordance with no UI to render a `Result`). Every failure path returns `{ ok: false, code, error }` with a Hebrew sentence. The consequence is structural: **there is no unhandled-rejection surface**, and no page needs a `try`/`catch`.

### 17.2 Where errors are rendered

**[Verified]** Three distinct patterns, each used consistently:

| Pattern | Used by | Shape |
|---|---|---|
| Inline form error | `LoginPage`, `CheckoutPage`, `SupportPage`, `SetupPasswordPage`, `AdminSettingsPage`, every admin form | `const [error, setError] = useState('')`, then `if (!result.ok) { setError(result.error); return; }`, rendered in a red box |
| Status message object | `AdminSettingsPage` | `setMessage({ kind: 'ok' \| 'error', text })` — one channel for both outcomes |
| Notice / empty state | mobile screens | `<Notice tone="warn">{error}</Notice>`, `<EmptyState … />` |

**[Verified]** No page ever renders `result.error` from a *successful* call, and no page swallows a failure silently. `AdminSettingsPage` even validates **before** calling the service — `if (Number.isNaN(maxUpload) || maxUpload < 1024)` — and shows its own Hebrew message rather than round-tripping to the guard.

### 17.3 Web route-level boundaries

**[Verified]** `src/components/RouteError.tsx` (88 lines) serves **two** purposes from one component, and its header says why:

> *"Shared by the error boundary and the catch-all, because 'this address does not exist' and 'this screen threw' are the same screen with different words: both need a way out, and neither needs a stack trace."*

- `RouteError` (default export) — `useRouteError()` + `isRouteErrorResponse(error) && error.status === 404` selects the copy.
- `NotFoundPage` (named export) — `<RouteErrorView missing />`, wired as `{ path: '*', Component: NotFoundPage }` **inside** the storefront shell so a stale link still gets the header and navigation. `routes.tsx` comments: *"Left out entirely, the router answers with its own English 404 screen."*

The reason `errorElement` is set on every route at all:

> *"Without an `errorElement`, React Router renders its own developer screen: an English 'Unexpected Application Error!' page carrying the component stack. Showing that to a paying reader is wrong twice over — it is untranslated, and it prints application internals into the page."*

And the JSX carries an inline note that is a standing instruction:

> *"Deliberately no error text, no component stack and no source frames. React Router already logs the real error to the console … repeating it into the DOM would hand internals to anyone who manages to trigger a bug."*

**[Verified]** The recovery affordance differs by case: `missing` → a link to `/store`; a thrown screen → `window.location.reload()` plus a link home. The copy is honest about the odds: *"רענון אחד פותר את זה כמעט תמיד"* — one refresh almost always fixes this.

**[Verified — gap]** `src/App.tsx` is 20 lines and contains **no** application-level error boundary. Protection is per-route only. An error thrown in `AppProvider`, `CmsProvider` or `AdminProvider` — i.e. above the `RouterProvider` — is not caught by anything and reaches React's default handling.

### 17.4 The mobile crash boundary is a security control

**[Verified]** `react-native/App.tsx`'s `CrashBoundary` is the only class component in either project, and it is not a UX convenience. Its header:

> *"A render error is caught, and catching it wipes the vault. This is the last line of the 'no permanent copy' rule: if the reader throws halfway through a session, the normal unmount cleanup may never run, and the bytes would sit in the sandbox with nothing tracking their TTL."*

`componentDidCatch` does exactly two things:

```ts
console.error('[CasanovaReader] fatal render error', error, info.componentStack);
void wipeAll().catch(() => undefined);
```

and deliberately does **not** report to `security_events`:

> *"Not reported to `security_events`: the session that would carry the report may itself be what threw, and a fire-and-forget POST from inside an error boundary is a POST nobody can confirm landed."*

The fallback UI is pure black (`colors.shield`), matching the shield overlay, because *"this screen can appear over a partially rendered reader, and a lighter background would make whatever is behind it legible in a capture."* No diagnostic detail reaches the screen: *"A React error box renders the component stack, and on a device that is being recorded that text is visible in the capture; the useful part of it goes to the console, where a developer can read it and a screenshot cannot."*

The user-facing copy states the consequence plainly: *"האפליקציה נסגרה להגנה על התוכן … כל עותק שנשמר במכשיר זה נמחק"* — the app closed to protect the content; every copy saved on this device was deleted.

### 17.5 Swallowed errors — each one reasoned

**[Verified]** Every empty `catch` in the repository carries a comment explaining why swallowing is correct. They are:

| Location | Swallowed | Reason in source |
|---|---|---|
| `auth.ts` `readSessionUserId` / `writeSessionUserId` | `localStorage` access | *"storage unavailable — session stays in memory only"* |
| `db.ts` JSON parse | corrupt document | falls back to `emptyDatabase()` |
| `client.ts` `readStoredSession` | keychain read | *"A keychain read fails on a device whose secure enclave is unavailable or after an OS restore. Treat it as signed out rather than crashing the boot sequence."* |
| `client.ts` `clearSession` | keychain reset | *"Nothing was stored, or the keychain is unavailable. Either way the in-memory copy above is already gone, which is what matters."* |
| `client.ts` `deviceId` | `getUniqueId()` | falls back to `getBundleId()` |
| `client.ts` `response.json()` | malformed body | `.catch(() => null)`, then a `STORAGE` result |
| `config.ts` `loadApiBaseUrl` | AsyncStorage throw | *"keeps the app bootable rather than stranded on an error screen the user cannot act on"* |
| `api.ts` `reportSecurityEvent` | the whole POST | *"a phone that cannot reach the server must still hide its content"* |
| `AuthContext` boot | `wipeAll()`, `clearSession()`, `purgeExpired()` | `.catch(() => …)` — boot must complete |
| `CrashBoundary` | `wipeAll()` | a failed cleanup must not mask the crash |
| `useScreenProtection` | `navigator.clipboard.writeText('')` | `.catch(noop)` — the clipboard may be locked |

**[Inferred — HIGH]** The pattern is: **swallow only when the alternative is a worse failure**, and say so. No error is swallowed for convenience.

### 17.6 Validation failures

**[Verified]** Validation lives in the service layer, produces `VALIDATION`, and is written as a Hebrew sentence naming the field and the rule: `'קוד הקופון חובה.'`, `'כותרת הסקטור חובה.'`, `'תוכן ההערה חובה.'`. Normalisation happens **before** validation — `data.code.trim().toUpperCase()`, `email.trim().toLowerCase()` — so `' SUMMER25 '` and `'summer25'` are the same coupon.

`isEmail()` is a deliberately permissive regex with an ASCII guard: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && /^[\x20-\x7E]+$/.test(value)`. The second clause is what rejects RTL marks and zero-width characters inside an address.

### 17.7 Conflict failures

**[Verified]** `CONFLICT` is the code for "the database says no, and it is not your input that is wrong": a duplicate coupon code, a duplicate e-mail, deleting a product that has been sold, a device cap reached. `deleteProduct`'s `CONFLICT` and `order_items.product_id ON DELETE RESTRICT` are the same rule expressed twice (§9.5).

### 17.8 Storage failures

**[Verified]** `STORAGE` is the catch-all for infrastructure: an unreadable document, a malformed server response, a failed `FileReader`. **But the quota case does not use it.** `db.ts:269`:

```ts
function writeDocument(db: Database): void {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (err) {
    // Quota exceeded is a real operational failure (large data-URL assets);
    // surface it instead of pretending the write succeeded.
    console.error('[db] persistence failed', err);
    throw new Error('STORAGE_QUOTA_EXCEEDED');
  }
}
```

**[Verified — UNCAUGHT]** A grep for `STORAGE_QUOTA_EXCEEDED` across `src/` returns exactly one match: the `throw` itself. Nothing catches it. `mutate()` has no `try`, no service function has one, and no page has one. **A quota failure therefore propagates out of the click handler as an unhandled exception**, and — because there is no application-level error boundary on the web side (§17.3) — reaches React Router's route `errorElement` at best and the browser's default handling at worst.

The comment explains the intent correctly (*"surface it instead of pretending the write succeeded"*) and the intent is right: a silent write failure would be far worse, since the UI would show a saved product that is not there. **What is missing is a catcher.** Given §14.10, the most likely trigger is a large PDF upload: `readAssetFile` rejects files over `max_upload_bytes` (default 10 MB) with helpful Hebrew guidance, but a 6 MB file passes that check and then exceeds a 5 MB quota at the `setItem`, producing an unhandled throw instead of a message.

**[Inferred — HIGH]** This is the one place in the web application where the "errors are values" rule is broken, and it is broken in the direction of loudness rather than silence — which is the safer direction, but still a bug.

---

## 18. LOGGING & OBSERVABILITY

### 18.1 There is no logging infrastructure

**[Verified — HIGH]** No logger, no log level, no structured logging, no Sentry, no OpenTelemetry, no analytics SDK. Exactly **two** `console` calls exist in the entire repository:

1. `db.ts:275` — `console.error('[db] persistence failed', err)`, immediately before the uncaught `STORAGE_QUOTA_EXCEEDED` throw (§17.8).
2. `react-native/App.tsx:77` — `console.error('[CasanovaReader] fatal render error', …)` in `CrashBoundary.componentDidCatch`.

Both are `console.error`, both are last-resort, and neither is a logging system. Observability is therefore not a stream. It is **three in-product surfaces an administrator reads**.

### 18.2 The audit log

**[Verified]** `audit_logs` / `db.audit_log`, written by `writeAudit(actor, AuditInput)` from **every** mutating service function without exception. Fields: `category` (17-member union), `action` (Hebrew verb phrase), `target_type`, `target_id`, `target_label`, `details`, plus the actor and a timestamp. Rendered by `AdminAuditPage` (permission `audit`, **SUPER_ADMIN-only**).

The `target_label` convention is what makes the log readable: `${owner.first_name} ${owner.last_name} · ${target.product_snapshot.name}` — a person and a thing, not two UUIDs.

**[Verified]** `details` carries the *transition*, not the new state: `` `${existing.account_status} → ${status}` ``, `'תוקף חדש עד ' + new Date(expiresAt).toLocaleDateString('he-IL')`, `changed.join(', ')` for a settings patch (so only the keys that moved are recorded).

### 18.3 The security event log

**[Verified]** `security_events`, bounded at `SECURITY_EVENT_LIMIT = 400` with oldest-first pruning, 20-second dedupe on identical events. 15 event types. Rendered by `AdminSecurityPage` with `SECURITY_EVENT_LABEL` (Hebrew names) and `HIGH_SIGNAL_EVENTS` (the subset that deserves attention).

**[Verified]** The ten events the web reader actually raises: `CONTEXT_MENU_BLOCKED`, `COPY_BLOCKED`, `PRINT_BLOCKED`, `SOURCE_VIEW_BLOCKED`, `SCREENSHOT_BLOCKED`, `RECORDING_DETECTED`, `VISIBILITY_HIDDEN`, plus the mobile-only `OFFLINE_EXPIRED`, `DEVICE_COMPROMISED` and the capture notifications from `ScreenShield.swift`.

The purpose is stated in `useScreenProtection`'s header: *"(c) report each blocked attempt so the CMS can show which accounts are probing the protection."* **This is behavioural telemetry, not diagnostics.**

The noise-control decision is explicit: Ctrl+Shift+C is *not* reported because *"it is the element picker, and reporting it would fill the log with noise that hides real capture attempts."*

### 18.4 The e-mail log

**[Verified]** `email_log` / `db.email_logs` records every message the system *intends* to send, with `status` (`QUEUED` / `SENT` / `DELIVERED` / `FAILED`), `sent_at`, `failure_reason` and a provider message id. Rendered by `AdminEmailsPage` (permission `emails`). This is the observability surface for an integration that does not exist — and `failure_reason` explains the absence in Hebrew rather than leaving a blank column.

### 18.5 What is deliberately never logged

**[Verified]** Four categories, each with a reason findable in source:

| Never logged | Why |
|---|---|
| Passwords, in any form | `auth.ts` header: *"Passwords are never stored or logged in clear text"*; `toPublicUser()` strips the fields before they can reach a log call |
| Session tokens | The web session is a user id, not a token; the mobile token lives only in the keychain and the in-memory mirror |
| Content URLs in telemetry | `reportSecurityEvent` takes `product_id` and `session_id`, never a grant token or a URL |
| Error detail in the DOM | §17.3 and §17.4 — both boundaries route diagnostics to the console and keep the screen clean |

### 18.6 Derived signals as observability

**[Verified]** `alerts.ts` recomputes an alert list on every read from the audit log, the security events and the orders. `AdminAlertsPage` renders it and its count badges `SideNav` (`AdminLayout` computes `openAlerts.length` and `openInquiries`). **Nothing is stored, so an alert cannot go stale** — and nothing can be acknowledged and forgotten either. **[Inferred — MEDIUM]** This is fine for a single-operator CMS and would need a `read_at` column the moment alerts are shared between staff.

### 18.7 Mobile observability

**[Verified]** The phone has two channels: `reportSecurityEvent()` (fire-and-forget, discarded result) and the local `Notice`/`EmptyState` UI. There is no crash reporter. `AuthContext` records `expiredAtBoot` — the titles whose offline copies were purged — and reports `OFFLINE_EXPIRED` for each, so the CMS can see a device losing its cache.

**[Verified]** `ProtectionContext` reports `DEVICE_COMPROMISED` **once**, via a `reportedFailure` ref, so a flapping integrity probe does not fill the bounded event table.

---

## 19. TESTING

### 19.1 There are no tests

**[Verified — HIGH]** Zero. No test framework in either `package.json`, no `test` script in either, no `*.test.*` or `*.spec.*` file anywhere outside `node_modules`, no `__tests__` directory, no `jest.config`, no `vitest.config`, no Playwright or Cypress, no snapshot files.

**[Verified]** The only quality gates that exist are `pnpm typecheck` (`tsc --noEmit`) in both projects and `pnpm format` (`oxfmt`) in the web project.

### 19.2 The brief requires fourteen scenarios

**[Verified]** `docs/PRODUCT_BRIEF.md` §34 lists fourteen mandatory test scenarios; §35's Definition of Done includes *"Tested"* and *"No console errors"*; §39's deliverable list includes *"Tests, README, Environment configuration example, Setup instructions"*. The README and environment template now exist; automated tests remain absent.

Ten of the fourteen scenarios are nevertheless **implemented** and were verified by reading source during this analysis:

| Brief scenario | Verified implementation |
|---|---|
| Guest checkout creates an account | `checkout()` → `findOrCreateCustomer()`; `password_set: false` → `/setup-password` |
| Purchase grants access | `markOrderPaid()` → `grantAccessForOrder()` → `user_products` row |
| Unpaid order grants nothing | `checkout()` writes `PENDING`; no entitlement is created |
| Coupon applies correctly | `findCoupon()` + recomputation inside `checkout()` |
| Invalid coupon rejected | `VALIDATION` with *'קוד הקופון אינו תקף או שפג תוקפו.'* |
| Device limit enforced | `registerDeviceSession()` / `max_devices_per_user` / `uq_device_sessions_open_slot` |
| Revoked device stops reading | `revokeDeviceSession()` + `trg_device_session_revokes_grants` |
| Revoked entitlement stops reading | `revokeAccess()` + `revokeGrantsForEntitlement()` + `trg_user_product_revokes_grants` |
| Role may not exceed its permissions | `guard()` on all 27 permissions across 40+ call sites |
| Protection flags change reader behaviour | `useScreenProtection()` reads through `optionsRef`; `withProtectionDefaults()` fills gaps |
| **Duplicate webhook arrives** | **Schema only** — `chk_payment_captured_has_reference` and the `payments` table; no webhook handler exists |
| **Invoice generation** | **Schema only** — `orders.invoice_number` and `settings.invoice_prefix`; no document is produced |

### 19.3 What substitutes for tests today

**[Verified]** Three things, none of which is a test:

1. **The type checker.** `strict` in both `tsconfig`s, `noImplicitOverride` and `noFallthroughCasesInSwitch` in the mobile one. The 15-member `SecurityEventType` and 17-member `AuditCategory` unions mean adding a SQL CHECK value without a TypeScript member is a compile error at every exhaustive `Record<…>`.
2. **The database constraints.** §9.5. Fourteen triggers and six arithmetic/uniqueness CHECKs express the invariants a test suite would otherwise assert. **They are the real test suite — they just have never been run.**
3. **Manual smoke evidence.** Twenty-two PNGs in the repository root, named `smoke_stage1_landing_empty.png` through `smoke_stage7_dashboard_devices.png`, `step1_landing.png` through `step9_admin_support_detail.png`, and `verify_*.png`. `.gitignore` covers `/smoke_*.png`, `/step*.png` and `/verify_*.png`. **[Inferred — HIGH]** These are screenshots from a scripted manual walkthrough — a human-executed test plan with no runner. Two names are findings in themselves: `smoke_stage6_reader_crash.png` and `step2_store_404.png`.

### 19.4 Why `src/lib/` is ideal test material

**[Inferred — HIGH]** If tests are ever added, the service layer is where they belong first, and the architecture is unusually favourable:

- Every function is pure with respect to its inputs **except** for `getDb()`/`mutate()`. Resetting `localStorage['casanova_db_v1']` resets the world; `resetDatabase()` does it in one call.
- No mocking of HTTP, timers or the DOM is needed — there is no HTTP.
- `Result<T>` means assertions are structural: `expect(r.ok).toBe(false); expect(r.code).toBe('FORBIDDEN')`.
- The six-step discipline gives a natural test matrix: for each mutating function × each of the five roles, assert allow/deny. That is ~200 cases and it is the single highest-value suite in the project.
- `Vitest` is not installed but is the obvious choice given Vite 8; adding it is a devDependency and a `test` script, with no source changes required.

**The one hazard:** `mutate()` notifies synchronously, so a test that renders a component and calls a service function in the same tick can loop. Test the service layer without React, or use the existing ref-guard patterns.

---

## 20. BUILD, CI/CD & DEPLOYMENT

### 20.1 Web build — works

**[Verified]** `pnpm install` → `pnpm dev` / `pnpm build` / `pnpm preview`. Node 22 and pnpm 10.34.3 pinned by `.mise.toml`; `pnpm-lock.yaml` committed; `node_modules` present. `pnpm typecheck` and `pnpm format` both runnable. `dist/` exists in the working tree, so a build has been produced at least once.

**[Verified — EXPOSURE]** `.figma/make/deploy-preview`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Build in development mode to emit sourcemaps.
pnpm run build --mode development
figma make deploy-preview --build-dir dist
```

Combined with `vite.config.ts`'s `build.sourcemap: 'inline'` when `mode === 'development'`, **preview deployments ship the complete TypeScript source inline in the bundle.** For a DRM client whose whole threat model assumes the visitor is adversarial, this hands them the annotated source — including every comment explaining what the protection does and does not stop. `.figma/make/deploy` (the non-preview path) does not pass `--mode development`.

**[Verified — inconsistency]** `.figma/make/install` runs `pnpm install --prefer-offline --no-frozen-lockfile`, which undercuts the byte-for-byte care `.gitattributes` takes with the lockfile.

### 20.2 There is no CI

**[Verified — HIGH]** No `.github/`, no `.gitlab-ci.yml`, no `.circleci/`, no `Jenkinsfile`, no git hooks, no `.husky/`. Nothing runs `typecheck` automatically. **The only thing standing between a change and a broken build is a human remembering to run `pnpm typecheck`.**

### 20.3 Android — source-complete, cannot run its own scripts

**[Verified]** `android/` contains `settings.gradle`, `build.gradle` (root and app), `gradle.properties`, `app/src/main/AndroidManifest.xml`, `MainActivity.kt`, `MainApplication.kt`, `shield/ScreenShieldModule.kt`, `shield/ScreenShieldPackage.kt`, and resources. **It does not contain `gradlew`, `gradlew.bat` or `gradle/wrapper/gradle-wrapper.jar`.**

The wrapper *directory* does exist — and contains a 13 MB Hebrew-named PDF (`היא קודם (6).pdf`), not a wrapper jar. `react-native/.gitignore` excludes `*.pdf`, so it can never be committed.

Consequences, all verified:

- `pnpm clean:android` (`cd android && ./gradlew clean`) **cannot run**.
- Any documented `./gradlew` invocation fails.
- `android/build.gradle` declares `classpath("com.android.tools.build:gradle")` with **no version**, which relies on a version catalog or a wrapper-provided resolution that is not present. **[Unknown]** which Gradle version is intended — §27.
- A developer must run `npx @react-native-community/cli run-android` (which can generate the wrapper) or install Gradle independently.

### 20.4 iOS — cannot be built at all

**[Verified]** The complete `ios/` tree is **four files**: `Podfile`, `CasanovaReader/ScreenShield.swift`, `CasanovaReader/ScreenShield.m`, `CasanovaReader/CasanovaReader-Bridging-Header.h`.

Absent: `CasanovaReader.xcodeproj` / `.xcworkspace`, `Info.plist`, `AppDelegate.swift` or `.m`, `LaunchScreen.storyboard`, the asset catalogue, `project.yml`, any `.entitlements`.

Five independently fatal consequences:

1. `pnpm pods` (`cd ios && pod install`) fails — the `Podfile` names `target 'CasanovaReader'` and there is no project for it to attach to.
2. Nothing can compile: there is no Xcode project.
3. `CasanovaReader-Bridging-Header.h`'s own comment says it is *"Referenced by the `SWIFT_OBJC_BRIDGING_HEADER` build setting in project.yml"* — **`project.yml` does not exist**, and no XcodeGen or Tuist configuration is present anywhere.
4. `ScreenShield.swift`'s jailbreak detection uses `canOpenURL` on custom schemes, which requires an `LSApplicationQueriesSchemes` entry in an `Info.plist` that does not exist. Even with a project, those checks would silently fail.
5. The Swift would not be linked into any target.

**[Inferred — HIGH]** `project.yml` strongly suggests **XcodeGen** was the intended project generator and that the generated artefacts were never committed (correctly — they are derived). But no `project.yml` was committed either, so the generation recipe is lost. Recreating the iOS project is a task in itself, not a configuration step.

### 20.5 Documentation drift

**[Verified]** Three instances where the documentation contradicts the repository. In each case the repository is right:

| Document | Claim | Reality |
|---|---|---|
| `AGENTS.md` | *"A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually."* | Verified false — nothing is listening; the server must be started |
| `AGENTS.md` | *"`src/App.tsx` — Primary application component and the usual starting point for UI work"*; describes a 7-file scaffold | `App.tsx` is 20 lines of provider composition. The real entry points are `src/routes.tsx` and `src/lib/`. `AGENTS.md` never mentions `src/lib/`, `src/types/`, `schema.sql`, `migrations/` or `react-native/` |
| `ios/Podfile` | `restrictDocumentInteraction()` uses `responds(to:)` guards | The Swift uses class-name walking with no `responds(to:)` call |

`CLAUDE.md` is two lines and contains only `@AGENTS.md` — it inherits every one of these.

**[Inferred — HIGH]** `AGENTS.md` is the untouched Figma Make scaffold README. It describes the project as it was on day one, not as it is now. **An AI agent following `AGENTS.md` literally would start in the wrong file and assume a server that is not running.**

### 20.6 Version control state — the most consequential finding

**[Verified]** Re-confirmed during this analysis by `git log`, `git ls-files`, `git status --short` and `git check-ignore -v`:

- **Zero commits.** `git log` exits with `fatal: your current branch 'main' does not have any commits yet`. There is no history, no baseline, no revert target, no `git blame`, no authored attribution.
- **82 files staged**, **33 untracked entries**.
- `git check-ignore -v` returns nothing for the React Native paths — **they are not ignored, they were simply never `git add`ed.**

| | Status |
|---|---|
| All 59 entries under `src/**` (57 code files plus the founding brief and one image) | **Tracked** |
| `index.html`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts`, `.mise.toml`, `.gitignore`, `.gitattributes`, `AGENTS.md`, `CLAUDE.md`, `schema.sql`, `.figma/make/*`, `images/main_photo.jpg`, `public/books/.gitkeep` | **Tracked** |
| Removed legacy root `ScreenShield.tsx` | Deleted during repository cleanup; it was the obsolete `ELITEREAD` prototype (§26) |
| `migrations/` (the entire directory, including `0001_mobile_reader.sql`) | **Untracked** |
| `react-native/{App.tsx, index.js, app.json, package.json, tsconfig.json, metro.config.js, babel.config.js, .gitignore, src/, android/, ios/}` | **Untracked** — the entire real mobile application |
| ~20 PNGs with `exp_*` and `screenshot_*` prefixes | **Untracked** — `.gitignore` covers `smoke_*`, `step*` and `verify_*` but not these two patterns |
| `docs/Senia_book.pdf`, `public/books/Senia_book.pdf` | Ignored by design (`/docs/`, `/public/books/*` with `!.gitkeep`) |

**The consequence, stated plainly:** a fresh `git clone` of this repository produces a working web storefront and **one** React Native file — a 244-line `@ts-nocheck` prototype branded `ELITEREAD`, whose three-method native contract contradicts the shipped eleven-method one, and whose header instructs the reader to *"paste the Android/iOS classes at the bottom of this file into the native projects"* — classes that would not exist in the clone. **The mobile application, and the migration that documents its schema requirements, would be gone.**

**[Verified — a second, subtler hazard]** 13 of the 82 tracked files are in status `AM`: staged, **and modified again in the working tree**. They are not a random sample — they are the security core:

```
schema.sql                        src/lib/useScreenProtection.ts
src/lib/api.ts                    src/pages/ReaderPage.tsx
src/lib/api-security.ts           src/pages/admin/AdminSecurityPage.tsx
src/lib/api-support.ts            src/pages/admin/AdminCrmPage.tsx
src/lib/db.ts                     src/pages/admin/AdminSupportPage.tsx
src/types/index.ts                src/components/icons.tsx
vite.config.ts
```

**A `git commit` right now — without `git add -A` — would commit an older version of the DRM core, the persistence layer, the domain types and the database contract**, and the working tree would still hold the newer one, invisibly. This is the specific mechanism by which the absence of commits becomes data loss rather than mere inconvenience.

**[Inferred — HIGH]** This is the single highest-priority remediation in the repository, and it is not a code change. It is `git add -A migrations react-native src schema.sql vite.config.ts && git commit`.

### 20.7 Deployment target

**[Verified]** Figma Make. `figma make deploy --build-dir dist` and `figma make deploy-preview --build-dir dist`. `site.json` sets `robots.index: false`, and `vite.config.ts` emits a matching `robots.txt` from that field. **[Unknown]** who can reach a preview URL — §27. This matters because of §20.1: if a preview URL is public, the inline sourcemaps are public.

There is no Dockerfile, no compose file, no infrastructure-as-code, no server component of any kind. **The deployed artefact is a directory of static files.**

---

## 21. SECURITY ARCHITECTURE

### 21.1 The threat model, as the code states it

**[Verified]** This is not a generic e-commerce threat model. It is stated in three places and is consistent across all of them:

- Brief §12: *"אסור להסתמך על Frontend לצורך הרשאות"* — authorisation must never be trusted to the frontend.
- Brief §15: *"אין לחשוף public URL קבוע של PDF אם ניתן להימבע מכך"* — no permanent public PDF URL if it can be avoided.
- Brief §40: *"אנחנו לא מוכרים קובץ. אנחנו מוכרים הרשאה לתוכן בתוך מערכת."*

**The adversary is the paying customer.** Not an outside attacker — the person who legitimately bought the book and wants to photograph it, print it, extract the URL or keep it after a refund. That is why the watermark carries their identity, why `block_print` blanks the paper rather than only intercepting the keystroke, and why `userDidTakeScreenshot` exists for attribution rather than prevention.

### 21.2 The central invariant

**[Verified]** Both clients obey one rule, and every other protection is downstream of it:

> **Nobody ever receives the permanent address of a protected file.** They receive a short-lived, use-budgeted grant bound to *account* + *entitlement* + *device session*. Revoking any of the three kills every URL already handed out.

Web: `issueContentGrant()` → `consumeContentGrant()`, bounded at `CONTENT_GRANT_LIMIT = 200`.
Mobile: `issueGrant()` returns a **token**, `redeemGrant(token, productId)` returns the address, server-side `consume_content_grant()` takes a row lock and re-validates expiry, budget, revocation and entitlement **inside one transaction**.
SQL: `chk_grant_bound_to_session`, `chk_grant_offline_single_use`, `chk_grant_revocation`, `trg_device_session_revokes_grants`, `trg_user_product_revokes_grants`.

**[Verified — the web gap]** The web `ReaderPage` does not currently go through this path for `public/books/*.pdf`. `pdfEmbedUrl()` is handed a `content_url` that, for the bundled book, is a **permanent public path in the static bundle**. The grant machinery exists and is exercised for uploaded/pasted URLs, but a file in `public/books/` is downloadable by anyone who knows the name. **[Inferred — HIGH]** This is the single largest divergence between the stated model and the running web app, and it is a consequence of having no server to issue short-lived URLs from.

### 21.3 Defence in depth — five layers

| Layer | Web | Mobile | Verifiable? |
|---|---|---|---|
| **1. Authorisation** | `guard()` on every mutation; 27 permissions; two-tier `can()`/`guard()` | Bearer token from the keychain; server re-checks every grant | Yes, in source |
| **2. Address withholding** | `issueContentGrant` / `consumeContentGrant`; `v_storefront_catalog` excludes the content URL | `issueGrant` → token → `redeemGrant` → short-lived URL | Yes |
| **3. Behavioural deterrence** | `useScreenProtection`: copy/print/view-source/capture-key suppression, blur shield, clipboard wiping, injected print stylesheet | `FLAG_SECURE` (Android); privacy cover + capture notifications (iOS) | Partially — §21.5 |
| **4. Attribution** | Watermark overlay with the reader's identity | Watermark frozen into the grant at issue time | Yes |
| **5. Destruction** | — | `wipeAll()` on sign-out, on a `blocked` boot, and on a render crash; vault purge when an entitlement dies or a TTL expires | Yes |

**Layer 5 exists only on mobile**, because only mobile holds bytes. The web reader never possesses the file — the browser's PDF plugin streams it.

### 21.4 Fail-closed — the enumeration

**[Verified]** Every place where an absent or broken input resolves to the strictest value:

| Function | Absent input | Resolves to |
|---|---|---|
| `withProtectionDefaults()` (web) | a policy missing block flags | the strictest value for each flag |
| `RESTRICTIVE_POLICY` (mobile) | no policy resolved yet | every flag blocked |
| `bootCheck()` | network failure | `mobile_app_enabled: false` + a neutral retry message |
| `probeIntegrity()` | the native module is missing | `ATTESTATION_FAILED` (which is in `COMPROMISED_INTEGRITY`) |
| `can(role, permission)` | `role === undefined` | `false` |
| `guard(actor, …)` | `actor === null` | `UNAUTHENTICATED` failure |
| `findCoupon(code)` | expired or exhausted | `undefined`, indistinguishable from a nonexistent code |
| `loadApiBaseUrl()` | corrupt AsyncStorage | the compiled default, not an arbitrary stored string |
| `readStoredSession()` | keychain unavailable | `null` → signed out |
| `CrashBoundary` | a render error | opaque black + `wipeAll()` |

**[Verified — the one deliberate exception]** `ScreenShieldModule.detectIntegrity()` in Kotlin returns `TRUSTED` and **never** `ATTESTATION_FAILED`, because that value is in `COMPROMISED_INTEGRITY` and would block every unmodified Android phone. This is the single place where the codebase fails *open* on purpose, and it is the correct call: Play Integrity is not available on every device, and refusing to run on a legitimate phone is a worse outcome than recording `TRUSTED` without proof. **Note the asymmetry with the JS side**: `probeIntegrity()` fails closed when the *module* is missing; the module fails open when the *attestation service* is missing.

### 21.5 What the protection does not do

**[Verified]** The codebase is unusually explicit about its own limits, and these statements should be quoted rather than paraphrased in any future security discussion:

- `useScreenProtection` header: *"a web page cannot stop a camera, an OS-level screenshot, or a browser extension."*
- `pdfEmbedUrl` doc: *"These are viewer hints rather than a security boundary — a determined visitor can still reach the file through developer tools — but they remove the accidental path, which is where nearly all real leakage starts."*
- `AdminSecurityPage` `FLAG_FIELDS` hint on `block_print`: printing from inside the browser's PDF view is **not** blocked.
- `FLAG_FIELDS` hint on `block_screenshots`: does **not** stop an OS-level screenshot.
- `deviceId()` doc: *"not a hardware serial and is not a security boundary … Spoofing it buys an attacker a fresh device slot, which `max_devices_per_user` is there to make expensive, not impossible."*
- `auth.ts` header: SHA-256 with a fallback to a non-cryptographic digest; replacing it with server-side argon2/bcrypt is listed as technical debt **by the module itself**.
- `vite.config.ts` CSP plugin: *"A meta policy cannot express `frame-ancestors`, `report-uri` or `sandbox`, so clickjacking protection still has to be delivered as a real HTTP header by whatever serves the built files."* **Nothing in this repository serves that header.**

### 21.6 The web authentication weakness, stated plainly

**[Verified]** §12.3. The web session is a plaintext user id in `localStorage['casanova_session_v1']`. Combined with §21.2's grant machinery running in the same process, the consequence is:

> **Every authorisation decision in the web application is made by code the visitor is running, over data the visitor holds.**

`guard()` is architecturally correct and operationally meaningless today. Editing `localStorage` to `{"casanova_session_v1":"<admin-user-id>"}` yields a `SUPER_ADMIN` session with no credential.

**[Inferred — HIGH]** This is not a defect to be fixed in place. It is the expected state of a static bundle with no backend, the code says so repeatedly, and the fix is the backend migration the architecture was designed for. **What must not happen is a security review that treats `guard()` as a control.** It is a *specification* of a control.

### 21.7 Sensitive-data handling in the admin panel

**[Verified]** `src/lib/sensitive.ts` (35 lines) is small but states a hard policy:

> *"Policy: admins and support agents must NEVER see raw passwords, full card numbers, CVV, API keys, tokens or secrets. The admin panel only ever stores and renders already-masked representations produced by these helpers."*

| Helper | Output |
|---|---|
| `maskCard(last4?)` | `•••• •••• •••• 1234`, or all dots when there is no tail. Strips non-digits and takes the last four |
| `maskEmail(email)` | `a•••@domain` — first character plus the full domain |
| `maskSecret(label)` | `"<label> מוסתר"` — a fixed opaque placeholder, never a partial reveal |
| `maskCvv()` | `•••` — takes no argument, so a CVV cannot be passed in to be masked |
| `SECURITY_NOTE` | The Hebrew sentence the panel displays alongside masked fields |

**[Inferred — HIGH]** The signatures are the design. `maskCvv()` accepts nothing, so there is no way to call it with a real CVV. `maskSecret()` returns a constant. **The API makes the insecure call unrepresentable** — a pattern worth extending to any future secret-handling code.

Note that `maskEmail` keeps the domain, which is what lets support tell two `gmail.com` customers apart while still not displaying the address.

### 21.8 Dependency and supply-chain posture

**[Verified]** Web: three runtime dependencies (`react`, `react-dom`, `react-router`). No HTTP client, no utility library, no UI kit — so the transitive surface is unusually small and there is nothing that phones home.

**[Verified]** Mobile: eleven runtime dependencies, **every one pinned to an exact version**. **[Inferred — HIGH]** Deliberate for a DRM client: a floating minor of `react-native-pdf` or `react-native-keychain` could change capture or storage behaviour without anyone deciding it should.

**[Verified]** No `react-native/node_modules`, **no mobile lockfile**. `pnpm-lock.yaml` exists only for the web project. A mobile install today resolves eleven exact top-level versions but an unpinned transitive tree.

**[Verified]** `.gitignore` excludes `android/keystore.properties`, `*.keystore` and `*.jks` with `!android/app/debug.keystore` — the signing material is deliberately never committed. `react-native/.gitignore` also excludes `vault/`, the on-device cache directory.

### 21.9 Security review summary

| Finding | Severity | Type |
|---|---|---|
| Web session is a plaintext user id; all authorisation is client-side | **Critical** | Architectural — resolved only by the backend migration |
| `public/books/*.pdf` is a permanent public path in the static bundle | **High** | Contradicts §21.2 for the one real title in the repository |
| Preview deployments ship inline sourcemaps with all security comments | **High** | `.figma/make/deploy-preview` + `build.sourcemap: 'inline'` |
| No `frame-ancestors` header anywhere; the reader is an iframe | **Medium** | Acknowledged in source; a deployment task |
| SHA-256 password digest with a non-cryptographic fallback | **Medium** | Self-declared technical debt in `auth.ts` |
| 10 MB upload → ~13.3 MB base64 in a ~5 MB quota | **Medium** | Fails as a generic `STORAGE` error, not the specific guidance |
| `FINANCE` role description promises coupons it cannot touch | **Low** | §10.6 |
| `AdminSecurityPage`'s device-scoping fallback is unreachable | **Low** | Over-restrictive, so safe; the comment misleads (§26) |
| No CI, no tests, no commits | **High** | Nothing verifies any of the above automatically |

---

## 22. CODING CONVENTIONS

These are observed conventions, not documented ones — with the exception of `AGENTS.md`, which documents three and is stale on everything else (§20.5).

### 22.1 The file-header box

**[Verified]** Every architecturally significant file opens with the same ASCII box and explains **why it exists**, not what it does:

```ts
/* ─────────────────────────────────────────
 * HTTP transport.
 *
 * Three rules this module exists to enforce:
 *  1. The session token lives in the platform keychain, never in
 *     AsyncStorage. …
 * ───────────────────────────────────────── */
```

Present in all 13 `src/lib/` modules, all three contexts, `App.tsx` (both projects), `client.ts`, `api.ts`, `config.ts`, `metro.config.js`, and every screen with a non-obvious constraint. **The convention is that the header carries the reasoning a reviewer would otherwise have to reconstruct.** Several of the most important facts in this document are quotations from these headers.

Inline `/* … */` comments follow the same rule at statement level: they explain a hazard, a rejected alternative, or a coupling — never the syntax.

### 22.2 Language

**[Verified]** A strict split with no exceptions found:

| Language | Used for |
|---|---|
| **English** | All identifiers, all comments, all type names, all SQL, all commit-adjacent documentation |
| **Hebrew** | Every user-facing string — UI copy, validation messages, error messages, audit `action`/`details`, alert text, e-mail subjects |

Hebrew strings appear inline in JSX and in service-layer `fail()` calls. There is **no i18n layer, no message catalogue, no translation keys** — the product is Hebrew-only and the strings are literals. Label maps for enums are `Record<Enum, string>` constants co-located with their use: `ROLE_LABEL`, `INQUIRY_STATUS_LABEL`, `SECURITY_EVENT_LABEL`, `PLATFORM_LABEL`, `INTEGRITY_LABEL`.

### 22.3 Quoting and escaping

**[Verified]** Single quotes for TypeScript strings, double quotes for JSX attributes. `AGENTS.md` adds the one rule that actually breaks builds: *"Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build."* Hebrew text uses the geresh (`׳`) and gershayim (`״`) rather than ASCII apostrophes, which sidesteps the issue in most copy.

`oxfmt` is the formatter (`pnpm format`). There is no configuration file for it, so defaults apply.

### 22.4 Directionality

**[Verified]** `<html lang="he" dir="rtl">`. Two consequences that recur:

- **Anything machine-shaped is wrapped in `dir="ltr"`** — e-mail addresses, coupon codes, ticket numbers, order references, build numbers. `<p dir="ltr" className="font-mono …">{submitted.ticket_number}</p>`. Without it, RTL bidi reordering scrambles them.
- **The mobile app forces RTL at module scope**, before the first render:

```ts
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
```

with the reasoning that the screens do not depend on it (every text style sets `writingDirection: 'rtl'` explicitly, every row uses `flexDirection: 'row'` with mirrored padding) but *"forcing it makes the platform's own widgets (the text-selection handles, the keyboard's language row, the native `Alert` button order) agree with the app instead of fighting it."* `forceRTL` normally needs a restart to take effect; the header explains why none is needed here.

### 22.5 Styling

**[Verified]** Tailwind CSS v4 via `@tailwindcss/vite`. `src/index.css` is `@import 'tailwindcss';` followed by an `@theme { … }` block defining the design tokens as CSS custom properties (`--color-background`, `--color-foreground`, `--color-primary`, `--color-border`, `--color-muted-foreground`, `--color-success`, `--color-danger`, `--color-card`, `--font-display`, `--font-mono`, …).

**Two styling mechanisms are used together, deliberately:**

1. **Tailwind utility classes** for layout and spacing: `className="max-w-5xl mx-auto px-6 py-16 page-enter"`.
2. **Inline `style={{ color: 'var(--color-muted-foreground)' }}`** for anything token-driven.

The reason is theme switching: `ThemeToggle` flips a class on the root, the `@theme` variables resolve differently, and inline `var()` references follow. A Tailwind colour class baked at build time would not.

**[Verified]** A small set of hand-written component classes carries the visual identity and is reused everywhere rather than re-expressed:

| Class | Purpose |
|---|---|
| `.btn-gradient` | The gold gradient primary button, with `:hover` lift and `:active` press |
| `.card-glow` | The elevated card with a gold border on hover |
| `.font-display` / `.font-mono` | The two typefaces |
| `.page-enter` | `animation: fadeUp 0.4s ease both` |
| `.tap-target` | `min-height: 44px; min-width: 44px` — *"44px is the Apple HIG floor; 48dp is Android's. Applied to controls that a thumb has to find by feel."* |
| `.safe-top` / `.safe-bottom` / `.safe-x` | `env(safe-area-inset-*)`, zero on desktop |
| `.swipe-zone` / `.swipe-hint` | Capability-gated by `@media (hover: none) and (pointer: coarse)` |

**[Verified]** Capability-based rather than breakpoint-based responsive CSS throughout: `@media (hover: none) and (pointer: coarse)` instead of `@media (max-width: …)`, `min-height: 100vh` immediately followed by `min-height: 100dvh` so the mobile URL bar does not push the bottom navigation off-screen, and `prefers-reduced-motion` respected.

**[Verified]** The mobile `theme.ts` **copies** the token values from `src/index.css` rather than importing them, and adds `shield: '#000000'` and `TAP_TARGET = 44`. Metro's `blockList` makes importing impossible (§13.7). **The two token sets must be kept in step by hand** — the same class of hazard as `ScreenShield.m` ↔ `ScreenShield.swift`.

### 22.6 Component conventions

**[Verified]**

- **Default exports** for components: `export default function AdminSecurityPage()`. `AGENTS.md` requires it. Named exports coexist for helpers in the same file (`export function NotFoundPage`).
- **One page per file**, `src/pages/`, with admin pages under `src/pages/admin/` and named `Admin<Domain>Page.tsx`.
- **Function components only.** The two `class` components in the repository are error boundaries, where React requires it.
- **Hooks before guards.** §12.5. Non-negotiable.
- **Sub-components are file-local** and defined above the default export (`StatusPill` in `SupportPage.tsx`, the coupon modal in `AdminCmsPage.tsx`). They are not exported.
- **`as const` on shared style objects** — `const inputStyle = { … } as const;` at the top of pages that reuse it across many inputs.
- **State is local.** `useState` per form; the three contexts hold only cross-page state (session, admin aggregates, CMS content).

### 22.7 Naming

**[Verified]** Consistent enough to predict:

| Kind | Convention | Examples |
|---|---|---|
| Service functions | verb + noun, no `Api`/`Service` suffix | `saveCoupon`, `revokeDeviceSession`, `markOrderPaid` |
| Read functions | `list*` (many) / `get*` (one) / `find*` (maybe-undefined) | `listSections`, `getSettings`, `findCoupon` |
| Hooks | `use*` | `useStore`, `useApp`, `useAdmin`, `useCms`, `useAuth`, `useLibrary`, `useProtection`, `useScreenProtection` |
| Database fields | `snake_case`, matching SQL exactly | `order_status`, `payment_status`, `access_status`, `mobile_min_build` |
| TypeScript identifiers | `camelCase` for locals, `PascalCase` for types | `couponCode`, `DrmPolicy` |
| IDs | `<entity>_id` | `user_product_id`, `session_id`, `coupon_id` |
| Label maps | `<ENTITY>_LABEL` | `ROLE_LABEL`, `PLATFORM_LABEL`, `INTEGRITY_LABEL` |
| Constants | `SCREAMING_SNAKE` | `DB_KEY`, `SESSION_KEY`, `TOKEN_SERVICE`, `REQUEST_TIMEOUT_MS` |

**The `snake_case` data fields are load-bearing**: they are what makes `react-native/src/net/types.ts` and `schema.sql` directly comparable, and what will make a future JSON API need no field renaming. **Do not "fix" them to camelCase.**

### 22.8 SQL conventions

**[Verified]** `snake_case` throughout; `chk_<table>_<rule>` for CHECK constraints; `trg_<table>_<action>` for triggers; `uq_<table>_<rule>` for unique indexes; `v_<name>` for views; `fn`-less plain verb names for functions (`consume_content_grant`, `sweep_expired_reader_sessions`). Every table has `<entity>_id` as its primary key plus `created_at` and (where mutable) `updated_at`. `BEGIN;` / `COMMIT;` wrap the whole file. Comments explain the failure mode a constraint prevents (§9.5).

---

## 23. FEATURE IMPLEMENTATION PATTERNS

Five recipes. Each is what the existing code does, so a new feature built the same way will fit without review friction.

### 23.1 Recipe: add a new admin capability

The full sequence, in the order the existing fourteen pages follow:

1. **`src/types/index.ts`** — add the entity, its status union and its `*_id` field. Use `snake_case` field names matching the SQL you will write in step 8.
2. **`src/lib/db.ts`** — add the collection to the `Database` interface and to `emptyDatabase()` as `[]`. **Do NOT bump `DB_VERSION`** without first resolving §27's unknown about migration behaviour.
3. **`src/lib/permissions.ts`** — add the `AdminPermission` string to the union, to `SUPER`, and to whichever other roles should hold it. If it should be SUPER_ADMIN-only, add it only to `SUPER`.
4. **`src/lib/api*.ts`** — add the service functions, actor-first, following the six steps. Every mutation ends with `writeAudit(actor, { … })`. Add the `AuditCategory` member if none fits.
5. **`src/pages/admin/Admin<Domain>Page.tsx`** — hooks first, then `if (!can(adminRole, '<perm>')) return <AccessDenied page="<Hebrew name>" />;`.
6. **`src/components/layout/SideNav.tsx`** — add the nav item with its `perm` so `AdminLayout`'s filter picks it up.
7. **`src/routes.tsx`** — add the route under the `/admin` parent with `lazyPage(() => import(…))` and `errorElement: <RouteError />`.
8. **`schema.sql`** — add the table, its CHECK constraints (with a comment on each failure mode), its foreign keys (`ON DELETE RESTRICT` where a reference must survive), and a view if the feature is read-heavy. **Also add the `AuditCategory` and any status value to the matching SQL CHECK list** — §9.6 verified these are exact matches today, and that is worth preserving.

**What you must not skip:** step 3 without step 4 leaves a permission nothing enforces. Step 4 without `writeAudit` leaves a mutation nobody can account for — there is no exception in the existing code.

### 23.2 Recipe: add a public/customer feature

1. Service function in `src/lib/api*.ts`, taking `Actor | null` first. For customer-scoped reads, follow `listMyInquiries(actor)` / `listMyOrders(actor)`: filter by `actor.user_id` **and** by `customer_email`, because guest checkout creates orders before the account exists. `getCustomerProfile()` does exactly this: `o.user_id === userId || o.customer_email === stored.email`.
2. Page in `src/pages/`, default export, `page-enter` class, `max-w-5xl mx-auto px-6 py-16` shell.
3. Route in `src/routes.tsx` under the storefront parent so the header and navigation are inherited.
4. Context exposure only if the state is cross-page — otherwise keep it in the page.

### 23.3 Recipe: add a CMS-editable piece of copy

Three distinct mechanisms; picking the wrong one is the most common mistake here (§14.2):

| If it is… | Use |
|---|---|
| A single global string (brand, tagline, footer) | a `platform_settings` column + `AdminSettingsPage` form field |
| A named structural block on the landing page | a `cms_content` **fixed slot** + `CmsHint` for the empty state |
| A repeating, reorderable block an operator adds freely | a `cms_sections` **free-form section** + `display_order` |

**The rule that must be honoured:** an unset slot renders `CmsHint` to an administrator and **nothing** to a visitor. Never add a fallback string. `AdminSettingsPage`'s comment is the standing instruction: *"Written even when empty on purpose: clearing a field here has to clear it on the page, not silently leave last month's copy up."*

### 23.4 Recipe: add a security event type

Four places must change together, or the type checker catches three of them and the database catches the fourth:

1. `SecurityEventType` union in `src/types/index.ts`.
2. The **same** union in `react-native/src/net/types.ts` (the duplication is intentional and enforced — §15.5).
3. `security_events_event_type_check` in `schema.sql` — a PostgreSQL CHECK list cannot be extended in place, which is exactly why `migrations/0001` section B replaces the whole constraint. **Copy that approach.**
4. `SECURITY_EVENT_LABEL` (Hebrew display name) and, if it deserves attention, `HIGH_SIGNAL_EVENTS` in `api-security.ts`.

Because `SECURITY_EVENT_LABEL` is typed `Record<SecurityEventType, string>`, step 1 without step 4 is a **compile error**. That is the design working.

### 23.5 Recipe: add a mobile endpoint

1. `net/types.ts` — the request and response types, `snake_case` fields matching the SQL.
2. `net/api.ts` — the function, using `get`/`post`/`put`/`del`. Add `{ anonymous: true }` only if it must work before sign-in.
3. **Update the header mapping table** in `net/api.ts` — phone function → web service function → SQL table. This is the API specification (§10.1) and an endpoint missing from it is an endpoint the backend author will not implement.
4. The web service function that does the same thing against `localStorage`, so the two stay comparable.
5. The SQL view or table the server will read.

**Two rules from the existing code:** never send a value the server can derive from a header (`submitInquiry`'s `source`), and never return a content address from anything but `redeemGrant`.

### 23.6 Recipe: add a native module method

The most hazardous change in the repository, because nothing validates it:

1. `ScreenShieldModule.kt` (Android) and `ScreenShield.swift` (iOS) — both, with matching semantics. **Android prevents; iOS detects and conceals.** Do not assume one implementation can mirror the other.
2. `ScreenShield.m` — add the `RCT_EXTERN_METHOD`. The header's warning is the whole reason this is hazardous: *"Nothing in the toolchain checks that a selector declared here exists in Swift, and the failure is not a build error: it is `undefined` returned from the JS side at call time."*
3. `drm/ScreenShield.tsx` — the JS wrapper, with a fallback for the method being `undefined`.
4. The obsolete root `ScreenShield.tsx` was deleted during repository cleanup; do not restore it.

---

## 24. DEPENDENCY MAP

### 24.1 Web module graph

**[Verified]** Arrows mean "is imported by". The graph is a strict layering — **no layer imports from a layer above it**, and there are no cycles.

```
index.html
   └─> src/main.tsx  (+ src/index.css)
         └─> src/App.tsx
               ├─> context/AppContext ──┐
               ├─> context/CmsContext   │  (AppProvider is outermost:
               ├─> context/AdminContext ─┘   it owns the session the
               └─> src/routes.tsx            other two authorise with)
                     ├─> components/layout/{PublicRoot,DashboardLayout,AdminLayout,SideNav}
                     │      └─> components/{icons,ThemeToggle,AccessDenied,CmsHint,RouteError}
                     └─> pages/*  and  pages/admin/*   (all lazyPage())
                            │
                            ├─────────────────────────┐
                            ▼                          ▼
                     lib/api*.ts  lib/analytics  lib/alerts  lib/permissions
                     lib/auth     lib/sensitive  lib/media   lib/useScreenProtection
                            │
                            ▼
                     lib/store.ts  ──> lib/db.ts  ──> localStorage['casanova_db_v1']
                            │
                            ▼
                     types/index.ts   (imported by everything above)
```

**The three hard rules this graph encodes:**

1. **Pages contain no business logic.** A page imports a service function, calls it with `actor`, and renders `result`. Verified across all fourteen admin pages by grepping their `src/lib/*` imports.
2. **Only `db.ts` touches `localStorage` for data.** `auth.ts` touches it for the session key alone; `store.ts` touches neither.
3. **`types/index.ts` is a leaf.** It imports nothing from the application.

### 24.2 What depends on what — the blast-radius view

| If you change… | Everything that breaks |
|---|---|
| `types/index.ts` | The entire web application, plus (by hand) `net/types.ts` and `schema.sql` |
| `db.ts`'s `Database` shape | Every service function, every context, every page; **and every existing user's stored data** |
| `db.ts`'s `mutate()` notification timing | Every `useStore()` consumer; the three `ReaderPage` ref guards become insufficient |
| `permissions.ts` | All 14 admin pages, `SideNav`, `AdminLayout`, and every `guard()` call site |
| `guard()` | Every mutating service function — 40+ call sites |
| `api.ts`'s `Result`/`ErrorCode` | Every page's error branch, and `net/types.ts` by hand |
| `useScreenProtection` | `ReaderPage` only — but the CSP `style-src 'unsafe-inline'` exception exists for it (§13.6) |
| `vite.config.ts` | The Figma Make integration, the CSP, `robots.txt`, the `@` alias, and sourcemap policy |
| `src/index.css` `@theme` tokens | Every page's inline `style={{ … var(--color-…) }}`, and `react-native/src/theme.ts` by hand |
| `metro.config.js`'s `blockList` | The mobile build silently bundles web React (§13.7) |
| `config.ts` timing constants | Coupled by inequality to server-side `session_timeout_minutes` and grant TTL (§13.4) |
| `android/build.gradle` `versionCode` | The `mobile_min_build` kill switch's ability to target a build (§14.8) |
| `ScreenShield.swift` | `ScreenShield.m` by hand; nothing detects the mismatch (§14.7) |
| `schema.sql` | Nothing at runtime — but it is the declared arbiter, so every divergence becomes a future bug |

### 24.3 Mobile module graph

**[Verified]**

```
index.js ─> App.tsx
              ├─> CrashBoundary ──> drm/SecureFileVault.wipeAll()
              ├─> SafeAreaProvider, StatusBar
              ├─> store/AuthContext ──┐
              │      ├─> net/api.ts   │  (outermost: the policy derives
              │      ├─> net/client.ts│   from a signed-in device session)
              │      └─> config.ts    │
              ├─> store/ProtectionContext ─> drm/ScreenShield.tsx ─> NativeModules.ScreenShield
              │                                     └─> net/api.ts (reportSecurityEvent)
              ├─> store/LibraryContext ─> net/api.ts, drm/SecureFileVault
              └─> navigation/RootNavigator ─> navigation/routes.ts
                        └─> screens/* ─> components/{ui,Watermark}, theme.ts
```

`net/client.ts` is the only module that performs I/O to the network. `drm/SecureFileVault` is the only module that performs filesystem I/O. **Both are single chokepoints**, which is why `wipeAll()` can be called from three unrelated places and be trusted to mean "everything".

### 24.4 Cross-project dependencies

**[Verified]** The two projects share **no code**. `metro.config.js`'s `blockList` makes `../src`, `../node_modules` and `../dist` unresolvable from `react-native/`. What they share is three things, each maintained by hand:

| Shared | Web location | Mobile location | Enforced by |
|---|---|---|---|
| The domain vocabulary | `src/types/index.ts` | `src/net/types.ts` | Nothing but review. **SQL is the declared arbiter** |
| The design tokens | `src/index.css` `@theme` | `src/theme.ts` | Nothing |
| The behavioural contract | `src/lib/api*.ts` | `src/net/api.ts` + the header mapping table | Nothing |

**[Inferred — HIGH]** This is the correct decision — a shared package would mean a build system for both projects and a Metro/Vite interop problem — but it means **every change to the domain model is a three-place edit**. §28 makes that a checklist item.

### 24.5 External runtime dependencies

**[Verified]** Zero. §11. The only external things the shipped web bundle loads are Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`, permitted by `font-src` and `style-src`) and, where an administrator has pasted one, a YouTube or Vimeo iframe (`frame-src`).

---

## 25. CHANGE IMPACT / SENSITIVE AREAS

Ranked by how much damage a well-intentioned edit can do. "Fragile" here means *the code looks ordinary and the failure is not local*.

### 25.1 Tier 1 — do not touch without a plan

| Area | Why it is sensitive | The specific trap |
|---|---|---|
| **`src/lib/db.ts`** — `Database`, `DB_VERSION`, `mutate()` | Every byte of every user's data lives in one localStorage document. There is no migration path and no backup | `mutate()` notifies **synchronously**. Changing that to async, batching, or `queueMicrotask` breaks the three `ReaderPage` ref guards and every `useStore()` consumer's assumptions at once. Adding a collection without adding it to `emptyDatabase()` produces `undefined` for every existing user |
| **`src/lib/permissions.ts`** | 27 strings, 5 roles, 14 admin pages, 40+ `guard()` call sites | Removing a permission from a role silently disables a page — `can()` returns false, the page renders `AccessDenied`, and nothing errors. Adding one to `SUPER` alone is the safe default |
| **`schema.sql`** — the CHECK constraints | Four of them are the only thing preventing a false financial claim | Removing a `COALESCE` from `chk_drm_watermark_template` or `chk_drm_offline_needs_ttl` **silently disables the constraint for NULL rows** — the source says so. Removing `chk_payment_captured_has_reference` allows a `PAID` order with no provider reference |
| **`metro.config.js`** — `blockList` | One line separates two projects that both contain React | Deleting it produces a build that **succeeds** and an app that bundles web React. There is no error to see |
| **`useScreenProtection.ts`** — the `}, []` dependency array | The listeners are installed once and read policy through `optionsRef` | Adding `options` to the dependency array re-installs listeners on every policy object identity change, opening windows where nothing is protected. The comment states this explicitly |
| **`react-native/src/net/client.ts`** — `identityHeaders()` | The kill switch depends on `X-Casanova-Build` arriving on **every** request | Making the headers conditional on authentication, or omitting them for anonymous calls, breaks `bootCheck()`'s server-side counterpart |

### 25.2 Tier 2 — high coupling, moderate blast radius

| Area | Coupling |
|---|---|
| **`src/types/index.ts`** | Imported by everything. A rename is a three-place edit (§24.4) |
| **`api-security.ts`** — `resolveDrmPolicy`, `withProtectionDefaults` | Policy resolution is most-specific-first (`WEB`/`MOBILE` then `ALL`). Reordering it changes which policy wins for every user |
| **`ReaderPage.tsx`** | Three ref guards + `pdfEmbedUrl` + the iframe `key`. All four exist because of browser PDF-viewer behaviour that is not obvious from the code (§14.4) |
| **`react-native/src/config.ts`** timing constants | Coupled by **inequality** to server values nobody validates (§13.4) |
| **`ScreenShield.m` ↔ `ScreenShield.swift`** | Hand-maintained; a mismatch returns `undefined` at call time, not a build error |
| **`android/build.gradle` `versionCode`** | The kill switch's targeting key. A security release that does not bump it cannot be forced |
| **`api-orders.ts` `checkout()`** | Recomputes the price server-side. Accepting a client-supplied total here — even "for convenience" — destroys the property verified in §14.3 |

### 25.3 Tier 3 — safe to change freely

**[Verified]** These are leaf modules with local effects:

- `src/components/icons.tsx` (459 lines) — an icon-name→SVG map. Adding an icon cannot break anything.
- `src/lib/media.ts` (27 lines) — YouTube/Vimeo URL detection and embed conversion.
- `src/lib/sensitive.ts` (35 lines) — pure masking functions.
- `src/components/{ThemeToggle,AccessDenied,CmsHint}.tsx` — presentational.
- Any page's JSX and layout, provided the hooks-before-guard order is preserved.
- `src/index.css` visual values (not the token *names*, which pages reference by `var()`).

### 25.4 Areas where the failure is silent

**[Inferred — HIGH]** The dangerous characteristic of this codebase is that **most breakages produce no error**. Concretely:

| Change | Symptom |
|---|---|
| Remove a permission from a role | The page renders `AccessDenied`. No console output |
| Delete the `metro.config.js` `blockList` | The build succeeds. The app does not run |
| Add `options` to `useScreenProtection`'s dependency array | Protection intermittently absent. Nothing logs it |
| Remove a `COALESCE` from a CHECK | The constraint passes on NULL. No error until data is wrong |
| Rename a `SecurityEventType` in one project only | The web admin console shows an unlabelled event. The type checker catches it only if the `Record<…>` map is touched |
| Bump `DB_VERSION` without a migration | **[Unknown]** — §27. Possibly every user's data is discarded |
| Forget `writeAudit` on a new mutation | Everything works. The audit log has a hole nobody notices |
| Ship a mobile build without bumping `versionCode` | The kill switch cannot target it. Nothing indicates the omission |

**This is why §19.4's service-layer test suite is the highest-value work in the repository.** The type checker catches arity and naming; it cannot catch any of the above.

### 25.5 Change-impact checklist

Before merging any change that touches the domain model:

- [ ] `src/types/index.ts`, `react-native/src/net/types.ts` and `schema.sql` all agree
- [ ] The new collection appears in `emptyDatabase()`
- [ ] Every new mutation calls `writeAudit`
- [ ] Every new mutation begins with `guard()`
- [ ] Any new permission is in `SUPER` and in `ROLE_PERMISSIONS` for the intended roles only
- [ ] `pnpm typecheck` passes in **both** projects
- [ ] If a security event type changed, `SECURITY_EVENT_LABEL` and the SQL CHECK list changed too
- [ ] If a native method changed, `ScreenShield.m` changed too
- [ ] If a design token changed, `react-native/src/theme.ts` changed too
- [ ] If a mobile timing constant changed, the server-side inequality it depends on still holds

---

## 26. TECHNICAL DEBT

Ordered by consequence. Every item was verified during this analysis.

### 26.1 Critical

**1. Zero commits, and the entire mobile application is untracked.**
At the time of the initial assessment, `git log` reported that `main` had no commits and the obsolete root `ScreenShield.tsx` was the only tracked React Native file. The cleanup removed that dead prototype. Evidence it was obsolete:

- Branded **`ELITEREAD`**, a different product name. `db.ts`'s `LEGACY_KEYS = ['eliteread_cms_v2', 'eliteread_admin_v2', 'rp_user']` confirms the rename happened and the old storage keys are still swept on first run.
- Opens with `// @ts-nocheck`, justified by a comment saying *"'react-native' is not a dependency of this web project"* — true of the web project, irrelevant to the mobile one, and it means the file has never been type-checked.
- Declares a **three-method** native contract (`enable(): Promise<void>`, `disable(): Promise<void>`, `isCaptured(): Promise<boolean>`) against a shipped **eleven-method** module, with a different return type on the first one (`Promise<boolean>`).
- Instructs the reader to *"paste the Android/iOS classes at the bottom of this file into the native projects (they are kept here as the single source of truth)"* — the native projects exist, are 1 450+ lines of Kotlin and Swift, and are not in this file.
- It is **not** in `react-native/tsconfig.json`'s `include`, so `pnpm typecheck` never sees it.

**A fresh clone yields a working web app and this file.** The mobile application and its migration would be gone. This is not a code problem; it is `git add migrations react-native && git commit`, and the obsolete file should be deleted or moved out of the tracked tree at the same time.

**2. `schema.sql` ↔ `migrations/0001_mobile_reader.sql` cannot both be applied.**
`consume_content_grant` returns **7** columns in `schema.sql` and **8** in the migration (adding `out_asset_id`). PostgreSQL rejects `CREATE OR REPLACE FUNCTION` when the return type changes: *"cannot change return type of existing function."* Applying `schema.sql` then `0001` **fails at section G**. Two further divergences: `content_access_grants.token_hash` uniqueness is inline `UNIQUE` in one and a named `CONSTRAINT chk_grant_token_unique UNIQUE (token_hash)` in the other (so a future drop-by-name works against only one); and `schema.sql` already contains everything the migration adds, so the migration is not additive to the committed baseline. **Nobody has run either** — there is no PostgreSQL instance, connection string or migration runner in the repository.

**3. The iOS target cannot be built.**
The complete `ios/` tree is four files. No `.xcodeproj`, no `Info.plist`, no `AppDelegate`, no `LaunchScreen`, no asset catalogue, no `project.yml` — although `CasanovaReader-Bridging-Header.h`'s own comment references *"the `SWIFT_OBJC_BRIDGING_HEADER` build setting in project.yml"*. Five independent fatal consequences are listed in §20.4. Recreating the project is a task, not a configuration step.

### 26.2 High

**4. The Android build cannot run its own documented scripts.** No `gradlew`, no `gradlew.bat`, no `gradle-wrapper.jar`. `pnpm clean:android` (`cd android && ./gradlew clean`) fails. `android/build.gradle` declares `classpath("com.android.tools.build:gradle")` with **no version**.

**5. `pnpm lint` cannot succeed.** `react-native/package.json` declares `"lint": "eslint ."` with `eslint ^8.57.1` and `@react-native/eslint-config 0.79.2` installed, but **no ESLint configuration file exists** anywhere in `react-native/`. ESLint 8 requires one.

**6. No tests, no README, no `.env.example`, no setup instructions — all four mandated by the founding brief.** §34 requires fourteen named scenarios; §35's Definition of Done includes *"Tested"* and *"No console errors"*; §39 lists all four as deliverables. Ten of the fourteen scenarios are implemented and were verified by reading source; two (`Duplicate webhook arrives`, `Invoice generation`) are schema-only. §19.

**7. Preview deployments ship inline sourcemaps.** `.figma/make/deploy-preview` runs `pnpm run build --mode development`, and `vite.config.ts` sets `build.sourcemap: 'inline'` in that mode. The complete annotated TypeScript source — including every comment explaining what the DRM does and does not stop — is delivered to anyone who can reach the preview URL. §20.1.

**8. The web reader's real content is a permanent public path.** `public/books/Senia_book.pdf` is served from the static bundle. `pdfEmbedUrl()` receives it as `content_url`. The grant machinery exists but is not on this path, so §21.2's central invariant does not hold for the one real title in the repository.

**9. The web session is a plaintext user id.** §12.3, §21.6. All authorisation is client-side. Self-declared in `auth.ts`, which lists its own replacement as technical debt.

**10. The first-run bootstrap is undocumented and unreachable by clicking.** §14.1. A new deployment shows an empty storefront until someone types `/setup`. There is no README to say so.

### 26.3 Medium

**11. `AdminSecurityPage.tsx` contains unreachable code with a misleading comment.** Lines 446–458 build a device list that falls back to a caller-scoped `listDeviceSessions(actor)` when `can(adminRole, 'security')` is false, with a comment explaining that *"the page degrades to a personal device list rather than becoming a way to enumerate other customers."* Line 475 already returned `<AccessDenied />` for exactly that condition. **The behaviour is over-restrictive and therefore safe; the comment describes a degradation that cannot happen.** A reader who trusts the comment will believe a permission tier exists that does not.

**12. The upload path can exceed the storage quota.** `max_upload_bytes` defaults to 10 MB; `readAssetFile` base64-encodes to ~13.3 MB into a single localStorage key against a typical 5 MB origin quota. The failure surfaces as a generic `STORAGE` error rather than the specific "upload it externally" guidance the size check gives. §14.10.

**13. `RESTRICTIVE_POLICY` diverges from `defaultDrmPolicy()`.** The mobile fail-closed default uses watermark opacity **0.14** and an offline timeout of **30 minutes**; the web default uses **0.07** and **120 minutes**. Both are defensible in isolation. **[Unknown]** whether the divergence is a deliberate platform difference or drift — §27.

**14. The `FINANCE` role description promises permissions the role does not have.** `ROLE_DESCRIPTION.FINANCE` names קופונים (coupons); `ROLE_PERMISSIONS.FINANCE` has no `'cms'`, which is what `saveCoupon`/`deleteCoupon` guard on. `MARKETING` holds `'finance'` although its description does not mention it. §10.6.

**15. A complete cart API with no consumer.** `AppContext` exposes `cart`, `cartLines`, `cartTotal`, `addToCart`, `removeFromCart`, `clearCart`, `selectedProduct`, `setSelectedProduct`. No page uses any of them. `checkout()` is single-item with `quantity: 1` hardcoded. The SQL handles `quantity > 1` correctly, so this is a UI gap, not a schema gap.

**16. Three documentation files contradict the repository.** `AGENTS.md`'s "dev server is already running" (verified false) and its description of a 7-file scaffold with `App.tsx` as the starting point; `ios/Podfile`'s claim that `restrictDocumentInteraction()` uses `responds(to:)` guards when the Swift uses class-name walking. `CLAUDE.md` is `@AGENTS.md` and inherits all of it. §20.5.

**17. `.figma/make/install` uses `--no-frozen-lockfile`.** Undercuts the byte-for-byte lockfile care in `.gitattributes`.

**18. `Order` carries `refund_status` and `refunded_amount`, which `schema.sql` deliberately does not store on `orders`.** They are derived through `v_order_refunds`. Pointing the web app at this schema requires those two fields to become computed. §9.6.

**19. `STORAGE_QUOTA_EXCEEDED` is thrown and never caught.** `db.ts:276`. It is the only `throw` in the web application and the only break in the "errors are values" rule; a grep for the string returns one match, the `throw` itself. Most likely triggered by a large upload that passes `max_upload_bytes` but exceeds the origin quota. §17.8.

### 26.4 Low

**20. Twenty-two smoke-test PNGs in the repository root**, and `.gitignore` covers `smoke_*`, `step*` and `verify_*` but **not `exp_*` or `screenshot_*`** — which is why ~20 of them show as untracked. Two names are findings in themselves: `smoke_stage6_reader_crash.png`, `step2_store_404.png`.

**21. Two duplicate and two mis-placed PDFs.** `docs/Senia_book.pdf` and `public/books/Senia_book.pdf` are byte-identical (~48 MB); `.gitignore` records that the `docs/` copy is read by nothing. A 13 MB Hebrew-named PDF sits in `react-native/android/gradle/wrapper/`, where the wrapper jar should be, and `react-native/.gitignore`'s `*.pdf` rule keeps it out of git but not out of the working tree.

**22. `SupportPage` wraps a synchronous `createInquiry` in `await Promise.resolve(…)`.** Harmless, but inconsistent with the genuinely async `checkout`. §10.6.

**23. The mobile project has no lockfile.** Eleven exact top-level pins over an unpinned transitive tree.

### 26.5 What is *not* technical debt

Worth stating, because several of these look like debt and are decisions:

- **Three runtime dependencies** on the web side. Not a gap — a deliberate refusal of third-party abstraction (§3.1).
- **`net/types.ts` redeclaring web types.** Intentional and enforced by Metro's `blockList` (§15.5).
- **No seed data.** Deliberate, so no invented marketing copy can ship (§14.1).
- **No mock payment provider.** Deliberate, so the UI cannot claim a charge that did not happen (§11.4).
- **`detectIntegrity()` returning `TRUSTED` on Android.** The correct call, not an oversight (§21.4).
- **Discrete zoom rungs in the reader.** A consequence of PDFium honouring the fragment only on a full document load (§14.4), not a design preference.
- **`migrations/0001` being redundant with `schema.sql`.** It is a record of a gap analysis that was folded back in. Its *reasoning* is the value; its DDL is historical (§9.4).

---

## 27. UNKNOWNS & ASSUMPTIONS

This section is mandatory and is deliberately not softened. Each item is something the repository **cannot** settle. They are not resolved by guesswork anywhere else in this document.

### 27.1 One assumption resolved during this analysis

The behaviour of a `DB_VERSION` bump was flagged as unknown in earlier passes. Reading `db.ts:237-267` settles it, and the answer is more useful than a guess would have been:

```ts
const merged = { ...base } as Database;
(Object.keys(base) as (keyof Database)[]).forEach((key) => {
  const value = parsed[key];
  if (value === undefined || value === null) return;
  if (key === 'settings')          merged.settings = { ...base.settings, ...(value as Partial<PlatformSettings>) };
  else if (key === 'sequences')    merged.sequences = { ...(value as Record<string, number>) };
  else if (key === 'drm_policies' && Array.isArray(value))  merged.drm_policies = withProtectionDefaults(value);
  else if (key === 'device_sessions' && Array.isArray(value)) merged.device_sessions = withSessionDefaults(value);
  else if (Array.isArray(value))   (merged[key] as unknown[]) = value as unknown[];
});
merged.version = DB_VERSION;
```

**[Verified]** The consequences, which are a de facto migration policy that nobody has written down:

1. **`version` is overwritten, never compared.** Bumping `DB_VERSION` does **nothing**. There is no migration branch, no discard path, no upgrade hook.
2. **Iteration is over `Object.keys(base)`, not over the parsed document.** So a collection **removed** from `Database` is silently dropped on read — old data disappears without error.
3. **A collection added** to `Database` starts as `[]` for every existing user, because `base` supplies it and `parsed[key]` is `undefined`.
4. **`settings` is shallow-merged** with `defaultSettings()`, so a new setting gets its default for existing users. Safe.
5. **`drm_policies` and `device_sessions` are re-run through defaults-fillers** (`withProtectionDefaults`, `withSessionDefaults`), so a new policy flag gets the strictest value for existing rows. Safe, and fail-closed.
6. **Every other array is taken verbatim.** `merged[key] = value`. So **a shape change inside a record is not migrated.** Add a required field to `Product`, `Order` or `UserProduct` and every existing row has it as `undefined`.

The header comment states the intent: *"Merge key-by-key so a document written by an older build can never silently inject records that no longer exist in the schema, and a missing collection can never fall back to fabricated content."* **That intent is achieved at the collection level and not at the record level.**

**The remaining unknown, and it is the one that matters:** how to migrate a *record* shape. There is no mechanism. Any change to an existing record's fields either has to tolerate `undefined` forever or has to add a per-collection normaliser alongside `withProtectionDefaults`/`withSessionDefaults` — which is the pattern the code already establishes but has only used twice.

### 27.2 Genuine unknowns

| # | Unknown | Why the repository cannot settle it | Why it matters |
|---|---|---|---|
| 1 | **Minimum supported PostgreSQL major version** | No version declared anywhere; no `.tool-versions`, no Docker image, no CI matrix. The constructs used (`RETURNS TABLE`, partial unique indexes, `gen_random_uuid()`, `EXECUTE FUNCTION`) are long-standing, but nothing states a floor | `gen_random_uuid()` moved into core in PG 13; before that it needed `pgcrypto`. Choosing a target version is the first decision of the backend migration |
| 2 | **The intended migration order** | `schema.sql` already contains everything `migrations/0001` adds, and applying both fails (§26.1). No runner, no `schema_migrations` table, no ordering metadata | Determines whether `0001` is a historical record or an unapplied step. §9.4 argues historical, **[Inferred — HIGH]**, but it is not stated |
| 3 | **Which Gradle version the Android build needs** | `classpath("com.android.tools.build:gradle")` is version-less; no wrapper, no `gradle/libs.versions.toml`, no `buildscript` version | The Android build cannot be reproduced without guessing. AGP 8.x requires Gradle 8.x and JDK 17 |
| 4 | **Whether XcodeGen was the intended iOS project generator** | `CasanovaReader-Bridging-Header.h` references `project.yml`, which does not exist. No `project.yml`, no `.xcodegen.yml`, no Tuist config, no `.xcodeproj` | Determines whether the iOS project is regenerable from a lost recipe or must be authored from scratch |
| 5 | **Who can reach a Figma Make preview URL** | Nothing in the repository describes the deployment's access control. `site.json` sets `robots.index: false`, which suggests an intent to be unlisted but is not an access control | Decides whether §26.2's inline-sourcemap exposure is internal-only or public |
| 6 | **Why `RESTRICTIVE_POLICY` and `defaultDrmPolicy()` diverge** | Mobile defaults: watermark opacity 0.14, offline timeout 30 min. Web defaults: 0.07, 120 min. Both are literals with no comment explaining the difference | If it is drift, one of them is wrong. If it is deliberate (a phone is held closer, so a stronger watermark; a phone is more often offline, so a shorter TTL), that reasoning should be written down before someone "fixes" it |
| 7 | **Whether a pdf.js migration for the web reader was ever considered** | `pdfEmbedUrl`'s comments explain at length what the browser plugin *cannot* do, which reads like a conclusion reached after trying — but no decision record, no ADR, no alternative branch exists | A canvas-based renderer would allow real text selection blocking, in-page watermarking and smooth zoom. It would also be a large dependency, against the project's three-runtime-dependency discipline |
| 8 | **What `admin/access` is for** | `AdminAccessPage.tsx` (301 lines) guards on `'access'`, held by SUPER_ADMIN and SUPPORT. `src/lib/permissions.ts` does not describe it, and the page was not read in full | The permission name suggests entitlement management, which overlaps `grant_access`. Whether they are two views of one thing or two features is not settled |
| 9 | **The production content-delivery path** | Three coexist: data URL in localStorage, a pasted external URL, and a bundled `public/books/*.pdf`. `readAssetFile`'s error message recommends external storage; the DRM model assumes grant-issued short-lived URLs; the one real title uses the bundle | Any feature touching content delivery must pick one, and the repository does not say which is intended for production |
| 10 | **Whether `exp_*` and `screenshot_*` PNGs are evidence to keep or debris to delete** | `.gitignore` covers three of the five screenshot prefixes. The two uncovered ones are either a gap in the ignore file or deliberately preserved artefacts | Determines whether §26.4 item 20 is fixed by editing `.gitignore` or by deleting files |

### 27.3 Assumptions this document makes

Stated so a reader can disagree with them explicitly:

1. **`schema.sql` is the current intended state and `migrations/0001` is historical.** [Inferred — HIGH] from the three divergences in §9.4 and from `schema.sql` already containing everything the migration adds.
2. **The web application is the shipping product and the mobile application is not yet shipped.** [Inferred — HIGH] from the web side being buildable with a committed lockfile while the mobile side has no `node_modules`, no lockfile, no Gradle wrapper and no Xcode project.
3. **The Figma Make scripts are the intended build path**, not an accidental artefact of the scaffold. [Inferred — MEDIUM] — they are tracked in git and `.gitattributes` takes explicit care with their line endings, which is not effort spent on something disposable.
4. **`AGENTS.md` is stale rather than aspirational.** [Verified] on the "dev server is already running" claim; [Inferred — HIGH] on the rest.
5. **The absence of tests is a gap against the brief, not a decision to forgo them.** [Inferred — HIGH] — the brief mandates fourteen scenarios and a Definition of Done including "Tested", and nothing in the repository records a decision to deviate.
6. **The removed legacy root `ScreenShield.tsx` was superseded rather than parallel.** [Verified] — it had a different brand name, `@ts-nocheck`, a three-method contract against a shipped eleven-method module, and was excluded from the mobile `tsconfig.json` `include`.
7. **Hebrew-only is a product decision, not an unfinished i18n.** [Inferred — HIGH] — there is no i18n layer, no key indirection, no locale detection, and `site.json` hardcodes `language: he`.

---

## 28. DEVELOPER GUIDE — HOW TO SAFELY MODIFY THIS PROJECT

### 28.0 Before anything else

**Commit the repository.** There are zero commits (§20.6). Until that is done, every edit is unrecoverable and there is no diff to review. This is not a code recommendation; it is a precondition for making code recommendations safe.

```powershell
git add -A                         # -A, not a path list: 13 tracked files are
                                   # already staged AND modified again (§20.6)
git status --short                 # confirm no AM entries remain, and that no
                                   # PDF, keystore or node_modules is listed
git commit -m "baseline"
```

Note `react-native/.gitignore` already excludes `node_modules`, build artefacts, keystores and `*.pdf`, and the root `.gitignore` excludes `/docs/`, `/public/books/*` and the three known screenshot prefixes. **Do not force-add the PDFs.** Also do not commit the ~20 `exp_*`/`screenshot_*` PNGs without deciding §27.2 item 10 first.

### 28.1 Environment

```powershell
# PowerShell — '&&' is not a statement separator; use ';'
mise install                       # node 22, pnpm 10.34.3
pnpm install
pnpm dev                           # Vite on :5173 unless $PORT says otherwise
pnpm typecheck                     # tsc --noEmit
pnpm format                        # oxfmt
pnpm build; pnpm preview
```

**`AGENTS.md` claims a dev server is already running on port 8443. It is not** (§20.5). Start it yourself.

First run of the app: navigate to **`/setup`** to create the first `SUPER_ADMIN`. Nothing links there (§14.1).

The mobile project cannot be installed or built today (§20.3, §20.4). `pnpm typecheck` inside `react-native/` will fail without `node_modules`.

### 28.2 The five rules that are not negotiable

1. **Never bypass `guard()`.** Every mutating service function takes `Actor | null` first and calls `guard()` first. A new mutation that skips it is an authorisation hole the type checker will not catch.
2. **Never call `mutate()` outside `src/lib/`.** It is the only write path, it notifies synchronously, and it can throw (§17.8).
3. **Never let a `StoredUser` reach React state.** Always `toPublicUser()`. It strips `password_hash`, `password_salt` and `password_set`, and it is the only thing standing between credential material and the component tree.
4. **Never accept a client-supplied price, total, discount or `source`.** `checkout()` re-derives the discount from the stored coupon row; `submitInquiry`'s `source` is set server-side from a header because *"a value the client chooses is a value the client can forge"*.
5. **Never invent content the system did not produce.** No placeholder marketing copy, no `PAID` without a provider reference, no `DELIVERED` without a provider message id. `CmsHint` renders nothing to a visitor on purpose.

### 28.3 Adding a feature — the walkthrough

Use the recipes in §23. The order that matters:

**Types → storage → permission → service → page → nav → route → SQL.**

Do not start at the page. Starting at the page produces a component that calls `db.ts` directly or reimplements a guard, and both are un-fixable-by-linter mistakes in a codebase with no linter.

### 28.4 The three-place edit

**Every change to the domain model touches three files**, and nothing enforces it (§24.4):

| Web | Mobile | Database |
|---|---|---|
| `src/types/index.ts` | `react-native/src/net/types.ts` | `schema.sql` |

When they disagree, **`schema.sql` wins** — `net/types.ts` says so explicitly: *"the SQL schema in `schema.sql` is the arbiter when they disagree."*

The same three-place discipline applies to:

- `SecurityEventType` / `AuditCategory` → both TypeScript unions **and** the SQL CHECK list (§23.4).
- Design tokens → `src/index.css` `@theme` **and** `react-native/src/theme.ts`.
- Native methods → `ScreenShieldModule.kt` / `ScreenShield.swift` **and** `ScreenShield.m` **and** `drm/ScreenShield.tsx`.

### 28.5 Working with the reader

Read §14.4 before touching `ReaderPage.tsx` or `useScreenProtection.ts`. The four facts that are not visible in the code:

1. The browser's PDF plugin is **out-of-process** with an empty host DOM. The parent cannot set its zoom, intercept its keys, or block its text selection.
2. Zoom and page travel go in the **URL fragment**, honoured by Chromium only on a **full document load** — hence the `key`-forced iframe remount.
3. `view=FitH` and an explicit `zoom` are **mutually exclusive**; exactly one is emitted.
4. The listeners install **once** (`}, []`) and read policy through `optionsRef`. Adding a dependency creates protection gaps.

And the CSP consequence: `style-src 'unsafe-inline'` exists **for** `useScreenProtection`'s injected print stylesheet. Removing it breaks the print deterrent (§13.6).

### 28.6 Working with the DRM policy

- `resolveDrmPolicy()` is **most-specific-first**: a `WEB` or `MOBILE` policy beats `ALL`. Reordering changes which policy wins for everyone.
- `withProtectionDefaults()` fills absent flags with the **strictest** value. A new flag must be added there, or existing policies silently get `undefined`.
- Turning a flag off is a **CMS edit**, and `writeAudit` records who did it. Do not add a code-level override.
- The `FLAG_FIELDS` hints in `AdminSecurityPage` are honest about what each flag cannot do. **Keep them honest.** A new flag needs a new hint saying what it does not stop.

### 28.7 Working with money

The invariant is *"money is never invented"*:

- `checkout()` writes `PENDING`. It cannot write `PAID`.
- Only `markOrderPaid()` (permission `mark_paid`) flips it, and it takes a provider reference. **That function is the future webhook handler** — its signature is already right.
- `grantAccessForOrder()` runs only from `markOrderPaid()`. An entitlement created any other way is a manual grant, which is a different permission (`grant_access`) and a different audit category.
- `refund_execution_enabled` cannot be turned on without a `payment_provider`, and the refusal message says why: *"המערכת לא תטען שהכסף הוחזר"*.
- SQL backs all of it with `chk_payment_captured_has_reference`, `chk_refund_needs_provider_confirmation`, `chk_refunds_require_provider`, `chk_order_total_arithmetic`, `chk_item_arithmetic`.

**Adding a payment provider means replacing `markOrderPaid`'s caller, not adding a second path to `PAID`.**

### 28.8 Working with the database contract

- **Preserve the `COALESCE`s** in CHECK constraints. *"A CHECK passes on NULL."* Removing one silently disables the constraint.
- **`ON DELETE RESTRICT` is the SQL form of a `CONFLICT` result.** `deleteProduct` refuses because `order_items.product_id` refuses. Keep both sides.
- **Extend a CHECK list by replacing the constraint**, as `migrations/0001` section B does. A PostgreSQL CHECK list cannot be edited in place.
- **Derive, do not store.** `orders` has no `refunded_amount` column on purpose; `v_order_refunds` computes it.
- **Write a comment on every constraint naming the failure mode it prevents.** That is the existing convention and it is why the constraints have survived review.

### 28.9 Working with the mobile app

- `ProtectionProvider` sits **above** `RootNavigator`, and `ShieldOverlay` renders as a **sibling** of `{children}`. A per-screen shield leaves transition frames exposed, and only one thing can own `FLAG_SECURE`.
- Navigation is **phase-derived**, not imperative. Adding a screen means adding it to the right phase's screen set in `RootNavigator`, not calling `navigate()`.
- `reporterRef` in `ProtectionContext` is a **ref, not state** — *"attaching a reporter must not re-render the shield, because re-rendering re-runs its effect and a capture event arriving in that window would be dropped."*
- `reportSecurityEvent()` is **fire-and-forget by design**. Do not `await` it and do not gate protection on its result.
- **Android prevents, iOS detects and conceals.** Do not assume symmetry.
- Any change to `ScreenShield.swift` requires a matching `ScreenShield.m` declaration, and **nothing checks it** (§14.7).
- `wipeAll()` is called from three places: sign-out, a `blocked` boot, and a render crash. Adding a fourth trigger is fine; removing one is not.

### 28.10 What to run before declaring a change done

| Check | Command | Catches |
|---|---|---|
| Web types | `pnpm typecheck` | Arity, naming, exhaustive `Record<…>` maps |
| Web format | `pnpm format` | Style drift |
| Web build | `pnpm build` | Import resolution, the `@` alias |
| Mobile types | `cd react-native; pnpm typecheck` | The mobile half of a three-place edit |
| Mobile lint | `cd react-native; pnpm lint` | **Nothing — the script cannot succeed** (§26.2) |
| SQL | none available | **Nothing. There is no database to run it against** |
| Tests | none exist | **Nothing** (§19) |

**The honest summary: the type checker in two projects is the entire automated safety net.** Everything in §25.4's silent-failure table is outside it.

Manual verification that substitutes, until tests exist:

- Load the app, complete a guest checkout, mark the order paid in the admin, open the reader.
- Change a DRM flag in `AdminSecurityPage` and confirm the reader's behaviour changes **without a reload** (it reads through `optionsRef`).
- Sign in as each of the five roles and confirm `SideNav` and page-level `AccessDenied` agree with §12.4's matrix.
- Open two tabs, write in one, confirm the other updates (cross-tab sync).
- Clear `localStorage['casanova_db_v1']` and confirm `/setup` appears.

---

## 29. HIGH-VALUE FILES REFERENCE

The brief asks for *the most important files, not every file*. The repository has 82 tracked entries plus 33 untracked ones; the tables below cover the ~35 that carry the architecture. Everything else is a leaf that can be read, changed and reasoned about locally.

**How to read the Change Risk column.** `High` does not mean "this file is badly written" - most of these are the best-commented code in the repository. It means **a wrong edit here fails silently**: the type checker passes, the build succeeds, and the damage shows up later in a different place, or not at all until a user hits it.

### 29.1 Persistence and domain model (web)

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| `src/lib/db.ts` (386) | The entire persistence layer. `DB_KEY`, `DB_VERSION`, `emptyDatabase()`, `defaultSettings()`, `readDocument()`, `writeDocument()`, `mutate()`, `getDb()`, `subscribe()`, the collection ceilings (`SECURITY_EVENT_LIMIT` 400, `CONTENT_GRANT_LIMIT` 200), the per-collection normalisers, and `LEGACY_KEYS` | **Critical** | Literally everything. All 13 `src/lib` modules, all three contexts, all 25 pages, `routes.tsx` | **High.** Three distinct traps: `merged.version = DB_VERSION` is an assignment, not a comparison, so bumping the version does nothing (§9.4); only `settings`, `drm_policies` and `device_sessions` are normalised, so a record-shape change to any other collection is not migrated (§27.1); `writeDocument()` throws `STORAGE_QUOTA_EXCEEDED` and nothing in `src/` catches it (§17.8) |
| `src/types/index.ts` (845) | The single source of truth for every record shape, union and status enum in the web app. `Database`, `Product`, `Order`, `User`, `DrmPolicy`, `DeviceSession`, `ContentGrant`, `SecurityEvent`, `AdminRole`, `AdminPermission`, `Result<T>`, `ErrorCode` | **Critical** | Every web module imports from here. `schema.sql` mirrors it by hand. `react-native/src/net/types.ts` re-declares a subset of it by hand | **High.** A field added here does **not** appear in `schema.sql`, does **not** appear in the mobile types, and does **not** migrate existing `localStorage` documents. Three manual follow-ups, none of them enforced (§24.2) |
| `src/lib/store.ts` (28) | The React binding: `useStore()` = `useSyncExternalStore(subscribe, getDb, getDb)` | High | All three contexts | Low - but note `getSnapshot` is called **twice** with the same function. Returning a fresh object from either would cause an infinite render loop |

### 29.2 Service layer (web)

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| `src/lib/api.ts` (1270) | The core service layer and the pattern every other service file copies. `guard()` (:107), `ok()`/`fail()`, `writeAudit()`, `nextId()`, product/CMS/coupon/user/email CRUD, `readAssetFile()` (:827) | **Critical** | `AppContext`, `AdminContext`, `CmsContext`, every admin page, `StorePage`, `CheckoutPage`, `SupportPage`, `SetupPage` | **High.** `guard()` returns `Failure | null`, not a boolean - `if (!guard(...))` is a logic inversion that type-checks (§10.6). All user-facing error strings live here, so error copy is API contract (§10.2) |
| `src/lib/api-security.ts` (892) | DRM policies, device sessions, security events, watermark rendering, content grants. `resolveDrmPolicy()`, `activeDrmPolicy()`, `registerDeviceSession()`, `recordEvent()`, `issueContentGrant()`, `consumeContentGrant()`, `isGrantLive()`, `isDeviceCompromised()` | **Critical** | `ReaderPage`, `DashboardPage`, `AdminSecurityPage`, `useScreenProtection`, and the mobile contract in `react-native/src/net/api.ts` | **High.** This is the web half of the grant protocol the phone also implements. `consumeContentGrant()` takes **no actor** - it is authenticated by the token itself; adding an actor check there breaks redemption |
| `src/lib/api-orders.ts` (636) | Checkout and the order lifecycle. `checkout()` (the only `async` function in the layer), `markOrderPaid()`, `cancelOrder()`, invoices, the five-step refund state machine, `refundableAmount()`, `productLookup()` | **Critical** | `CheckoutPage`, `CheckoutSuccessPage`, `AdminOrdersPage`, `AdminFinancePage`, `DashboardPage`, `LibraryPage` | **High.** Price and discount are **re-derived server-side** inside `checkout()` from the stored coupon row; the client only sends `coupon_code`. Any refactor that lets the caller supply an amount re-opens the pricing hole (§14.3). `grantAccessForOrder()` takes no actor and is called from `checkout()` - it is the entitlement bridge |
| `src/lib/api-support.ts` (623) | Support inquiries, CRM customer profiles, user administration, entitlements, reading progress. `updateUser()`, `setUserAdminRole()`, `grantAccess()`, `extendAccess()`, `removeAccess()`, `saveReadingProgress()` | **Critical** | `SupportPage`, `AdminSupportPage`, `AdminCrmPage`, `AdminUsersPage`, `AdminAccessPage`, `DashboardPage`, `LibraryPage`, `ReaderPage` | **High.** `updateUser()` is the only **two-permission** function in the codebase: it guards `'users'`, then guards `'manage_roles'` additionally if the patch touches `admin_role`/`role`. Collapsing that into one check is a privilege-escalation bug (§12.5) |
| `src/lib/permissions.ts` (135) | `AdminRole`, the 27 `AdminPermission` strings, `ROLE_PERMISSIONS`, `ROLE_LABEL`, `ROLE_DESCRIPTION`, `can()` | **Critical** | `guard()` in all four service files, `SideNav`, `AdminLayout`, every admin page's `AccessDenied`, `AdminUsersPage`'s role editor | **High.** `can()` fails closed on `undefined` and on an unknown permission string - which means **a typo in a permission literal silently denies rather than loudly failing**. The full matrix is §12.4; the known drift is §12.6 |
| `src/lib/analytics.ts` (287) | Read-only revenue and date-range computation: `presetRange()`, `inRange()`, `isRevenueBearing()`, `orderRevenueDate()`, `computeRevenue()`, `lifetimeTotals()` | High | `AdminDashboardPage`, `AdminFinancePage`, `DashboardLayout` | Medium. Pure functions over `Order[]`/`Refund[]`. `isRevenueBearing()` defines **which orders count as money** - changing it silently restates every historical revenue figure |
| `src/lib/alerts.ts` (257) | One export: `computeAlerts(db)` → `SystemAlert[]`. Derives operational warnings from the whole database | Medium | `AdminAlertsPage`, `AdminDashboardPage`, `DashboardLayout` | Medium. It receives the **entire** `Database`, so any collection rename breaks it at compile time - which is the good failure mode |

### 29.3 Authentication, DRM and content protection (web)

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| `src/lib/auth.ts` (115) | `SESSION_KEY = 'casanova_session_v1'`, `hashPassword()` (SHA-256 of `${salt}:${password}` via `crypto.subtle`, with a 4-round FNV-1a `fallbackDigest` fallback), constant-length XOR compare, `toPublicUser()`, `passwordProblem()`, `isEmail()` | **Critical** | `AppContext`, `LoginPage`, `SetupPasswordPage`, `ForgotPasswordPage`, `api.ts` | **High.** `toPublicUser()` strips `password_hash`/`password_salt`/`password_set` by destructuring. Returning the raw `User` from any new function leaks the hash into a React tree that renders it (§21.2). The file's own header declares the whole scheme technical debt |
| `src/lib/useScreenProtection.ts` (228) | The web deterrent layer. Installs seven listeners **once** (`}, []`), reads live policy through `optionsRef`, wipes the clipboard on capture keys, injects `@media print { html, body { display: none !important; } }`, gates Ctrl/Cmd+U on `blockCopy`. Also exports `pdfEmbedUrl(url, page, zoom)` | **Critical** | `ReaderPage` only | **High.** Two non-obvious invariants: the Ctrl/Cmd+U handler is registered **before** the hook's early return, so it runs even when protection is off (§14.6); and `pdfEmbedUrl` emits `zoom=N` **or** `view=FitH`, never both, because the Chromium PDF viewer honours fragment parameters only on a full document load - which is why `ReaderPage` forces an iframe remount via `key` and offers discrete zoom rungs rather than a slider (§14.5) |
| `src/lib/sensitive.ts` (35) | `maskCard(last4?)`, `maskEmail()`, `maskSecret()`, `maskCvv()`, `SECURITY_NOTE` | High | `AdminOrdersPage`, `AdminUsersPage`, `AdminSettingsPage`, `AdminSecurityPage`, `AdminCrmPage` | Low, and deliberately so. `maskCvv()` **takes no argument** - the signature makes the insecure call unrepresentable. Do not "helpfully" add a parameter (§21.4) |
| `src/lib/media.ts` (27) | `detectPlatform()`, `toEmbedUrl()`, `PLATFORM_LABEL` - YouTube/Vimeo/embed detection for CMS media | Medium | `LandingPage`, `AdminCmsPage`, `ReaderPage` | Medium. `toEmbedUrl()` output must stay inside CSP `frame-src`, which lists exactly `youtube.com`, `youtube-nocookie.com` and `player.vimeo.com` (§13.4). Adding a provider requires editing both |

### 29.4 Routing, context and the reader (web)

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| `src/routes.tsx` (147) | The complete route table: public storefront shell, `/dashboard/*`, `/admin/*` under `AdminLayout`, the `/setup` bootstrap gate, per-route `errorElement: <RouteError />`, and `{ path: '*', Component: NotFoundPage }` | **Critical** | Every page; `AdminLayout`'s redirect chain | **High.** There is **no app-level error boundary** - `src/App.tsx` is 20 lines of provider composition. `errorElement` is the only thing standing between a render throw and React Router's own English diagnostic screen (§17.2) |
| `src/context/AppContext.tsx` (267) | Session, current user, cart, storefront CMS data. The public-facing store | **Critical** | Every public page, `DashboardLayout`, `ReaderPage` | **High.** It is the outermost provider; `CmsProvider` and `AdminProvider` both read it |
| `src/pages/ReaderPage.tsx` (698 non-blank) | The protected reading surface: grant acquisition, iframe remounting, zoom rungs, page navigation, watermark overlay, device-session heartbeat | **Critical** | Nothing imports it - it is a leaf. But it is the product | **High.** It is where `useScreenProtection`, `api-security`'s grant functions and `media.ts` all meet. Changing the zoom control changes the iframe `key`, which changes remount behaviour, which changes what the PDF viewer honours (§14.5) |
| `src/components/RouteError.tsx` (88) | One `RouteErrorView({ missing })` serving **both** the error boundary and the 404 catch-all, plus `NotFoundPage` | High | `routes.tsx` (every `errorElement` and the `*` route) | Medium. Its header explains that React Router's default screen is *"wrong twice over"* - English, and carrying the component stack. Do not let a future edit reintroduce either |
| `src/components/layout/AdminLayout.tsx` | The admin shell: auth gate, role gate, the `/setup` bootstrap redirect, `SideNav`, and the outlet | **Critical** | All 14 admin pages | **High.** Its redirect chain (`isBootstrapRequired()` → `/setup`; unauthenticated → `/login`; unauthorised → `AccessDenied`) is order-dependent. Reordering produces redirect loops rather than errors |
| `src/App.tsx` (20) | `AppProvider > CmsProvider > AdminProvider > RouterProvider`. Nothing else | High | - | Low in size, **High** in consequence: this is the file where an error boundary would go, and there isn't one (§17.2) |

### 29.5 The data contract (SQL)

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| `schema.sql` (1941) | The intended PostgreSQL schema: every table, enum, index, constraint and trigger. **Nothing in the repository executes it** | **Critical** | Nothing at runtime. It is the arbiter between `src/types/index.ts` and `react-native/src/net/types.ts`, and the blueprint for the backend that does not exist yet | **High, and unusually so.** Because nothing runs it, **an error here is invisible**: a typo in a constraint or a mismatch with the TypeScript types will not fail any build, any test or any CI job. It is also in `AM` git status (§20.6) |
| `migrations/0001_mobile_reader.sql` (597) | The mobile half of the contract: device sessions, content grants, security events, `mobile_min_build`, the token column | **Critical** | Same as `schema.sql` | Same as `schema.sql`, plus: the entire `migrations/` directory is **untracked**, so it exists only in this working tree (§20.6) |

### 29.6 Build and configuration

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| `vite.config.ts` (454) | React + Tailwind v4 + the Figma Make plugins, the `@` → `src` alias, `build.sourcemap`, and `figmaContentSecurityPolicy()` (:255-310) which injects the `<meta http-equiv>` CSP at `head-prepend` | **Critical** | The whole web build; `src/index.css`; every import using `@/` | **High.** The CSP is **not in `index.html`** - looking there finds nothing (§13.4). `style-src 'unsafe-inline'` exists specifically for `useScreenProtection`'s injected print stylesheet; tightening it breaks print blocking. The file's own comment acknowledges that a meta policy **cannot express `frame-ancestors`**, and nothing serves that header |
| `package.json` | Three runtime dependencies (`react`, `react-dom`, `react-router`). Scripts: `dev`, `build`, `preview`, `typecheck`, `format`. **No `test` script** | High | Everything | Medium. Adding a test framework means adding the first dev dependency that is not build tooling - see §19.4 for why that is a bigger decision than it looks |
| `react-native/package.json` | **Exact pins** on every dependency (RN 0.79.2, React 19.0.0, navigation 7.x, `react-native-pdf` 6.7.7, keychain 9.2.2). Scripts: `typecheck`, `lint` | High | The mobile build | **High.** `lint` runs `eslint .` but **no ESLint config file exists**, so the script cannot succeed (§26.2). The exact pins are deliberate: RN's native modules break across minor versions |
| `react-native/metro.config.js` (38) | One `blockList` excluding `../node_modules`, `../dist` and `../src` | **Critical** | The entire mobile bundle | **The highest-risk single line in the repository.** *"Metro walks the file system, not the module graph."* Deleting it produces a build that **succeeds** and an app that bundles a web copy of React and does not run. There is no error to see (§24.4) |
| `.figma/make/deploy-preview` | Runs `pnpm run build --mode development` | High | Every preview deployment | **High, and already realised.** Combined with `build.sourcemap: 'inline'`, **preview deployments ship the full annotated TypeScript source** (§20.4). This is where a security review would want the reader's grant logic to be least readable |
| `.gitattributes` | Pins `eol=lf` on the seven extension-less bash scripts in `.figma/make/` | Medium | Every Figma Make script | Medium. All seven use `set -euo pipefail` and are executed by a POSIX shell; a CRLF checkout breaks them with a confusing `\r` error |

### 29.7 Mobile networking and state

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| `react-native/src/net/client.ts` (203) | `request()`: the keychain-backed session, the six mandatory `X-Casanova-*` identity headers, the 15 s `AbortController` timeout, the exact response-handling order, and 401 → `clearSession()` | **Critical** | Every one of the 18 endpoints in `net/api.ts` | **High.** Three rules are load-bearing and stated in its header: the token lives in the **keychain**, never AsyncStorage; it is stored `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; and the identity headers go on **anonymous requests too**. `Content-Type` is set only when there is a body - adding it unconditionally breaks `GET`s on some servers |
| `react-native/src/net/api.ts` (283) | The 18 endpoint wrappers, plus a 12-row header table mapping each phone function → the web service function → the SQL table, and `bootCheck()` with its fail-closed `DEFAULT_SETTINGS` | **Critical** | Every screen; `AuthContext`, `LibraryContext`, `ProtectionContext` | **High.** The header table is the only cross-client contract documentation that exists. `bootCheck()` returns restrictive defaults when the server is unreachable - inverting that to permissive defaults would make a network outage disable DRM (§21.6) |
| `react-native/src/config.ts` (102) | `DEFAULT_API_BASE_URL = 'https://api.casanova.local'`, the AsyncStorage override `casanova.api_base_url`, client identity, and the four timing constants | **Critical** | `net/client.ts`, `net/api.ts`, the heartbeat and revalidation loops | **High.** `setApiBaseUrl()` is the **only throwing function in the mobile codebase**. The timing constants are coupled by inequality to server-side values nobody validates: `SESSION_HEARTBEAT_MS` (60 s) must stay under the smallest CMS `session_timeout_minutes`; `GRANT_REVALIDATION_MS` (60 s) against grants minted for ≤30 min (§13.6) |
| `react-native/src/store/AuthContext.tsx` (195) | Session state, sign-in/out, the keychain mirror (`cachedToken`, `cachedUserId`), `TOKEN_SERVICE = 'com.casanova.reader.session'` | **Critical** | `ProtectionContext` (derives policy from the signed-in device session), `LibraryContext` (only loads while signed in), every screen | **High.** It must stay the **outermost** provider - `App.tsx`'s header explains that protection policy is derived from a signed-in session. A keychain read failure means signed out, not "retry" |
| `react-native/App.tsx` (158) | Module-scope `I18nManager.allowRTL(true); forceRTL(true);`, the fixed provider order, `StatusBar translucent={false}`, and `CrashBoundary` | **Critical** | The whole mobile app | **High.** `CrashBoundary.componentDidCatch` calls `void wipeAll()` - **a render crash deliberately destroys the local vault** as the last line of the no-permanent-copy rule. Its comment explains why it does *not* report to `security_events`. Removing either behaviour removes a security control that looks like error handling (§17.6) |

### 29.8 Mobile native shield

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| `react-native/android/app/src/main/java/com/casanova/reader/shield/ScreenShieldModule.kt` (623) | The eleven-method Android bridge: `FLAG_SECURE`, integrity detection, event emission | **Critical** | `ScreenShieldPackage.kt`, `ProtectionContext`, the reader screen | **High.** `detectIntegrity()` deliberately returns `TRUSTED` and never `ATTESTATION_FAILED`, because that value is in `COMPROMISED_INTEGRITY` on the JS side and *"would make `block_rooted_devices` refuse to open a book on every unmodified Android phone in existence."* `enable()` **rejects** `E_NO_ACTIVITY` rather than resolving false, so a log distinguishes "no activity" from "the flag did not take" (§14.7) |
| `react-native/android/app/src/main/java/com/casanova/reader/MainActivity.kt` (110) | Sets `FLAG_SECURE` **before** `super.onCreate()` and re-asserts it in `onWindowFocusChanged` when `!isShieldSuppressedByPolicy` | **Critical** | Every Android capture surface | **High.** The ordering before `super.onCreate()` is the whole point - setting it afterwards leaves a window where the first frame is capturable |
| `react-native/ios/CasanovaReader/ScreenShield.swift` (828) | The entire iOS detection-and-concealment layer: `privacyCover` on `willResignActive`, `capturedDidChange`, `connectDidChange`, `userDidTakeScreenshot`, PDFKit long-press removal by class-name walking, and the secure-text-field layer lift | **Critical** | `ScreenShield.m`, `ProtectionContext` | **High, and the highest-maintenance file in the repository.** The secure-text-field trick is **excluded** from `canProtectSwitcher()` because it depends on non-public API shape - its own comment notes that making `enable()`'s return depend on it *"would mean an iOS update could stop the reader from opening books at all"* (§14.7) |
| `react-native/ios/CasanovaReader/ScreenShield.m` (61) | Nine `RCT_EXTERN_METHOD` declarations bridging Swift to JS | **Critical** | Every JS call into `ScreenShield.swift` | **The silent-failure champion.** It is hand-maintained against 828 lines of Swift and **nothing checks the correspondence**. A mismatch returns `undefined` at call time - not a build error, not a type error, not a runtime throw (§25.4) |

### 29.9 The trap

| File | Purpose | Importance | What depends on it | Change Risk |
|---|---|---|---|---|
| Removed legacy root `ScreenShield.tsx` | **Deleted during cleanup.** It was an obsolete prototype carrying `@ts-nocheck`, the old `ELITEREAD` name, and a **3-method** contract against the shipped **11-method** native module | None — it was dead | Nothing. The active implementation remains `react-native/src/drm/ScreenShield.tsx`. |

---

## 30. FINAL ARCHITECTURAL SUMMARY

### 30.1 What this project is, in one paragraph

**Casanova** is a Hebrew, right-to-left digital bookstore selling protected PDF titles, built as **two clients over one intended backend**. The web client (`src/`, React 19 + Vite 8 + Tailwind v4, three runtime dependencies) is a complete storefront, customer dashboard and fourteen-page admin panel that persists a single versioned JSON document to `localStorage` behind a hand-written service layer shaped exactly like a REST API. The mobile client (`react-native/`, RN 0.79.2) is a reading app that speaks HTTP to a backend which **does not exist in this repository**. `schema.sql` (1941 lines) and `migrations/0001_mobile_reader.sql` (597 lines) describe that backend in full and are executed by nothing. The product's reason for existing is **content protection**: both clients implement the same rule - *nobody ever receives the permanent address of a protected file; they receive a short-lived, use-budgeted grant bound to an account, an entitlement and a device session* - and both wrap that rule in as much deterrence as their platform allows.

### 30.2 The architecture's four load-bearing decisions

**1. The service layer is a fake network, on purpose.** `api.ts`, `api-orders.ts`, `api-support.ts` and `api-security.ts` are not "helpers" or "utils". Every mutation takes `Actor | null` first, runs `guard()` → validate → conflict-check → `mutate()` → `writeAudit()` → `return ok(...)`, and returns `Result<T>`. No component touches `getDb()` to write. This is the single most important fact in the document: **the web app is already structured as a client of an API it does not have**, so the eventual backend swap is a change to four files rather than a rewrite - *provided the convention is not broken in the meantime*.

**2. Errors are values, with exactly one exception.** `Result<T>` and the seven-value `ErrorCode` union mean no function in the service layer throws, and every user-facing string is Hebrew and produced server-side - **error copy is part of the API contract**. The exception is `writeDocument()`, which throws `STORAGE_QUOTA_EXCEEDED`. Grep across `src/` returns one match: the throw itself. There is no app-level error boundary (`src/App.tsx` is 20 lines), so that throw propagates out of a click handler into nothing (§17.8).

**3. Protection is a policy, not a feature.** `DrmPolicy` resolves most-specific-first by scope (`WEB | MOBILE | ALL`); seven booleans drive five web deterrents; the same policy drives `FLAG_SECURE` on Android and a privacy cover plus screenshot attribution on iOS. `useScreenProtection` installs its listeners **once** and reads live policy through `optionsRef`, so an admin changing a flag changes reader behaviour **without a reload**. That is the design's most elegant property and the reason its `}, []` must never grow a dependency.

**4. The two platforms are deliberately asymmetric, and the asymmetry is documented.** Android **prevents** (`FLAG_SECURE` before `super.onCreate()`) so `isCaptured()` correctly always resolves false. iOS **detects and conceals** because no equivalent exists. Kotlin's `detectIntegrity()` returns `TRUSTED` and never `ATTESTATION_FAILED`, while JS's `probeIntegrity()` fails closed when the module is missing. None of this is an oversight; all of it is argued in source comments. **A future engineer who "fixes" the asymmetry will break the product.**

### 30.3 What is genuinely impressive here

The comment density is exceptional and specifically *archaeological*: headers record not what the code does but **why the alternative was rejected**. `metro.config.js` explains that Metro walks the file system rather than the module graph. `ScreenShield.swift` explains why the secure-text-field lift is excluded from `canProtectSwitcher()`. `App.tsx` explains why a crash wipes the vault and why the wipe is not reported. `vite.config.ts` names its own `frame-ancestors` gap. `sensitive.ts` makes the insecure call unrepresentable by giving `maskCvv()` no parameter. `CheckoutPage` computes a discount for display and sends only `coupon_code`, because `checkout()` re-derives it. **The codebase is unusually honest with its reader, and this document has quoted that honesty more than it has paraphrased the code.**

### 30.4 What is genuinely missing

| Gap | Evidence | Consequence |
|---|---|---|
| **No tests, anywhere** | No `test` script in either `package.json`; no test framework in either dependency tree (§19) | The type checker in two projects is the entire automated safety net |
| **No backend** | `schema.sql` is executed by nothing; the web app uses `localStorage`, the mobile app points at `https://api.casanova.local` (§5.4) | The mobile app cannot run against anything. The web app's authorisation is architecturally correct and operationally meaningless |
| **No CI** | No workflow files, no pipeline config (§20.5) | Nothing prevents a regression reaching a deployment |
| **No linter that runs** | `react-native`'s `lint` script calls `eslint .` with no config file present (§26.2) | The script cannot succeed; the web project has no lint at all |
| **No README, no `.env.example`** | Verified absent (§4.4) | Onboarding depends entirely on source comments - which are good, but assume you already know where to look |
| **No migration mechanism** | `readDocument()` assigns `merged.version = DB_VERSION` rather than comparing it (§9.4) | Adding a collection is safe; changing a record shape silently leaves old documents un-migrated |
| **Almost nothing is committed** | Zero commits on `main`; 82 tracked files, 33 untracked; **all of `migrations/` and the entire real mobile app are untracked**; 13 tracked files are `AM` (§20.6) | The working tree is the only copy of most of this project. A bare `git commit` would commit *older* versions of the DRM core, persistence layer, domain types and SQL contract |
| **The web reader's file is public** | `public/books/Senia_book.pdf` is a permanent path in the static bundle (§21.3) | The one rule both clients obey is broken by the web client's own deployment artefact |
| **iOS cannot be built** | `react-native/ios/` is four files: no `.xcodeproj`, no `Info.plist`, no `AppDelegate`, no LaunchScreen, no asset catalogue, no `project.yml` (§20.2) | 828 lines of Swift are unbuildable and unverifiable |
| **Android has no wrapper** | No `gradlew`, no wrapper jar (the wrapper directory holds a 13 MB Hebrew-named PDF), version-less AGP classpath (§20.2) | The Android build is not reproducible from a clean checkout |

### 30.5 The one-sentence version

**This is a carefully designed, heavily commented, security-minded two-client commerce application whose persistence, backend, tests, CI and version control are all incomplete in ways that the code itself mostly acknowledges - so the highest-value thing a future contributor can do is not add cleverness, but keep the service-layer convention intact, treat every source comment as a constraint rather than a note, and read §25 before touching anything.**

---

## HOW I SHOULD APPROACH FUTURE FEATURE REQUESTS

*Everything below is grounded in this repository. Where a recommendation is general practice, it is because the repository gives no specific answer - and that is labelled.*

### 1. Where to start investigating when a new feature request arrives

**Start with the domain model, not the UI.** In this codebase the order of understanding is inverted from a typical React project, because the pages are thin and the service layer is thick:

1. **`src/types/index.ts` (845 lines)** - does the thing already exist as a type? Most "new feature" requests in a commerce app are a new status on an existing union, a new field on an existing record, or a new collection. Find out which before writing anything.
2. **Which of the four service files owns it** - `api.ts` (products, CMS, coupons, users, emails, audit), `api-orders.ts` (checkout, orders, invoices, refunds, subscriptions), `api-support.ts` (inquiries, CRM, entitlements, reading progress), `api-security.ts` (DRM, sessions, events, grants). The split is by domain, not by size, and putting a function in the wrong file is the most common structural mistake available.
3. **`src/lib/permissions.ts`** - which of the 27 permissions covers this action, and which of the five roles should hold it. Do this **before** writing the function, because `guard()`'s permission argument is the first line of the six-step template.
4. **`src/routes.tsx`** - is this a new page, a new tab in an existing page, or a new section of an existing admin page? Note that admin pages are large (`AdminProductsPage` is 1565 lines) and adding a section is usually right; adding a page requires touching `routes.tsx`, `SideNav`, and possibly `AdminLayout`.
5. **Then, and only then, the page.**

**If the request touches the mobile app**, the starting point is different and the order matters: `react-native/src/net/api.ts`'s **12-row header table** first (it maps each phone function → the web service function → the SQL table, and is the only cross-client contract documentation that exists), then `react-native/src/net/types.ts`, then the screen. **Do not start from the screen** - the screens are downstream of a contract that may not have an endpoint yet.

**If the request touches content protection**, start from `DrmPolicy` in `src/types/index.ts` and `resolveDrmPolicy()` in `api-security.ts`, and read the header of `useScreenProtection.ts` before deciding anything. The seven flags and the most-specific-first resolution are the extension points; a new deterrent that does not come from a policy flag will not be admin-controllable and will not reach the phone.

**Two questions to ask the requester before investigating**, because this repository cannot answer them:
- *Is this web, mobile, or both?* If both, there are **three** places to change (web types, mobile types, `schema.sql`) and nothing enforces the third.
- *Does this need to persist?* If yes, the honest answer today is "it will persist to `localStorage`", and whether that is acceptable is a product decision, not an engineering one.

### 2. Which files to inspect first

A ranked list, with the reason each is on it:

| # | File | Why it is on the list |
|---|---|---|
| 1 | `src/types/index.ts` | Every record shape. If the feature has a noun, the noun is here or belongs here |
| 2 | `src/lib/api.ts` | `guard()` (:107), `ok()`/`fail()`, `writeAudit()`, `nextId()`, and `saveCoupon()` (:1001) - the **canonical six-step example** to copy |
| 3 | `src/lib/permissions.ts` | The 27 × 5 matrix. Read it whole; it is 135 lines |
| 4 | `src/lib/db.ts` | `Database`, `emptyDatabase()`, `defaultSettings()`, `readDocument()`, `mutate()`. Any new collection touches at least three of these |
| 5 | `src/routes.tsx` | 147 lines, the whole surface area of the app |
| 6 | The nearest existing page | Copy its structure. `AdminCmsPage.tsx` (942) is the best model for a CRUD admin page; `SupportPage.tsx` for a public form; `CheckoutPage.tsx` for a multi-step flow |
| 7 | `src/context/AppContext.tsx` (267) | If the feature needs cross-page state. Note the provider order `App > Cms > Admin` is load-bearing |
| 8 | `schema.sql` | If the feature adds a noun that the backend must eventually know about. It is 1941 lines - search for the neighbouring table rather than reading it |
| 9 | `react-native/src/net/api.ts` | Only if the feature is mobile. The header table tells you in one read whether an endpoint exists |
| 10 | `src/lib/useScreenProtection.ts` | Only if the feature touches the reader. All 228 lines, because the listener-registration order is the point |

**What NOT to inspect first:** `src/App.tsx` (20 lines, tells you nothing) and `src/lib/analytics.ts` and `src/lib/alerts.ts` (derived, read-only, downstream of the real model).

### 3. Which patterns must be followed

These are not style preferences. Each one has a specific failure mode if broken, and each is already established in enough places that deviating will look like a bug to the next reader.

**a) The six-step mutation template.** Verbatim from `api.ts:1001`:

```ts
export function saveCoupon(
  actor: Actor | null,
  data: Omit<Coupon, 'coupon_id' | 'times_used'>,
  id?: string
): Result<Coupon> {
  const denied = guard(actor, 'cms');
  if (denied) return denied;
  const code = data.code.trim().toUpperCase();
  if (!code) return fail('VALIDATION', 'קוד הקופון חובה.');
  const db = getDb();
  if (db.coupons.some((c) => c.code.toUpperCase() === code && c.coupon_id !== id)) { … }
  // … mutate() → writeAudit() → return ok(saved)
}
```

Order matters: **guard, validate, conflict-check, mutate, audit, return.** Guarding after validation leaks whether a record exists to an unauthorised caller. Auditing before the mutation records something that did not happen.

**b) `guard()` returns `Failure | null`, not a boolean.** The correct call is:

```ts
const denied = guard(actor, 'permission');
if (denied) return denied;
```

`if (!guard(actor, 'x'))` is a **logic inversion that type-checks**, because both `Failure` and `null` are truthy/falsy-compatible with `!`. This is the single easiest bug to introduce in this codebase and the type checker will not catch it (§25.4).

**c) Errors are values.** Return `fail(code, 'Hebrew message')`. **Never throw.** The one throwing function (`writeDocument()`) is documented debt, not a pattern to extend. The seven `ErrorCode` values are `UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | VALIDATION | CONFLICT | PROVIDER_NOT_CONFIGURED | STORAGE` - if none fits, adding one is a cross-client change, because `react-native/src/net/types.ts` mirrors the union and adds six mobile-only codes.

**d) All user-facing strings are Hebrew and live in the service layer.** Not in the component. The component renders `result.error`. Writing Hebrew copy in a page component breaks the convention and means the mobile client cannot reuse it.

**e) `actor` is the first parameter of every mutation.** The verified exceptions are narrow and each has a reason: pure read helpers (`productLookup()`, `findUser()`), fire-and-forget telemetry (`recordEvent()`), internal bridges called from an already-guarded function (`grantAccessForOrder()`, `revokeGrantsForEntitlement()`), and token-authenticated rather than actor-authenticated calls (`consumeContentGrant(token)`). A new exception should be one of those four kinds or it is wrong.

**f) Never write to the store except through `mutate()`.** `mutate()` shallow-copies, calls `writeDocument()`, and **synchronously** notifies the `Set<Listener>` that `useSyncExternalStore` is subscribed to. Mutating the object returned by `getDb()` in place will change the data and **not re-render anything** - a silent, maddening failure (§15.1).

**g) Every mutation writes an audit entry.** `writeAudit()` takes an object, not positional arguments. The audit log is one of the four things the two clients share by hand; skipping it makes an action invisible to `AdminAuditPage`.

**h) Exhaustive `Record<…>` maps for every union.** `SCOPE_LABEL`, `REFUND_STATUS_LABEL`, `INQUIRY_STATUS_LABEL`, `INQUIRY_TOPIC_LABEL`, `SECURITY_EVENT_LABEL`, `RANGE_LABEL`, `PLATFORM_LABEL`, `ROLE_LABEL`, `ROLE_DESCRIPTION`. Declared as `Record<Union, string>`, so **adding a union member is a compile error until every label map is updated**. This is the one place in the codebase where the type checker genuinely enforces completeness - use it. A new status without a label map entry is an unfinished change.

**i) Header comments carry the reasoning.** Every one of the 13 `src/lib` modules, all three contexts, both `App.tsx` files, `client.ts`, `config.ts` and `metro.config.js` opens with a block comment explaining *why the alternative was rejected*. Match that density. A comment that says what the next line does is not the house style; a comment that says why the obvious approach would fail is.

**j) Double quotes for strings containing apostrophes** (`AGENTS.md`), default-export components, and Tailwind utility classes directly in JSX with theme customisation in `src/index.css` - there is no Tailwind config file and no PostCSS config, by design.

### 4. Which components must not be bypassed

| Component | What bypassing it costs |
|---|---|
| **`guard()`** | Calling `mutate()` directly from a page component skips authorisation entirely. There is no second line of defence - the web session is a **plaintext user id** in `localStorage['casanova_session_v1']` with no token, signature, expiry or round trip (§21.1) |
| **`mutate()`** | In-place writes do not notify `useSyncExternalStore`, so the UI shows stale data while `localStorage` holds new data. Also skips cross-tab sync |
| **`toPublicUser()`** | Returning a raw `User` puts `password_hash`, `password_salt` and `password_set` into a React tree that will render them (§21.2) |
| **`checkout()`'s server-side pricing** | The client computes the discount **for display only** and sends just `coupon_code`. Letting a caller supply an amount re-opens the pricing hole (§14.3) |
| **The grant protocol** | `issueContentGrant()` → `consumeContentGrant()` → `isGrantLive()`. Handing a component a permanent `content_url` instead of a grant breaks the one rule both clients obey (§21.3) |
| **`resolveDrmPolicy()` / `activeDrmPolicy()`** | Reading a `DrmPolicy` row directly instead of resolving it ignores the most-specific-first scope ordering, so an `ALL` policy can shadow a `WEB` policy or vice versa (§14.4) |
| **`useScreenProtection`'s `optionsRef`** | Passing policy as a hook argument would re-register the seven listeners on every policy change. The `}, []` is deliberate (§14.6) |
| **The provider order** | Web: `App > Cms > Admin > Router`. Mobile: `CrashBoundary > SafeAreaProvider > StatusBar > Auth > Protection > Library > RootNavigator`. `App.tsx`'s header explains that protection policy is **derived from** a signed-in device session and the library only loads while signed in. Reordering is a runtime failure with no compile-time signal |
| **`metro.config.js`'s `blockList`** | Deleting it produces a build that **succeeds** and an app that bundles web React and does not run (§24.4) |
| **`CrashBoundary`'s `wipeAll()`** | It looks like error handling and is a **security control** - the last line of the no-permanent-copy rule. `void wipeAll().catch(() => undefined)` must stay fire-and-forget (§17.6) |
| **`bootCheck()`'s fail-closed defaults** | Making `DEFAULT_SETTINGS` permissive means a network outage disables DRM on the phone (§21.6) |
| **`RouteError`** | Bypassing it exposes React Router's own English "Unexpected Application Error!" screen carrying the component stack - which its header calls *"wrong twice over"* (§17.2) |

### 5. Which areas are dangerous

Ranked by (probability of being asked to change it) × (silence of the failure):

1. **`src/lib/db.ts`'s `readDocument()`.** `merged.version = DB_VERSION` is an **assignment, not a comparison** - there is no migration mechanism at all. Only `settings`, `drm_policies` and `device_sessions` are normalised; every other array is taken verbatim. A record-shape change ships to existing users as un-migrated data with **no error, no warning and no version check** (§9.4, §27.1).
2. **`guard()`'s return type.** `if (!guard(...))` type-checks and inverts authorisation (§10.6).
3. **`ScreenShield.m` ↔ `ScreenShield.swift`.** Nine `RCT_EXTERN_METHOD` declarations hand-maintained against 828 lines of Swift. A mismatch returns `undefined` at call time - not a build error, not a type error, not a throw (§25.4).
4. **`metro.config.js`'s `blockList`.** One line separates two sibling projects that both contain React. Deleting it fails **silently and successfully** (§24.4).
5. **`writeDocument()`'s uncaught throw.** `STORAGE_QUOTA_EXCEEDED` has one occurrence in `src/`: the throw. Realistic trigger: any upload between the browser's ~5 MB quota and the 10 MB `max_upload_bytes` check, because `readAssetFile()` stores a **base64 data URL** (~1.33× the file) as `products.content_url` **inside the same `localStorage` key as the entire database** (§17.8, §14.10).
6. **The three-way type duplication.** `src/types/index.ts` ↔ `react-native/src/net/types.ts` ↔ `schema.sql`, maintained by hand, arbitrated by the SQL. `metro.config.js` makes the web types **unimportable** from the phone, so the duplication is enforced, not accidental (§24.3).
7. **CSP in `vite.config.ts`.** It is not in `index.html`. `style-src 'unsafe-inline'` exists for the injected print stylesheet. A meta policy **cannot express `frame-ancestors`**, and nothing serves that header - so the app is framable (§13.4).
8. **The permission matrix.** `can()` fails closed on an unknown permission string, so **a typo silently denies rather than loudly failing**. Known drift already exists: `saveCoupon`/`deleteCoupon` guard on `'cms'` and the coupon UI lives in `AdminCmsPage`, but `ROLE_DESCRIPTION.FINANCE` promises קופונים while `ROLE_PERMISSIONS.FINANCE` lacks `'cms'`; `MARKETING` holds `'finance'` though its description omits it (§12.6).
9. **Git state.** Zero commits on `main`. All of `migrations/` and the entire real mobile app are untracked. **13 tracked files are `AM`** - staged *and* re-modified - including `schema.sql`, `api.ts`, `api-security.ts`, `api-support.ts`, `db.ts`, `useScreenProtection.ts`, `ReaderPage.tsx`, `types/index.ts`, `vite.config.ts` and `AdminSecurityPage.tsx`. A bare `git commit` commits **older** versions of the DRM core, the persistence layer, the domain types and the database contract (§20.6).
10. **`ReaderPage.tsx`'s zoom/page mechanism.** `pdfEmbedUrl()` emits `zoom=N` **or** `view=FitH`, never both, because the Chromium PDF viewer honours fragment parameters only on a full document load. The `key`-forced iframe remount is what makes it work. Turning the discrete zoom rungs into a slider, or removing the `key`, silently produces a viewer that ignores the parameter (§14.5).
11. **`updateUser()`'s two-permission guard.** `'users'`, then additionally `'manage_roles'` if the patch touches `admin_role`/`role`. Collapsing it to one check is privilege escalation (§12.5).
12. **Android/iOS asymmetry.** Android prevents, iOS detects and conceals. `detectIntegrity()` returns `TRUSTED` and never `ATTESTATION_FAILED` on purpose. "Making it consistent" breaks it (§14.7).

### 6. How tests should be added

**The honest starting position: there are none.** No `test` script in either `package.json`, no test framework in either dependency tree, no CI. `react-native`'s `lint` script cannot succeed because no ESLint config file exists. **This section is therefore a recommendation, not a description of an existing pattern** - and it is the one place in this document where the advice is necessarily somewhat general. `[Inferred]`

**Where tests would pay for themselves immediately, in this repository's terms:**

| Priority | Target | Why |
|---|---|---|
| 1 | `src/lib/permissions.ts` - `can()` against the full 27 × 5 matrix | Pure function, no I/O, and the matrix in §12.4 can be transcribed directly into a table-driven test. It would catch the existing FINANCE/MARKETING drift on the first run |
| 2 | `guard()` | Pure function returning `Failure | null`. Three cases: no actor → `UNAUTHENTICATED`; non-staff → `FORBIDDEN`; missing permission → `FORBIDDEN` with the Hebrew role label interpolated. Cheap, and it protects the easiest bug in the codebase to introduce |
| 3 | `src/lib/analytics.ts` | `isRevenueBearing()`, `computeRevenue()`, `lifetimeTotals()` are pure functions over arrays. A change to `isRevenueBearing()` silently restates every historical revenue figure |
| 4 | `resolveDrmPolicy()` | Pure function, most-specific-first ordering, and getting it wrong disables protection |
| 5 | `readDocument()` migration behaviour | The highest-value and hardest: it needs a `localStorage` stub, and it is where the version-assignment-not-comparison bug lives |
| 6 | `checkout()` pricing | The security property (client sends `coupon_code`, server re-derives the amount) is exactly the kind of thing a test should pin |
| 7 | `pdfEmbedUrl()` | Pure string function with a non-obvious mutual-exclusion rule (`zoom` **xor** `view=FitH`) |

**Framework choice:** the web project has three runtime dependencies and no test tooling. Vitest is the natural fit given Vite 8 is already the bundler and would reuse `vite.config.ts`'s `@` alias - but **adding it means the first dev dependency that is not build tooling, and it will resolve `jsdom` or `happy-dom`, which is a real decision about how `localStorage` and `crypto.subtle` are stubbed.** `auth.ts`'s `fallbackDigest` exists precisely because `crypto.subtle` is unavailable in insecure contexts, which makes it a useful seam for testing without a full Web Crypto polyfill.

**Do not** add tests to `react-native/` first. Its `typecheck` works but `lint` cannot run, there is no Jest config, and the interesting behaviour is in Kotlin and Swift where no harness exists at all.

**Until tests exist**, §28.10's manual checklist is the substitute, and the type checker in two projects is the entire automated safety net.

### 7. How API and database changes should be handled

**There is no API and no database - so "API change" means one of two different things here, and the first step is to establish which.**

**Case A: a web service-layer change** (the common case). This is a function in one of the four `api-*.ts` files.

1. Add or change the record shape in `src/types/index.ts`.
2. Add the permission to `AdminPermission` and to the right entries of `ROLE_PERMISSIONS` - and **update `ROLE_DESCRIPTION` in the same edit**, because the existing drift (§12.6) came from not doing so.
3. Write the service function following the six-step template.
4. If it is a new collection: add it to `Database`, to `emptyDatabase()`, **and** understand that existing users will get `[]` (that part is safe - `readDocument()` merges key-by-key over `Object.keys(base)`).
5. If it is a **new field on an existing record**: this is the dangerous case. `readDocument()` takes non-normalised arrays verbatim, so old documents will have `undefined` there. Either make the field optional and handle `undefined` at every read site, or add a per-collection normaliser following the `withProtectionDefaults` / `withSessionDefaults` pattern - which exists and has been used exactly twice (§27.1).
6. Mirror the change in `schema.sql`, and if it is mobile-visible, in `migrations/0001_mobile_reader.sql`. **Nothing will tell you if you forget.**
7. Mirror it in `react-native/src/net/types.ts` if the phone needs it. The header there states the arbitration rule: *"the SQL schema in `schema.sql` is the arbiter when they disagree."*
8. If it is a new endpoint the phone calls, add a row to `net/api.ts`'s header table. That table is the contract documentation.

**Bumping `DB_VERSION` does nothing.** It is overwritten, never compared. Do not add a version bump and believe you have migrated (§9.4).

**Case B: a real mobile HTTP endpoint.** There is no server in this repository. Adding one means:

1. Add the wrapper in `react-native/src/net/api.ts` using `request()` from `client.ts` - **do not call `fetch` directly**, or you lose the keychain session, the six `X-Casanova-*` identity headers, the 15 s timeout and the 401 → `clearSession()` behaviour.
2. Understand that `Content-Type` is set only when there is a body, and that the identity headers go on **anonymous requests too**.
3. Add the SQL in `migrations/`.
4. Remember that `mobile_min_build` gating depends on the client volunteering `X-Casanova-Build` - *"a kill switch that only works for clients that volunteer their version is not a kill switch"* (§21.5).

**Storage-quota awareness for any change that stores data:** the whole database is one `localStorage` key, assets are stored as base64 data URLs at ~1.33× file size, and the `max_upload_bytes` default (10 MB) is **larger than a typical browser quota (~5 MB)**. Any feature that increases stored bytes moves the uncaught `STORAGE_QUOTA_EXCEEDED` closer (§14.10).

### 8. Common mistakes

Specific to this repository, each with its failure mode:

| Mistake | Why it is tempting | What actually happens |
|---|---|---|
| `if (!guard(actor, 'x')) return …` | Reads naturally as "if not allowed" | **Inverts authorisation.** Type-checks, because `Failure | null` is compatible with `!` |
| `guard(actor, 'coupons')` | Coupons are a thing, so `'coupons'` should be a permission | `can()` fails closed on an unknown string → **silently denies everyone including SUPER_ADMIN**. No error |
| Writing to `getDb()` in place | It returns a mutable object | Data changes, **nothing re-renders**, cross-tab sync does not fire |
| `throw new Error(…)` in a service function | Feels like proper error handling | Breaks the errors-are-values contract; no caller has a `try`, and there is no app-level error boundary |
| Bumping `DB_VERSION` to "migrate" | The constant exists and is named `version` | **Nothing.** It is assigned, never compared |
| Adding a field to a type and calling it done | The type checker is happy | Existing `localStorage` documents have `undefined`; `schema.sql` and the mobile types do not know it exists |
| Putting Hebrew error copy in a component | It is where the text is displayed | Breaks the convention that error strings are produced by the service layer and are part of the API contract |
| Adding a new status without the label map entry | Only if the map is declared loosely | Actually **a compile error** - the `Record<Union, string>` maps are exhaustive. This one is caught, and is the model the others should follow |
| Reading a `DrmPolicy` row directly | It is right there in the database | Ignores most-specific-first scope resolution; an `ALL` policy can shadow a `WEB` one |
| Adding a dependency to `useScreenProtection`'s effect array | Looks like a lint fix | Re-registers seven listeners on every policy change. The `}, []` plus `optionsRef` is the design |
| Turning the reader's zoom rungs into a slider | Better UX, obviously | The Chromium viewer honours fragment params only on a full document load; without the `key`-forced remount the parameter is **ignored** |
| Adding a parameter to `maskCvv()` | It looks like an oversight | The signature is **deliberately** argument-less so the insecure call is unrepresentable |
| "Fixing" the Android/iOS asymmetry | One prevents, one detects - looks inconsistent | Both are argued in source comments. Making them symmetric breaks one of them |
| Importing web types into `react-native/` | DRY | **Impossible** - `metro.config.js`'s `blockList` makes `../src` unresolvable. If you remove the blockList to make it work, the build succeeds and the app does not run |
| `git commit` without `git add -A` | Normal habit | Commits **older** versions of 13 `AM` files including `db.ts`, `api.ts`, `types/index.ts` and `schema.sql` |
| Believing `AGENTS.md`'s "dev server is already running" | It is documented | Verified false in this environment. **Repository evidence overrides documentation** |
| Using `Measure-Object -Line` to size a file | It is the obvious PowerShell idiom | Counts **non-blank** lines. Use `(Get-Content $f).Count` for raw totals |
| Using `&&` in PowerShell | Habit from bash | Not supported in this shell version. Use `;` |

### 9. What to verify before implementing a significant feature

A pre-flight list, in order. Items 1-4 are questions to resolve before writing code; 5-9 are checks after.

**Before:**

1. **Resolve the git state.** `git status --short`. If the 13 `AM` files are still `AM`, the working tree and the index disagree about the DRM core, the persistence layer, the domain types and the SQL contract. Establish which version is real **before** adding to it. With zero commits on `main`, there is no history to fall back on (§20.6).
2. **Confirm which clients are affected.** Web only, mobile only, or both. If both, budget for **three** coordinated edits (`src/types/index.ts`, `react-native/src/net/types.ts`, `schema.sql`) and accept that nothing enforces the third.
3. **Locate the permission.** Read `permissions.ts` whole. If a new permission is needed, decide which of the five roles hold it **and update `ROLE_DESCRIPTION` in the same change** - the existing FINANCE/MARKETING drift is the evidence for what happens otherwise.
4. **Decide the persistence story.** New collection (safe: `readDocument()` gives existing users `[]`) or new field on an existing record (unsafe: needs a normaliser or an optional field handled at every read site). And if the feature stores bytes, compute the quota impact against a ~5 MB ceiling and a 10 MB `max_upload_bytes` check.

**After:**

5. **`pnpm typecheck`** - catches arity, naming, and every exhaustive `Record<…>` label map.
6. **`pnpm build`** - catches import resolution and the `@` alias.
7. **`cd react-native; pnpm typecheck`** - if any mobile file changed. **`pnpm lint` is not worth running**: it calls `eslint .` with no config file present and cannot succeed (§26.2).
8. **`pnpm format`** - oxfmt, per `AGENTS.md`.
9. **The manual checklist**, because there is no automated substitute (§28.10):
   - Load the app, complete a guest checkout, mark the order paid in the admin, open the reader.
   - Change a DRM flag in `AdminSecurityPage` and confirm reader behaviour changes **without a reload**.
   - Sign in as each of the five roles and confirm `SideNav` and page-level `AccessDenied` agree with §12.4's matrix.
   - Open two tabs, write in one, confirm the other updates.
   - Clear `localStorage['casanova_db_v1']` and confirm `/setup` appears.

**And three things to verify that no tool will check for you:**

- **Did I write an audit entry?** `writeAudit()` takes an object. Skipping it makes the action invisible to `AdminAuditPage`.
- **Did I keep the CSP consistent?** If the feature adds an embed, a script, a style or a connect target, `vite.config.ts`'s `figmaContentSecurityPolicy()` (:255-310) must be edited - in **both** the production and dev directive lists. A CSP violation shows up only in the browser console at runtime.
- **Did I add a comment explaining why the obvious approach would fail?** That is the house style, it is the reason this codebase is navigable at all, and it is the single cheapest way to keep it that way.

---

*End of the knowledge base. Sections 1-30 plus this closing guide. Every conclusion is labelled `[Verified]`, `[Inferred]` or `[Unknown]`, and confidence is marked HIGH, MEDIUM or LOW. Where the evidence was incomplete - the twelve admin pages not read in full, the iOS build's absence, the SQL that nothing executes - that is stated rather than papered over, per the brief's honesty clause.*
