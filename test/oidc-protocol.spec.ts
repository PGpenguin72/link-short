import * as oauth from 'oauth4webapi'
import { readFile } from 'node:fs/promises'
import { Miniflare } from 'miniflare'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import worker, { logOidcCallbackFailure } from '../src-worker/index'
import {
  createAuthorizationRequest,
  decodeOidcTransaction,
  encodeOidcTransaction,
  processAuthorizationCallback,
  type OidcBindings,
  type OidcTransaction,
} from '../src-worker/oidc'

const ISSUER = 'https://sso-preview.test'
const APP_BASE_URL = 'https://link-preview.test'
const CLIENT_ID = 'pg72-link-test'
const CLIENT_SECRET = 'pg72-link-test-client-secret'
const SUBJECT = 'pg72-user-subject'
const env: OidcBindings = {
  APP_BASE_URL,
  PG72_ID_ISSUER: ISSUER,
  PG72_ID_CLIENT_ID: CLIENT_ID,
  PG72_ID_CLIENT_SECRET: CLIENT_SECRET,
}

let signingKeys: CryptoKeyPair
let publicJwk: JsonWebKey

function base64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function jsonPart(value: object): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)))
}

async function idToken(audience: string, nonce: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = jsonPart({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
  const payload = jsonPart({
    iss: ISSUER,
    sub: SUBJECT,
    aud: audience,
    iat: now,
    exp: now + 600,
    nonce,
  })
  const signingInput = `${header}.${payload}`
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingKeys.privateKey,
    new TextEncoder().encode(signingInput),
  ))
  return `${signingInput}.${base64Url(signature)}`
}

function discoveryResponse(): Response {
  return Response.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth2/authorize`,
    token_endpoint: `${ISSUER}/oauth2/token`,
    userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
    jwks_uri: `${ISSUER}/oauth2/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  })
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

function installProviderMock(options: {
  transaction: OidcTransaction
  codeChallenge: string
  audience?: string
  nonce?: string
  onTokenRequest?: () => void
  rejectReplayWith?: string
}) {
  let tokenRequests = 0
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = requestUrl(input)
    if (url.pathname === '/.well-known/openid-configuration') return discoveryResponse()
    if (url.pathname === '/oauth2/token') {
      tokenRequests += 1
      options.onTokenRequest?.()
      const headers = new Headers(init?.headers)
      // ClientSecretPost: credentials travel in the body, not a Basic header,
      // to avoid oauth4webapi percent-encoding "-"/"_" in a way the PGID token
      // endpoint does not decode.
      expect(headers.get('authorization')).toBeNull()
      const body = init?.body instanceof URLSearchParams
        ? init.body
        : new URLSearchParams(String(init?.body ?? ''))
      expect(body.get('client_id')).toBe(CLIENT_ID)
      expect(body.get('client_secret')).toBe(CLIENT_SECRET)
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('redirect_uri')).toBe(`${APP_BASE_URL}/api/auth/callback`)
      expect(body.get('code_verifier')).toBe(options.transaction.codeVerifier)
      expect(await oauth.calculatePKCECodeChallenge(body.get('code_verifier') ?? ''))
        .toBe(options.codeChallenge)
      if (tokenRequests > 1 && options.rejectReplayWith) {
        return Response.json({
          error: 'invalid_grant',
          error_description: options.rejectReplayWith,
          error_uri: 'https://sso-preview.test/errors?code=replayed-secret-code',
        }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
      return Response.json({
        access_token: 'pg72_at_protocol_test',
        token_type: 'Bearer',
        expires_in: 900,
        id_token: await idToken(
          options.audience ?? CLIENT_ID,
          options.nonce ?? options.transaction.nonce,
        ),
      })
    }
    if (url.pathname === '/oauth2/jwks') {
      return Response.json({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] })
    }
    if (url.pathname === '/oauth2/userinfo') {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer pg72_at_protocol_test')
      return Response.json({
        sub: SUBJECT,
        email: 'Verified@PG72.test',
        email_verified: true,
      })
    }
    throw new Error(`Unexpected test request: ${url.href}`)
  })
}

function d1ExecScript(sql: string): string {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((statement) => `${statement};`)
    .join('\n')
}

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext

beforeAll(async () => {
  signingKeys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  publicJwk = await crypto.subtle.exportKey('jwk', signingKeys.publicKey)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PG72 ID OIDC protocol', () => {
  it('HMAC-protects the state, nonce, and PKCE transaction cookie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(discoveryResponse())
    const { transaction } = await createAuthorizationRequest(env)
    const encoded = await encodeOidcTransaction(transaction, CLIENT_SECRET)
    await expect(decodeOidcTransaction(encoded, CLIENT_SECRET)).resolves.toEqual(transaction)

    // Flip the first signature character: the last one only carries 2
    // significant bits, so flipping it can decode to the same signature.
    const [payload, signature] = encoded.split('.')
    const tampered = `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
    await expect(decodeOidcTransaction(tampered, CLIENT_SECRET)).resolves.toBeNull()
    vi.restoreAllMocks()
  })

  it('validates state, PKCE S256, nonce, issuer, audience, signature, sub, and verified email', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(discoveryResponse())
    const { authorizationUrl, transaction } = await createAuthorizationRequest(env)
    vi.restoreAllMocks()
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('state')).toBe(transaction.state)
    expect(authorizationUrl.searchParams.get('nonce')).toBe(transaction.nonce)

    installProviderMock({
      transaction,
      codeChallenge: authorizationUrl.searchParams.get('code_challenge') ?? '',
    })
    const callback = new URL('/api/auth/callback', APP_BASE_URL)
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', transaction.state)
    callback.searchParams.set('iss', ISSUER)

    await expect(processAuthorizationCallback(env, callback.href, transaction)).resolves.toEqual({
      subject: SUBJECT,
      email: 'verified@pg72.test',
    })
    vi.restoreAllMocks()
  })

  it('rejects a callback with the wrong state before exchanging the code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(discoveryResponse())
    const { authorizationUrl, transaction } = await createAuthorizationRequest(env)
    vi.restoreAllMocks()
    let tokenRequests = 0
    installProviderMock({
      transaction,
      codeChallenge: authorizationUrl.searchParams.get('code_challenge') ?? '',
      onTokenRequest: () => { tokenRequests += 1 },
    })
    const callback = new URL('/api/auth/callback', APP_BASE_URL)
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', 'wrong-state-value-that-is-long-enough')
    callback.searchParams.set('iss', ISSUER)

    await expect(processAuthorizationCallback(env, callback.href, transaction)).rejects.toThrow()
    expect(tokenRequests).toBe(0)
    vi.restoreAllMocks()
  })

  it.each([
    ['audience', 'another-client', undefined],
    ['nonce', undefined, 'wrong-nonce-value-that-is-long-enough'],
  ] as const)('rejects an ID Token with the wrong %s', async (_name, audience, nonce) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(discoveryResponse())
    const { authorizationUrl, transaction } = await createAuthorizationRequest(env)
    vi.restoreAllMocks()
    installProviderMock({
      transaction,
      codeChallenge: authorizationUrl.searchParams.get('code_challenge') ?? '',
      audience,
      nonce,
    })
    const callback = new URL('/api/auth/callback', APP_BASE_URL)
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', transaction.state)
    callback.searchParams.set('iss', ISSUER)

    await expect(processAuthorizationCallback(env, callback.href, transaction)).rejects.toThrow()
    vi.restoreAllMocks()
  })

  it('rejects a replayed callback without logging provider descriptions or raw values', async () => {
    const miniflare = new Miniflare({
      compatibilityDate: '2026-07-10',
      modules: true,
      script: 'export default { fetch() { return new Response(null) } }',
      d1Databases: { DB: 'callback-replay-test' },
    })
    try {
      const database = await miniflare.getD1Database('DB') as unknown as D1Database
      const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
      await database.exec(d1ExecScript(schema))

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(discoveryResponse())
      const { authorizationUrl, transaction } = await createAuthorizationRequest(env)
      vi.restoreAllMocks()

      const sensitiveDescription = [
        'replay rejected',
        'victim@example.test',
        'pg72_at_should_never_be_logged',
        'authorization_code=private-code',
      ].join('\n')
      let tokenRequests = 0
      installProviderMock({
        transaction,
        codeChallenge: authorizationUrl.searchParams.get('code_challenge') ?? '',
        rejectReplayWith: sensitiveDescription,
        onTokenRequest: () => { tokenRequests += 1 },
      })
      const callback = new URL('/api/auth/callback', APP_BASE_URL)
      callback.searchParams.set('code', 'authorization-code')
      callback.searchParams.set('state', transaction.state)
      callback.searchParams.set('iss', ISSUER)
      const encodedTransaction = await encodeOidcTransaction(transaction, CLIENT_SECRET)
      const callbackRequest = () => new Request(callback, {
        headers: { cookie: `__Host-link_oidc=${encodedTransaction}` },
      })
      const workerEnv = {
        ...env,
        DB: database,
        ASSETS: { fetch: () => new Response('unused') },
      } as never

      const first = await worker.fetch(callbackRequest(), workerEnv, ctx)
      expect(first.status).toBe(302)
      expect(first.headers.get('location')).toBe('/dashboard')
      const firstSessionCount = await database.prepare(
        'SELECT COUNT(*) AS count FROM sessions',
      ).first<{ count: number }>()
      expect(firstSessionCount?.count).toBe(1)

      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      const replay = await worker.fetch(callbackRequest(), workerEnv, ctx)
      expect(replay.status).toBe(302)
      expect(replay.headers.get('location')).toBe('/?error=auth_failed')
      expect(tokenRequests).toBe(2)
      const replaySessionCount = await database.prepare(
        'SELECT COUNT(*) AS count FROM sessions',
      ).first<{ count: number }>()
      expect(replaySessionCount?.count).toBe(1)

      expect(errorLog).toHaveBeenCalledTimes(1)
      const serializedLog = String(errorLog.mock.calls[0]?.[0])
      expect(serializedLog).toBe(
        '{"event":"oidc_callback_failed","oauthError":"invalid_grant"}',
      )
      expect(serializedLog).not.toContain('\n')
      expect(serializedLog).not.toContain('victim@example.test')
      expect(serializedLog).not.toContain('pg72_at_should_never_be_logged')
      expect(serializedLog).not.toContain('authorization_code')
      expect(serializedLog).not.toContain('error_uri')
    } finally {
      await miniflare.dispose()
    }
  })

  it('logs only a generic callback event for unrecognized provider errors', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    logOidcCallbackFailure({
      error: 'unknown_error\nprivate-token',
      error_description: 'victim@example.test',
      error_uri: 'https://sso-preview.test/private',
    })
    expect(errorLog).toHaveBeenCalledWith('{"event":"oidc_callback_failed"}')
  })
})
