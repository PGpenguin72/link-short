# AGENTS.md

## Project Summary

This repository is the source for `link.pg72.tw`, a multi-user short URL service deployed to Cloudflare Pages. It uses a React SPA for the UI, a Hono Worker in Pages Advanced Mode for all server behavior, Cloudflare D1 for persistence, and Google OAuth for authentication.

All Google users may sign in. `ALLOWED_EMAIL` identifies the single administrator; it is not a login allowlist.

## Start Here

Read these files before changing behavior:

- `README.md`: product behavior, diagrams, setup, deployment, API, and data model.
- `src-worker/index.ts`: authoritative server routes, authorization, D1 queries, and redirects.
- `src/App.tsx`: client routes and authentication-aware navigation.
- `schema.sql`: complete schema for a fresh database.
- `migration-002.sql`: one-time migration for databases created by an older version.
- `wrangler.toml`: Pages output directory and D1 binding.

## Commands

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev:worker
```

Use `npm run dev:worker` when testing API, OAuth, D1, redirects, or static asset routing. `npm run dev` runs only Vite and cannot validate Worker behavior.

Before handing off a code change, run:

```bash
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.worker.json
npm run build
```

Do not deploy or run remote migrations unless the user explicitly asks.

## Build Model

The build has two stages:

1. Vite compiles the React application into `dist/`.
2. esbuild bundles `src-worker/index.ts` into `dist/_worker.js`.

Cloudflare Pages sees `_worker.js` and runs it in Advanced Mode. The Worker must explicitly forward static requests through `env.ASSETS.fetch()`.

## Request Routing

Routes in `src-worker/index.ts` are order-sensitive:

1. `/api/auth/*` handles authentication.
2. `/api/links*` requires an authenticated, non-banned user.
3. `/api/admin/*` also requires `user.is_admin` inside each handler.
4. Root-level brand assets are forwarded to `ASSETS` before slug matching.
5. `GET` and `HEAD /:slug` query D1 and redirect valid links.
6. `app.all('*')` forwards all remaining requests to the React assets and must remain last.

When adding a top-level React route, also add its first path segment to `RESERVED`. Otherwise the Worker may treat it as a short code. Reserved checks are case-insensitive when validating new short codes.

When adding a root-level public file such as `/robots.txt`, register it before `/:slug`; otherwise it will be treated as a short code. Files under `/assets/` already pass through the catch-all route.

## Short URL and Open Graph Rules

- `/` serves this project's Open Graph and Twitter Card metadata from `index.html`.
- `/og-image.png` is the production social image; `public/og-image.svg` is its editable source.
- A valid `/:slug` responds with a non-cacheable `302` to the target URL.
- Social crawlers follow that redirect, so the target page controls the title, description, image, and canonical URL shown in the preview.
- Do not proxy or scrape target HTML without a separate security design. Arbitrary target fetching introduces SSRF, content-size, timeout, and HTML parsing risks.
- Invalid, disabled, and banned-owner links return the React 404 page with HTTP status 404.

## Authentication and Authorization

- OAuth state is stored in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie for 10 minutes.
- Sessions are random UUIDs stored in D1 and expire after 7 days.
- Never trust only React route guards. Enforce access in the Worker.
- `authMiddleware` must protect user and admin APIs.
- Every admin handler must call `requireAdmin` before accessing data.
- Banning a user must invalidate active sessions.
- Store `GOOGLE_CLIENT_SECRET` as a Cloudflare secret and never commit `.dev.vars`.

## D1 Conventions

- Use prepared statements and `.bind()` for every dynamic value.
- Define concrete row types for `.first<T>()` and `.all<T>()` results.
- `schema.sql` must remain sufficient for a fresh install.
- Add a new numbered migration for existing production databases when changing schema. Do not rewrite an already-applied migration.
- Keep `slug` unique and preserve the existing allowed format: letters, numbers, `_`, and `-`.
- A link redirects only when `links.active = 1` and its owner is not banned.

## Frontend Conventions

- Keep API calls in `src/api.ts` and shared response shapes in `src/types.ts`.
- Preserve the current quiet, dark, utility-focused interface.
- Keep layouts usable on narrow mobile viewports as well as desktop.
- Use the existing icon style for local UI changes and include an accessible label or `title` for icon-only controls.
- Do not duplicate server authorization rules in a way that suggests the frontend is a security boundary.

## Environment Bindings

| Binding or variable | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 binding | Users, links, and sessions |
| `ASSETS` | Pages asset binding | React build output and public assets |
| `GOOGLE_CLIENT_ID` | Variable | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Secret | Google OAuth client secret |
| `ALLOWED_EMAIL` | Variable | Administrator email |

## Change Checklist

- Check route ordering and `RESERVED` when routes change.
- Check both owner and admin authorization paths when link mutations change.
- Check active-link and banned-owner behavior when redirect logic changes.
- Update `README.md`, API docs, and diagrams when behavior or commands change.
- Re-render `public/og-image.png` after editing `public/og-image.svg`.
- Run both TypeScript checks and the production build.
- For routing changes, verify `/`, `/api/auth/me`, one valid slug, and one missing slug through the Worker runtime.
