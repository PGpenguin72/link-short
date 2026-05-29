/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { handle } from 'hono/cloudflare-pages'

type Env = {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ALLOWED_EMAIL: string
}

type Variables = {
  sessionEmail: string
}

type GoogleTokenResponse = {
  access_token?: string
  error?: string
}

type GoogleUserInfo = {
  email: string
  verified_email: boolean
}

type LinkRow = {
  id: number
  slug: string
  target_url: string
  created_at: string
  updated_at: string
}

type SessionRow = {
  id: string
  email: string
}

const RESERVED_SLUGS = new Set(['admin', 'login', 'api', 'favicon.svg', 'assets'])

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// ─── Helpers ────────────────────────────────────────────────────────────────

function getBaseUrl(req: Request): string {
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}`
}

function generateSlug(length = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => chars[b % chars.length]).join('')
}

async function getSession(c: { req: { raw: Request }; env: Env }): Promise<SessionRow | null> {
  const sessionId = getCookie({ req: c.req, res: new Response() } as never, 'session')
  if (!sessionId) return null
  const row = await c.env.DB.prepare(
    `SELECT id, email FROM sessions WHERE id = ? AND expires_at > datetime('now')`
  )
    .bind(sessionId)
    .first<SessionRow>()
  return row ?? null
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────

const requireAuth = async (c: Parameters<typeof app.use>[1] extends (c: infer C, n: infer N) => infer R ? C : never, next: () => Promise<void>) => {
  const sessionId = getCookie(c, 'session')
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)
  const row = await c.env.DB.prepare(
    `SELECT id, email FROM sessions WHERE id = ? AND expires_at > datetime('now')`
  )
    .bind(sessionId)
    .first<SessionRow>()
  if (!row) return c.json({ error: 'Unauthorized' }, 401)
  c.set('sessionEmail', row.email)
  await next()
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────

app.get('/api/auth/me', async (c) => {
  const session = await getSession(c as never)
  if (!session) return c.json({ user: null })
  return c.json({ user: { email: session.email } })
})

app.get('/api/auth/login', async (c) => {
  const state = crypto.randomUUID()
  const redirectUri = `${getBaseUrl(c.req.raw)}/api/auth/callback`

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  })

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  })

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

app.get('/api/auth/callback', async (c) => {
  const { code, state, error } = c.req.query()

  if (error) return c.redirect('/?error=auth_failed')

  const storedState = getCookie(c, 'oauth_state')
  deleteCookie(c, 'oauth_state', { path: '/' })

  if (!code || !state || state !== storedState) {
    return c.redirect('/?error=invalid_state')
  }

  const redirectUri = `${getBaseUrl(c.req.raw)}/api/auth/callback`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = (await tokenRes.json()) as GoogleTokenResponse

  if (!tokens.access_token) return c.redirect('/?error=auth_failed')

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const userInfo = (await userRes.json()) as GoogleUserInfo

  if (userInfo.email !== c.env.ALLOWED_EMAIL) {
    return c.redirect('/?error=unauthorized')
  }

  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '')

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)`
  )
    .bind(sessionId, userInfo.email, expiresAt)
    .run()

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  })

  return c.redirect('/admin')
})

app.post('/api/auth/logout', async (c) => {
  const sessionId = getCookie(c, 'session')
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run()
    deleteCookie(c, 'session', { path: '/' })
  }
  return c.json({ ok: true })
})

// ─── Links API (protected) ────────────────────────────────────────────────────

app.get('/api/links', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM links ORDER BY created_at DESC'
  ).all<LinkRow>()
  return c.json({ links: results })
})

app.post('/api/links', requireAuth, async (c) => {
  const body = await c.req.json<{ slug?: string; target_url: string }>()
  let { slug, target_url } = body

  if (!target_url?.trim()) {
    return c.json({ error: '目標網址為必填' }, 400)
  }

  try {
    new URL(target_url)
  } catch {
    return c.json({ error: '無效的目標網址' }, 400)
  }

  if (!slug?.trim()) {
    // Auto-generate, retry on collision
    for (let i = 0; i < 5; i++) {
      slug = generateSlug()
      const existing = await c.env.DB.prepare(
        'SELECT id FROM links WHERE slug = ?'
      )
        .bind(slug)
        .first()
      if (!existing) break
    }
  } else {
    slug = slug.trim()
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(slug!)) {
    return c.json({ error: '短代碼只能包含字母、數字、連字符和底線' }, 400)
  }

  if (RESERVED_SLUGS.has(slug!.toLowerCase())) {
    return c.json({ error: '此短代碼為保留字，請換一個' }, 400)
  }

  try {
    const link = await c.env.DB.prepare(
      `INSERT INTO links (slug, target_url) VALUES (?, ?) RETURNING *`
    )
      .bind(slug, target_url.trim())
      .first<LinkRow>()
    return c.json({ link }, 201)
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return c.json({ error: '此短代碼已存在' }, 409)
    }
    throw e
  }
})

app.put('/api/links/:id', requireAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ slug?: string; target_url?: string }>()
  const { slug, target_url } = body

  if (!slug?.trim() && !target_url?.trim()) {
    return c.json({ error: '沒有要更新的內容' }, 400)
  }

  if (slug?.trim()) {
    if (!/^[a-zA-Z0-9_-]+$/.test(slug.trim())) {
      return c.json({ error: '短代碼只能包含字母、數字、連字符和底線' }, 400)
    }
    if (RESERVED_SLUGS.has(slug.trim().toLowerCase())) {
      return c.json({ error: '此短代碼為保留字' }, 400)
    }
  }

  if (target_url?.trim()) {
    try {
      new URL(target_url)
    } catch {
      return c.json({ error: '無效的目標網址' }, 400)
    }
  }

  try {
    const link = await c.env.DB.prepare(
      `UPDATE links
       SET slug       = COALESCE(NULLIF(?, ''), slug),
           target_url = COALESCE(NULLIF(?, ''), target_url),
           updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
      .bind(slug?.trim() ?? '', target_url?.trim() ?? '', id)
      .first<LinkRow>()

    if (!link) return c.json({ error: '找不到此連結' }, 404)
    return c.json({ link })
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return c.json({ error: '此短代碼已存在' }, 409)
    }
    throw e
  }
})

app.delete('/api/links/:id', requireAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const link = await c.env.DB.prepare(
    'DELETE FROM links WHERE id = ? RETURNING *'
  )
    .bind(id)
    .first<LinkRow>()

  if (!link) return c.json({ error: '找不到此連結' }, 404)
  return c.json({ ok: true })
})

// ─── Short URL Redirect ───────────────────────────────────────────────────────

app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')

  const link = await c.env.DB.prepare(
    'SELECT target_url FROM links WHERE slug = ?'
  )
    .bind(slug)
    .first<Pick<LinkRow, 'target_url'>>()

  if (link) {
    return c.redirect(link.target_url, 301)
  }

  // Unknown slug — serve SPA (handles /admin, /login client-side routes)
  const url = new URL(c.req.url)
  url.pathname = '/'
  return c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers }))
})

// ─── SPA Fallback ────────────────────────────────────────────────────────────

app.get('/', async (c) => c.env.ASSETS.fetch(c.req.raw))

app.all('*', async (c) => {
  const url = new URL(c.req.url)
  url.pathname = '/'
  return c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers }))
})

export const onRequest = handle(app)
