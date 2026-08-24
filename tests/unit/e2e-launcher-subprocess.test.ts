import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

const directPlaywright = (arguments_: string[]) => {
  const environment: NodeJS.ProcessEnv = { ...process.env, BASE_URL: 'https://example.invalid' }
  for (const key of Object.keys(environment)) {
    if (key.startsWith('IVYBM_E2E_')) delete environment[key]
  }
  return spawnSync('corepack', ['pnpm', 'exec', 'playwright', 'test', ...arguments_], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
    timeout: 20_000,
  })
}

const suiteLauncherWithoutAdminCredentials = (suite: string) => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ADMIN_PORTAL_PUBLISHING_ENABLED: 'true',
    DOTENV_CONFIG_PATH: '/dev/null',
  }
  for (const key of [
    'CI',
    'E2E_ADMIN_EMAIL',
    'E2E_ADMIN_PASSWORD',
    'SEED_ADMIN_EMAIL',
    'SEED_ADMIN_PASSWORD',
  ]) {
    delete environment[key]
  }
  return spawnSync(process.execPath, ['scripts/e2e/run-suite.mjs', suite], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
    timeout: 20_000,
  })
}

describe('E2E launcher process boundary', () => {
  it('rejects the reviewed option-value bypass before collecting tests', () => {
    const result = directPlaywright([
      '--config=playwright.config.ts',
      '--list',
      '--output',
      'tests/e2e/website-visual.spec.ts',
    ])
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('must be started by the suite launcher')
    expect(`${result.stdout}${result.stderr}`).not.toContain('103 tests in 18 files')
  }, 30_000)

  it('rejects alternate config execution when mutation specs are loaded', () => {
    const result = directPlaywright([
      '--config=tests/e2e',
      '--list',
      '--grep-invert',
      'tests/e2e/website-visual.spec.ts',
    ])
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('must be started by the suite launcher')
  }, 30_000)

  it.each(['facebook-publishing', 'admin'])(
    'fails %s before Playwright when administrator credentials are absent',
    (suite) => {
      const result = suiteLauncherWithoutAdminCredentials(suite)
      const output = `${result.stdout}${result.stderr}`
      expect(result.status).not.toBe(0)
      expect(output).toContain('Selected Facebook E2E closure requires non-production')
      expect(output).not.toMatch(/\d+ skipped/u)
      expect(output).not.toMatch(/\d+ passed/u)
    },
    30_000,
  )
})
