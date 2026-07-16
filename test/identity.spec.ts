import { readFile } from 'node:fs/promises'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resolveOidcUser, setUserBanned } from '../src-worker/index'

let miniflare: Miniflare
let database: D1Database
let legacySchemaSql: string
let oidcMigrationSql: string
let emailIdentityMigrationSql: string

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

async function createLegacyOidcDatabase(name: string): Promise<{
  miniflare: Miniflare
  database: D1Database
}> {
  const instance = new Miniflare({
    compatibilityDate: '2026-07-10',
    modules: true,
    script: 'export default { fetch() { return new Response(null) } }',
    d1Databases: { DB: name },
  })
  const db = await instance.getD1Database('DB') as unknown as D1Database
  await db.exec(d1ExecScript(legacySchemaSql))
  await db.exec(d1ExecScript(oidcMigrationSql))
  return { miniflare: instance, database: db }
}

beforeAll(async () => {
  [legacySchemaSql, oidcMigrationSql, emailIdentityMigrationSql] = await Promise.all([
    readFile(new URL('./legacy-schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migration-003-pg72-oidc.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migration-004-email-identity.sql', import.meta.url), 'utf8'),
  ])
  miniflare = new Miniflare({
    compatibilityDate: '2026-07-10',
    modules: true,
    script: 'export default { fetch() { return new Response(null) } }',
    d1Databases: { DB: 'link-oidc-test' },
  })
  database = await miniflare.getD1Database('DB') as unknown as D1Database
  await database.exec(d1ExecScript(legacySchemaSql))
  await database.exec(d1ExecScript(oidcMigrationSql))
  await database.exec(d1ExecScript(emailIdentityMigrationSql))
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
      `INSERT INTO users (email, banned, is_admin) VALUES ('Friend@PG72.test', 0, 0)`,
    ).run()
    const user = await resolveOidcUser(env, 'friend-sub', 'friend@pg72.test')
    expect(user).toMatchObject({
      email: 'Friend@PG72.test',
      sso_subject: 'friend-sub',
      is_admin: 0,
    })
  })

  it('fails closed when legacy rows have duplicate normalized emails', async () => {
    const isolated = await createLegacyOidcDatabase('duplicate-binding-test')
    try {
      await isolated.database.batch([
        isolated.database.prepare(
          `INSERT INTO users (email, banned, is_admin) VALUES ('Dupe@PG72.test', 0, 0)`,
        ),
        isolated.database.prepare(
          `INSERT INTO users (email, banned, is_admin) VALUES ('dupe@pg72.test', 0, 0)`,
        ),
      ])

      await expect(resolveOidcUser(
        { DB: isolated.database, BOOTSTRAP_ADMIN_EMAIL: 'admin@pg72.test' },
        'new-subject',
        'DUPE@pg72.test',
      )).rejects.toThrow('OIDC_IDENTITY_CONFLICT')

      const { results } = await isolated.database.prepare(
        `SELECT email, sso_subject FROM users ORDER BY email`,
      ).all<{ email: string; sso_subject: string | null }>()
      expect(results).toEqual([
        { email: 'Dupe@PG72.test', sso_subject: null },
        { email: 'dupe@pg72.test', sso_subject: null },
      ])
    } finally {
      await isolated.miniflare.dispose()
    }
  })

  it('bans only the exact selected legacy row and its session', async () => {
    const isolated = await createLegacyOidcDatabase('exact-ban-test')
    try {
      await isolated.database.batch([
        isolated.database.prepare(
          `INSERT INTO users (email, sso_subject, banned, is_admin)
           VALUES ('Member@PG72.test', 'admin-subject', 0, 1)`,
        ),
        isolated.database.prepare(
          `INSERT INTO users (email, sso_subject, banned, is_admin)
           VALUES ('member@pg72.test', 'member-subject', 0, 0)`,
        ),
        isolated.database.prepare(
          `INSERT INTO sessions (id, sso_subject, expires_at)
           VALUES ('admin-session', 'admin-subject', datetime('now', '+1 day'))`,
        ),
        isolated.database.prepare(
          `INSERT INTO sessions (id, sso_subject, expires_at)
           VALUES ('member-session', 'member-subject', datetime('now', '+1 day'))`,
        ),
      ])

      await expect(setUserBanned(
        { DB: isolated.database },
        'member@pg72.test',
        true,
      )).resolves.toBe('updated')
      await expect(setUserBanned(
        { DB: isolated.database },
        'Member@PG72.test',
        true,
      )).resolves.toBe('admin_protected')

      const { results: users } = await isolated.database.prepare(
        `SELECT email, banned FROM users ORDER BY email`,
      ).all<{ email: string; banned: number }>()
      expect(users).toEqual([
        { email: 'Member@PG72.test', banned: 0 },
        { email: 'member@pg72.test', banned: 1 },
      ])
      const { results: sessions } = await isolated.database.prepare(
        `SELECT id FROM sessions ORDER BY id`,
      ).all<{ id: string }>()
      expect(sessions).toEqual([{ id: 'admin-session' }])
    } finally {
      await isolated.miniflare.dispose()
    }
  })

  it('migration 004 fails on duplicates and succeeds after cleanup', async () => {
    const isolated = await createLegacyOidcDatabase('email-index-migration-test')
    try {
      await isolated.database.batch([
        isolated.database.prepare(
          `INSERT INTO users (email, banned, is_admin) VALUES ('Case@PG72.test', 0, 0)`,
        ),
        isolated.database.prepare(
          `INSERT INTO users (email, banned, is_admin) VALUES ('case@pg72.test', 0, 0)`,
        ),
      ])

      await expect(
        isolated.database.exec(d1ExecScript(emailIdentityMigrationSql)),
      ).rejects.toThrow()
      const failedIndexes = await isolated.database.prepare(
        `SELECT name FROM pragma_index_list('users') WHERE name = 'idx_users_email_normalized'`,
      ).all<{ name: string }>()
      expect(failedIndexes.results).toEqual([])
      const duplicateCount = await isolated.database.prepare(
        `SELECT COUNT(*) AS count FROM users WHERE lower(email) = 'case@pg72.test'`,
      ).first<{ count: number }>()
      expect(duplicateCount?.count).toBe(2)

      await isolated.database.prepare(
        `DELETE FROM users WHERE email = 'Case@PG72.test'`,
      ).run()
      await expect(
        isolated.database.exec(d1ExecScript(emailIdentityMigrationSql)),
      ).resolves.toBeDefined()
      const createdIndexes = await isolated.database.prepare(
        `SELECT name FROM pragma_index_list('users') WHERE name = 'idx_users_email_normalized'`,
      ).all<{ name: string }>()
      expect(createdIndexes.results).toEqual([{ name: 'idx_users_email_normalized' }])
      await expect(isolated.database.prepare(
        `INSERT INTO users (email, banned, is_admin) VALUES ('CASE@PG72.test', 0, 0)`,
      ).run()).rejects.toThrow()
    } finally {
      await isolated.miniflare.dispose()
    }
  })
})
