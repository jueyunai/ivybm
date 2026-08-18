import { describe, expect, it, vi } from 'vitest'

import { createE2EAttestationHandler } from '@/lib/e2eAttestation'

const environment = {
  DATABASE_URL: 'postgres://secret@127.0.0.1:5432/ivybm_e2e_secret_test',
  IVYBM_E2E_COMMIT_SHA: 'a'.repeat(40),
  IVYBM_E2E_LAUNCH_TOKEN: 'b'.repeat(64),
  IVYBM_E2E_MODE: 'mutation',
  IVYBM_E2E_PLAN_DIGEST: 'c'.repeat(64),
  IVYBM_E2E_RUN_ID: 'd'.repeat(24),
}

describe('E2E server attestation', () => {
  it('stays hidden without the launcher token', async () => {
    const probe = vi.fn(async () => 'ivybm_e2e_test')
    const handler = createE2EAttestationHandler({ environment, probe })
    const response = await handler(new Request('http://localhost/api/health/e2e-attestation'))
    expect(response.status).toBe(404)
    expect(probe).not.toHaveBeenCalled()
  })

  it('returns only the target identity for a matching launcher token', async () => {
    const handler = createE2EAttestationHandler({
      environment,
      probe: async () => 'ivybm_e2e_dddddddddddddddddddddddd_test',
    })
    const response = await handler(
      new Request('http://localhost/api/health/e2e-attestation', {
        headers: { 'x-ivybm-e2e-launch-token': environment.IVYBM_E2E_LAUNCH_TOKEN },
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({
      commitSHA: environment.IVYBM_E2E_COMMIT_SHA,
      database: 'ivybm_e2e_dddddddddddddddddddddddd_test',
      planDigest: environment.IVYBM_E2E_PLAN_DIGEST,
      runId: environment.IVYBM_E2E_RUN_ID,
      status: 'ready',
    })
    expect(body).not.toContain('postgres://')
    expect(body).not.toContain('secret')
    expect(body).not.toContain(environment.IVYBM_E2E_LAUNCH_TOKEN)
  })

  it('does not expose database errors', async () => {
    const handler = createE2EAttestationHandler({
      environment,
      probe: async () => {
        throw new Error(`password=secret DATABASE_URL=${environment.DATABASE_URL}`)
      },
    })
    const response = await handler(
      new Request('http://localhost/api/health/e2e-attestation', {
        headers: { 'x-ivybm-e2e-launch-token': environment.IVYBM_E2E_LAUNCH_TOKEN },
      }),
    )
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('')
  })
})
