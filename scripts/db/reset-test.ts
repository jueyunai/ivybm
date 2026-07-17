import 'dotenv/config'

import { spawnSync } from 'node:child_process'

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

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const resetResult = spawnSync(
  pnpmCommand,
  ['exec', 'payload', 'migrate:fresh', '--force-accept-warning'],
  {
    env: {
      ...process.env,
      DISABLE_PAYLOAD_HMR: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  },
)

if (resetResult.error) {
  throw resetResult.error
}

if (resetResult.status !== 0) {
  const termination = resetResult.signal
    ? `signal ${resetResult.signal}`
    : `exit code ${resetResult.status ?? 'unknown'}`

  throw new Error(`Failed to reset test database "${databaseName}": ${termination}`)
}

console.info(`Reset test database: ${databaseName}`)
