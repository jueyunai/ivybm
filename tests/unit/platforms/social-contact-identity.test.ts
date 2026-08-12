import { describe, expect, it, vi } from 'vitest'

import {
  reauthorizeInboundMessage,
  verifiedSocialContactSource,
} from '@/modules/platforms/socialContactIdentity'
import type { PlatformMessagingAccountAuthorizer } from '@/modules/platforms/payloadMessagingAccountAuthorizer'
import type { MessagingPlatform, NormalizedInboundMessage } from '@/modules/platforms/types'

const installationNamespace = 'ivybm-production'

const allowAuthorizer = (): PlatformMessagingAccountAuthorizer => ({
  assertCanReceive: vi.fn().mockResolvedValue(undefined),
})

const authorize = (
  message: NormalizedInboundMessage,
  authorizer: PlatformMessagingAccountAuthorizer = allowAuthorizer(),
) => reauthorizeInboundMessage({ authorizer, installationNamespace, message })

const inbound = ({
  accountExternalId = '129472283584550',
  platform = 'facebook-messenger',
  senderExternalId = '122294474450066102',
}: {
  accountExternalId?: string
  platform?: MessagingPlatform
  senderExternalId?: string
} = {}): NormalizedInboundMessage => ({
  accountExternalId,
  content: { messageType: 'text', text: 'We need facade panels.' },
  externalEventId: 'mid-fixture-1',
  idempotencyKey: 'fixture-key',
  kind: 'inbound-message',
  occurredAt: '2026-08-12T00:00:00.000Z',
  platform,
  recipientExternalId: accountExternalId,
  senderExternalId,
})

describe('verified social contact identity', () => {
  it.each(['facebook-messenger', 'instagram'] as const)(
    'derives one credential-free contact source for %s',
    async (platform) => {
      const authorizer = allowAuthorizer()
      const source = verifiedSocialContactSource(await authorize(inbound({ platform }), authorizer))

      expect(source).toEqual({
        accountExternalId: '129472283584550',
        identityKey: expect.stringMatching(`^social-contact:v2:${platform}:[a-f0-9]{64}$`),
        kind: 'verified-social-session',
        platform,
        senderExternalId: '122294474450066102',
      })
      expect(authorizer.assertCanReceive).toHaveBeenCalledWith({
        accountExternalId: '129472283584550',
        platform,
      })
      expect(JSON.stringify(source)).not.toContain('access_token')
    },
  )

  it('isolates the same sender across installations, Pages, and Meta products', async () => {
    const firstPage = verifiedSocialContactSource(
      await authorize(inbound({ accountExternalId: 'page-1' })),
    )
    const secondPage = verifiedSocialContactSource(
      await authorize(inbound({ accountExternalId: 'page-2' })),
    )
    const instagram = verifiedSocialContactSource(
      await authorize(inbound({ accountExternalId: 'ig-1', platform: 'instagram' })),
    )
    const anotherInstallation = verifiedSocialContactSource(
      await reauthorizeInboundMessage({
        authorizer: allowAuthorizer(),
        installationNamespace: 'another-installation',
        message: inbound({ accountExternalId: 'page-1' }),
      }),
    )

    expect(
      new Set([
        firstPage.identityKey,
        secondPage.identityKey,
        instagram.identityKey,
        anotherInstallation.identityKey,
      ]).size,
    ).toBe(4)
  })

  it('keeps the identity stable across message retries and provider message IDs', async () => {
    const first = inbound()
    const retry = {
      ...first,
      externalEventId: 'mid-fixture-2',
      idempotencyKey: 'changed-transport-key',
    }

    expect(verifiedSocialContactSource(await authorize(first)).identityKey).toBe(
      verifiedSocialContactSource(await authorize(retry)).identityKey,
    )
  })

  it('rejects non-Meta channels and mismatched recipients before authorization', async () => {
    const authorizer = allowAuthorizer()
    await expect(authorize(inbound({ platform: 'tiktok' }), authorizer)).rejects.toThrow(
      'supported only for Meta messaging',
    )

    const mismatched = { ...inbound(), recipientExternalId: 'another-page' }
    await expect(authorize(mismatched, authorizer)).rejects.toThrow('recipient does not match')
    expect(authorizer.assertCanReceive).not.toHaveBeenCalled()
  })

  it('cannot create a contact source when account re-authorization is denied', async () => {
    const denied = new Error('account disabled')
    const authorizer: PlatformMessagingAccountAuthorizer = {
      assertCanReceive: vi.fn().mockRejectedValue(denied),
    }

    await expect(authorize(inbound(), authorizer)).rejects.toBe(denied)
    expect(authorizer.assertCanReceive).toHaveBeenCalledOnce()
  })

  it('freezes authorized identity fields and rejects structurally forged proof', async () => {
    const authorized = await authorize(inbound())

    expect(Object.isFrozen(authorized)).toBe(true)
    expect(() => {
      ;(authorized as unknown as { accountExternalId: string }).accountExternalId = 'other-page'
    }).toThrow()
    expect(authorized.accountExternalId).toBe('129472283584550')

    expect(() =>
      verifiedSocialContactSource(
        inbound() as unknown as Parameters<typeof verifiedSocialContactSource>[0],
      ),
    ).toThrow('has not been authorized')
  })

  it.each<
    [
      string,
      {
        installationNamespace?: string
        senderExternalId?: string
      },
    ]
  >([
    ['blank namespace', { installationNamespace: ' ' }],
    ['unsafe sender ID', { senderExternalId: 'sender with spaces' }],
  ])('rejects %s', async (_label, override) => {
    const message = inbound({
      senderExternalId: override.senderExternalId,
    })
    await expect(
      reauthorizeInboundMessage({
        authorizer: allowAuthorizer(),
        installationNamespace: override.installationNamespace ?? installationNamespace,
        message,
      }),
    ).rejects.toThrow('invalid')
  })
})
