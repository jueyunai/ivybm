import { describe, expect, it, vi } from 'vitest'

import {
  createLinkedInPublishingTransport,
  type LinkedInPublishingFetch,
} from '@/modules/platforms/linkedin/publishingOutbound'
import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '@/modules/platforms/publishingResult'

const person = { kind: 'person' as const, personId: 'AbC_123' }
const organization = { kind: 'organization' as const, organizationId: '971937765923229' }
const authorization = { authorizationRevision: 4, platformAccountId: 7 } as const
const headers = (values: Record<string, string> = {}) => new Headers(values)
const response = ({
  body = {},
  headerValues = {},
  ok = true,
  status = 200,
}: {
  body?: unknown
  headerValues?: Record<string, string>
  ok?: boolean
  status?: number
} = {}) => ({
  headers: headers(headerValues),
  json: vi.fn().mockResolvedValue(body),
  ok,
  status,
})

const createTransport = (
  fetch: LinkedInPublishingFetch,
  tokenProvider = vi.fn().mockResolvedValue('fixture-linkedin-token'),
) =>
  createLinkedInPublishingTransport({
    allowedUploadOrigins: ['https://www.linkedin.com', 'https://media.licdn.com'],
    fetch,
    linkedInVersion: '202607',
    now: () => 1_800_000_000_000,
    tokenProvider,
    uploadTicketKey: Buffer.alloc(32, 11),
  })

describe('LinkedIn publishing transport', () => {
  it('publishes a member text post and reads the response URN only from the header', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ status: 201, headerValues: { 'x-restli-id': 'urn:li:share:123456789' } }),
      )
    const tokenProvider = vi.fn().mockResolvedValue('fixture-linkedin-token')
    const transport = createTransport(fetch, tokenProvider)

    await expect(
      transport.publishTextPost({ authorization, author: person, commentary: 'Project update' }),
    ).resolves.toEqual({ postUrn: 'urn:li:share:123456789' })
    expect(tokenProvider).toHaveBeenCalledWith({
      accountExternalId: 'AbC_123',
      accountKind: 'linkedin-member',
      authorizationRevision: 4,
      platformAccountId: 7,
    })
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe('https://api.linkedin.com/rest/posts')
    expect(init).toMatchObject({ method: 'POST' })
    expect(init.headers).toMatchObject({
      'Linkedin-Version': '202607',
      'X-Restli-Protocol-Version': '2.0.0',
      authorization: 'Bearer fixture-linkedin-token',
    })
    expect(String(init.body)).toContain('urn:li:person:AbC_123')
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('client_secret')
  })

  it('initializes an organization image upload with exact account binding', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        body: {
          value: {
            image: 'urn:li:image:abc_123',
            uploadUrl: 'https://www.linkedin.com/dms-uploads/image/abc',
            uploadUrlExpiresAt: 1_900_000_000_000,
          },
        },
      }),
    )
    const tokenProvider = vi.fn().mockResolvedValue('fixture-linkedin-token')
    const transport = createTransport(fetch, tokenProvider)

    await expect(
      transport.initializeImageUpload({ authorization, author: organization }),
    ).resolves.toEqual({
      imageUrn: 'urn:li:image:abc_123',
      sealedUpload: expect.stringMatching(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
      uploadUrlExpiresAt: 1_900_000_000_000,
    })
    expect(tokenProvider).toHaveBeenCalledWith({
      accountExternalId: '971937765923229',
      accountKind: 'linkedin-organization',
      authorizationRevision: 4,
      platformAccountId: 7,
    })
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe('https://api.linkedin.com/rest/images?action=initializeUpload')
    expect(String(init.body)).toContain('urn:li:organization:971937765923229')
  })

  it('uploads image bytes only to an allowlisted HTTPS origin', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          body: {
            value: {
              image: 'urn:li:image:abc_123',
              uploadUrl: 'https://media.licdn.com/dms/image/upload?sig=opaque',
              uploadUrlExpiresAt: 1_900_000_000_000,
            },
          },
        }),
      )
      .mockResolvedValueOnce(response({ status: 201 }))
    const transport = createTransport(fetch)
    const ticket = await transport.initializeImageUpload({ authorization, author: organization })
    await expect(
      transport.uploadImage({
        authorization,
        author: organization,
        bytes: new Uint8Array([1, 2, 3]),
        contentType: 'image/jpeg',
        ticket,
      }),
    ).resolves.toBeUndefined()
    const [url, init] = fetch.mock.calls[1] as [URL, RequestInit]
    expect(url.href).toBe('https://media.licdn.com/dms/image/upload?sig=opaque')
    expect(init).toMatchObject({ method: 'PUT' })
    expect(init.headers).toMatchObject({
      authorization: 'Bearer fixture-linkedin-token',
      'content-type': 'image/jpeg',
    })
  })

  it.each([
    ['https://evil.example.invalid/upload', ProviderPublicationConfirmedError],
    ['http://media.licdn.com/upload', ProviderPublicationResultUnknownError],
  ])(
    'rejects provider-supplied untrusted upload target %s before returning a ticket',
    async (uploadUrl, errorType) => {
      const fetch = vi.fn().mockResolvedValue(
        response({
          body: {
            value: {
              image: 'urn:li:image:abc_123',
              uploadUrl,
              uploadUrlExpiresAt: 1_900_000_000_000,
            },
          },
        }),
      )
      const transport = createTransport(fetch)
      await expect(
        transport.initializeImageUpload({ authorization, author: organization }),
      ).rejects.toBeInstanceOf(errorType)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('rejects fabricated, tampered or author-rebound upload tickets before network I/O', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        body: {
          value: {
            image: 'urn:li:image:abc_123',
            uploadUrl: 'https://www.linkedin.com/dms-uploads/image/abc',
            uploadUrlExpiresAt: 1_900_000_000_000,
          },
        },
      }),
    )
    const transport = createTransport(fetch)
    const fabricated = Object.freeze({
      imageUrn: 'urn:li:image:abc_123',
      sealedUpload: 'v1.fabricated.signature',
      uploadUrlExpiresAt: 1_900_000_000_000,
    })
    await expect(
      transport.uploadImage({
        authorization,
        author: organization,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        ticket: fabricated,
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationConfirmedError)
    expect(fetch).not.toHaveBeenCalled()

    const ticket = await transport.initializeImageUpload({ authorization, author: organization })
    await expect(
      transport.uploadImage({
        authorization,
        author: person,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        ticket,
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationConfirmedError)
    const sealedSegments = ticket.sealedUpload.split('.')
    const encodedTag = sealedSegments[2]
    if (!encodedTag) throw new Error('Expected a sealed upload authentication tag')
    sealedSegments[2] = `${encodedTag[0] === 'A' ? 'B' : 'A'}${encodedTag.slice(1)}`
    const tampered = {
      ...ticket,
      sealedUpload: sealedSegments.join('.'),
    }
    await expect(
      transport.uploadImage({
        authorization,
        author: organization,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        ticket: tampered,
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationConfirmedError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('accepts a serialized ticket after transport restart with the same server key', async () => {
    const initializeFetch = vi.fn().mockResolvedValue(
      response({
        body: {
          value: {
            image: 'urn:li:image:abc_123',
            uploadUrl: 'https://www.linkedin.com/dms-uploads/image/abc',
            uploadUrlExpiresAt: 1_900_000_000_000,
          },
        },
      }),
    )
    const first = createTransport(initializeFetch)
    const persisted = JSON.parse(
      JSON.stringify(await first.initializeImageUpload({ authorization, author: organization })),
    )
    const uploadFetch = vi.fn().mockResolvedValue(response({ status: 201 }))
    const restarted = createTransport(uploadFetch)
    await expect(
      restarted.uploadImage({
        authorization,
        author: organization,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        ticket: persisted,
      }),
    ).resolves.toBeUndefined()
    expect(uploadFetch).toHaveBeenCalledTimes(1)
  })

  it('re-checks the current upload allowlist after restart before token or network I/O', async () => {
    const initializeFetch = vi.fn().mockResolvedValue(
      response({
        body: {
          value: {
            image: 'urn:li:image:abc_123',
            uploadUrl: 'https://media.licdn.com/dms/image/upload?sig=opaque',
            uploadUrlExpiresAt: 1_900_000_000_000,
          },
        },
      }),
    )
    const first = createTransport(initializeFetch)
    const ticket = await first.initializeImageUpload({ authorization, author: organization })
    const uploadFetch = vi.fn()
    const tokenProvider = vi.fn().mockResolvedValue('fixture-linkedin-token')
    const restarted = createLinkedInPublishingTransport({
      allowedUploadOrigins: ['https://www.linkedin.com'],
      fetch: uploadFetch,
      linkedInVersion: '202607',
      now: () => 1_800_000_000_000,
      tokenProvider,
      uploadTicketKey: Buffer.alloc(32, 11),
    })
    await expect(
      restarted.uploadImage({
        authorization,
        author: organization,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        ticket,
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationConfirmedError)
    expect(tokenProvider).not.toHaveBeenCalled()
    expect(uploadFetch).not.toHaveBeenCalled()
  })

  it('publishes an initialized image URN and preserves its provider post ID', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ status: 201, headerValues: { 'x-restli-id': 'urn:li:ugcPost:987654321' } }),
      )
    const transport = createTransport(fetch)
    await expect(
      transport.publishImagePost({
        altText: 'Facade',
        authorization,
        author: organization,
        commentary: 'New facade project',
        imageUrn: 'urn:li:image:abc_123',
      }),
    ).resolves.toEqual({ postUrn: 'urn:li:ugcPost:987654321' })
    expect(String((fetch.mock.calls[0]?.[1] as RequestInit).body)).toContain('urn:li:image:abc_123')
  })

  it('polls a known post with GET and maps provider lifecycle', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ body: { lifecycleState: 'PROCESSING' } }))
    const transport = createTransport(fetch)
    await expect(
      transport.getPostStatus({
        authorization,
        author: organization,
        postUrn: 'urn:li:share:123456789',
      }),
    ).resolves.toEqual({ lifecycleState: 'PROCESSING' })
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(
      'https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3A123456789?viewContext=AUTHOR',
    )
    expect(init.method).toBe('GET')
  })

  it('returns the official feed permalink only after the post is published', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ body: { lifecycleState: 'PUBLISHED' } }))
    const transport = createTransport(fetch)
    await expect(
      transport.getPostStatus({
        authorization,
        author: organization,
        postUrn: 'urn:li:ugcPost:987654321',
      }),
    ).resolves.toEqual({
      externalPublicationUrl: 'https://www.linkedin.com/feed/update/urn:li:ugcPost:987654321/',
      lifecycleState: 'PUBLISHED',
    })
  })

  it.each([
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['server failure', () => Promise.resolve(response({ ok: false, status: 503 }))],
  ])('classifies mutation %s as delivery unknown', async (_label, fetchResult) => {
    const fetch = vi.fn().mockImplementation(fetchResult)
    const transport = createTransport(fetch)
    await expect(
      transport.publishTextPost({ authorization, author: person, commentary: 'Project update' }),
    ).rejects.toBeInstanceOf(ProviderPublicationResultUnknownError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('classifies malformed mutation success as delivery unknown', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ status: 201 }))
    const transport = createTransport(fetch)
    await expect(
      transport.publishTextPost({ authorization, author: person, commentary: 'Project update' }),
    ).rejects.toBeInstanceOf(ProviderPublicationResultUnknownError)
  })

  it('maps confirmed permission and rate errors without exposing response bodies', async () => {
    const forbidden = createTransport(
      vi.fn().mockResolvedValue(response({ ok: false, status: 403 })),
    )
    await expect(
      forbidden.publishTextPost({ authorization, author: person, commentary: 'Project update' }),
    ).rejects.toMatchObject({ code: 'permission_required', retryable: false })

    const rateLimited = createTransport(
      vi
        .fn()
        .mockResolvedValue(
          response({ ok: false, status: 429, headerValues: { 'retry-after': '60' } }),
        ),
    )
    await expect(
      rateLimited.publishTextPost({ authorization, author: person, commentary: 'Project update' }),
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60, retryable: true })
  })

  it('fails closed when no exact author token is available', async () => {
    const fetch = vi.fn()
    const transport = createTransport(fetch, vi.fn().mockResolvedValue(undefined))
    await expect(
      transport.publishTextPost({ authorization, author: person, commentary: 'Project update' }),
    ).rejects.toMatchObject({ code: 'authorization_required', retryable: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed authorization identity before token or provider I/O', async () => {
    const fetch = vi.fn()
    const tokenProvider = vi.fn().mockResolvedValue('fixture-linkedin-token')
    const transport = createTransport(fetch, tokenProvider)
    await expect(
      transport.publishTextPost({
        authorization: { authorizationRevision: -1, platformAccountId: 7 },
        author: person,
        commentary: 'Project update',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
    await expect(
      transport.publishTextPost({
        authorization: { authorizationRevision: 4, platformAccountId: ' invalid ' },
        author: person,
        commentary: 'Project update',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
    expect(tokenProvider).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps read-only status transport failures retryable without claiming publication', async () => {
    const transport = createTransport(vi.fn().mockRejectedValue(new Error('offline')))
    await expect(
      transport.getPostStatus({
        authorization,
        author: person,
        postUrn: 'urn:li:share:123456789',
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationTransportError)
  })
})
