import { describe, expect, it, vi } from 'vitest'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'
import { encryptPlatformCredential } from '@/modules/platforms/credentials'
import { PayloadMetaPublishingTokenProvider } from '@/modules/platforms/meta/payloadPublishingTokenProvider'
import type { MetaPublishingPlatform } from '@/modules/platforms/meta/publishingOutbound'

const encryptionKey = Buffer.alloc(32, 7)
const encryptedToken = encryptPlatformCredential('fixture-publishing-token', encryptionKey)

const payloadWith = (authorization: Record<string, unknown>, count = 1, revision = 4) => {
  const find = vi.fn().mockResolvedValue({
    docs: Array.from({ length: count }, () => ({
      authorization,
      authorizationRevision: revision,
      capabilities: { publishing: 'approved' },
    })),
  })
  return { find }
}

describe('Payload Meta publishing token provider', () => {
  it.each<[MetaPublishingPlatform, 'facebook-page' | 'instagram-professional']>([
    ['facebook', 'facebook-page'],
    ['instagram', 'instagram-professional'],
  ])(
    'binds a %s token to one exact account kind and external ID',
    async (platform, accountKind) => {
      const payload = payloadWith({
        accessToken: encryptedToken,
        accessTokenConfigured: true,
        expiresAt: '2026-08-13T00:00:00.000Z',
        scopes: [
          {
            scope:
              platform === 'facebook' ? 'pages_manage_posts' : 'instagram_business_content_publish',
          },
        ],
        state: 'connected',
      })
      const provider = new PayloadMetaPublishingTokenProvider({
        encryptionKey,
        now: () => Date.parse('2026-08-12T00:00:00.000Z'),
        payload: payload as never,
      })

      await expect(
        provider.getToken({
          accountExternalId: '129472283584550',
          authorizationRevision: 4,
          platform,
          platformAccountId: 7,
        }),
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
            scopes: true,
            state: true,
          },
          authorizationRevision: true,
          capabilities: { publishing: true },
        },
        where: {
          and: [
            { id: { equals: 7 } },
            { accountKind: { equals: accountKind } },
            { externalAccountId: { equals: '129472283584550' } },
            { authorizationRevision: { equals: 4 } },
          ],
        },
      })
      expect(JSON.stringify(payload.find.mock.calls)).not.toContain('fixture-publishing-token')
    },
  )

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
      malformed.getToken({
        accountExternalId: '1294/../../me',
        authorizationRevision: 4,
        platform: 'facebook',
        platformAccountId: 7,
      }),
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
      ambiguous.getToken({
        accountExternalId: '129472283584550',
        authorizationRevision: 4,
        platform: 'facebook',
        platformAccountId: 7,
      }),
    ).resolves.toBeUndefined()
  })

  it.each([
    ['facebook', 'instagram_business_content_publish'],
    ['instagram', 'pages_manage_posts'],
  ] as const)(
    'rejects a %s token without its exact publishing scope',
    async (platform, wrongScope) => {
      const provider = new PayloadMetaPublishingTokenProvider({
        encryptionKey,
        payload: payloadWith({
          accessToken: encryptedToken,
          accessTokenConfigured: true,
          scopes: [{ scope: wrongScope }],
          state: 'connected',
        }) as never,
      })

      await expect(
        provider.getToken({
          accountExternalId: '129472283584550',
          authorizationRevision: 4,
          platform,
          platformAccountId: 7,
        }),
      ).resolves.toBeUndefined()
    },
  )

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
      provider.getToken({
        accountExternalId: '129472283584550',
        authorizationRevision: 4,
        platform: 'facebook',
        platformAccountId: 7,
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects a stale authorization revision before decrypting credentials', async () => {
    const payload = payloadWith(
      { accessToken: encryptedToken, accessTokenConfigured: true, state: 'connected' },
      1,
      5,
    )
    const provider = new PayloadMetaPublishingTokenProvider({
      encryptionKey,
      payload: payload as never,
    })
    await expect(
      provider.getToken({
        accountExternalId: '129472283584550',
        authorizationRevision: 4,
        platform: 'facebook',
        platformAccountId: 7,
      }),
    ).resolves.toBeUndefined()
  })
})
