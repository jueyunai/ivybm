import { describe, expect, it } from 'vitest'

import {
  assertBootstrapDatabaseURL,
  createE2EDatabaseName,
  databaseURLForName,
  generatedDatabaseNamePattern,
} from '../../scripts/e2e/database-lifecycle.mjs'

describe('E2E database lifecycle', () => {
  it('derives a unique test database without changing connection authority', () => {
    const bootstrap = assertBootstrapDatabaseURL(
      'postgres://postgres:secret@127.0.0.1:55483/ivybm_mvp_e2e_b1?sslmode=disable',
    )
    const name = createE2EDatabaseName(false)
    expect(name).toMatch(generatedDatabaseNamePattern)
    const derived = new URL(databaseURLForName(bootstrap, name))
    expect(derived.hostname).toBe('127.0.0.1')
    expect(derived.port).toBe('55483')
    expect(derived.username).toBe('postgres')
    expect(derived.password).toBe('secret')
    expect(derived.pathname).toBe(`/${name}`)
    expect(derived.searchParams.get('sslmode')).toBe('disable')
  })

  it('rejects remote, production-named, and malformed bootstrap targets', () => {
    expect(() => assertBootstrapDatabaseURL('not-a-url')).toThrow('must be a valid URL')
    expect(() =>
      assertBootstrapDatabaseURL('postgres://postgres@db.production.internal:5432/ivybm_ci'),
    ).toThrow('loopback host')
    expect(() => assertBootstrapDatabaseURL('postgres://postgres@127.0.0.1:5432/ivybm')).toThrow(
      'project-scoped test database',
    )
    expect(() =>
      databaseURLForName('postgres://postgres@127.0.0.1:5432/ivybm_ci', 'production'),
    ).toThrow('untrusted E2E database name')
  })
})
