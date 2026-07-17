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
    const extension = await database.pool.query<{ installed: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed",
    )
    const vector = await database.pool.query<{ dimensions: number }>(
      "SELECT vector_dims('[0.1,0.2,0.3]'::vector)::int AS dimensions",
    )

    expect(extension.rows[0]?.installed).toBe(true)
    expect(vector.rows[0]?.dimensions).toBe(3)
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
