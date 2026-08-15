import { describe, expect, it, vi } from 'vitest'

import { createMetaPublishingTransport } from '@/modules/platforms/meta/publishingOutbound'
import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '@/modules/platforms/publishingResult'

const authorization = { authorizationRevision: 4, platformAccountId: 7 } as const

const response = ({
  body = { id: '24680', post_id: '129472283584550_24680' },
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

describe('Meta publication HTTP transport', () => {
  it('rejects invalid transport configuration at construction time', () => {
    expect(() =>
      createMetaPublishingTransport({
        allowedMediaOrigins: ['https://cdn.example.invalid/'],
        tokenProvider: async () => 'fixture-token',
      }),
    ).toThrow('Meta trusted media origin is invalid')
    expect(() =>
      createMetaPublishingTransport({
        allowedMediaOrigins: ['https://cdn.example.invalid'],
        tokenProvider: undefined as never,
      }),
    ).toThrow('Meta publishing token provider is required')
  })

  it('publishes a Facebook Page photo against the fixed Graph origin without leaking token', async () => {
    const token = 'fixture-page-token'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        response({
          body: { permalink_url: 'https://www.facebook.com/129472283584550/posts/24680' },
        }),
      )
    const tokenProvider = vi.fn().mockResolvedValue(token)
    const transport = createMetaPublishingTransport({
      allowedMediaOrigins: ['https://cdn.example.invalid'],
      fetch,
      tokenProvider,
    })

    await expect(
      transport.publishFacebookPagePhoto({
        ...authorization,
        accountExternalId: '129472283584550',
        caption: 'Facade project update',
        url: 'https://cdn.example.invalid/facade.jpg?revision=1',
      }),
    ).resolves.toEqual({ photoId: '24680', postId: '129472283584550_24680' })
    await expect(
      transport.getFacebookPagePostPermalink({
        ...authorization,
        accountExternalId: '129472283584550',
        postId: '129472283584550_24680',
      }),
    ).resolves.toEqual({
      permalinkUrl: 'https://www.facebook.com/129472283584550/posts/24680',
    })

    expect(tokenProvider).toHaveBeenCalledWith({
      accountExternalId: '129472283584550',
      authorizationRevision: 4,
      platform: 'facebook',
      platformAccountId: 7,
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('https://graph.facebook.com/v25.0/129472283584550/photos')
    expect(String(url)).not.toContain(token)
    expect(init.headers.authorization).toBe(`Bearer ${token}`)
    expect(JSON.parse(String(init.body))).toEqual({
      caption: 'Facade project update',
      url: 'https://cdn.example.invalid/facade.jpg?revision=1',
    })
    expect(init.body).not.toContain(token)
  })

  it('executes the three Instagram operations as separately persisted boundaries', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ body: { id: '112233' } }))
      .mockResolvedValueOnce(response({ body: { status_code: 'FINISHED' } }))
      .mockResolvedValueOnce(response({ body: { id: '998877' } }))
      .mockResolvedValueOnce(
        response({ body: { permalink: 'https://www.instagram.com/p/ABC123/' } }),
      )
    const tokenProvider = vi.fn().mockResolvedValue('fixture-instagram-token')
    const transport = createMetaPublishingTransport({
      allowedMediaOrigins: ['https://cdn.example.invalid'],
      fetch,
      tokenProvider,
    })

    await expect(
      transport.createInstagramMedia({
        ...authorization,
        accountExternalId: '1221206873460693',
        caption: 'New project',
        imageUrl: 'https://cdn.example.invalid/project.jpg',
      }),
    ).resolves.toEqual({ creationId: '112233' })
    await expect(
      transport.getInstagramContainerStatus({
        ...authorization,
        accountExternalId: '1221206873460693',
        containerId: '112233',
      }),
    ).resolves.toEqual({ state: 'ready' })
    await expect(
      transport.publishInstagramMedia({
        ...authorization,
        accountExternalId: '1221206873460693',
        creationId: '112233',
      }),
    ).resolves.toEqual({ igMediaId: '998877' })
    await expect(
      transport.getInstagramMediaPermalink({
        ...authorization,
        accountExternalId: '1221206873460693',
        mediaId: '998877',
      }),
    ).resolves.toEqual({ permalink: 'https://www.instagram.com/p/ABC123/' })

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://graph.instagram.com/v22.0/1221206873460693/media',
      'https://graph.instagram.com/v22.0/112233?fields=status_code',
      'https://graph.instagram.com/v22.0/1221206873460693/media_publish',
      'https://graph.instagram.com/v22.0/998877?fields=permalink',
    ])
    expect(tokenProvider).toHaveBeenCalledTimes(4)
    expect(tokenProvider).toHaveBeenNthCalledWith(1, {
      accountExternalId: '1221206873460693',
      authorizationRevision: 4,
      platform: 'instagram',
      platformAccountId: 7,
    })
  })

  it.each([
    [400, 'invalid_request', false, undefined],
    [401, 'authorization_required', false, undefined],
    [403, 'permission_required', false, undefined],
    [429, 'rate_limited', true, 30],
  ] as const)(
    'maps confirmed HTTP %s rejection before any success claim',
    async (status, code, retryable, retryAfterSeconds) => {
      const transport = createMetaPublishingTransport({
        allowedMediaOrigins: ['https://cdn.example.invalid'],
        fetch: vi.fn().mockResolvedValue(
          response({
            headers: retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : {},
            status,
          }),
        ),
        tokenProvider: async () => 'fixture-page-token',
      })

      await expect(
        transport.publishFacebookPagePhoto({
          ...authorization,
          accountExternalId: '129472283584550',
          url: 'https://cdn.example.invalid/facade.jpg',
        }),
      ).rejects.toMatchObject({ code, retryAfterSeconds, retryable })
    },
  )

  it.each([
    ['network loss', vi.fn().mockRejectedValue(new Error('socket reset'))],
    ['provider 500', vi.fn().mockResolvedValue(response({ status: 500 }))],
    ['malformed success', vi.fn().mockResolvedValue(response({ body: { success: true } }))],
  ])('fails closed as delivery_unknown after %s', async (_label, fetch) => {
    const transport = createMetaPublishingTransport({
      allowedMediaOrigins: ['https://cdn.example.invalid'],
      fetch,
      tokenProvider: async () => 'fixture-page-token',
    })

    await expect(
      transport.publishFacebookPagePhoto({
        ...authorization,
        accountExternalId: '129472283584550',
        url: 'https://cdn.example.invalid/facade.jpg',
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationResultUnknownError)
  })

  it('rejects invalid targets, URLs and tokens before provider I/O', async () => {
    const fetch = vi.fn()
    const validToken = createMetaPublishingTransport({
      allowedMediaOrigins: ['https://cdn.example.invalid'],
      fetch,
      tokenProvider: async () => 'fixture-page-token',
    })
    await expect(
      validToken.publishFacebookPagePhoto({
        ...authorization,
        accountExternalId: '129472283584550/../../me',
        url: 'https://cdn.example.invalid/facade.jpg',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
    await expect(
      validToken.publishFacebookPagePhoto({
        ...authorization,
        accountExternalId: '129472283584550',
        url: 'https://127.0.0.1/internal.jpg',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
    await expect(
      validToken.publishFacebookPagePhoto({
        ...authorization,
        accountExternalId: '129472283584550',
        url: 'https://user:password@cdn.example.invalid/facade.jpg',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false })

    const invalidToken = createMetaPublishingTransport({
      allowedMediaOrigins: ['https://cdn.example.invalid'],
      fetch,
      tokenProvider: async () => 'token with whitespace',
    })
    await expect(
      invalidToken.publishFacebookPagePhoto({
        ...authorization,
        accountExternalId: '129472283584550',
        url: 'https://cdn.example.invalid/facade.jpg',
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationConfirmedError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed authorization identity before token lookup', async () => {
    const fetch = vi.fn()
    const tokenProvider = vi.fn().mockResolvedValue('fixture-page-token')
    const transport = createMetaPublishingTransport({
      allowedMediaOrigins: ['https://cdn.example.invalid'],
      fetch,
      tokenProvider,
    })
    await expect(
      transport.publishFacebookPagePhoto({
        accountExternalId: '129472283584550',
        authorizationRevision: -1,
        platformAccountId: 7,
        url: 'https://cdn.example.invalid/facade.jpg',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
    await expect(
      transport.publishFacebookPagePhoto({
        accountExternalId: '129472283584550',
        authorizationRevision: 4,
        platformAccountId: ' invalid ',
        url: 'https://cdn.example.invalid/facade.jpg',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
    expect(tokenProvider).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a malformed Instagram status account identity before token lookup', async () => {
    const fetch = vi.fn()
    const tokenProvider = vi.fn().mockResolvedValue('fixture-instagram-token')
    const transport = createMetaPublishingTransport({
      allowedMediaOrigins: ['https://cdn.example.invalid'],
      fetch,
      tokenProvider,
    })

    await expect(
      transport.getInstagramContainerStatus({
        ...authorization,
        accountExternalId: '1221206873460693/../../me',
        containerId: '112233',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
    expect(tokenProvider).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps credential-store outages retryable before provider I/O', async () => {
    const fetch = vi.fn()
    const transport = createMetaPublishingTransport({
      allowedMediaOrigins: ['https://cdn.example.invalid'],
      fetch,
      tokenProvider: async () => {
        throw new Error('credential store unavailable')
      },
    })

    await expect(
      transport.publishFacebookPagePhoto({
        ...authorization,
        accountExternalId: '129472283584550',
        url: 'https://cdn.example.invalid/facade.jpg',
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationTransportError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts a timed-out mutation and fails closed as delivery_unknown', async () => {
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
      const transport = createMetaPublishingTransport({
        allowedMediaOrigins: ['https://cdn.example.invalid'],
        fetch,
        timeoutMs: 50,
        tokenProvider: async () => 'fixture-page-token',
      })

      const result = transport.publishFacebookPagePhoto({
        ...authorization,
        accountExternalId: '129472283584550',
        url: 'https://cdn.example.invalid/facade.jpg',
      })
      const unknown = expect(result).rejects.toBeInstanceOf(ProviderPublicationResultUnknownError)
      await vi.advanceTimersByTimeAsync(50)
      await unknown
      expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
