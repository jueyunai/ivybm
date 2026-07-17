import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'

let payload: Payload

const getDatabase = (): PostgresAdapter => payload.db as unknown as PostgresAdapter

describe('PostgreSQL foundation', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for database integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'database-integration-tests',
    })
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('connects to PostgreSQL', async () => {
    const database = getDatabase()
    const result = await database.pool.query<{ ok: number }>('SELECT 1::int AS ok')

    expect(result.rows[0]?.ok).toBe(1)
  })

  it('has the vector extension available', async () => {
    const database = getDatabase()
    const server = await database.pool.query<{ serverVersion: string }>(
      'SELECT current_setting(\'server_version\') AS "serverVersion"',
    )
    const extension = await database.pool.query<{ version: string }>(
      "SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'",
    )
    const vector = await database.pool.query<{ dimensions: number }>(
      "SELECT vector_dims('[0.1,0.2,0.3]'::vector)::int AS dimensions",
    )

    expect(server.rows[0]?.serverVersion).toMatch(/^18\.4(?:\.|$)/)
    expect(extension.rows[0]?.version).toBe('0.8.5')
    expect(vector.rows[0]?.dimensions).toBe(3)
  })

  it('orders stored vectors by cosine distance', async () => {
    const database = getDatabase()
    const client = await database.pool.connect()

    await client.query('BEGIN')

    try {
      await client.query(
        'CREATE TEMP TABLE vector_distance_probe (label text NOT NULL, embedding vector(3) NOT NULL) ON COMMIT DROP',
      )
      await client.query(
        "INSERT INTO vector_distance_probe (label, embedding) VALUES ('nearest', '[1,0,0]'), ('farther', '[0,1,0]')",
      )
      const result = await client.query<{ label: string }>(
        "SELECT label FROM vector_distance_probe ORDER BY embedding <=> '[1,0,0]'::vector LIMIT 1",
      )

      expect(result.rows).toEqual([{ label: 'nearest' }])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('has applied at least one tracked migration', async () => {
    const database = getDatabase()
    const result = await database.pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM payload_migrations',
    )

    expect(result.rows[0]?.count).toBeGreaterThan(0)
  })

  it('writes and reads a minimal Payload record', async () => {
    const email = `integration-${randomUUID()}@example.invalid`
    const created = await payload.create({
      collection: 'users',
      data: {
        email,
        password: 'integration-test-only-password',
        role: 'sales',
      },
      overrideAccess: true,
    })

    try {
      const found = await payload.findByID({
        collection: 'users',
        id: created.id,
        overrideAccess: true,
      })

      expect(found.email).toBe(email)
    } finally {
      await payload.delete({
        collection: 'users',
        id: created.id,
        overrideAccess: true,
      })
    }
  })
})
