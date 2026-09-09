# Casanova Storefront

A Hebrew, right-to-left digital-title storefront with a protected browser reader, customer library, CMS/admin area, and a companion React Native reader. The web application is built with React, Vite, TypeScript, and Tailwind CSS. Optional Supabase Edge Functions provide private-storage upload and signed content URLs.

## Repository layout

```text
src/             Web application: routes, pages, components, contexts, and client services
public/          Public static assets (protected book files are deliberately excluded)
supabase/        Supabase project configuration and Edge Functions
migrations/      Database migrations
react-native/    Independent React Native protected-reader application
images/          Source image assets used by the web application
docs/            Maintained architecture reference (other local documents stay ignored)
```

The original product requirements live in [docs/PRODUCT_BRIEF.md](docs/PRODUCT_BRIEF.md).

The web and mobile applications are intentionally separate projects in one repository. Their dependency manifests and commands must be run from their respective directories.

## Requirements

- Node.js 22 or newer
- pnpm for the web application
- For native builds: the React Native Android/iOS toolchain described by the React Native documentation

## Web application

Install dependencies and start the Vite server:

```bash
pnpm install
pnpm dev
```

Available validation commands:

```bash
pnpm run typecheck
pnpm run build
pnpm run format
```

There is no automated test script currently configured.

### Environment configuration

Copy `.env.example` to `.env.local` and replace only the placeholder values needed for your Supabase project:

```bash
cp .env.example .env.local
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are browser-facing configuration values. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client or commit it; it belongs exclusively in the Supabase function runtime's secret store.

## Supabase

`supabase/functions/` contains the content-delivery functions. Deploy them with the Supabase CLI after configuring the project and its server-side secrets. The functions keep protected content in private storage and issue signed URLs; do not add sellable PDFs to Git.

Database source exists in `schema.sql` and `migrations/`. Apply it through the team’s chosen Supabase migration workflow; this repository does not include a deployment script.

## React Native reader

From `react-native/`, install its own dependencies and use its scripts:

```bash
cd react-native
npm install
npm run typecheck
npm run android
```

Before a production native release, copy `android/keystore.properties.example` to `android/keystore.properties` and provide the release signing material outside the repository. The supplied debug key is the standard public Android debug key and cannot sign a Play Store release.

## Repository and security hygiene

- `.env.local`, protected PDFs, dependencies, build output, screenshots, logs, and platform build artifacts are ignored.
- `.env.example` and `android/keystore.properties.example` are safe templates only; do not put real credentials in them.
- Commit source, configuration templates, migration/function source, and the lockfile.
- Do not commit generated `dist/`, `node_modules/`, mobile build artifacts, or content copied from a protected-title vault.

## Deployment

Build the web application with `pnpm run build`; deploy the generated `dist/` directory through the chosen hosting platform. Configure production security headers at the hosting layer—especially `frame-ancestors`, which cannot be enforced by the application’s HTML meta Content-Security-Policy.
