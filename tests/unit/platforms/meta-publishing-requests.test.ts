import { describe, expect, it, vi } from 'vitest'

import {
  buildFacebookPagePhotoRequest,
  buildInstagramContainerStatusRequest,
  buildInstagramMediaPublishRequest,
  buildInstagramMediaRequest,
  parseFacebookPagePhotoResponse,
  parseInstagramContainerStatusResponse,
  parseInstagramMediaPublishResponse,
  parseInstagramMediaResponse,
  type MetaPublishingHttpRequest,
} from '../../../src/modules/platforms/meta/publishingRequests'

/**
 * The builders are required to be pure and credential-free: every request
 * description must be inspectable as plain data, never fetching the URL, and
 * never carrying any access token through the input or output. The tests below
 * assert that contract end to end.
 */

const SENSITIVE_TOKENS = ['access_token=EAAB123', 'EAAB123secret', 'Bearer EAA', 'graph_token=']

const providerErrorBodies = [
  {
    error: {
      code: 190,
      error_subcode: 460,
      fbtrace_id: 'AbCdEf',
      message: '(#190) Missing or invalid access token. Please provide a valid access token.',
      type: 'OAuthException',
    },
  },
  {
    error: {
      code: 100,
      fbtrace_id: 'secret-trace',
      message: 'Invalid parameter',
      type: 'IGApiException',
    },
  },
  {
    error: { error_user_msg: 'sensitive internal note', message: 'invalid container' },
  },
]

const validFacebookInput = () => ({
  caption: 'Aluminum facade panel for global projects. ',
  pageId: '1234567890',
  url: 'https://cdn.example.invalid/assets/facade-panel.jpg?signature=abc',
})

const validInstagramMediaInput = () => ({
  caption: '\nAluminum facade panel for global projects.\n',
  igId: '17895695688002100',
  imageUrl: 'https://cdn.example.invalid/assets/facade-panel.jpg',
})

const containsSensitiveErrorText = (value: string): boolean => {
  const lower = value.toLowerCase()
  return (
    lower.includes('eab') ||
    lower.includes('access token') ||
    lower.includes('oauth') ||
    lower.includes('bearer') ||
    lower.includes('fbtrace') ||
    lower.includes('igapi') ||
    lower.includes('sensitive internal note') ||
    lower.includes('graph_token')
  )
}

describe('Meta publishing request builders', () => {
  it('builds a Facebook Page single-photo request without an access token', () => {
    const request = buildFacebookPagePhotoRequest(validFacebookInput())

    expect(request).toEqual<MetaPublishingHttpRequest>({
      method: 'POST',
      path: '/1234567890/photos',
      body: {
        caption: 'Aluminum facade panel for global projects.',
        url: 'https://cdn.example.invalid/assets/facade-panel.jpg?signature=abc',
      },
    })

    for (const token of SENSITIVE_TOKENS) {
      expect(tokenize(request)).not.toContain(token)
    }
  })

  it('omits the caption key entirely when the trimmed caption is empty', () => {
    const request = buildFacebookPagePhotoRequest({
      ...validFacebookInput(),
      caption: '   \n\t ',
    })

    expect(request.body).not.toHaveProperty('caption')
    expect(request.body).toEqual({
      url: 'https://cdn.example.invalid/assets/facade-panel.jpg?signature=abc',
    })
  })

  it('enforces separate Facebook and Instagram caption ceilings', () => {
    const facebookOversized = 'a'.repeat(5_001)
    const facebookAtLimit = 'b'.repeat(5_000)
    const instagramOversized = 'c'.repeat(2_201)
    const instagramAtLimit = 'd'.repeat(2_200)

    expect(() =>
      buildFacebookPagePhotoRequest({ ...validFacebookInput(), caption: facebookOversized }),
    ).toThrow('Meta caption must be 5000 characters or fewer')
    expect(() =>
      buildInstagramMediaRequest({
        ...validInstagramMediaInput(),
        caption: instagramOversized,
      }),
    ).toThrow('Meta caption must be 2200 characters or fewer')

    const facebookRequest = buildFacebookPagePhotoRequest({
      ...validFacebookInput(),
      caption: `  ${facebookAtLimit}  `,
    })
    expect((facebookRequest.body as Record<string, unknown>).caption).toBe(facebookAtLimit)

    const instagramRequest = buildInstagramMediaRequest({
      ...validInstagramMediaInput(),
      caption: `  ${instagramAtLimit}  `,
    })
    expect((instagramRequest.body as Record<string, unknown>).caption).toBe(instagramAtLimit)
  })

  it('builds an Instagram /media container request with the trimmed caption and HTTPS URL', () => {
    const request = buildInstagramMediaRequest(validInstagramMediaInput())

    expect(request).toEqual<MetaPublishingHttpRequest>({
      method: 'POST',
      path: '/17895695688002100/media',
      body: {
        caption: 'Aluminum facade panel for global projects.',
        image_url: 'https://cdn.example.invalid/assets/facade-panel.jpg',
      },
    })
    for (const token of SENSITIVE_TOKENS) {
      expect(tokenize(request)).not.toContain(token)
    }
  })

  it('omits the Instagram caption key when the trimmed caption is empty', () => {
    const request = buildInstagramMediaRequest({
      ...validInstagramMediaInput(),
      caption: ' \t  \n ',
    })

    expect(request.body).not.toHaveProperty('caption')
    expect(request.body).toEqual({
      image_url: 'https://cdn.example.invalid/assets/facade-panel.jpg',
    })
  })

  it('builds an Instagram /media_publish request that carries the container creation_id in the JSON body', () => {
    const request = buildInstagramMediaPublishRequest({
      creationId: '17895695688002100',
      igId: '17895695688002101',
    })

    expect(request).toEqual<MetaPublishingHttpRequest>({
      method: 'POST',
      path: '/17895695688002101/media_publish',
      body: { creation_id: '17895695688002100' },
    })
    for (const token of SENSITIVE_TOKENS) {
      expect(tokenize(request)).not.toContain(token)
    }
  })

  it('builds an Instagram container status GET request that targets the fields=status_code query', () => {
    const request = buildInstagramContainerStatusRequest({ containerId: '17895695688002102' })

    expect(request).toEqual<MetaPublishingHttpRequest>({
      method: 'GET',
      path: '/17895695688002102',
      query: { fields: 'status_code' },
    })
    for (const token of SENSITIVE_TOKENS) {
      expect(tokenize(request)).not.toContain(token)
    }
  })

  it('rejects Meta identifiers that are blank, non-decimal, traversal-shaped or overlong', () => {
    const invalidIds = [
      '',
      '   ',
      '0x1f',
      '12a',
      '12.3',
      '-1',
      '+1',
      '1/2',
      '../etc/passwd',
      '12 34',
      '12:34',
      '12?34',
      '12#34',
      `${'1'.repeat(33)}`,
      null,
      undefined,
      12345,
    ]

    for (const id of invalidIds) {
      expect(() =>
        buildFacebookPagePhotoRequest({
          ...validFacebookInput(),
          pageId: id as never,
        }),
      ).toThrow('Meta identifier must be a bounded decimal path segment')
      expect(() =>
        buildInstagramMediaRequest({
          ...validInstagramMediaInput(),
          igId: id as never,
        }),
      ).toThrow('Meta identifier must be a bounded decimal path segment')
      expect(() =>
        buildInstagramMediaPublishRequest({
          creationId: '17895695688002100',
          igId: id as never,
        }),
      ).toThrow('Meta identifier must be a bounded decimal path segment')
      expect(() =>
        buildInstagramContainerStatusRequest({
          containerId: id as never,
        }),
      ).toThrow('Meta identifier must be a bounded decimal path segment')
    }
  })

  it('accepts only decimal Meta identifiers within the bounded length window', () => {
    expect(buildFacebookPagePhotoRequest({ ...validFacebookInput(), pageId: '1' }).path).toBe(
      '/1/photos',
    )
    expect(
      buildFacebookPagePhotoRequest({
        ...validFacebookInput(),
        pageId: '9'.repeat(32),
      }).path,
    ).toBe(`/${'9'.repeat(32)}/photos`)
  })

  it('requires HTTPS image URLs without username, password, fragments, or oversized input', () => {
    const invalidUrls = [
      'http://cdn.example.invalid/assets/facade-panel.jpg',
      'ftp://cdn.example.invalid/assets/facade-panel.jpg',
      'javascript:alert(1)',
      'not a url',
      '',
      '   ',
      'https://user:pass@cdn.example.invalid/assets/facade-panel.jpg',
      'https://:secret@cdn.example.invalid/assets/facade-panel.jpg',
      'https://user@cdn.example.invalid/assets/facade-panel.jpg',
      'https://cdn.example.invalid/assets/facade-panel.jpg#section-2',
      `https://cdn.example.invalid/${'a'.repeat(2_040)}`,
    ]

    for (const url of invalidUrls) {
      expect(() => buildFacebookPagePhotoRequest({ ...validFacebookInput(), url })).toThrow(
        'Meta publishing URL must be an HTTPS URL without credentials or fragments',
      )
      expect(() =>
        buildInstagramMediaRequest({ ...validInstagramMediaInput(), imageUrl: url }),
      ).toThrow('Meta publishing URL must be an HTTPS URL without credentials or fragments')
    }
  })

  it('preserves the supplied HTTPS image URL exactly without fetching or rewriting it', () => {
    const url = 'https://cdn.example.invalid/assets/facade-panel.jpg?signature=abc&size=2048'
    const facebook = buildFacebookPagePhotoRequest({ ...validFacebookInput(), url })
    const instagram = buildInstagramMediaRequest({ ...validInstagramMediaInput(), imageUrl: url })

    expect((facebook.body as Record<string, unknown>).url).toBe(url)
    expect((instagram.body as Record<string, unknown>).image_url).toBe(url)
  })

  it('never calls fetch and never opens a network socket when building a request', () => {
    const fetchSpy = vi.fn()
    const originalFetch = globalThis.fetch
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchSpy,
      writable: true,
    })
    try {
      buildFacebookPagePhotoRequest(validFacebookInput())
      buildInstagramMediaRequest(validInstagramMediaInput())
      buildInstagramMediaPublishRequest({
        creationId: '17895695688002100',
        igId: '17895695688002101',
      })
      buildInstagramContainerStatusRequest({ containerId: '17895695688002102' })
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: originalFetch,
        writable: true,
      })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects non-string pageId, igId, creationId, containerId, url, imageUrl and caption inputs', () => {
    for (const value of [null, 12, { id: '1' }, true]) {
      expect(() =>
        buildFacebookPagePhotoRequest({
          ...validFacebookInput(),
          pageId: value as never,
        }),
      ).toThrow('Meta identifier must be a bounded decimal path segment')
      expect(() =>
        buildInstagramMediaPublishRequest({
          creationId: value as never,
          igId: '17895695688002101',
        }),
      ).toThrow('Meta identifier must be a bounded decimal path segment')
      expect(() =>
        buildInstagramContainerStatusRequest({
          containerId: value as never,
        }),
      ).toThrow('Meta identifier must be a bounded decimal path segment')
      expect(() =>
        buildFacebookPagePhotoRequest({
          ...validFacebookInput(),
          url: value as never,
        }),
      ).toThrow('Meta publishing URL must be a string')
      expect(() =>
        buildInstagramMediaRequest({
          ...validInstagramMediaInput(),
          imageUrl: value as never,
        }),
      ).toThrow('Meta publishing URL must be a string')
      expect(() =>
        buildFacebookPagePhotoRequest({
          ...validFacebookInput(),
          caption: value as never,
        }),
      ).toThrow('Meta caption must be a string')
    }

    // `undefined` is the documented "omitted" caption shape; it must not throw.
    expect(() =>
      buildFacebookPagePhotoRequest({
        ...validFacebookInput(),
        caption: undefined,
      }),
    ).not.toThrow()
  })
})

describe('Meta publishing response parsers', () => {
  it('parses a Facebook Page single-photo response carrying both id and post_id', () => {
    expect(
      parseFacebookPagePhotoResponse({ id: '1234567890', post_id: '0987654321_1234' }),
    ).toEqual({ photoId: '1234567890', postId: '0987654321_1234' })
  })

  it('parses a Facebook Page single-photo response carrying only a photo id', () => {
    expect(parseFacebookPagePhotoResponse({ id: '1234567890' })).toEqual({
      photoId: '1234567890',
    })
  })

  it('parses a Facebook Page single-photo response carrying only a post_id', () => {
    expect(parseFacebookPagePhotoResponse({ post_id: '0987654321_1234' })).toEqual({
      postId: '0987654321_1234',
    })
  })

  it('rejects path-unsafe or malformed provider identifiers before adapters can reuse them', () => {
    for (const id of [
      '../123',
      '123/456',
      '123?fields=x',
      '123#fragment',
      '123_456',
      'a123',
      '9'.repeat(33),
    ]) {
      expect(() => parseFacebookPagePhotoResponse({ id })).toThrow(
        'Meta Facebook photo response identifier must be a bounded decimal path segment',
      )
      expect(() => parseInstagramMediaResponse({ id })).toThrow(
        'Meta Instagram creation response identifier must be a bounded decimal path segment',
      )
      expect(() => parseInstagramMediaPublishResponse({ id })).toThrow(
        'Meta Instagram media response identifier must be a bounded decimal path segment',
      )
    }

    for (const post_id of [
      '../123_456',
      '123/456',
      '123?456',
      '123#456',
      '123',
      '123_456_789',
      'abc_123',
      `${'1'.repeat(33)}_1`,
    ]) {
      expect(() => parseFacebookPagePhotoResponse({ post_id })).toThrow(
        'Meta Facebook post response identifier is invalid',
      )
    }
  })

  it('parses an Instagram /media response by surfacing the container creation id', () => {
    expect(parseInstagramMediaResponse({ id: '17895695688002100' })).toEqual({
      creationId: '17895695688002100',
    })
  })

  it('parses an Instagram /media_publish response into the published ig_media id', () => {
    expect(parseInstagramMediaPublishResponse({ id: '17895695688002200' })).toEqual({
      igMediaId: '17895695688002200',
    })
  })

  it('accepts every documented Instagram status_code and rejects everything else', () => {
    const allowed = ['EXPIRED', 'ERROR', 'FINISHED', 'IN_PROGRESS', 'PUBLISHED'] as const
    for (const statusCode of allowed) {
      expect(parseInstagramContainerStatusResponse({ status_code: statusCode })).toEqual({
        statusCode,
      })
    }

    for (const statusCode of [
      'finished',
      'FINISHED_PROCESSING',
      '',
      'QUEUED',
      null,
      0,
      undefined,
      { value: 'FINISHED' },
    ]) {
      expect(() => parseInstagramContainerStatusResponse({ status_code: statusCode })).toThrow(
        'Meta Instagram container status code is not allowed',
      )
    }
  })

  it('accepts unknown input shapes and rejects malformed provider responses without echoing raw provider text', () => {
    for (const value of [null, undefined, 'string', 42, true, [], ['id'], () => undefined]) {
      expect(() => parseFacebookPagePhotoResponse(value)).toThrow(
        'Meta Facebook page photo response is invalid',
      )
      expect(() => parseInstagramMediaResponse(value)).toThrow(
        'Meta Instagram media response is invalid',
      )
      expect(() => parseInstagramMediaPublishResponse(value)).toThrow(
        'Meta Instagram media publish response is invalid',
      )
      expect(() => parseInstagramContainerStatusResponse(value)).toThrow(
        'Meta Instagram container status response is invalid',
      )
    }

    for (const value of [{}, { id: '' }, { id: '   ' }, { post_id: '' }, { id: null }]) {
      expect(() => parseFacebookPagePhotoResponse(value)).toThrow(
        'Meta Facebook page photo response requires a photo id or post id',
      )
    }

    for (const value of [{}, { id: '' }, { id: null }, { id: 42 }]) {
      expect(() => parseInstagramMediaResponse(value)).toThrow(
        'Meta Instagram media response requires a creation id',
      )
      expect(() => parseInstagramMediaPublishResponse(value)).toThrow(
        'Meta Instagram media publish response requires an ig media id',
      )
    }

    for (const body of providerErrorBodies) {
      const facebookError = interceptError(() => parseFacebookPagePhotoResponse(body))
      const mediaError = interceptError(() => parseInstagramMediaResponse(body))
      const publishError = interceptError(() => parseInstagramMediaPublishResponse(body))
      const statusError = interceptError(() => parseInstagramContainerStatusResponse(body))

      for (const caught of [facebookError, mediaError, publishError, statusError]) {
        expect(caught).toBeInstanceOf(Error)
        expect(containsSensitiveErrorText(caught.message)).toBe(false)
      }
    }
  })
})

const tokenize = (request: MetaPublishingHttpRequest): string => {
  const segments = [request.method, request.path]
  if (request.body) segments.push(JSON.stringify(request.body))
  if (request.query) segments.push(JSON.stringify(request.query))
  return segments.join('\n')
}

const interceptError = (callback: () => unknown): Error => {
  try {
    callback()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as Error
  }
  throw new Error('Expected parser to throw')
}
