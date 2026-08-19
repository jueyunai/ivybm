import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { readE2ELaunchContext } from '../e2e/launch-context'

const runID = 'a'.repeat(24)
const databaseName = `ivybm_e2e_${runID}_test`
const specs = ['tests/e2e/website.spec.ts']
const requestedSuites = ['website']
const planDigest = createHash('sha256')
  .update(JSON.stringify({ mode: 'mutation', requestedSuites, specs }))
  .digest('hex')

const validMutationEnvironment = {
  DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:5432/${databaseName}`,
  E2E_PORT: '31001',
  IVYBM_E2E_COMMIT_SHA: 'a'.repeat(40),
  IVYBM_E2E_DATABASE_NAME: databaseName,
  IVYBM_E2E_LAUNCH_TOKEN: 'b'.repeat(64),
  IVYBM_E2E_MODE: 'mutation',
  IVYBM_E2E_PLAN_DIGEST: planDigest,
  IVYBM_E2E_REQUESTED_SUITES: requestedSuites.join(','),
  IVYBM_E2E_RUN_ID: runID,
  IVYBM_E2E_SPEC_PATHS_JSON: JSON.stringify(specs),
} satisfies Record<string, string | undefined>

describe('E2E launch context', () => {
  it('accepts a launcher-owned loopback server and unique database', () => {
    expect(readE2ELaunchContext(validMutationEnvironment)).toMatchObject({
      baseURL: 'http://localhost:31001',
      databaseName,
      mode: 'mutation',
      specPaths: specs,
    })
  })

  it('rejects direct Playwright execution and malformed derived targets', () => {
    expect(() => readE2ELaunchContext({})).toThrow('must be started by the suite launcher')
    expect(() =>
      readE2ELaunchContext({ ...validMutationEnvironment, E2E_PORT: '3000@evil.example' }),
    ).toThrow('E2E_PORT must be 1..65535')
    expect(() =>
      readE2ELaunchContext({
        ...validMutationEnvironment,
        DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:5432/another_ci`,
      }),
    ).toThrow('does not match launcher database')
  })

  it('allows an exact external read-only launch without database context', () => {
    const externalSpecs = ['tests/e2e/website-visual.spec.ts']
    const externalSuites = ['readonly-visual']
    const externalPlanDigest = createHash('sha256')
      .update(
        JSON.stringify({
          mode: 'readonly-external',
          requestedSuites: externalSuites,
          specs: externalSpecs,
        }),
      )
      .digest('hex')
    expect(
      readE2ELaunchContext({
        BASE_URL: 'https://example.invalid',
        IVYBM_E2E_COMMIT_SHA: 'a'.repeat(40),
        IVYBM_E2E_LAUNCH_TOKEN: 'b'.repeat(64),
        IVYBM_E2E_MODE: 'readonly-external',
        IVYBM_E2E_PLAN_DIGEST: externalPlanDigest,
        IVYBM_E2E_REQUESTED_SUITES: externalSuites.join(','),
        IVYBM_E2E_RUN_ID: runID,
        IVYBM_E2E_SPEC_PATHS_JSON: JSON.stringify(externalSpecs),
      }),
    ).toMatchObject({ baseURL: 'https://example.invalid', mode: 'readonly-external' })
  })
})
