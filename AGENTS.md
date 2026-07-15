# AGENTS.md

## Project Summary

This repository is the source for `link.pg72.tw`, a multi-user short URL service deployed to Cloudflare Pages. It uses a React SPA for the UI, a Hono Worker in Pages Advanced Mode for all server behavior, Cloudflare D1 for persistence, and PG72 ID OpenID Connect for authentication.

All active PG72 ID users may sign in. Authentication is bound to the issuer's stable `sub`; verified email is used only once to bind a pre-migration user. Administrator authorization comes from D1 `users.is_admin`, never from a request-time email comparison.

## Start Here

Read these files before changing behavior:

- `README.md`: product behavior, diagrams, setup, deployment, API, and data model.
- `src-worker/index.ts`: authoritative server routes, authorization, D1 queries, and redirects.
- `src/App.tsx`: client routes and authentication-aware navigation.
- `schema.sql`: complete schema for a fresh database.
- `migration-002.sql`: one-time migration for databases created by an older version.
- `migration-003-pg72-oidc.sql`: existing Google/email database migration to stable PG72 ID subjects.
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

- OIDC state, nonce, and PKCE verifier are HMAC-protected in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie for 10 minutes.
- `oauth4webapi` must validate discovery issuer, callback state, ID Token issuer/audience/nonce/signature, and UserInfo `sub` plus `email_verified`.
- Sessions are random UUIDs stored in D1 and expire after 7 days.
- Sessions join users by `sso_subject`. Email remains link profile/ownership data and must not authenticate a returning account.
- Never trust only React route guards. Enforce access in the Worker.
- `authMiddleware` must protect user and admin APIs.
- Every admin handler must call `requireAdmin` before accessing data.
- Every cookie-authenticated unsafe method must pass `mutationOriginMiddleware`; do not add a POST/PUT/PATCH/DELETE route that bypasses the exact `APP_BASE_URL` Origin check.
- Banning a user must invalidate active sessions.
- `BOOTSTRAP_ADMIN_EMAIL` may promote only the first fresh-database administrator; `auth_bootstrap.admin_subject` permanently closes that email bootstrap path.
- Store `PG72_ID_CLIENT_SECRET` as a Cloudflare secret and never commit `.dev.vars`.

## D1 Conventions

- Use prepared statements and `.bind()` for every dynamic value.
- Define concrete row types for `.first<T>()` and `.all<T>()` results.
- `schema.sql` must remain sufficient for a fresh install.
- Add a new numbered migration for existing production databases when changing schema. Do not rewrite an already-applied migration.
- Keep `slug` unique and preserve the existing allowed format: letters, numbers, `_`, and `-`.
- Link targets must use only the `http:` or `https:` scheme.
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
| `APP_BASE_URL` | Variable | Exact application origin used for callbacks and Origin checks |
| `PG72_ID_ISSUER` | Variable | Exact PG72 ID issuer origin |
| `PG72_ID_CLIENT_ID` | Variable | Registered confidential OIDC client ID |
| `PG72_ID_CLIENT_SECRET` | Secret | OIDC client secret and transaction-cookie HMAC key material |
| `BOOTSTRAP_ADMIN_EMAIL` | Variable/secret | Optional one-time verified-email bootstrap for an empty database |

## Change Checklist

- Check route ordering and `RESERVED` when routes change.
- Check both owner and admin authorization paths when link mutations change.
- Check active-link and banned-owner behavior when redirect logic changes.
- Update `README.md`, API docs, and diagrams when behavior or commands change.
- Re-render `public/og-image.png` after editing `public/og-image.svg`.
- Run both TypeScript checks and the production build.
- For routing changes, verify `/`, `/api/auth/me`, one valid slug, and one missing slug through the Worker runtime.
