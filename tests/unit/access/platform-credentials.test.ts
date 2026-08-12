import { describe, expect, it } from 'vitest'

import {
  platformCredentialRead,
  platformReadinessCredentialReadContext,
  platformRuntimeCredentialReadContext,
} from '@/access/platformCredentials'

const canRead = async (context: Record<string, unknown>): Promise<boolean> =>
  await platformCredentialRead({ req: { context } } as never)

describe('platform credential field access', () => {
  it('denies ordinary and lookalike request contexts', async () => {
    await expect(canRead({})).resolves.toBe(false)
    await expect(canRead({ platformRuntimeCredentialRead: 'true' })).resolves.toBe(false)
    await expect(canRead({ portalPlatformReadinessCredentialRead: 1 })).resolves.toBe(false)
  })

  it('allows only the two explicit server-side credential contexts', async () => {
    await expect(canRead(platformReadinessCredentialReadContext)).resolves.toBe(true)
    await expect(canRead(platformRuntimeCredentialReadContext)).resolves.toBe(true)
  })
})
