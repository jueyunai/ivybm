import { describe, expect, it } from 'vitest'

import { assertWorkerDatabaseTarget } from '@/modules/jobs/workerDatabaseSafety'

describe('real worker database safety', () => {
  it('allows a non-test worker database', () => {
    expect(() =>
      assertWorkerDatabaseTarget({
        databaseURL: 'postgres://postgres:postgres@db:5432/ivybm',
      }),
    ).not.toThrow()
  })

  it.each(['ivybm_e2e_test', 'ivybm_e2e_ci'])(
    'rejects the test database %s by default',
    (databaseName) => {
      expect(() =>
        assertWorkerDatabaseTarget({
          databaseURL: `postgres://postgres:postgres@127.0.0.1:5432/${databaseName}`,
        }),
      ).toThrow(`Refusing real worker connection to test database "${databaseName}"`)
    },
  )

  it('does not allow a generic environment override for test databases', () => {
    expect(() =>
      assertWorkerDatabaseTarget({
        databaseURL: 'postgres://postgres:postgres@127.0.0.1:5432/ivybm_worker_ci',
      }),
    ).toThrow('isolated real-worker tests require a separate test-only entrypoint')
  })
})
