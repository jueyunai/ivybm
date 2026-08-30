import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { PayloadPlatformMessagingAccountAuthorizer } from '@/modules/platforms/payloadMessagingAccountAuthorizer'

const payloadWithAccounts = (docs: unknown[]): Payload =>
  ({
    find: vi.fn(async () => ({ docs })),
  }) as unknown as Payload

const account = (
  state: 'blocked' | 'connected' | 'disabled' | 'expired' | 'pending',
  messagingInbound: 'approved' | 'blocked' | 'pending' = 'pending',
) => ({
  authorization: { state },
  capabilities: { messagingInbound },
  id: 1,
})

describe('Payload platform messaging account authorizer', () => {
  it.each([
    ['facebook-messenger', 'facebook-page', 'externalAccountId'],
    ['instagram', 'instagram-professional', 'messagingExternalAccountId'],
  ] as const)(
    'maps %s to %s and its authoritative identity field',
    async (platform, kind, identityField) => {
      const payload = payloadWithAccounts([account('connected')])
      const authorizer = new PayloadPlatformMessagingAccountAuthorizer({ payload })

      await expect(
        authorizer.assertCanReceive({ accountExternalId: 'account-123', platform }),
      ).resolves.toBeUndefined()

      expect(payload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'platform-accounts',
          depth: 0,
          limit: 2,
          overrideAccess: true,
          pagination: false,
          where: {
            and: [
              { accountKind: { equals: kind } },
              { [identityField]: { equals: 'account-123' } },
            ],
          },
        }),
      )
      const query = vi.mocked(payload.find).mock.calls[0]?.[0]
      expect(JSON.stringify(query?.select)).not.toMatch(/accessToken|refreshToken/)
    },
  )

  it('queries the TikTok business account but keeps the unimplemented DM capability blocked', async () => {
    const payload = payloadWithAccounts([account('connected')])
    const authorizer = new PayloadPlatformMessagingAccountAuthorizer({ payload })

    await expect(
      authorizer.assertCanReceive({ accountExternalId: 'account-123', platform: 'tiktok' }),
    ).rejects.toMatchObject({ code: 'implementation_blocked' })

    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          and: [
            { accountKind: { equals: 'tiktok-business' } },
            { externalAccountId: { equals: 'account-123' } },
          ],
        },
      }),
    )
    const query = vi.mocked(payload.find).mock.calls[0]?.[0]
    expect(JSON.stringify(query?.select)).not.toMatch(/accessToken|refreshToken/)
  })

  it.each([
    [[], 'account_not_configured'],
    [[account('connected'), account('connected')], 'account_not_configured'],
    [[account('pending')], 'account_not_connected'],
    [[account('expired')], 'account_not_connected'],
    [[account('blocked')], 'account_blocked'],
    [[account('disabled')], 'account_blocked'],
    [[account('connected', 'blocked')], 'capability_blocked'],
  ] as const)('fails closed for an unusable account record', async (docs, code) => {
    const authorizer = new PayloadPlatformMessagingAccountAuthorizer({
      payload: payloadWithAccounts([...docs]),
    })

    await expect(
      authorizer.assertCanReceive({
        accountExternalId: 'account-123',
        platform: 'facebook-messenger',
      }),
    ).rejects.toMatchObject({ code })
  })
})
