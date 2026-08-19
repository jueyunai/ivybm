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
      aiProviderPort: 31_002,
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
    expect(environment.AI_PROVIDER_API_KEY).toBe(environment.IVYBM_E2E_LAUNCH_TOKEN)
    expect(environment.AI_PROVIDER_BASE_URL).toBe('http://127.0.0.1:31002/v1')
    expect(environment.IVYBM_E2E_ALLOW_HTTP_AI_LOOPBACK).toBe('true')
    expect(environment.PLAYWRIGHT_HTML_OPEN).toBe('never')
    expect(() => assertE2EEnvironmentDoesNotExposeProviderCredentials(environment)).not.toThrow()
  })

  it('detects provider credentials added after sanitization', () => {
    expect(() =>
      assertE2EEnvironmentDoesNotExposeProviderCredentials({ FEISHU_APP_SECRET: 'secret' }),
    ).toThrow('must not expose FEISHU_APP_SECRET')
    expect(() =>
      assertE2EEnvironmentDoesNotExposeProviderCredentials({
        AI_PROVIDER_API_KEY: 'not-the-launch-token',
        IVYBM_E2E_EXTERNAL_SIDE_EFFECTS: 'deny',
        IVYBM_E2E_LAUNCH_TOKEN: 'b'.repeat(64),
        IVYBM_E2E_MODE: 'mutation',
      }),
    ).toThrow('must not expose AI_PROVIDER_API_KEY')
  })
})
