import * as oauth from 'oauth4webapi'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const OIDC_TIMEOUT_MS = 5_000
const TRANSACTION_TTL_MS = 10 * 60 * 1_000
const MAX_TRANSACTION_COOKIE_LENGTH = 2_048

export interface OidcBindings {
  APP_BASE_URL: string
  PG72_ID_ISSUER: string
  PG72_ID_CLIENT_ID: string
  PG72_ID_CLIENT_SECRET: string
}

export interface OidcTransaction {
  state: string
  nonce: string
  codeVerifier: string
  createdAt: number
}

export interface VerifiedOidcIdentity {
  subject: string
  email: string
}

interface OidcConfig {
  issuer: URL
  appBaseUrl: URL
  redirectUri: string
  client: oauth.Client
  clientAuth: oauth.ClientAuth
}

function requiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`Missing required environment variable: ${name}`)
  return normalized
}

function exactOrigin(raw: string, name: string, allowLocalHttp = false): URL {
  const url = new URL(raw)
  const localHttp = allowLocalHttp
    && url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (
    url.origin !== raw
    || url.username
    || url.password
    || (url.protocol !== 'https:' && !localHttp)
  ) {
    throw new Error(`${name} must be an exact HTTPS origin`)
  }
  return url
}

function readConfig(env: OidcBindings): OidcConfig {
  const issuer = exactOrigin(
    requiredValue(env.PG72_ID_ISSUER, 'PG72_ID_ISSUER'),
    'PG72_ID_ISSUER',
  )
  const appBaseUrl = exactOrigin(
    requiredValue(env.APP_BASE_URL, 'APP_BASE_URL'),
    'APP_BASE_URL',
    true,
  )
  const clientId = requiredValue(env.PG72_ID_CLIENT_ID, 'PG72_ID_CLIENT_ID')
  const clientSecret = requiredValue(env.PG72_ID_CLIENT_SECRET, 'PG72_ID_CLIENT_SECRET')
  if (
    clientId.length > 255
    || clientSecret.length > 512
    || /[\u0000-\u001f\u007f]/.test(clientId + clientSecret)
  ) {
    throw new Error('Invalid PG72 ID client configuration')
  }
  return {
    issuer,
    appBaseUrl,
    redirectUri: `${appBaseUrl.origin}/api/auth/callback`,
    client: { client_id: clientId },
    clientAuth: oauth.ClientSecretBasic(clientSecret),
  }
}

function encodeBase64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_OIDC_TRANSACTION')
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = atob(padded)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

async function transactionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function validTransaction(transaction: OidcTransaction, now = Date.now()): boolean {
  const safeValue = (value: string, min: number, max: number) => (
    value.length >= min
    && value.length <= max
    && /^[A-Za-z0-9._~-]+$/.test(value)
  )
  return safeValue(transaction.state, 32, 256)
    && safeValue(transaction.nonce, 32, 256)
    && safeValue(transaction.codeVerifier, 43, 128)
    && Number.isSafeInteger(transaction.createdAt)
    && transaction.createdAt <= now + 60_000
    && now - transaction.createdAt <= TRANSACTION_TTL_MS
}

export async function encodeOidcTransaction(
  transaction: OidcTransaction,
  secret: string,
): Promise<string> {
  if (!validTransaction(transaction)) throw new Error('INVALID_OIDC_TRANSACTION')
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(transaction)))
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await transactionKey(secret), encoder.encode(payload)),
  )
  return `${payload}.${encodeBase64Url(signature)}`
}

export async function decodeOidcTransaction(
  value: string | undefined,
  secret: string,
): Promise<OidcTransaction | null> {
  if (!value || value.length > MAX_TRANSACTION_COOKIE_LENGTH) return null
  const parts = value.split('.')
  if (parts.length !== 2) return null
  try {
    const [payload, encodedSignature] = parts
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      await transactionKey(secret),
      decodeBase64Url(encodedSignature),
      encoder.encode(payload),
    )
    if (!validSignature) return null
    const parsed: unknown = JSON.parse(decoder.decode(decodeBase64Url(payload)))
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<OidcTransaction>
    if (
      typeof candidate.state !== 'string'
      || typeof candidate.nonce !== 'string'
      || typeof candidate.codeVerifier !== 'string'
      || typeof candidate.createdAt !== 'number'
    ) {
      return null
    }
    const transaction: OidcTransaction = {
      state: candidate.state,
      nonce: candidate.nonce,
      codeVerifier: candidate.codeVerifier,
      createdAt: candidate.createdAt,
    }
    return validTransaction(transaction) ? transaction : null
  } catch {
    return null
  }
}

async function discover(config: OidcConfig): Promise<oauth.AuthorizationServer> {
  const response = await oauth.discoveryRequest(config.issuer, {
    algorithm: 'oidc',
    signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
  })
  const authorizationServer = await oauth.processDiscoveryResponse(config.issuer, response)
  for (const endpoint of [
    authorizationServer.authorization_endpoint,
    authorizationServer.token_endpoint,
    authorizationServer.userinfo_endpoint,
    authorizationServer.jwks_uri,
  ]) {
    if (!endpoint || new URL(endpoint).protocol !== 'https:') {
      throw new Error('PG72 ID discovery metadata is incomplete')
    }
  }
  return authorizationServer
}

export async function createAuthorizationRequest(env: OidcBindings): Promise<{
  authorizationUrl: URL
  transaction: OidcTransaction
}> {
  const config = readConfig(env)
  const authorizationServer = await discover(config)
  const transaction: OidcTransaction = {
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    codeVerifier: oauth.generateRandomCodeVerifier(),
    createdAt: Date.now(),
  }
  const codeChallenge = await oauth.calculatePKCECodeChallenge(transaction.codeVerifier)
  const authorizationUrl = new URL(authorizationServer.authorization_endpoint!)
  authorizationUrl.searchParams.set('client_id', config.client.client_id)
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', 'openid email')
  authorizationUrl.searchParams.set('state', transaction.state)
  authorizationUrl.searchParams.set('nonce', transaction.nonce)
  authorizationUrl.searchParams.set('code_challenge', codeChallenge)
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  return { authorizationUrl, transaction }
}

function normalizeVerifiedEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('OIDC_VERIFIED_EMAIL_REQUIRED')
  const email = value.trim().toLowerCase()
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error('OIDC_VERIFIED_EMAIL_REQUIRED')
  }
  return email
}

export async function processAuthorizationCallback(
  env: OidcBindings,
  callbackUrl: string,
  transaction: OidcTransaction,
): Promise<VerifiedOidcIdentity> {
  if (!validTransaction(transaction)) throw new Error('INVALID_OIDC_TRANSACTION')
  const config = readConfig(env)
  const currentUrl = new URL(callbackUrl)
  if (currentUrl.origin !== config.appBaseUrl.origin || currentUrl.pathname !== '/api/auth/callback') {
    throw new Error('INVALID_OIDC_CALLBACK_ORIGIN')
  }

  const authorizationServer = await discover(config)
  const callbackParameters = oauth.validateAuthResponse(
    authorizationServer,
    config.client,
    currentUrl,
    transaction.state,
  )
  const tokenResponse = await oauth.authorizationCodeGrantRequest(
    authorizationServer,
    config.client,
    config.clientAuth,
    callbackParameters,
    config.redirectUri,
    transaction.codeVerifier,
    { signal: AbortSignal.timeout(OIDC_TIMEOUT_MS) },
  )
  const tokens = await oauth.processAuthorizationCodeResponse(
    authorizationServer,
    config.client,
    tokenResponse,
    { expectedNonce: transaction.nonce, requireIdToken: true },
  )
  await oauth.validateApplicationLevelSignature(authorizationServer, tokenResponse, {
    signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
  })
  const claims = oauth.getValidatedIdTokenClaims(tokens)
  if (
    !claims
    || !claims.sub
    || claims.sub.length > 255
    || /[\u0000-\u001f\u007f]/.test(claims.sub)
  ) {
    throw new Error('OIDC_INVALID_SUBJECT')
  }

  const userInfoResponse = await oauth.userInfoRequest(
    authorizationServer,
    config.client,
    tokens.access_token,
    { signal: AbortSignal.timeout(OIDC_TIMEOUT_MS) },
  )
  const profile = await oauth.processUserInfoResponse(
    authorizationServer,
    config.client,
    claims.sub,
    userInfoResponse,
  )
  if (profile.email_verified !== true) throw new Error('OIDC_VERIFIED_EMAIL_REQUIRED')
  return { subject: claims.sub, email: normalizeVerifiedEmail(profile.email) }
}
