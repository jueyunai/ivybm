import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../../src/payload.config'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to reset the test database')
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''))

if (!databaseName.endsWith('_test') && !databaseName.endsWith('_ci')) {
  throw new Error(
    `Refusing to reset database "${databaseName}"; test databases must end with _test or _ci`,
  )
}

const payload = await getPayload({
  config,
  disableOnInit: true,
  key: 'database-test-reset',
})

try {
  await payload.db.migrateFresh({ forceAcceptWarning: true })
  payload.logger.info(`Reset test database: ${databaseName}`)
} finally {
  await payload.destroy()
}
