import { describe, expect, it } from 'vitest'

import { assertMutationE2ETarget, mutationE2EIsScheduled } from '../e2e/mutation-safety'

const mutationArguments = ['tests/e2e/website.spec.ts']
const safeDatabaseURL = 'postgres://postgres:postgres@127.0.0.1:55483/ivybm_e2e_ci'

describe('mutation E2E target safety', () => {
  it('accepts a Playwright-managed server with a loopback test database', () => {
    expect(() =>
      assertMutationE2ETarget({
        baseURL: '',
        databaseURL: safeDatabaseURL,
        selectedArguments: mutationArguments,
        workerMode: 'harness-only',
      }),
    ).not.toThrow()
  })

  it('rejects mutation suites when BASE_URL selects any external server', () => {
    expect(() =>
      assertMutationE2ETarget({
        baseURL: 'https://ivybm.com',
        databaseURL: safeDatabaseURL,
        selectedArguments: mutationArguments,
      }),
    ).toThrow('Refusing mutation E2E against external BASE_URL host "ivybm.com"')

    expect(() =>
      assertMutationE2ETarget({
        baseURL: 'http://localhost:3001',
        databaseURL: safeDatabaseURL,
        selectedArguments: mutationArguments,
      }),
    ).toThrow('mutation suites must use the Playwright-managed local server')
  })

  it('rejects production database hosts and non-test database names', () => {
    expect(() =>
      assertMutationE2ETarget({
        baseURL: '',
        databaseURL: 'postgres://ivybm:secret@db.production.internal:5432/ivybm_ci',
        selectedArguments: mutationArguments,
        workerMode: 'harness-only',
      }),
    ).toThrow('test databases must use a local loopback host')

    expect(() =>
      assertMutationE2ETarget({
        baseURL: '',
        databaseURL: 'postgres://postgres:postgres@127.0.0.1:55483/ivybm',
        selectedArguments: mutationArguments,
        workerMode: 'harness-only',
      }),
    ).toThrow('test databases must end with _test or _ci')
  })

  it('allows an explicitly selected read-only visual spec to use an external server', () => {
    const selectedArguments = ['test', '--list', 'tests/e2e/website-visual.spec.ts']
    expect(mutationE2EIsScheduled(selectedArguments)).toBe(false)
    expect(() =>
      assertMutationE2ETarget({
        baseURL: 'https://example.invalid',
        selectedArguments,
      }),
    ).not.toThrow()
  })

  it('fails closed for unknown and authentication-dependent specs', () => {
    expect(mutationE2EIsScheduled(['tests/e2e/future-workflow.spec.ts'])).toBe(true)
    expect(mutationE2EIsScheduled(['tests/e2e/admin-visual.spec.ts'])).toBe(true)
  })

  it('fails closed for mixed read-only and selector arguments', () => {
    const selectedArguments = [
      'test',
      '--',
      'tests/e2e/website-visual.spec.ts',
      'admin-portal-content',
    ]
    expect(mutationE2EIsScheduled(selectedArguments)).toBe(true)
    expect(() =>
      assertMutationE2ETarget({
        baseURL: 'https://example.invalid',
        databaseURL: safeDatabaseURL,
        selectedArguments,
        workerMode: 'harness-only',
      }),
    ).toThrow('Refusing mutation E2E against external BASE_URL host')
  })

  it('treats a full-suite invocation as mutation-capable', () => {
    expect(mutationE2EIsScheduled([])).toBe(true)
    expect(() =>
      assertMutationE2ETarget({
        baseURL: '',
        databaseURL: '',
        selectedArguments: [],
        workerMode: 'harness-only',
      }),
    ).toThrow('DATABASE_URL is required for mutation E2E')
  })

  it('requires the canonical harness-only worker mode', () => {
    expect(() =>
      assertMutationE2ETarget({
        baseURL: '',
        databaseURL: safeDatabaseURL,
        selectedArguments: mutationArguments,
        workerMode: '',
      }),
    ).toThrow('IVYBM_E2E_WORKER_MODE=harness-only')
  })
})
