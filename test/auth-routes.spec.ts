import { describe, expect, it } from 'vitest'
import worker from '../src-worker/index'

// The auth routes delete `__Host-` cookies; hono throws unless the deletion
// Set-Cookie also carries `Secure`. These tests fail with a 500 if that
// attribute is ever dropped again.
const env = {
  APP_BASE_URL: 'https://link-preview.test',
  PG72_ID_ISSUER: 'https://sso-preview.test',
  PG72_ID_CLIENT_ID: 'pg72-link-test',
  PG72_ID_CLIENT_SECRET: 'pg72-link-test-client-secret',
} as never

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext

describe('auth route cookie handling', () => {
  it('callback without a transaction cookie redirects instead of failing', async () => {
    const response = await worker.fetch(
      new Request('https://link-preview.test/api/auth/callback?code=x&state=y'),
      env,
      ctx,
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/?error=invalid_state')
    const setCookie = response.headers.getSetCookie().join('\n')
    expect(setCookie).toContain('__Host-link_oidc=;')
    expect(setCookie).toContain('Secure')
  })

  it('logout clears the session cookie for a same-origin request', async () => {
    const response = await worker.fetch(
      new Request('https://link-preview.test/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://link-preview.test' },
      }),
      env,
      ctx,
    )
    expect(response.status).toBe(200)
    const setCookie = response.headers.getSetCookie().join('\n')
    expect(setCookie).toContain('__Host-link_session=;')
    expect(setCookie).toContain('Secure')
  })

  it('logout rejects a cross-origin request', async () => {
    const response = await worker.fetch(
      new Request('https://link-preview.test/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
      env,
      ctx,
    )
    expect(response.status).toBe(403)
  })
})
