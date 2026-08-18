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
      }),
    ).toThrow('test databases must use a local loopback host')

    expect(() =>
      assertMutationE2ETarget({
        baseURL: '',
        databaseURL: 'postgres://postgres:postgres@127.0.0.1:55483/ivybm',
        selectedArguments: mutationArguments,
      }),
    ).toThrow('test databases must end with _test or _ci')
  })

  it('allows an explicitly selected read-only visual spec to use an external server', () => {
    expect(mutationE2EIsScheduled(['tests/e2e/website-visual.spec.ts'])).toBe(false)
    expect(() =>
      assertMutationE2ETarget({
        baseURL: 'https://example.invalid',
        selectedArguments: ['tests/e2e/website-visual.spec.ts'],
      }),
    ).not.toThrow()
  })

  it('fails closed for unknown and authentication-dependent specs', () => {
    expect(mutationE2EIsScheduled(['tests/e2e/future-workflow.spec.ts'])).toBe(true)
    expect(mutationE2EIsScheduled(['tests/e2e/admin-visual.spec.ts'])).toBe(true)
  })

  it('treats a full-suite invocation as mutation-capable', () => {
    expect(mutationE2EIsScheduled([])).toBe(true)
    expect(() =>
      assertMutationE2ETarget({
        baseURL: '',
        databaseURL: '',
        selectedArguments: [],
      }),
    ).toThrow('DATABASE_URL is required for mutation E2E')
  })
})
