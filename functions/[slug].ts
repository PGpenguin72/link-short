/// <reference types="@cloudflare/workers-types" />

type Env = {
  DB: D1Database
  ASSETS: Fetcher
}

// SPA routes that should render the React app
const SPA_ROUTES = new Set(['admin', 'login'])

export async function onRequest(
  context: EventContext<Env, 'slug', Record<string, unknown>>
): Promise<Response> {
  const slug = context.params.slug as string

  // Known SPA routes → serve React app
  if (SPA_ROUTES.has(slug)) {
    const url = new URL(context.request.url)
    url.pathname = '/'
    return context.env.ASSETS.fetch(new Request(url.toString(), context.request))
  }

  // Look up slug in D1
  try {
    const row = await context.env.DB.prepare(
      'SELECT target_url FROM links WHERE slug = ?'
    )
      .bind(slug)
      .first<{ target_url: string }>()

    if (row) {
      return Response.redirect(row.target_url, 301)
    }
  } catch {
    // DB not available or error → fall through to SPA
  }

  // Unknown slug → serve React app (will show 404 or home)
  const url = new URL(context.request.url)
  url.pathname = '/'
  return context.env.ASSETS.fetch(new Request(url.toString(), context.request))
}
