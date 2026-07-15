/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import {
  createAuthorizationRequest,
  decodeOidcTransaction,
  encodeOidcTransaction,
  processAuthorizationCallback,
  type OidcBindings,
} from './oidc'
import { hasExpectedOrigin, isAllowedTargetUrl, requiresOriginCheck } from './security'

type Env = OidcBindings & {
  DB: D1Database
  ASSETS: Fetcher
  BOOTSTRAP_ADMIN_EMAIL?: string
}

type SessionUser = { subject: string; email: string; is_admin: boolean; banned: boolean }

type Variables = { user: SessionUser }

type LinkRow = {
  id: number
  slug: string
  target_url: string
  owner_email: string
  active: number
  disabled_reason: string | null
  created_at: string
  updated_at: string
}

const RESERVED = new Set(['admin', 'login', 'api', 'dashboard', '404'])
const SESSION_COOKIE = '__Host-link_session'
const OIDC_TRANSACTION_COOKIE = '__Host-link_oidc'
const SESSION_SECONDS = 7 * 86400
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type AppEnv = { Bindings: Env; Variables: Variables }
type Ctx = Context<AppEnv>

const app = new Hono<AppEnv>()

app.onError((err, c) => {
  console.error(JSON.stringify({
    event: 'worker_request_failed',
    path: c.req.path,
    error: err.name || 'Error',
  }))
  return c.json({ error: 'Internal Server Error' }, 500)
})

// ── Helpers ────────────────────────────────────────────────────────────────────
function randSlug(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => chars[b % chars.length]).join('')
}

async function loadUser(c: Ctx): Promise<SessionUser | null> {
  const sid = getCookie(c, SESSION_COOKIE)
  if (!sid || !SESSION_ID_PATTERN.test(sid)) return null
  const row = await c.env.DB.prepare(
    `SELECT u.sso_subject AS subject, u.email AS email,
            u.banned AS banned, u.is_admin AS is_admin
     FROM sessions s JOIN users u ON u.sso_subject = s.sso_subject
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  )
    .bind(sid)
    .first<{ subject: string; email: string; banned: number; is_admin: number }>()
  if (!row) return null
  return {
    subject: row.subject,
    email: row.email,
    banned: row.banned === 1,
    is_admin: row.is_admin === 1,
  }
}

type UserRow = {
  email: string
  sso_subject: string
  banned: number
  is_admin: number
}

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(normalized)) {
    throw new Error('INVALID_EMAIL')
  }
  return normalized
}

async function applyAdminBootstrap(
  env: Pick<Env, 'DB' | 'BOOTSTRAP_ADMIN_EMAIL'>,
  user: UserRow,
  verifiedEmail: string,
): Promise<UserRow> {
  if (user.is_admin === 1) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO auth_bootstrap (id, admin_subject, completed_at)
       VALUES (1, ?, datetime('now'))`
    ).bind(user.sso_subject).run()
    return user
  }

  const bootstrapEmail = env.BOOTSTRAP_ADMIN_EMAIL?.trim()
  if (!bootstrapEmail || normalizeEmail(bootstrapEmail) !== verifiedEmail) return user

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_bootstrap (id, admin_subject, completed_at)
       SELECT 1, ?, datetime('now')
       WHERE NOT EXISTS (SELECT 1 FROM auth_bootstrap WHERE id = 1)
         AND NOT EXISTS (
           SELECT 1 FROM users WHERE is_admin = 1 AND sso_subject IS NOT NULL
         )
       ON CONFLICT(id) DO NOTHING`
    ).bind(user.sso_subject),
    env.DB.prepare(
      `UPDATE users SET is_admin = 1
       WHERE sso_subject = ?
         AND EXISTS (
           SELECT 1 FROM auth_bootstrap
           WHERE id = 1 AND admin_subject = ?
         )`
    ).bind(user.sso_subject, user.sso_subject),
  ])
  return (await env.DB.prepare(
    `SELECT email, sso_subject, banned, is_admin
     FROM users WHERE sso_subject = ?`
  ).bind(user.sso_subject).first<UserRow>()) ?? user
}

export async function resolveOidcUser(
  env: Pick<Env, 'DB' | 'BOOTSTRAP_ADMIN_EMAIL'>,
  subject: string,
  email: string,
): Promise<UserRow> {
  const verifiedEmail = normalizeEmail(email)
  const existingSubject = await env.DB.prepare(
    `SELECT email, sso_subject, banned, is_admin
     FROM users WHERE sso_subject = ?`
  ).bind(subject).first<UserRow>()
  if (existingSubject) return existingSubject

  try {
    const bound = await env.DB.prepare(
      `UPDATE users SET sso_subject = ?
       WHERE email = (
         SELECT email FROM users
         WHERE lower(email) = ? AND sso_subject IS NULL
         ORDER BY created_at ASC LIMIT 1
       ) AND sso_subject IS NULL
       RETURNING email, sso_subject, banned, is_admin`
    ).bind(subject, verifiedEmail).first<UserRow>()
    if (bound) return applyAdminBootstrap(env, bound, verifiedEmail)
  } catch {
    const concurrent = await env.DB.prepare(
      `SELECT email, sso_subject, banned, is_admin
       FROM users WHERE sso_subject = ?`
    ).bind(subject).first<UserRow>()
    if (concurrent) return concurrent
    throw new Error('OIDC_IDENTITY_CONFLICT')
  }

  const emailOwner = await env.DB.prepare(
    `SELECT email, sso_subject, banned, is_admin
     FROM users WHERE lower(email) = ? LIMIT 1`
  ).bind(verifiedEmail).first<UserRow>()
  if (emailOwner?.sso_subject && emailOwner.sso_subject !== subject) {
    throw new Error('OIDC_IDENTITY_CONFLICT')
  }

  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO users (email, sso_subject, banned, is_admin)
       VALUES (?, ?, 0, 0)
       RETURNING email, sso_subject, banned, is_admin`
    ).bind(verifiedEmail, subject).first<UserRow>()
    if (!inserted) throw new Error('OIDC_USER_CREATE_FAILED')
    return applyAdminBootstrap(env, inserted, verifiedEmail)
  } catch {
    const concurrent = await env.DB.prepare(
      `SELECT email, sso_subject, banned, is_admin
       FROM users WHERE sso_subject = ?`
    ).bind(subject).first<UserRow>()
    if (concurrent) return concurrent
    throw new Error('OIDC_IDENTITY_CONFLICT')
  }
}

// ── Auth gate for all /api/links + /api/admin routes ─────────────────────────────
const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (user.banned) return c.json({ error: '此帳號已被停權' }, 403)
  c.set('user', user)
  await next()
}

const mutationOriginMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (
    requiresOriginCheck(c.req.method)
    && !hasExpectedOrigin(c.req.header('origin'), c.env.APP_BASE_URL)
  ) {
    return c.json({ error: 'Invalid request origin' }, 403)
  }
  await next()
}

function requireAdmin(c: Ctx): boolean {
  return c.get('user')?.is_admin === true
}

app.use('/api/links/*', mutationOriginMiddleware, authMiddleware)
app.use('/api/links', mutationOriginMiddleware, authMiddleware)
app.use('/api/admin/*', mutationOriginMiddleware, authMiddleware)
app.use('/api/auth/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')
})

// ── Auth: me ─────────────────────────────────────────────────────────────────
app.get('/api/auth/me', async (c) => {
  const user = await loadUser(c)
  return c.json({ user })
})

// ── Auth: PG72 ID login ─────────────────────────────────────────────────────
app.get('/api/auth/login', async (c) => {
  try {
    const { authorizationUrl, transaction } = await createAuthorizationRequest(c.env)
    const transactionCookie = await encodeOidcTransaction(
      transaction,
      c.env.PG72_ID_CLIENT_SECRET,
    )
    setCookie(c, OIDC_TRANSACTION_COOKIE, transactionCookie, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 600,
      path: '/',
    })
    return c.redirect(authorizationUrl.href)
  } catch (error) {
    console.error(JSON.stringify({
      event: 'oidc_login_start_failed',
      error: error instanceof Error ? error.name : 'UnknownError',
    }))
    return c.redirect('/?error=auth_unavailable')
  }
})

// ── Auth: callback ───────────────────────────────────────────────────────────
app.get('/api/auth/callback', async (c) => {
  const encodedTransaction = getCookie(c, OIDC_TRANSACTION_COOKIE)
  // __Host- cookies must carry Secure even on deletion or hono throws.
  deleteCookie(c, OIDC_TRANSACTION_COOKIE, { path: '/', secure: true })
  const transaction = await decodeOidcTransaction(
    encodedTransaction,
    c.env.PG72_ID_CLIENT_SECRET,
  )
  if (!transaction) return c.redirect('/?error=invalid_state')

  try {
    const identity = await processAuthorizationCallback(c.env, c.req.url, transaction)
    const user = await resolveOidcUser(c.env, identity.subject, identity.email)
    if (user.banned === 1) return c.redirect('/?error=banned')

    const sid = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19)
    await c.env.DB.prepare(
      `INSERT INTO sessions (id, sso_subject, expires_at) VALUES (?, ?, ?)`
    ).bind(sid, user.sso_subject, expiresAt).run()
    setCookie(c, SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: SESSION_SECONDS,
      path: '/',
    })
    deleteCookie(c, 'session', { path: '/' })
    return c.redirect(user.is_admin === 1 ? '/admin' : '/dashboard')
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : ''
    console.error(JSON.stringify({
      event: 'oidc_callback_failed',
      error: error instanceof Error ? error.name : 'UnknownError',
    }))
    return c.redirect(errorCode === 'OIDC_IDENTITY_CONFLICT'
      ? '/?error=identity_conflict'
      : '/?error=auth_failed')
  }
})

// ── Auth: logout ─────────────────────────────────────────────────────────────
app.post('/api/auth/logout', async (c) => {
  if (!hasExpectedOrigin(c.req.header('origin'), c.env.APP_BASE_URL)) {
    return c.json({ error: 'Invalid request origin' }, 403)
  }
  const sid = getCookie(c, SESSION_COOKIE)
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true })
  deleteCookie(c, 'session', { path: '/' })
  return c.json({ ok: true })
})

// ── Links: list own (admin still gets own here; all-links is /api/admin/links) ──
app.get('/api/links', async (c) => {
  const user = c.get('user')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM links WHERE owner_email = ? ORDER BY created_at DESC'
  )
    .bind(user.email)
    .all<LinkRow>()
  return c.json({ links: results })
})

// ── Links: create ────────────────────────────────────────────────────────────
app.post('/api/links', async (c) => {
  const user = c.get('user')
  const { slug: rawSlug, target_url } = await c.req.json<{ slug?: string; target_url: string }>()
  if (!target_url?.trim()) return c.json({ error: '目標網址為必填' }, 400)
  if (!isAllowedTargetUrl(target_url)) return c.json({ error: '無效的目標網址' }, 400)

  let slug = rawSlug?.trim()
  if (!slug) {
    for (let i = 0; i < 5; i++) {
      const cand = randSlug()
      if (!(await c.env.DB.prepare('SELECT id FROM links WHERE slug = ?').bind(cand).first())) {
        slug = cand
        break
      }
    }
  }
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) return c.json({ error: '無效的短代碼' }, 400)
  if (RESERVED.has(slug.toLowerCase())) return c.json({ error: '此短代碼為保留字' }, 400)

  try {
    const link = await c.env.DB.prepare(
      `INSERT INTO links (slug, target_url, owner_email) VALUES (?, ?, ?) RETURNING *`
    )
      .bind(slug, target_url.trim(), user.email)
      .first<LinkRow>()
    return c.json({ link }, 201)
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return c.json({ error: '此短代碼已存在' }, 409)
    throw e
  }
})

// ── Links: update (owner or admin) ───────────────────────────────────────────
app.put('/api/links/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const { slug, target_url } = await c.req.json<{ slug?: string; target_url?: string }>()

  const existing = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<LinkRow>()
  if (!existing) return c.json({ error: '找不到此連結' }, 404)
  if (existing.owner_email !== user.email && !user.is_admin) return c.json({ error: '沒有權限' }, 403)

  if (!slug?.trim() && !target_url?.trim()) return c.json({ error: '沒有要更新的內容' }, 400)
  if (slug?.trim() && !/^[a-zA-Z0-9_-]+$/.test(slug.trim())) return c.json({ error: '無效的短代碼' }, 400)
  if (slug?.trim() && RESERVED.has(slug.trim().toLowerCase())) return c.json({ error: '此短代碼為保留字' }, 400)
  if (target_url?.trim() && !isAllowedTargetUrl(target_url)) {
    return c.json({ error: '無效的目標網址' }, 400)
  }

  try {
    const link = await c.env.DB.prepare(
      `UPDATE links SET slug = COALESCE(NULLIF(?, ''), slug),
                        target_url = COALESCE(NULLIF(?, ''), target_url),
                        updated_at = datetime('now')
       WHERE id = ? RETURNING *`
    )
      .bind(slug?.trim() ?? '', target_url?.trim() ?? '', id)
      .first<LinkRow>()
    return c.json({ link })
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return c.json({ error: '此短代碼已存在' }, 409)
    throw e
  }
})

// ── Links: delete (owner or admin) ───────────────────────────────────────────
app.delete('/api/links/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const existing = await c.env.DB.prepare('SELECT owner_email FROM links WHERE id = ?')
    .bind(id)
    .first<{ owner_email: string }>()
  if (!existing) return c.json({ error: '找不到此連結' }, 404)
  if (existing.owner_email !== user.email && !user.is_admin) return c.json({ error: '沒有權限' }, 403)

  await c.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ════════════════════════════════════════════════════════════════════════════
// ── Admin routes ─────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// All links across all users (with owner ban status)
app.get('/api/admin/links', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: '沒有權限' }, 403)
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, COALESCE(u.banned, 0) AS owner_banned
     FROM links l LEFT JOIN users u ON u.email = l.owner_email
     ORDER BY l.created_at DESC`
  ).all()
  return c.json({ links: results })
})

// All users with link counts
app.get('/api/admin/users', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: '沒有權限' }, 403)
  const { results } = await c.env.DB.prepare(
    `SELECT u.email, u.banned, u.is_admin, u.created_at,
            COUNT(l.id) AS link_count
     FROM users u LEFT JOIN links l ON l.owner_email = u.email
     GROUP BY u.email ORDER BY u.created_at DESC`
  ).all()
  return c.json({ users: results })
})

// Ban / unban a user
app.post('/api/admin/users/:email/ban', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: '沒有權限' }, 403)
  const email = normalizeEmail(decodeURIComponent(c.req.param('email')))
  const { banned } = await c.req.json<{ banned: boolean }>()

  const target = await c.env.DB.prepare(
    `SELECT sso_subject, is_admin FROM users WHERE lower(email) = ?`
  ).bind(email).first<{ sso_subject: string | null; is_admin: number }>()
  if (!target) return c.json({ error: '找不到此帳號' }, 404)
  if (target.is_admin === 1) return c.json({ error: '無法停權管理員帳號' }, 400)

  const statements = [
    c.env.DB.prepare('UPDATE users SET banned = ? WHERE lower(email) = ?')
      .bind(banned ? 1 : 0, email),
  ]
  if (banned && target.sso_subject) {
    statements.push(
      c.env.DB.prepare('DELETE FROM sessions WHERE sso_subject = ?').bind(target.sso_subject),
    )
  }
  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})

// Disable / enable a single link
app.post('/api/admin/links/:id/disable', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: '沒有權限' }, 403)
  const id = Number(c.req.param('id'))
  const { active, reason } = await c.req.json<{ active: boolean; reason?: string }>()

  const link = await c.env.DB.prepare(
    `UPDATE links SET active = ?, disabled_reason = ?, updated_at = datetime('now')
     WHERE id = ? RETURNING *`
  )
    .bind(active ? 1 : 0, active ? null : reason ?? '違反使用條款', id)
    .first<LinkRow>()
  if (!link) return c.json({ error: '找不到此連結' }, 404)
  return c.json({ link })
})

// Admin edit any link (slug / target)
app.put('/api/admin/links/:id', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: '沒有權限' }, 403)
  const id = Number(c.req.param('id'))
  const { slug, target_url } = await c.req.json<{ slug?: string; target_url?: string }>()

  if (slug?.trim() && !/^[a-zA-Z0-9_-]+$/.test(slug.trim())) return c.json({ error: '無效的短代碼' }, 400)
  if (target_url?.trim() && !isAllowedTargetUrl(target_url)) {
    return c.json({ error: '無效的目標網址' }, 400)
  }
  try {
    const link = await c.env.DB.prepare(
      `UPDATE links SET slug = COALESCE(NULLIF(?, ''), slug),
                        target_url = COALESCE(NULLIF(?, ''), target_url),
                        updated_at = datetime('now')
       WHERE id = ? RETURNING *`
    )
      .bind(slug?.trim() ?? '', target_url?.trim() ?? '', id)
      .first<LinkRow>()
    if (!link) return c.json({ error: '找不到此連結' }, 404)
    return c.json({ link })
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return c.json({ error: '此短代碼已存在' }, 409)
    throw e
  }
})

// ── Short URL redirect ───────────────────────────────────────────────────────
// Root-level public files would otherwise be mistaken for short-link slugs.
const servePublicAsset = (c: Ctx) => c.env.ASSETS.fetch(c.req.raw)
app.on(['GET', 'HEAD'], '/favicon.svg', servePublicAsset)
app.on(['GET', 'HEAD'], '/og-image.svg', servePublicAsset)
app.on(['GET', 'HEAD'], '/og-image.png', servePublicAsset)

// Social crawlers follow this redirect and use the target page's Open Graph data.
// HEAD support also lets link unfurlers validate a short URL without downloading HTML.
app.on(['GET', 'HEAD'], '/:slug', async (c) => {
  const slug = c.req.param('slug')
  if (RESERVED.has(slug)) return serveSPA(c, 200)

  try {
    const row = await c.env.DB.prepare(
      `SELECT l.target_url, l.active, COALESCE(u.banned, 0) AS owner_banned
       FROM links l LEFT JOIN users u ON u.email = l.owner_email
       WHERE l.slug = ?`
    )
      .bind(slug)
      .first<{ target_url: string; active: number; owner_banned: number }>()

    if (row && row.active === 1 && row.owner_banned === 0) {
      // Targets are editable, so a permanent redirect would leave browsers and
      // social platforms stuck on an old destination after an update.
      c.header('Cache-Control', 'no-store')
      return c.redirect(row.target_url, 302)
    }
  } catch {
    /* fall through to 404 SPA */
  }

  // Not found, disabled, or owner banned → fun 404 (SPA handles the slug route)
  return serveSPA(c, 404)
})

// ── Catch-all: static assets / SPA ───────────────────────────────────────────
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

function serveSPA(c: Ctx, status: number) {
  const url = new URL(c.req.raw.url)
  url.pathname = '/'
  return c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers })).then((res) =>
    status === 200 ? res : new Response(res.body, { status, headers: res.headers })
  )
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
}
