/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Env = {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ALLOWED_EMAIL: string // admin email
}

type SessionUser = { email: string; is_admin: boolean; banned: boolean }

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

type AppEnv = { Bindings: Env; Variables: Variables }
type Ctx = Context<AppEnv>

const app = new Hono<AppEnv>()

// Surface real errors instead of opaque 500s
app.onError((err, c) => {
  console.error('[Worker Error]', err)
  return c.json({ error: err.message }, 500)
})

// ── Helpers ────────────────────────────────────────────────────────────────────
function randSlug(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => chars[b % chars.length]).join('')
}

async function loadUser(c: Ctx): Promise<SessionUser | null> {
  const sid = getCookie(c, 'session')
  if (!sid) return null
  const row = await c.env.DB.prepare(
    `SELECT s.email AS email, u.banned AS banned, u.is_admin AS is_admin
     FROM sessions s LEFT JOIN users u ON u.email = s.email
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  )
    .bind(sid)
    .first<{ email: string; banned: number | null; is_admin: number | null }>()
  if (!row) return null
  return { email: row.email, banned: !!row.banned, is_admin: !!row.is_admin }
}

// ── Auth gate for all /api/links + /api/admin routes ─────────────────────────────
const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (user.banned) return c.json({ error: '此帳號已被停權' }, 403)
  c.set('user', user)
  await next()
}

function requireAdmin(c: Ctx): boolean {
  return c.get('user')?.is_admin === true
}

app.use('/api/links/*', authMiddleware)
app.use('/api/links', authMiddleware)
app.use('/api/admin/*', authMiddleware)

// ── Auth: me ─────────────────────────────────────────────────────────────────
app.get('/api/auth/me', async (c) => {
  const user = await loadUser(c)
  return c.json({ user })
})

// ── Auth: login ──────────────────────────────────────────────────────────────
app.get('/api/auth/login', (c) => {
  const state = crypto.randomUUID()
  const u = new URL(c.req.url)
  const redirect = `${u.protocol}//${u.host}/api/auth/callback`
  setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600, path: '/' })
  return c.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?` +
      new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'openid email',
        state,
        prompt: 'select_account',
      })
  )
})

// ── Auth: callback ───────────────────────────────────────────────────────────
app.get('/api/auth/callback', async (c) => {
  const { code, state, error } = c.req.query()
  if (error) return c.redirect('/?error=auth_failed')
  const stored = getCookie(c, 'oauth_state')
  deleteCookie(c, 'oauth_state', { path: '/' })
  if (!code || !state || state !== stored) return c.redirect('/?error=invalid_state')

  const u = new URL(c.req.url)
  const redirect = `${u.protocol}//${u.host}/api/auth/callback`

  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = (await tr.json()) as { access_token?: string }
  if (!tokens.access_token) return c.redirect('/?error=auth_failed')

  const ur = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const info = (await ur.json()) as { email: string }
  if (!info.email) return c.redirect('/?error=auth_failed')

  const isAdmin = info.email === c.env.ALLOWED_EMAIL ? 1 : 0

  // Upsert user (preserve banned flag; keep admin status in sync)
  await c.env.DB.prepare(
    `INSERT INTO users (email, is_admin) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET is_admin = excluded.is_admin`
  )
    .bind(info.email, isAdmin)
    .run()

  const banned = await c.env.DB.prepare('SELECT banned FROM users WHERE email = ?')
    .bind(info.email)
    .first<{ banned: number }>()
  if (banned?.banned) return c.redirect('/?error=banned')

  const sid = crypto.randomUUID()
  const exp = new Date(Date.now() + 7 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  await c.env.DB.prepare(`INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)`)
    .bind(sid, info.email, exp)
    .run()
  setCookie(c, 'session', sid, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 7 * 86400, path: '/' })
  return c.redirect(isAdmin ? '/admin' : '/dashboard')
})

// ── Auth: logout ─────────────────────────────────────────────────────────────
app.post('/api/auth/logout', async (c) => {
  const sid = getCookie(c, 'session')
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run()
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
  try {
    new URL(target_url)
  } catch {
    return c.json({ error: '無效的目標網址' }, 400)
  }

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
  if (target_url?.trim()) {
    try {
      new URL(target_url)
    } catch {
      return c.json({ error: '無效的目標網址' }, 400)
    }
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
  const email = decodeURIComponent(c.req.param('email'))
  const { banned } = await c.req.json<{ banned: boolean }>()

  if (email === c.env.ALLOWED_EMAIL) return c.json({ error: '無法停權管理員帳號' }, 400)

  await c.env.DB.prepare('UPDATE users SET banned = ? WHERE email = ?')
    .bind(banned ? 1 : 0, email)
    .run()
  // When banning, also kill their active sessions
  if (banned) await c.env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email).run()
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
  if (target_url?.trim()) {
    try {
      new URL(target_url)
    } catch {
      return c.json({ error: '無效的目標網址' }, 400)
    }
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
