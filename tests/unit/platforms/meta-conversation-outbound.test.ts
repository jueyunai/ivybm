import { describe, expect, it, vi } from 'vitest'

import {
  isPlatformConversationOutboundOutcomeUnknownError,
  PlatformConversationOutboundOutcomeUnknownError,
  PlatformConversationOutboundTransportError,
} from '@/modules/platforms/conversationOutboundResult'
import { createMetaConversationOutboundPort } from '@/modules/platforms/meta/conversationOutbound'
import type { PlatformConversationOutboundRequest } from '@/modules/platforms/types'

const request = (
  overrides: Partial<PlatformConversationOutboundRequest> = {},
): PlatformConversationOutboundRequest => ({
  accountExternalId: '129472283584550',
  deliveryKey: 'reply:fixture:1',
  platform: 'facebook-messenger',
  recipientExternalId: '122294474450066102',
  text: 'Here are the available facade finishes.',
  ...overrides,
})

const response = ({
  body = { message_id: 'm_provider_fixture_1', recipient_id: '122294474450066102' },
  headers = {},
  status = 200,
}: {
  body?: unknown
  headers?: Record<string, string>
  status?: number
} = {}) => ({
  headers: new Headers(headers),
  json: vi.fn().mockResolvedValue(body),
  ok: status >= 200 && status < 300,
  status,
})

describe('Meta conversation outbound HTTP adapter', () => {
  it('attaches the token only at transport time and returns acceptance without provider claims', async () => {
    const token = 'fixture-page-token'
    const fetch = vi.fn().mockResolvedValue(response())
    const tokenProvider = vi.fn().mockResolvedValue(token)
    const port = createMetaConversationOutboundPort({ fetch, tokenProvider })

    await expect(port.send(request())).resolves.toEqual({
      deliveryKey: 'reply:fixture:1',
      platform: 'facebook-messenger',
      status: 'accepted',
    })

    expect(tokenProvider).toHaveBeenCalledWith({
      accountExternalId: '129472283584550',
      platform: 'facebook-messenger',
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('https://graph.facebook.com/v25.0/me/messages')
    expect(String(url)).not.toContain(token)
    expect(init.headers.authorization).toBe(`Bearer ${token}`)
    expect(init.body).toBe(
      JSON.stringify({
        message: { text: 'Here are the available facade finishes.' },
        messaging_type: 'RESPONSE',
        recipient: { id: '122294474450066102' },
      }),
    )
    expect(init.body).not.toContain(token)
  })

  it('binds Instagram token lookup and request limits to the Instagram platform', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ body: { message_id: 'm_ig_fixture_1', recipient_id: '99887766' } }),
      )
    const tokenProvider = vi.fn().mockResolvedValue('fixture-instagram-token')
    const port = createMetaConversationOutboundPort({ fetch, tokenProvider })

    await expect(
      port.send(
        request({
          accountExternalId: '11223344',
          platform: 'instagram',
          recipientExternalId: '99887766',
        }),
      ),
    ).resolves.toMatchObject({ platform: 'instagram', status: 'accepted' })
    expect(tokenProvider).toHaveBeenCalledWith({
      accountExternalId: '11223344',
      platform: 'instagram',
    })
  })

  it.each([
    [400, 'invalid_request', false, undefined],
    [401, 'authorization_required', false, undefined],
    [403, 'permission_required', false, undefined],
    [429, 'rate_limited', true, 30],
  ] as const)(
    'maps confirmed HTTP %s rejection without claiming delivery',
    async (status, errorCode, retryable, retryAfterSeconds) => {
      const fetch = vi.fn().mockResolvedValue(
        response({
          headers: retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : {},
          status,
        }),
      )
      const port = createMetaConversationOutboundPort({
        fetch,
        tokenProvider: async () => 'fixture-page-token',
      })

      await expect(port.send(request())).resolves.toEqual({
        deliveryKey: 'reply:fixture:1',
        errorCode,
        platform: 'facebook-messenger',
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        retryable,
        status: 'blocked',
      })
    },
  )

  it.each([
    ['network loss', vi.fn().mockRejectedValue(new Error('socket reset'))],
    ['provider 500', vi.fn().mockResolvedValue(response({ status: 500 }))],
    ['malformed success', vi.fn().mockResolvedValue(response({ body: { success: true } }))],
    [
      'recipient mismatch',
      vi.fn().mockResolvedValue(
        response({
          body: { message_id: 'm_provider_fixture_1', recipient_id: '999' },
        }),
      ),
    ],
  ])('fails closed as delivery_unknown after %s', async (_label, fetch) => {
    const port = createMetaConversationOutboundPort({
      fetch,
      tokenProvider: async () => 'fixture-page-token',
    })

    const result = port.send(request())
    await expect(result).rejects.toBeInstanceOf(PlatformConversationOutboundOutcomeUnknownError)
    await expect(result).rejects.toSatisfy(isPlatformConversationOutboundOutcomeUnknownError)
  })

  it('does not call fetch without a valid token or valid request', async () => {
    const fetch = vi.fn()
    const noToken = createMetaConversationOutboundPort({
      fetch,
      tokenProvider: async () => '',
    })
    await expect(noToken.send(request())).resolves.toMatchObject({
      errorCode: 'authorization_required',
      retryable: false,
      status: 'blocked',
    })

    const validToken = createMetaConversationOutboundPort({
      fetch,
      tokenProvider: async () => 'fixture-page-token',
    })
    await expect(validToken.send(request({ platform: 'tiktok' }))).resolves.toMatchObject({
      errorCode: 'invalid_request',
      retryable: false,
      status: 'blocked',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps token-provider outages retryable before provider I/O', async () => {
    const fetch = vi.fn()
    const port = createMetaConversationOutboundPort({
      fetch,
      tokenProvider: async () => {
        throw new Error('credential store unavailable')
      },
    })

    await expect(port.send(request())).rejects.toBeInstanceOf(
      PlatformConversationOutboundTransportError,
    )
    await expect(port.send(request())).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts a timed-out request and fails closed as delivery_unknown', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn((_url: string | URL, init?: RequestInit) => {
        return new Promise<ReturnType<typeof response>>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        })
      })
      const port = createMetaConversationOutboundPort({
        fetch,
        timeoutMs: 50,
        tokenProvider: async () => 'fixture-page-token',
      })

      const result = port.send(request())
      const unknownOutcome = expect(result).rejects.toBeInstanceOf(
        PlatformConversationOutboundOutcomeUnknownError,
      )
      await vi.advanceTimersByTimeAsync(50)
      await unknownOutcome
      expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never retries or claims acceptance while recovering an unknown Meta result', async () => {
    const fetch = vi.fn()
    const port = createMetaConversationOutboundPort({
      fetch,
      tokenProvider: async () => 'fixture-page-token',
    })

    await expect(port.recoverUnknownOutcome(request())).resolves.toEqual({
      deliveryKey: 'reply:fixture:1',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
