import { describe, expect, it, vi } from 'vitest'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'
import { encryptPlatformCredential } from '@/modules/platforms/credentials'
import { PayloadMetaPublishingTokenProvider } from '@/modules/platforms/meta/payloadPublishingTokenProvider'
import type { MetaPublishingPlatform } from '@/modules/platforms/meta/publishingOutbound'

const encryptionKey = Buffer.alloc(32, 7)
const encryptedToken = encryptPlatformCredential('fixture-publishing-token', encryptionKey)

const payloadWith = (authorization: Record<string, unknown>, count = 1) => {
  const find = vi.fn().mockResolvedValue({
    docs: Array.from({ length: count }, () => ({ authorization })),
  })
  return { find }
}

describe('Payload Meta publishing token provider', () => {
  it.each<[MetaPublishingPlatform, 'facebook-page' | 'instagram-professional']>([
    ['facebook', 'facebook-page'],
    ['instagram', 'instagram-professional'],
  ])('binds a %s token to one exact account kind and external ID', async (platform, accountKind) => {
    const payload = payloadWith({
      accessToken: encryptedToken,
      accessTokenConfigured: true,
      expiresAt: '2026-08-13T00:00:00.000Z',
      state: 'connected',
    })
    const provider = new PayloadMetaPublishingTokenProvider({
      encryptionKey,
      now: () => Date.parse('2026-08-12T00:00:00.000Z'),
      payload: payload as never,
    })

    await expect(
      provider.getToken({ accountExternalId: '129472283584550', platform }),
    ).resolves.toBe('fixture-publishing-token')
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
      },
      where: {
        and: [
          { accountKind: { equals: accountKind } },
          { externalAccountId: { equals: '129472283584550' } },
        ],
      },
    })
    expect(JSON.stringify(payload.find.mock.calls)).not.toContain('fixture-publishing-token')
  })

  it('rejects malformed or ambiguous account identities without exposing credentials', async () => {
    const malformedPayload = payloadWith({
      accessToken: encryptedToken,
      accessTokenConfigured: true,
      state: 'connected',
    })
    const malformed = new PayloadMetaPublishingTokenProvider({
      encryptionKey,
      payload: malformedPayload as never,
    })
    await expect(
      malformed.getToken({ accountExternalId: '1294/../../me', platform: 'facebook' }),
    ).resolves.toBeUndefined()
    expect(malformedPayload.find).not.toHaveBeenCalled()

    const ambiguous = new PayloadMetaPublishingTokenProvider({
      encryptionKey,
      payload: payloadWith(
        { accessToken: encryptedToken, accessTokenConfigured: true, state: 'connected' },
        2,
      ) as never,
    })
    await expect(
      ambiguous.getToken({ accountExternalId: '129472283584550', platform: 'facebook' }),
    ).resolves.toBeUndefined()
  })

  it.each([
    ['disconnected', { state: 'pending' }],
    [
      'expired',
      {
        accessToken: encryptedToken,
        accessTokenConfigured: true,
        expiresAt: '2026-08-11T00:00:00.000Z',
        state: 'connected',
      },
    ],
    ['missing ciphertext', { accessTokenConfigured: true, state: 'connected' }],
  ])('returns no token for %s authorization', async (_label, authorization) => {
    const provider = new PayloadMetaPublishingTokenProvider({
      encryptionKey,
      now: () => Date.parse('2026-08-12T00:00:00.000Z'),
      payload: payloadWith(authorization) as never,
    })
    await expect(
      provider.getToken({ accountExternalId: '129472283584550', platform: 'facebook' }),
    ).resolves.toBeUndefined()
  })
})
