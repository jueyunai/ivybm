import { describe, expect, it, vi } from 'vitest'

import { platformRuntimeCredentialReadContext } from '@/access/platformCredentials'
import { encryptPlatformCredential } from '@/modules/platforms/credentials'
import { PayloadMetaConversationTokenProvider } from '@/modules/platforms/meta/payloadConversationTokenProvider'
import type { MetaConversationReplyPlatform } from '@/modules/platforms/meta/conversationRequests'

const encryptionKey = Buffer.alloc(32, 7)
const encryptedToken = encryptPlatformCredential('fixture-page-token', encryptionKey)

const payloadWith = (authorization: Record<string, unknown>, count = 1) => {
  const find = vi.fn().mockResolvedValue({
    docs: Array.from({ length: count }, () => ({ authorization })),
  })
  return { find }
}

describe('Payload Meta conversation token provider', () => {
  it.each<[MetaConversationReplyPlatform, 'facebook-page' | 'instagram-professional']>([
    ['facebook-messenger', 'facebook-page'],
    ['instagram', 'instagram-professional'],
  ] as const)(
    'resolves one connected %s credential by exact account identity',
    async (platform, accountKind) => {
      const payload = payloadWith({
        accessToken: encryptedToken,
        accessTokenConfigured: true,
        expiresAt: '2026-08-13T00:00:00.000Z',
        state: 'connected',
      })
      const provider = new PayloadMetaConversationTokenProvider({
        encryptionKey,
        now: () => Date.parse('2026-08-12T00:00:00.000Z'),
        payload: payload as never,
      })

      await expect(
        provider.getToken({ accountExternalId: '129472283584550', platform }),
      ).resolves.toBe('fixture-page-token')
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
      expect(JSON.stringify(payload.find.mock.calls)).not.toContain('fixture-page-token')
    },
  )

  it.each<
    [
      string,
      {
        authorization?: Record<string, unknown>
        count?: number
      },
    ]
  >([
    ['missing account', { count: 0 }],
    ['ambiguous account', { count: 2 }],
    ['disconnected account', { authorization: { state: 'pending' } }],
    [
      'expired account',
      {
        authorization: {
          accessToken: encryptedToken,
          accessTokenConfigured: true,
          expiresAt: '2026-08-11T00:00:00.000Z',
          state: 'connected',
        },
      },
    ],
    ['missing ciphertext', { authorization: { accessTokenConfigured: true, state: 'connected' } }],
  ])('returns no token for a known authorization block: %s', async (_label, fixture) => {
    const payload = payloadWith(
      fixture.authorization ?? {
        accessToken: encryptedToken,
        accessTokenConfigured: true,
        state: 'connected',
      },
      fixture.count ?? 1,
    )
    const provider = new PayloadMetaConversationTokenProvider({
      encryptionKey,
      now: () => Date.parse('2026-08-12T00:00:00.000Z'),
      payload: payload as never,
    })

    await expect(
      provider.getToken({
        accountExternalId: '129472283584550',
        platform: 'facebook-messenger',
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects malformed identities before querying and propagates decrypt failures without secrets', async () => {
    const payload = payloadWith({
      accessToken: encryptedToken,
      accessTokenConfigured: true,
      state: 'connected',
    })
    const provider = new PayloadMetaConversationTokenProvider({
      encryptionKey: Buffer.alloc(32, 9),
      payload: payload as never,
    })

    await expect(
      provider.getToken({ accountExternalId: ' account ', platform: 'facebook-messenger' }),
    ).resolves.toBeUndefined()
    expect(payload.find).not.toHaveBeenCalled()

    const result = provider.getToken({
      accountExternalId: '129472283584550',
      platform: 'facebook-messenger',
    })
    await expect(result).rejects.toThrow('could not be decrypted')
    await expect(result).rejects.not.toThrow('fixture-page-token')
  })
})
