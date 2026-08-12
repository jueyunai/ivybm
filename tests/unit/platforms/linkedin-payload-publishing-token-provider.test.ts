import { describe, expect, it, vi } from 'vitest'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'
import { encryptPlatformCredential } from '@/modules/platforms/credentials'
import { PayloadLinkedInPublishingTokenProvider } from '@/modules/platforms/linkedin/payloadPublishingTokenProvider'
import type { LinkedInPublishingAccountKind } from '@/modules/platforms/linkedin/publishingOutbound'

const encryptionKey = Buffer.alloc(32, 9)
const encryptedToken = encryptPlatformCredential('fixture-linkedin-token', encryptionKey)

const payloadWith = (doc: Record<string, unknown>, count = 1) => {
  const find = vi.fn().mockResolvedValue({ docs: Array.from({ length: count }, () => doc) })
  return { find }
}

describe('Payload LinkedIn publishing token provider', () => {
  it.each<[LinkedInPublishingAccountKind, string]>([
    ['linkedin-member', 'AbC_123'],
    ['linkedin-organization', '971937765923229'],
  ])('binds one approved %s token to its exact external ID', async (accountKind, id) => {
    const payload = payloadWith({
      authorization: {
        accessToken: encryptedToken,
        accessTokenConfigured: true,
        expiresAt: '2026-08-13T00:00:00.000Z',
        state: 'connected',
      },
      authorizationRevision: 4,
      capabilities: { publishing: 'approved' },
    })
    const provider = new PayloadLinkedInPublishingTokenProvider({
      encryptionKey,
      now: () => Date.parse('2026-08-12T00:00:00.000Z'),
      payload: payload as never,
    })
    await expect(
      provider.getToken({
        accountExternalId: id,
        accountKind,
        authorizationRevision: 4,
        platformAccountId: 7,
      }),
    ).resolves.toBe('fixture-linkedin-token')
    expect(payload.find).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      context: platformRuntimeCredentialReadContext,
      depth: 0,
      limit: 2,
      overrideAccess: true,
      pagination: false,
      select: {
        authorization: {
          accessToken: true,
          accessTokenConfigured: true,
          expiresAt: true,
          state: true,
        },
        authorizationRevision: true,
        capabilities: { publishing: true },
      },
      where: {
        and: [
          { id: { equals: 7 } },
          { accountKind: { equals: accountKind } },
          { externalAccountId: { equals: id } },
          { authorizationRevision: { equals: 4 } },
        ],
      },
    })
    expect(JSON.stringify(payload.find.mock.calls)).not.toContain('fixture-linkedin-token')
  })

  it('rejects malformed, ambiguous, unapproved, disconnected and expired identities', async () => {
    const malformedPayload = payloadWith({})
    const malformed = new PayloadLinkedInPublishingTokenProvider({
      encryptionKey,
      payload: malformedPayload as never,
    })
    await expect(
      malformed.getToken({
        accountExternalId: '../organization',
        accountKind: 'linkedin-organization',
        authorizationRevision: 4,
        platformAccountId: 7,
      }),
    ).resolves.toBeUndefined()
    expect(malformedPayload.find).not.toHaveBeenCalled()

    for (const doc of [
      {
        authorization: {
          accessToken: encryptedToken,
          accessTokenConfigured: true,
          state: 'connected',
        },
        capabilities: { publishing: 'pending' },
      },
      { authorization: { state: 'pending' }, capabilities: { publishing: 'approved' } },
      {
        authorization: {
          accessToken: encryptedToken,
          accessTokenConfigured: true,
          expiresAt: '2026-08-11T00:00:00.000Z',
          state: 'connected',
        },
        capabilities: { publishing: 'approved' },
      },
    ]) {
      const provider = new PayloadLinkedInPublishingTokenProvider({
        encryptionKey,
        now: () => Date.parse('2026-08-12T00:00:00.000Z'),
        payload: payloadWith(doc) as never,
      })
      await expect(
        provider.getToken({
          accountExternalId: '971937765923229',
          accountKind: 'linkedin-organization',
          authorizationRevision: 4,
          platformAccountId: 7,
        }),
      ).resolves.toBeUndefined()
    }

    const ambiguous = new PayloadLinkedInPublishingTokenProvider({
      encryptionKey,
      payload: payloadWith(
        {
          authorization: {
            accessToken: encryptedToken,
            accessTokenConfigured: true,
            state: 'connected',
          },
          capabilities: { publishing: 'approved' },
        },
        2,
      ) as never,
    })
    await expect(
      ambiguous.getToken({
        accountExternalId: '971937765923229',
        accountKind: 'linkedin-organization',
        authorizationRevision: 4,
        platformAccountId: 7,
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects a token from a different authorization revision', async () => {
    const provider = new PayloadLinkedInPublishingTokenProvider({
      encryptionKey,
      payload: payloadWith({
        authorization: {
          accessToken: encryptedToken,
          accessTokenConfigured: true,
          state: 'connected',
        },
        authorizationRevision: 5,
        capabilities: { publishing: 'approved' },
      }) as never,
    })
    await expect(
      provider.getToken({
        accountExternalId: '971937765923229',
        accountKind: 'linkedin-organization',
        authorizationRevision: 4,
        platformAccountId: 7,
      }),
    ).resolves.toBeUndefined()
  })
})
