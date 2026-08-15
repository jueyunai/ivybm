import { describe, expect, it, vi } from 'vitest'

import { createMetaConversationOutboundAdapter } from '@/modules/platforms/meta/conversationOutbound'
import { PlatformConversationOutboundOutcomeUnknownError } from '@/modules/platforms/conversationOutboundResult'
import type { MessagingPlatform } from '@/modules/platforms/types'

const request = (
  overrides: Partial<{
    accountExternalId: string
    deliveryKey: string
    platform: MessagingPlatform
    recipientExternalId: string
    text: string
  }> = {},
) => ({
  accountExternalId: '129472283584550',
  deliveryKey: 'delivery-fixture-1',
  platform: 'facebook-messenger' as const,
  recipientExternalId: '9876543210987654',
  text: 'Thank you. Which finish and approximate quantity do you need?',
  ...overrides,
})

const response = ({
  body = { message_id: 'm_fixture', recipient_id: '9876543210987654' },
  headers = {},
  ok,
  status = 200,
}: {
  body?: unknown
  headers?: Record<string, string>
  ok?: boolean
  status?: number
} = {}) => ({
  headers: new Headers(headers),
  ok: ok ?? (status >= 200 && status < 300),
  status,
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
})

describe('Meta conversation outbound adapter', () => {
  it('rejects invalid adapter configuration at construction time', () => {
    expect(() =>
      createMetaConversationOutboundAdapter({
        timeoutMs: 0,
        tokenProvider: async () => 'fixture-token',
      }),
    ).toThrow('Meta conversation outbound timeout must be between 1 and 120000 milliseconds')
    expect(() =>
      createMetaConversationOutboundAdapter({
        tokenProvider: undefined as never,
      }),
    ).toThrow('Meta conversation outbound token provider is required')
    expect(() =>
      createMetaConversationOutboundAdapter({
        fetch: null as never,
        tokenProvider: async () => 'fixture-token',
      }),
    ).toThrow('Meta conversation outbound fetch implementation is required')
  })

  it.each([
    [
      'facebook-messenger',
      'https://graph.facebook.com/v25.0/me/messages',
      {
        message: { text: 'Hello from IVYBM.' },
        messaging_type: 'RESPONSE',
        recipient: { id: '9876543210987654' },
      },
    ],
    [
      'instagram',
      'https://graph.instagram.com/v22.0/129472283584550/messages',
      {
        message: { text: 'Hello from IVYBM.' },
        recipient: { id: '9876543210987654' },
      },
    ],
  ] as const)(
    'sends a %s reply against its fixed origin and version',
    async (platform, expectedUrl, expectedBody) => {
      const token = 'fixture-page-token'
      const fetch = vi.fn().mockResolvedValueOnce(response())
      const tokenProvider = vi.fn().mockResolvedValue(token)
      const adapter = createMetaConversationOutboundAdapter({
        fetch,
        tokenProvider,
      })

      await expect(
        adapter.send(
          request({
            platform,
            text: 'Hello from IVYBM.',
          }),
        ),
      ).resolves.toEqual({
        deliveryKey: 'delivery-fixture-1',
        platform,
        status: 'accepted',
      })

      expect(tokenProvider).toHaveBeenCalledWith({
        accountExternalId: '129472283584550',
        platform,
      })
      const [url, init] = fetch.mock.calls[0]!
      expect(String(url)).toBe(expectedUrl)
      expect(String(url)).not.toContain(token)
      expect(init.headers.authorization).toBe(`Bearer ${token}`)
      expect(JSON.parse(String(init.body))).toEqual(expectedBody)
      expect(init.body).not.toContain(token)
      expect(init.signal).toBeDefined()
    },
  )

  it('rejects tiktok before token lookup or network', async () => {
    const fetch = vi.fn()
    const tokenProvider = vi.fn().mockResolvedValue('fixture-token')
    const adapter = createMetaConversationOutboundAdapter({
      fetch,
      tokenProvider,
    })

    const result = await adapter.send(
      request({
        platform: 'tiktok',
        recipientExternalId: '9876543210987654',
        text: 'Hello',
      }),
    )

    expect(result).toMatchObject({
      deliveryKey: 'delivery-fixture-1',
      errorCode: 'invalid_request',
      platform: 'tiktok',
      retryable: false,
      status: 'blocked',
    })
    expect(tokenProvider).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves valid multiline message text', async () => {
    const fetch = vi.fn().mockResolvedValue(response())
    const adapter = createMetaConversationOutboundAdapter({
      fetch,
      tokenProvider: async () => 'fixture-token',
    })

    await expect(adapter.send(request({ text: 'Line one\nLine two' }))).resolves.toMatchObject({
      status: 'accepted',
    })
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).message.text).toBe(
      'Line one\nLine two',
    )
  })

  it.each([
    ['invalid recipient', { recipientExternalId: 'not-a-decimal' }],
    ['padded recipient', { recipientExternalId: ' 9876543210987654 ' }],
    ['invalid account', { accountExternalId: '1294/../../me' }],
    ['empty text', { text: '   ' }],
    ['padded text', { text: ' Hello ' }],
    ['oversized text', { text: 'a'.repeat(2_001) }],
  ])('rejects %s before provider I/O', async (_label, overrides) => {
    const fetch = vi.fn()
    const tokenProvider = vi.fn().mockResolvedValue('fixture-token')
    const adapter = createMetaConversationOutboundAdapter({
      fetch,
      tokenProvider,
    })

    const result = await adapter.send(request(overrides))

    expect(result).toMatchObject({
      deliveryKey: 'delivery-fixture-1',
      errorCode: 'invalid_request',
      platform: 'facebook-messenger',
      retryable: false,
      status: 'blocked',
    })
    expect(tokenProvider).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an invalid delivery identity before credential lookup', async () => {
    const fetch = vi.fn()
    const tokenProvider = vi.fn().mockResolvedValue('fixture-token')
    const adapter = createMetaConversationOutboundAdapter({ fetch, tokenProvider })

    await expect(adapter.send(request({ deliveryKey: ' delivery-fixture-1 ' }))).rejects.toThrow(
      'Meta conversation outbound request identity is invalid',
    )
    await expect(adapter.send(null as never)).rejects.toThrow(
      'Meta conversation outbound request is invalid',
    )
    expect(tokenProvider).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns authorization_required when no usable token is available', async () => {
    const fetch = vi.fn()
    const tokenProvider = vi.fn().mockResolvedValue(undefined)
    const adapter = createMetaConversationOutboundAdapter({
      fetch,
      tokenProvider,
    })

    const result = await adapter.send(request())

    expect(result).toMatchObject({
      deliveryKey: 'delivery-fixture-1',
      errorCode: 'authorization_required',
      platform: 'facebook-messenger',
      retryable: false,
      status: 'blocked',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns provider_unavailable when the credential store fails before provider I/O', async () => {
    const fetch = vi.fn()
    const tokenProvider = vi.fn().mockRejectedValue(new Error('credential store unavailable'))
    const adapter = createMetaConversationOutboundAdapter({
      fetch,
      tokenProvider,
    })

    const result = await adapter.send(request())

    expect(result).toMatchObject({
      deliveryKey: 'delivery-fixture-1',
      errorCode: 'provider_unavailable',
      platform: 'facebook-messenger',
      retryable: true,
      status: 'blocked',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'invalid_request', false, undefined],
    [401, 'authorization_required', false, undefined],
    [403, 'permission_required', false, undefined],
    [404, 'invalid_request', false, undefined],
    [422, 'invalid_request', false, undefined],
    [429, 'rate_limited', true, 30],
    [409, 'platform_blocked', false, undefined],
  ] as const)(
    'maps confirmed HTTP %s to blocked %s',
    async (status, code, retryable, retryAfterSeconds) => {
      const fetch = vi.fn().mockResolvedValue(
        response({
          headers: retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : {},
          status,
        }),
      )
      const adapter = createMetaConversationOutboundAdapter({
        fetch,
        tokenProvider: async () => 'fixture-token',
      })

      const result = await adapter.send(request())

      expect(result).toMatchObject({
        deliveryKey: 'delivery-fixture-1',
        errorCode: code,
        platform: 'facebook-messenger',
        retryable,
        status: 'blocked',
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      })
    },
  )

  it.each([
    ['network loss', vi.fn().mockRejectedValue(new Error('socket reset'))],
    ['provider 500', vi.fn().mockResolvedValue(response({ status: 500 }))],
    ['non-OK unclassified', vi.fn().mockResolvedValue(response({ ok: false, status: 200 }))],
    ['malformed success', vi.fn().mockResolvedValue(response({ body: { success: true } }))],
  ])('fails closed as delivery_unknown after %s', async (_label, fetch) => {
    const adapter = createMetaConversationOutboundAdapter({
      fetch,
      tokenProvider: async () => 'fixture-token',
    })

    await expect(adapter.send(request())).rejects.toMatchObject({
      code: 'delivery_unknown',
      deliveryKey: 'delivery-fixture-1',
      platform: 'facebook-messenger',
      retryable: false,
    })
  })

  it('fails closed as delivery_unknown when the provider returns a different recipient', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ body: { message_id: 'm_other', recipient_id: '1111111111111111' } }),
      )
    const adapter = createMetaConversationOutboundAdapter({
      fetch,
      tokenProvider: async () => 'fixture-token',
    })

    await expect(adapter.send(request())).rejects.toBeInstanceOf(
      PlatformConversationOutboundOutcomeUnknownError,
    )
  })

  it('recovers an unknown outcome as delivery_unknown without calling fetch', async () => {
    const fetch = vi.fn()
    const adapter = createMetaConversationOutboundAdapter({
      fetch,
      tokenProvider: async () => 'fixture-token',
    })

    await expect(adapter.recoverUnknownOutcome(request())).resolves.toEqual({
      deliveryKey: 'delivery-fixture-1',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts a timed-out send and fails closed as delivery_unknown', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn(
        (_url: string | URL, init?: RequestInit) =>
          new Promise<ReturnType<typeof response>>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            })
          }),
      )
      const adapter = createMetaConversationOutboundAdapter({
        fetch,
        timeoutMs: 50,
        tokenProvider: async () => 'fixture-token',
      })

      const result = adapter.send(request())
      const unknown = expect(result).rejects.toBeInstanceOf(
        PlatformConversationOutboundOutcomeUnknownError,
      )
      await vi.advanceTimersByTimeAsync(50)
      await unknown
      expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out while reading a stalled provider response body', async () => {
    vi.useFakeTimers()
    try {
      const body = new Promise<string>(() => undefined)
      const fetch = vi.fn().mockResolvedValue({
        headers: new Headers(),
        ok: true,
        status: 200,
        text: vi.fn(() => body),
      })
      const adapter = createMetaConversationOutboundAdapter({
        fetch,
        timeoutMs: 50,
        tokenProvider: async () => 'fixture-token',
      })

      const result = adapter.send(request())
      const unknown = expect(result).rejects.toBeInstanceOf(
        PlatformConversationOutboundOutcomeUnknownError,
      )
      await vi.advanceTimersByTimeAsync(50)
      await unknown
      expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an oversized provider response as delivery_unknown', async () => {
    const adapter = createMetaConversationOutboundAdapter({
      fetch: vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-length': String(64 * 1_024 + 1) }),
        ok: true,
        status: 200,
        text: vi.fn(),
      }),
      tokenProvider: async () => 'fixture-token',
    })

    await expect(adapter.send(request())).rejects.toBeInstanceOf(
      PlatformConversationOutboundOutcomeUnknownError,
    )
  })
})
