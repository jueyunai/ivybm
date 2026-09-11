import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { down, up } from '@/migrations/20260910_113313_users_username_permissions'
import config from '@/payload.config'

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,62})[a-z0-9]$/

describe.sequential('users username migration collision handling', () => {
  let payload: Payload

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    payload = await getPayload({ config, disableOnInit: true, key: 'username-migration-fixture' })
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('allocates globally unique usernames and rolls back cleanly', async () => {
    const database = payload.db as unknown as PostgresAdapter
    const client = await database.pool.connect()
    const schema = `username_probe_${Date.now()}`
    await client.query('BEGIN')

    try {
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}", public`)
      await client.query(`
        CREATE TABLE "users" (
          id integer PRIMARY KEY,
          email varchar,
          role varchar NOT NULL,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `)
      await client.query('CREATE UNIQUE INDEX "users_email_idx" ON "users" (email)')
      await client.query(
        `INSERT INTO "users" (id, email, role) VALUES
          (1, 'alex@example.com', 'admin'),
          (2, 'alex-3@other.com', 'sales'),
          (3, 'alex@third.com', 'operator')`,
      )

      const db = {
        execute: async (statement: { toQuery: (config: unknown) => { sql: string; params: unknown[] } }) => {
          const query = statement.toQuery({
              escapeName: (name: string) => `"${name}"`,
              escapeParam: (index: number) => `$${index + 1}`,
            })
          return client.query(query.sql, query.params)
        },
      }

      await up({ db } as never)
      const result = await client.query<{ id: number; username: string }>(
        'SELECT id, username FROM "users" ORDER BY id',
      )
      expect(result.rows.map((row) => row.username)).toEqual(['alex', 'alex-3', 'alex-3-2'])
      expect(new Set(result.rows.map((row) => row.username)).size).toBe(3)
      result.rows.forEach((row) => expect(USERNAME_PATTERN.test(row.username)).toBe(true))
      await client.query('SAVEPOINT duplicate_username_probe')
      await expect(
        client.query(
          'INSERT INTO "users" (id, email, role, username, permissions) VALUES (4, $1, $2, $3, $4)',
          ['x@y.com', 'sales', 'alex', '{}'],
        ),
      ).rejects.toMatchObject({ code: '23505' })
      await client.query('ROLLBACK TO SAVEPOINT duplicate_username_probe')

      await down({ db } as never)
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users'`,
        [schema],
      )
      expect(columns.rows.map((row) => row.column_name)).not.toEqual(
        expect.arrayContaining(['username', 'permissions']),
      )
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
