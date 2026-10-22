import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'
import { describe, expect, it } from 'vitest'

import { down, up } from '@/migrations/20261022_105725_content_first_publication'
import config from '@/payload.config'

describe('first publication migration', () => {
  it('recovers publication history without changing document or version timestamps and rolls back its schema', async () => {
    const url = new URL(process.env.DATABASE_URL ?? '')
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    ) {
      throw new Error('A local isolated _test database is required')
    }
    const payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'publication-migration-probe',
    })
    const pool = (payload.db as unknown as PostgresAdapter).pool
    const client = await pool.connect()
    const schema = `publication_probe_${Date.now()}`
    await client.query('BEGIN')
    try {
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}", public`)
      for (const collection of ['products', 'projects', 'posts']) {
        await client.query(`
          CREATE TABLE "${collection}" (
            id integer PRIMARY KEY, _status varchar, has_been_published boolean,
            created_at timestamptz, updated_at timestamptz
            ${collection === 'posts' ? ', published_at timestamptz' : ''}
          );
          CREATE TABLE "_${collection}_v" (
            id integer PRIMARY KEY, parent_id integer, version__status varchar,
            version_updated_at timestamptz, created_at timestamptz, updated_at timestamptz
            ${collection === 'posts' ? ', version_published_at timestamptz' : ''}
          );
          INSERT INTO "${collection}" (id,_status,has_been_published,created_at,updated_at) VALUES
            (1,'published',true,'2026-01-01T00:00:00Z','2026-10-22T00:00:00Z'),
            (2,'draft',false,'2026-04-01T00:00:00Z','2026-10-22T00:00:00Z'),
            (3,'draft',true,'2026-03-01T00:00:00Z','2026-10-22T00:00:00Z'),
            (4,'published',true,'2026-06-01T00:00:00Z','2026-10-22T00:00:00Z'),
            (5,'draft',false,'2026-01-01T00:00:00Z','2026-10-22T00:00:00Z');
          INSERT INTO "_${collection}_v" (id,parent_id,version__status,version_updated_at,created_at,updated_at) VALUES
            (1,1,'draft','2026-01-02T00:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z'),
            (2,1,'published','2026-02-03T00:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z'),
            (3,1,'published','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z'),
            (4,2,'draft','2026-05-01T00:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z'),
            (5,3,'published','2026-04-01T00:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z'),
            (6,3,'draft','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z'),
            (7,5,'published','2026-05-10T00:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z'),
            (8,5,'draft','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z');
        `)
      }
      await client.query(`UPDATE posts SET published_at='2026-01-15T00:00:00Z' WHERE id=5`)
      const before = new Map<string, unknown>()
      for (const collection of ['products', 'projects', 'posts']) {
        before.set(
          collection,
          (await client.query(`SELECT id,created_at,updated_at FROM "${collection}" ORDER BY id`))
            .rows,
        )
        before.set(
          `_${collection}_v`,
          (
            await client.query(
              `SELECT id,created_at,updated_at,version_updated_at FROM "_${collection}_v" ORDER BY id`,
            )
          ).rows,
        )
      }
      const db = {
        execute: (statement: {
          toQuery: (config: unknown) => { sql: string; params: unknown[] }
        }) => {
          const query = statement.toQuery({
            escapeName: (name: string) => `"${name}"`,
            escapeParam: (index: number) => `$${index + 1}`,
          })
          return client.query(query.sql, query.params)
        },
      }
      await up({ db } as never)
      for (const collection of ['products', 'projects', 'posts']) {
        const roots = await client.query<{ published_at: Date | null }>(
          `SELECT published_at FROM "${collection}" ORDER BY id`,
        )
        expect(roots.rows.map((row) => row.published_at?.toISOString() ?? null)).toEqual([
          '2026-02-03T00:00:00.000Z',
          null,
          '2026-04-01T00:00:00.000Z',
          '2026-06-01T00:00:00.000Z',
          collection === 'posts' ? '2026-01-15T00:00:00.000Z' : '2026-05-10T00:00:00.000Z',
        ])
        const versions = await client.query<{ version_published_at: Date | null }>(
          `SELECT version_published_at FROM "_${collection}_v" ORDER BY id`,
        )
        expect(versions.rows.map((row) => row.version_published_at?.toISOString() ?? null)).toEqual(
          [
            null,
            '2026-02-03T00:00:00.000Z',
            '2026-02-03T00:00:00.000Z',
            null,
            '2026-04-01T00:00:00.000Z',
            '2026-04-01T00:00:00.000Z',
            collection === 'posts' ? '2026-01-15T00:00:00.000Z' : '2026-05-10T00:00:00.000Z',
            collection === 'posts' ? '2026-01-15T00:00:00.000Z' : '2026-05-10T00:00:00.000Z',
          ],
        )
        expect(
          (await client.query(`SELECT id,created_at,updated_at FROM "${collection}" ORDER BY id`))
            .rows,
        ).toEqual(before.get(collection))
        expect(
          (
            await client.query(
              `SELECT id,created_at,updated_at,version_updated_at FROM "_${collection}_v" ORDER BY id`,
            )
          ).rows,
        ).toEqual(before.get(`_${collection}_v`))
      }
      await down({ db } as never)
      const columns = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns WHERE table_schema=$1 AND column_name IN ('published_at','version_published_at') ORDER BY table_name`,
        [schema],
      )
      expect(columns.rows.map((row) => row.table_name)).toEqual(['_posts_v', 'posts'])
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await payload.destroy()
    }
  })
})
