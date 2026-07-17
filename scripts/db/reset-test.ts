import 'dotenv/config'

import type { MigrateDownArgs, PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
} from 'payload'

import { migrations } from '@/migrations'
import config from '@/payload.config'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to reset the test database')
}

const parsedDatabaseUrl = new URL(databaseUrl)

if (parsedDatabaseUrl.protocol !== 'postgres:' && parsedDatabaseUrl.protocol !== 'postgresql:') {
  throw new Error('DATABASE_URL must use the postgres or postgresql protocol')
}

const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ''))

if (!databaseName.endsWith('_test') && !databaseName.endsWith('_ci')) {
  throw new Error(
    `Refusing to reset database "${databaseName}"; test databases must end with _test or _ci`,
  )
}

const payload = await getPayload({
  config,
  disableOnInit: true,
  key: 'test-database-reset',
})

try {
  const database = payload.db as unknown as PostgresAdapter
  const req = await createLocalReq({}, payload)
  const appliedResult = await database.pool.query<{ name: string }>(
    'SELECT name FROM payload_migrations',
  )
  const appliedMigrations = new Set(appliedResult.rows.map(({ name }) => name))
  const localMigrationNames = new Set(migrations.map(({ name }) => name))
  const missingLocalMigrations = [...appliedMigrations].filter(
    (name) => !localMigrationNames.has(name),
  )

  if (missingLocalMigrations.length > 0) {
    throw new Error(
      `Cannot reset database with missing local migrations: ${missingLocalMigrations.join(', ')}`,
    )
  }

  for (const migration of [...migrations].reverse()) {
    if (!appliedMigrations.has(migration.name)) {
      continue
    }

    payload.logger.info(`Resetting migration: ${migration.name}`)
    try {
      await initTransaction(req)
      const transactionID = await req.transactionID
      const transaction = transactionID
        ? database.sessions[String(transactionID)]?.db
        : undefined

      if (!transaction) {
        throw new Error(`Failed to start transaction for migration: ${migration.name}`)
      }

      await migration.down({
        db: transaction as MigrateDownArgs['db'],
        payload,
        req,
      })
      await commitTransaction(req)
    } catch (error) {
      await killTransaction(req)
      throw error
    }
  }

  // Do not depend on an individual migration dropping Payload's tracking table.
  await database.pool.query('DROP TABLE IF EXISTS payload_migrations')

  // Reapply tracked migrations without dropping the schema or DBA-managed extensions.
  await payload.db.migrate()
  payload.logger.info(`Reset test database: ${databaseName}`)
} finally {
  await payload.destroy()
}

// Payload 3.86 keeps the PostgreSQL pool active after destroy() in one-shot scripts.
process.exit(0)
