/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Env = {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ALLOWED_EMAIL: string
}

type Variables = { email: string }

type LinkRow = {
  id: number
  slug: string
  target_url: string
  created_at: string
  updated_at: string
}

const RESERVED = new Set(['admin', 'login', 'api'])

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// ── Auth middleware ────────────────────────────────────────────────────────────
app.use('/api/links/*', async (c, next) => {
  const sid = getCookie(c, 'session')
  if (!sid) return c.json({ error: 'Unauthorized' }, 401)
  const row = await c.env.DB.prepare(
    `SELECT email FROM sessions WHERE id=? AND expires_at>datetime('now')`
  ).bind(sid).first<{ email: string }>()
  if (!row) return c.json({ error: 'Unauthorized' }, 401)
  c.set('email', row.email)
  await next()
})

// ── GET /api/auth/me ───────────────────────────────────────────────────────────
app.get('/api/auth/me', async (c) => {
  const sid = getCookie(c, 'session')
  if (!sid) return c.json({ user: null })
  const row = await c.env.DB.prepare(
    `SELECT email FROM sessions WHERE id=? AND expires_at>datetime('now')`
  ).bind(sid).first<{ email: string }>()
  return c.json({ user: row ? { email: row.email } : null })
})

// ── GET /api/auth/login ────────────────────────────────────────────────────────
app.get('/api/auth/login', (c) => {
  const state = crypto.randomUUID()
  const u = new URL(c.req.url)
  const redirect = `${u.protocol}//${u.host}/api/auth/callback`
  setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600, path: '/' })
  return c.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri: redirect,
      response_type: 'code', scope: 'openid email', state, prompt: 'select_account' })
  )
})

// ── GET /api/auth/callback ─────────────────────────────────────────────────────
app.get('/api/auth/callback', async (c) => {
  const { code, state, error } = c.req.query()
  if (error) return c.redirect('/?error=auth_failed')
  const stored = getCookie(c, 'oauth_state')
  deleteCookie(c, 'oauth_state', { path: '/' })
  if (!code || !state || state !== stored) return c.redirect('/?error=invalid_state')

  const u = new URL(c.req.url)
  const redirect = `${u.protocol}//${u.host}/api/auth/callback`

  // Debug: check env vars are present
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: 'Missing GOOGLE_CLIENT_ID' }, 500)
  if (!c.env.GOOGLE_CLIENT_SECRET) return c.json({ error: 'Missing GOOGLE_CLIENT_SECRET' }, 500)
  if (!c.env.ALLOWED_EMAIL) return c.json({ error: 'Missing ALLOWED_EMAIL' }, 500)

  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect,
      grant_type: 'authorization_code' }),
  })
  const tokens = await tr.json() as { access_token?: string; error?: string; error_description?: string }
  if (!tokens.access_token) return c.json({ error: 'Token exchange failed', detail: tokens }, 500)

  const ur = await fetch('https://www.googleapis.com/oauth2/v2/userinfo',
    { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  const info = await ur.json() as { email: string }
  if (info.email !== c.env.ALLOWED_EMAIL) return c.redirect('/?error=unauthorized')

  // Debug: check DB binding
  if (!c.env.DB) return c.json({ error: 'Missing D1 binding (DB)' }, 500)

  const sid = crypto.randomUUID()
  const exp = new Date(Date.now() + 7 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  await c.env.DB.prepare(`INSERT INTO sessions (id,email,expires_at) VALUES (?,?,?)`)
    .bind(sid, info.email, exp).run()
  setCookie(c, 'session', sid, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 7 * 86400, path: '/' })
  return c.redirect('/admin')
})

// ── POST /api/auth/logout ──────────────────────────────────────────────────────
app.post('/api/auth/logout', async (c) => {
  const sid = getCookie(c, 'session')
  if (sid) { await c.env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run() }
  deleteCookie(c, 'session', { path: '/' })
  return c.json({ ok: true })
})

// ── GET /api/links ─────────────────────────────────────────────────────────────
app.get('/api/links', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM links ORDER BY created_at DESC').all<LinkRow>()
  return c.json({ links: results })
})

// ── POST /api/links ────────────────────────────────────────────────────────────
app.post('/api/links', async (c) => {
  const { slug: rawSlug, target_url } = await c.req.json<{ slug?: string; target_url: string }>()
  if (!target_url?.trim()) return c.json({ error: '目標網址為必填' }, 400)
  try { new URL(target_url) } catch { return c.json({ error: '無效的目標網址' }, 400) }

  let slug = rawSlug?.trim()
  if (!slug) {
    for (let i = 0; i < 5; i++) {
      const c2 = randSlug()
      if (!await c.env.DB.prepare('SELECT id FROM links WHERE slug=?').bind(c2).first()) { slug = c2; break }
    }
  }
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) return c.json({ error: '無效的短代碼' }, 400)
  if (RESERVED.has(slug.toLowerCase())) return c.json({ error: '此短代碼為保留字' }, 400)

  try {
    const link = await c.env.DB.prepare(`INSERT INTO links (slug,target_url) VALUES (?,?) RETURNING *`)
      .bind(slug, target_url.trim()).first<LinkRow>()
    return c.json({ link }, 201)
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return c.json({ error: '此短代碼已存在' }, 409)
    throw e
  }
})

// ── PUT /api/links/:id ─────────────────────────────────────────────────────────
app.put('/api/links/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { slug, target_url } = await c.req.json<{ slug?: string; target_url?: string }>()
  if (!slug?.trim() && !target_url?.trim()) return c.json({ error: '沒有要更新的內容' }, 400)
  if (slug?.trim() && !/^[a-zA-Z0-9_-]+$/.test(slug.trim())) return c.json({ error: '無效的短代碼' }, 400)
  if (target_url?.trim()) { try { new URL(target_url) } catch { return c.json({ error: '無效的目標網址' }, 400) } }

  try {
    const link = await c.env.DB.prepare(
      `UPDATE links SET slug=COALESCE(NULLIF(?,''),slug), target_url=COALESCE(NULLIF(?,''),target_url),
       updated_at=datetime('now') WHERE id=? RETURNING *`
    ).bind(slug?.trim() ?? '', target_url?.trim() ?? '', id).first<LinkRow>()
    if (!link) return c.json({ error: '找不到此連結' }, 404)
    return c.json({ link })
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return c.json({ error: '此短代碼已存在' }, 409)
    throw e
  }
})

// ── DELETE /api/links/:id ──────────────────────────────────────────────────────
app.delete('/api/links/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const link = await c.env.DB.prepare('DELETE FROM links WHERE id=? RETURNING *').bind(id).first<LinkRow>()
  if (!link) return c.json({ error: '找不到此連結' }, 404)
  return c.json({ ok: true })
})

// ── /:slug — short URL redirect ────────────────────────────────────────────────
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  // SPA routes — let static files handle via ASSETS
  if (RESERVED.has(slug)) return serveSPA(c)

  try {
    const row = await c.env.DB.prepare('SELECT target_url FROM links WHERE slug=?')
      .bind(slug).first<{ target_url: string }>()
    if (row) return c.redirect(row.target_url, 301)
  } catch { /* DB unavailable */ }

  return serveSPA(c)
})

// ── Catch-all: serve static files ─────────────────────────────────────────────
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

// ── Helpers ───────────────────────────────────────────────────────────────────
function serveSPA(c: Parameters<typeof app.get>[1] extends (c: infer C) => unknown ? C : never) {
  const url = new URL(c.req.url)
  url.pathname = '/'
  return c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers }))
}

function randSlug(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => chars[b % chars.length]).join('')
}

// Use standard Worker export format — required for Cloudflare Pages _worker.js
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
}
