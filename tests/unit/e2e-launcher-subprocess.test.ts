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
})
