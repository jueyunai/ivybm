import { describe, expect, it, vi } from 'vitest'

import {
  isMetaWebhookAccountConfigured,
  MetaWebhookSubscriptionError,
  subscribeMetaMessagingWebhook,
} from '@/modules/platforms/meta/webhookSubscription'

const response = ({
  body = { success: true },
  status = 200,
}: { body?: unknown; status?: number } = {}) => ({
  headers: new Headers(),
  ok: status >= 200 && status < 300,
  status,
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
})

describe('Meta messaging webhook asset subscription', () => {
  it('requires both the verify token and exact account allowlist entry', () => {
    expect(
      isMetaWebhookAccountConfigured({
        accountExternalId: '129472283584550',
        environment: {
          META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '111, 129472283584550 ',
          META_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token',
        },
      }),
    ).toBe(true)
    expect(
      isMetaWebhookAccountConfigured({
        accountExternalId: '129472283584550',
        environment: { META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '129472283584550' },
      }),
    ).toBe(false)
    expect(
      isMetaWebhookAccountConfigured({
        accountExternalId: '129472283584550',
        environment: {
          META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '111',
          META_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token',
        },
      }),
    ).toBe(false)
    expect(
      isMetaWebhookAccountConfigured({
        accountExternalId: '17841400000000001',
        environment: { META_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token' },
        platform: 'instagram',
      }),
    ).toBe(true)
  })

  it.each([
    [
      'facebook-messenger',
      'https://graph.facebook.com/v25.0/129472283584550/subscribed_apps?subscribed_fields=messages',
    ],
    [
      'instagram',
      'https://graph.instagram.com/v22.0/129472283584550/subscribed_apps?subscribed_fields=messages',
    ],
  ] as const)(
    'subscribes %s without putting the token in the URL',
    async (platform, expectedUrl) => {
      const fetch = vi.fn().mockResolvedValue(response())
      const accessToken = 'fixture-subscription-token'

      await expect(
        subscribeMetaMessagingWebhook({
          accessToken,
          accountExternalId: '129472283584550',
          fetch,
          platform,
        }),
      ).resolves.toBeUndefined()

      const [url, init] = fetch.mock.calls[0]!
      expect(String(url)).toBe(expectedUrl)
      expect(String(url)).not.toContain(accessToken)
      expect(init).toMatchObject({ method: 'POST' })
      expect(init.headers.authorization).toBe(`Bearer ${accessToken}`)
    },
  )

  it('accepts the exact string success response returned by Facebook Page subscriptions', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ body: { success: 'true' } }))

    await expect(
      subscribeMetaMessagingWebhook({
        accessToken: 'fixture-subscription-token',
        accountExternalId: '129472283584550',
        fetch,
        platform: 'facebook-messenger',
      }),
    ).resolves.toBeUndefined()
  })

  it.each([
    ['invalid account', { accountExternalId: '../../me' }],
    ['invalid token', { accessToken: ' padded-token ' }],
    ['invalid timeout', { timeoutMs: 0 }],
  ])('rejects %s before provider I/O', async (_label, overrides) => {
    const fetch = vi.fn()
    await expect(
      subscribeMetaMessagingWebhook({
        accessToken: 'fixture-token',
        accountExternalId: '129472283584550',
        fetch,
        platform: 'facebook-messenger',
        ...overrides,
      }),
    ).rejects.toBeInstanceOf(MetaWebhookSubscriptionError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an unsupported platform before provider I/O', async () => {
    const fetch = vi.fn()
    await expect(
      subscribeMetaMessagingWebhook({
        accessToken: 'fixture-token',
        accountExternalId: '129472283584550',
        fetch,
        platform: 'tiktok' as never,
      }),
    ).rejects.toBeInstanceOf(MetaWebhookSubscriptionError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['provider rejection', response({ status: 403 })],
    ['malformed success', response({ body: { success: false } })],
    ['unsupported success type', response({ body: { success: 1 } })],
    ['network failure', new Error('socket reset')],
  ])('fails closed on %s', async (_label, providerResult) => {
    const fetch =
      providerResult instanceof Error
        ? vi.fn().mockRejectedValue(providerResult)
        : vi.fn().mockResolvedValue(providerResult)
    await expect(
      subscribeMetaMessagingWebhook({
        accessToken: 'fixture-token',
        accountExternalId: '129472283584550',
        fetch,
        platform: 'instagram',
      }),
    ).rejects.toBeInstanceOf(MetaWebhookSubscriptionError)
  })
})
