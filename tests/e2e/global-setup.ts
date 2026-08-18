import type { FullConfig } from '@playwright/test'

import { readE2ELaunchContext } from './launch-context'

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const context = readE2ELaunchContext()
  if (context.mode === 'readonly-external') return

  const response = await fetch(`${context.baseURL}/api/health/e2e-attestation`, {
    headers: { 'x-ivybm-e2e-launch-token': context.launchToken },
  })
  if (!response.ok) throw new Error(`E2E server attestation failed with HTTP ${response.status}`)

  const body = (await response.json()) as Record<string, unknown>
  if (
    body.status !== 'ready' ||
    body.runId !== context.runID ||
    body.commitSHA !== context.commitSHA ||
    body.planDigest !== context.planDigest ||
    body.database !== context.databaseName
  ) {
    throw new Error('E2E server attestation did not match the launcher target')
  }
}
