import { readFile } from 'node:fs/promises'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resolveOidcUser } from '../src-worker/index'

let miniflare: Miniflare
let database: D1Database

const env = {
  get DB() { return database },
  BOOTSTRAP_ADMIN_EMAIL: 'admin@pg72.test',
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

beforeAll(async () => {
  miniflare = new Miniflare({
    compatibilityDate: '2026-07-10',
    modules: true,
    script: 'export default { fetch() { return new Response(null) } }',
    d1Databases: { DB: 'link-oidc-test' },
  })
  database = await miniflare.getD1Database('DB') as unknown as D1Database
  const [legacySchema, migration] = await Promise.all([
    readFile(new URL('./legacy-schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migration-003-pg72-oidc.sql', import.meta.url), 'utf8'),
  ])
  await database.exec(d1ExecScript(legacySchema))
  await database.exec(d1ExecScript(migration))
})

afterAll(async () => {
  await miniflare.dispose()
})

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM auth_bootstrap'),
    env.DB.prepare('DELETE FROM users'),
  ])
})

describe('stable PG72 ID identity and admin bootstrap', () => {
  it('binds a legacy admin once by verified email, then authenticates only by sub', async () => {
    await env.DB.prepare(
      `INSERT INTO users (email, banned, is_admin) VALUES ('admin@pg72.test', 0, 1)`,
    ).run()

    const first = await resolveOidcUser(env, 'pg72-admin-sub', 'ADMIN@pg72.test')
    expect(first).toMatchObject({
      email: 'admin@pg72.test',
      sso_subject: 'pg72-admin-sub',
      is_admin: 1,
    })

    const returning = await resolveOidcUser(env, 'pg72-admin-sub', 'renamed@pg72.test')
    expect(returning).toMatchObject({
      email: 'admin@pg72.test',
      sso_subject: 'pg72-admin-sub',
      is_admin: 1,
    })
    await expect(
      resolveOidcUser(env, 'different-sub', 'admin@pg72.test'),
    ).rejects.toThrow('OIDC_IDENTITY_CONFLICT')

    const bootstrap = await env.DB.prepare(
      'SELECT admin_subject FROM auth_bootstrap WHERE id = 1',
    ).first<{ admin_subject: string }>()
    expect(bootstrap?.admin_subject).toBe('pg72-admin-sub')
  })

  it('uses bootstrap email once and keeps later role decisions in D1', async () => {
    const admin = await resolveOidcUser(env, 'fresh-admin-sub', 'admin@pg72.test')
    expect(admin.is_admin).toBe(1)

    const normal = await resolveOidcUser(
      { DB: database, BOOTSTRAP_ADMIN_EMAIL: 'second@pg72.test' },
      'normal-sub',
      'second@pg72.test',
    )
    expect(normal.is_admin).toBe(0)
  })

  it('binds a legacy non-admin without changing its role', async () => {
    await env.DB.prepare(
      `INSERT INTO users (email, banned, is_admin) VALUES ('friend@pg72.test', 0, 0)`,
    ).run()
    const user = await resolveOidcUser(env, 'friend-sub', 'friend@pg72.test')
    expect(user).toMatchObject({ sso_subject: 'friend-sub', is_admin: 0 })
  })
})
