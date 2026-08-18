import { afterEach, describe, expect, it } from 'vitest'

import {
  assertE2EEnvironmentDoesNotExposeProviderCredentials,
  createE2EEnvironment,
} from '../../scripts/e2e/environment.mjs'

const originalFeishuSecret = process.env.FEISHU_APP_SECRET

afterEach(() => {
  if (originalFeishuSecret === undefined) delete process.env.FEISHU_APP_SECRET
  else process.env.FEISHU_APP_SECRET = originalFeishuSecret
})

describe('E2E child environment', () => {
  it('does not inherit real provider credentials or the worker override', () => {
    process.env.FEISHU_APP_SECRET = 'real-provider-secret'
    const environment = createE2EEnvironment({
      baseURL: 'http://127.0.0.1:31001',
      commitSHA: 'a'.repeat(40),
      databaseName: 'ivybm_e2e_aaaaaaaaaaaaaaaaaaaaaaaa_test',
      databaseURL:
        'postgres://postgres:postgres@127.0.0.1:5432/ivybm_e2e_aaaaaaaaaaaaaaaaaaaaaaaa_test',
      launchToken: 'b'.repeat(64),
      mode: 'mutation',
      planDigest: 'c'.repeat(64),
      port: 31_001,
      requestedSuites: ['website'],
      runID: 'a'.repeat(24),
      specPaths: ['tests/e2e/website.spec.ts'],
    })

    expect((environment as Record<string, string | undefined>).FEISHU_APP_SECRET).toBe('')
    expect(environment.IVYBM_E2E_ENVIRONMENT_ALLOWLIST).toBe('v1')
    expect(environment.IVYBM_ALLOW_TEST_DATABASE_WORKER).toBe('')
    expect(environment.ADMIN_PORTAL_PUBLISHING_ENABLED).toBe('false')
    expect(() => assertE2EEnvironmentDoesNotExposeProviderCredentials(environment)).not.toThrow()
  })

  it('detects provider credentials added after sanitization', () => {
    expect(() =>
      assertE2EEnvironmentDoesNotExposeProviderCredentials({ FEISHU_APP_SECRET: 'secret' }),
    ).toThrow('must not expose FEISHU_APP_SECRET')
  })
})
