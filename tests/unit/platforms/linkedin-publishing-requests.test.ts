// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import {
  buildLinkedInImageBinaryUploadPayload,
  buildLinkedInImageInitializeUploadRequest,
  buildLinkedInImagePostRequest,
  buildLinkedInJsonRequestHeaders,
  buildLinkedInPostStatusRequest,
  buildLinkedInTextPostRequest,
  type LinkedInImageBinaryUploadInput,
  type LinkedInImageInitializeUploadResponse,
  type LinkedInPostCreationResponse,
  type LinkedInPostStatusResponse,
  type LinkedInPublishingHttpRequest,
  parseLinkedInImageInitializeUploadResponse,
  parseLinkedInPostCreationResponse,
  parseLinkedInPostStatusResponse,
} from '../../../src/modules/platforms/linkedin/publishingRequests'
import { ProviderPublicationResultUnknownError } from '../../../src/modules/platforms/publishingResult'

/**
 * The builders are required to be pure and credential-free: every request
 * description must be inspectable as plain data, never calling `fetch`,
 * and never carrying any access token through the input or output. The
 * response parsers must accept unknown shapes and emit generic, sanitized
 * errors that never echo provider text. The tests below assert that
 * contract end to end.
 */

const SENSITIVE_TOKENS = [
  'access_token=AQU123',
  'AQU123secret',
  'Bearer AQU',
  'linkedin_oauth_token=',
  'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig',
]

const providerErrorBodies = [
  {
    error: {
      code: 'INVALID_PAYLOAD',
      message: '(400) Invalid request body — missing commentary',
      status: 400,
    },
  },
  {
    error: {
      code: 'UNAUTHORIZED',
      message: 'Not enough permissions to access: post-urn-as-author urn:li:person:abc123',
      status: 401,
    },
  },
  {
    errorDescription: 'urn:li:image:<internal-debug-payload>: trace=AbCdEf',
    error: 'image_upload_failed',
  },
]

const personAuthor = () => ({ kind: 'person' as const, personId: 'yrZCpj2Z12' })
const organizationAuthor = () => ({ kind: 'organization' as const, organizationId: '9876543' })

const validTextInput = () => ({
  author: personAuthor(),
  commentary: '  Aluminum facade systems for global projects.  ',
  linkedInVersion: '202607',
})

const validImageInput = () => ({
  author: personAuthor(),
  commentary: 'Project hero image rendering.',
  image: {
    altText: '  Aluminum facade hero  ',
    imageUrn: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
  },
  linkedInVersion: '202607',
})

const validInitializeUploadInput = () => ({
  author: personAuthor(),
  linkedInVersion: '202607',
})

const validStatusInput = () => ({
  linkedInVersion: '202607',
  postUrn: 'urn:li:share:7123456789012345678',
})

const binaryUploadNow = 1_753_600_000_000
const validBinaryUploadInput = (
  overrides: Partial<LinkedInImageBinaryUploadInput> = {},
): LinkedInImageBinaryUploadInput => ({
  bytes: new Uint8Array([0x01, 0x02, 0x03]),
  contentType: 'image/png',
  nowMilliseconds: binaryUploadNow,
  uploadUrl: 'https://upload.linkedin.com/facade',
  uploadUrlExpiresAt: binaryUploadNow + 60_000,
  ...overrides,
})

const containsSensitiveErrorText = (value: string): boolean => {
  const lower = value.toLowerCase()
  return (
    lower.includes('aqu') ||
    lower.includes('bearer') ||
    lower.includes('linkedin_oauth_token') ||
    lower.includes('access token') ||
    lower.includes('error_description') ||
    lower.includes('not enough permissions') ||
    lower.includes('internal-debug-payload') ||
    lower.includes('trace=abcdef') ||
    lower.includes('invalid_payload')
  )
}

describe('LinkedIn publishing request builders', () => {
  it('builds a text post request for a person author with the required protocol/version/content-type headers', () => {
    const request = buildLinkedInTextPostRequest(validTextInput())

    expect(request).toEqual<LinkedInPublishingHttpRequest>({
      body: {
        author: 'urn:li:person:yrZCpj2Z12',
        commentary: 'Aluminum facade systems for global projects.',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        isReshareDisabledByAuthor: false,
        lifecycleState: 'PUBLISHED',
        visibility: 'PUBLIC',
      },
      headers: {
        'Content-Type': 'application/json',
        'Linkedin-Version': '202607',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      method: 'POST',
      path: '/rest/posts',
    })
  })

  it('builds a text post request for an organization author with the same triple-header triple', () => {
    const request = buildLinkedInTextPostRequest({
      ...validTextInput(),
      author: organizationAuthor(),
    })

    expect(request.body).toMatchObject({
      author: 'urn:li:organization:9876543',
    })
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      'Linkedin-Version': '202607',
      'X-Restli-Protocol-Version': '2.0.0',
    })
  })

  it('builds an image post request that carries the media id and the trimmed altText under content.media', () => {
    const request = buildLinkedInImagePostRequest(validImageInput())

    expect(request).toEqual<LinkedInPublishingHttpRequest>({
      body: {
        author: 'urn:li:person:yrZCpj2Z12',
        commentary: 'Project hero image rendering.',
        content: {
          media: {
            altText: 'Aluminum facade hero',
            id: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
          },
        },
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        isReshareDisabledByAuthor: false,
        lifecycleState: 'PUBLISHED',
        visibility: 'PUBLIC',
      },
      headers: {
        'Content-Type': 'application/json',
        'Linkedin-Version': '202607',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      method: 'POST',
      path: '/rest/posts',
    })
  })

  it('omits the altText key from the image post body when the trimmed alt text is empty', () => {
    const request = buildLinkedInImagePostRequest({
      ...validImageInput(),
      image: { ...validImageInput().image, altText: '   \n\t  ' },
    })

    expect(request.body).toMatchObject({
      content: {
        media: {
          id: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
        },
      },
    })
    expect((request.body as Record<string, unknown>).content).toEqual({
      media: { id: 'urn:li:image:C4E10AQFoyyAjHPMQuQ' },
    })
  })

  it('builds an initializeUpload request whose body wraps the owner URN in initializeUploadRequest', () => {
    const request = buildLinkedInImageInitializeUploadRequest(validInitializeUploadInput())

    expect(request).toEqual<LinkedInPublishingHttpRequest>({
      body: {
        initializeUploadRequest: { owner: 'urn:li:person:yrZCpj2Z12' },
      },
      headers: {
        'Content-Type': 'application/json',
        'Linkedin-Version': '202607',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      method: 'POST',
      path: '/rest/images',
      query: { action: 'initializeUpload' },
    })
  })

  it('uses an organization owner when supplied to the initializeUpload builder', () => {
    const request = buildLinkedInImageInitializeUploadRequest({
      ...validInitializeUploadInput(),
      author: organizationAuthor(),
    })

    expect(request.body).toEqual({
      initializeUploadRequest: { owner: 'urn:li:organization:9876543' },
    })
  })

  it('URL-encodes the post URN inside the GET /rest/posts/{postUrn} status path', () => {
    const request = buildLinkedInPostStatusRequest({
      ...validStatusInput(),
      postUrn: 'urn:li:ugcPost:7123456789012345678',
    })

    expect(request.method).toBe('GET')
    expect(request.path).toBe('/rest/posts/urn%3Ali%3AugcPost%3A7123456789012345678')
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      'Linkedin-Version': '202607',
      'X-Restli-Protocol-Version': '2.0.0',
    })
    expect(request.query).toEqual({ viewContext: 'AUTHOR' })
    expect(request.body).toBeUndefined()
  })

  it('encodes the colon and trailing numeric id in a share post URN without losing the id', () => {
    const path = buildLinkedInPostStatusRequest(validStatusInput()).path
    const decoded = decodeURIComponent(path.replace('/rest/posts/', ''))

    expect(decoded).toBe('urn:li:share:7123456789012345678')
  })

  it('produces a frozen header map that never carries a token or extra header', () => {
    const headers = buildLinkedInJsonRequestHeaders({ linkedInVersion: '202607' })

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'Linkedin-Version': '202607',
      'X-Restli-Protocol-Version': '2.0.0',
    })
    expect(Object.isFrozen(headers)).toBe(true)
    expect(() => ((headers as Record<string, string>)['Authorization'] = 'Bearer AQU')).toThrow(
      TypeError,
    )
  })

  it('rejects the JSON headers builder when called with a token-like argument', () => {
    expect(() => buildLinkedInJsonRequestHeaders({ linkedInVersion: 'Bearer AQU' })).toThrow(
      'LinkedIn-Version must be a six-digit YYYYMM string',
    )
  })

  it('validates LinkedIn-Version as exactly six digits with a 01-12 month and never accepts blank values', () => {
    const invalidVersions = [
      '',
      '   ',
      '2026',
      '2026070',
      '2026a7',
      '202600',
      '202613',
      '2026000',
      'abcdef',
      '20-607',
      '20.607',
      null,
      undefined,
      202607,
      { value: '202607' },
    ]

    for (const value of invalidVersions) {
      const matcher =
        /LinkedIn-Version must be a six-digit YYYYMM string|LinkedIn-Version month must be between 01 and 12/

      expect(() =>
        buildLinkedInTextPostRequest({ ...validTextInput(), linkedInVersion: value as never }),
      ).toThrow(matcher)

      expect(() =>
        buildLinkedInImagePostRequest({ ...validImageInput(), linkedInVersion: value as never }),
      ).toThrow(matcher)

      expect(() =>
        buildLinkedInImageInitializeUploadRequest({
          ...validInitializeUploadInput(),
          linkedInVersion: value as never,
        }),
      ).toThrow(matcher)

      expect(() =>
        buildLinkedInPostStatusRequest({ ...validStatusInput(), linkedInVersion: value as never }),
      ).toThrow(matcher)

      expect(() => buildLinkedInJsonRequestHeaders({ linkedInVersion: value as never })).toThrow(
        matcher,
      )
    }
  })

  it('accepts every month between 01 and 12 for the LinkedIn-Version and rejects month 00/13', () => {
    for (const month of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']) {
      const request = buildLinkedInTextPostRequest({
        ...validTextInput(),
        linkedInVersion: `2026${month}`,
      })
      expect(request.headers?.['Linkedin-Version']).toBe(`2026${month}`)
    }

    for (const month of ['00', '13']) {
      expect(() =>
        buildLinkedInTextPostRequest({ ...validTextInput(), linkedInVersion: `2026${month}` }),
      ).toThrow('LinkedIn-Version month must be between 01 and 12')
    }
  })

  it('validates person author ids as bounded opaque segments and organization ids as decimals', () => {
    const invalidPersonIds = [
      '',
      '   ',
      '12.3',
      '1/2',
      '../etc/passwd',
      '12 34',
      '12?34',
      '12#34',
      '12:34',
      `${'a'.repeat(129)}`,
      null,
      undefined,
      12345,
    ]

    for (const id of invalidPersonIds) {
      expect(() =>
        buildLinkedInTextPostRequest({
          ...validTextInput(),
          author: { kind: 'person', personId: id as never },
        }),
      ).toThrow('LinkedIn person URN id must be a bounded opaque path segment')
      expect(() =>
        buildLinkedInImagePostRequest({
          ...validImageInput(),
          author: { kind: 'person', personId: id as never },
        }),
      ).toThrow('LinkedIn person URN id must be a bounded opaque path segment')
    }

    const invalidOrganizationIds = [
      ...invalidPersonIds,
      '0x1f',
      '12a',
      '-1',
      '+1',
      `${'1'.repeat(33)}`,
    ]
    for (const id of invalidOrganizationIds) {
      expect(() =>
        buildLinkedInTextPostRequest({
          ...validTextInput(),
          author: { kind: 'organization', organizationId: id as never },
        }),
      ).toThrow('LinkedIn organization URN id must be a bounded decimal path segment')
      expect(() =>
        buildLinkedInImageInitializeUploadRequest({
          author: { kind: 'organization', organizationId: id as never },
          linkedInVersion: '202607',
        }),
      ).toThrow('LinkedIn organization URN id must be a bounded decimal path segment')
    }

    expect(
      buildLinkedInTextPostRequest({
        ...validTextInput(),
        author: { kind: 'person', personId: 'opaque_ABC-123' },
      }).body,
    ).toMatchObject({ author: 'urn:li:person:opaque_ABC-123' })
  })

  it('rejects text/image builders when the author shape is missing or wrong', () => {
    for (const author of [undefined, null, {}, { kind: 'page' }, { memberId: '123' }]) {
      expect(() =>
        buildLinkedInTextPostRequest({ ...validTextInput(), author: author as never }),
      ).toThrow('LinkedIn author URN is required')
      expect(() =>
        buildLinkedInImagePostRequest({ ...validImageInput(), author: author as never }),
      ).toThrow('LinkedIn author URN is required')
      expect(() =>
        buildLinkedInImageInitializeUploadRequest({
          ...validInitializeUploadInput(),
          author: author as never,
        }),
      ).toThrow('LinkedIn author URN is required')
    }
  })

  it('accepts opaque image ids and rejects malformed or traversal-shaped image URNs', () => {
    const invalidImageUrns = [
      '',
      '   ',
      'urn:li:image:',
      'urn:li:image:12.3',
      'urn:li:image:12/34',
      'urn:li:image:12?34',
      'urn:li:image:12#34',
      'urn:li:image:12\\34',
      'urn:li:image:1 urn:li:image:2',
      'urn:li:image:' + 'a'.repeat(129),
      'urn:li:member:12345',
      null,
      undefined,
      12,
      true,
    ]

    for (const imageUrn of invalidImageUrns) {
      const matcher = /LinkedIn image URN is required|LinkedIn image URN is not allowed/
      expect(() =>
        buildLinkedInImagePostRequest({
          ...validImageInput(),
          image: { imageUrn: imageUrn as never },
        }),
      ).toThrow(matcher)
    }

    expect(
      buildLinkedInImagePostRequest({
        ...validImageInput(),
        image: { imageUrn: 'urn:li:image:C4E10AQFoyyAjHPMQuQ' },
      }).body,
    ).toMatchObject({ content: { media: { id: 'urn:li:image:C4E10AQFoyyAjHPMQuQ' } } })
  })

  it('rejects non-URN, traversal-shaped, or overlong post URNs on the status builder', () => {
    const invalidPostUrns = [
      '',
      '   ',
      'not-a-urn',
      'urn:li:share:',
      'urn:li:share:ABC',
      'urn:li:share:12.3',
      'urn:li:share:1/2',
      'urn:li:share:1?2',
      'urn:li:share:1#2',
      'urn:li:share:1\\2',
      'urn:li:member:12345',
      'urn:li:image:12345',
      null,
      undefined,
      12345,
    ]

    for (const postUrn of invalidPostUrns) {
      const matcher =
        /LinkedIn post URN is required|LinkedIn post URN is not allowed|LinkedIn URN id must be a bounded decimal path segment/
      expect(() =>
        buildLinkedInPostStatusRequest({ ...validStatusInput(), postUrn: postUrn as never }),
      ).toThrow(matcher)
    }
  })

  it('rejects blank or empty commentary and enforces the 3000-character ceiling', () => {
    expect(() =>
      buildLinkedInTextPostRequest({ ...validTextInput(), commentary: '   \n\t  ' }),
    ).toThrow('LinkedIn commentary must not be empty')
    expect(() =>
      buildLinkedInImagePostRequest({ ...validImageInput(), commentary: ' \t \n' }),
    ).toThrow('LinkedIn commentary must not be empty')

    const oversized = 'a'.repeat(3_001)
    expect(() =>
      buildLinkedInTextPostRequest({ ...validTextInput(), commentary: oversized }),
    ).toThrow('LinkedIn commentary must be 3000 characters or fewer')
    expect(() =>
      buildLinkedInImagePostRequest({ ...validImageInput(), commentary: oversized }),
    ).toThrow('LinkedIn commentary must be 3000 characters or fewer')

    const atLimit = 'b'.repeat(3_000)
    expect(
      (
        buildLinkedInTextPostRequest({ ...validTextInput(), commentary: `  ${atLimit}  ` })
          .body as Record<string, unknown>
      ).commentary,
    ).toBe(atLimit)
    expect(
      (
        buildLinkedInImagePostRequest({ ...validImageInput(), commentary: `  ${atLimit}  ` })
          .body as Record<string, unknown>
      ).commentary,
    ).toBe(atLimit)
  })

  it('counts multibyte commentary and alt text as Unicode characters', () => {
    const commentaryAtLimit = '😀'.repeat(3_000)
    const altTextAtLimit = '😀'.repeat(300)

    expect(
      (
        buildLinkedInTextPostRequest({ ...validTextInput(), commentary: commentaryAtLimit })
          .body as Record<string, unknown>
      ).commentary,
    ).toBe(commentaryAtLimit)
    expect(() =>
      buildLinkedInTextPostRequest({
        ...validTextInput(),
        commentary: `${commentaryAtLimit}😀`,
      }),
    ).toThrow('LinkedIn commentary must be 3000 characters or fewer')

    expect(
      buildLinkedInImagePostRequest({
        ...validImageInput(),
        image: { ...validImageInput().image, altText: altTextAtLimit },
      }).body,
    ).toMatchObject({ content: { media: { altText: altTextAtLimit } } })
    expect(() =>
      buildLinkedInImagePostRequest({
        ...validImageInput(),
        image: { ...validImageInput().image, altText: `${altTextAtLimit}😀` },
      }),
    ).toThrow('LinkedIn image alt text must be 300 characters or fewer')
  })

  it('rejects non-string commentary inputs and an oversized alt text', () => {
    for (const value of [null, 12, { text: 'x' }, true]) {
      expect(() =>
        buildLinkedInTextPostRequest({ ...validTextInput(), commentary: value as never }),
      ).toThrow('LinkedIn commentary must be a string')
      expect(() =>
        buildLinkedInImagePostRequest({ ...validImageInput(), commentary: value as never }),
      ).toThrow('LinkedIn commentary must be a string')
    }

    expect(() =>
      buildLinkedInImagePostRequest({
        ...validImageInput(),
        image: { ...validImageInput().image, altText: 'c'.repeat(301) },
      }),
    ).toThrow('LinkedIn image alt text must be 300 characters or fewer')

    expect(() =>
      buildLinkedInImagePostRequest({
        ...validImageInput(),
        image: { ...validImageInput().image, altText: 12 as never },
      }),
    ).toThrow('LinkedIn image alt text must be a string')
  })

  it('validates binary upload URLs as HTTPS without credentials or fragments', () => {
    const invalidUrls = [
      'http://upload.linkedin.com/facade',
      'ftp://upload.linkedin.com/facade',
      'javascript:alert(1)',
      'not a url',
      '',
      '   ',
      'https://user:pass@upload.linkedin.com/facade',
      'https://:secret@upload.linkedin.com/facade',
      'https://user@upload.linkedin.com/facade',
      'https://upload.linkedin.com/facade#section-2',
      'https://upload.linkedin.com/facade image',
      'https://upload.linkedin.com/facade\nimage',
    ]

    for (const uploadUrl of invalidUrls) {
      expect(() =>
        buildLinkedInImageBinaryUploadPayload({
          ...validBinaryUploadInput(),
          uploadUrl,
        }),
      ).toThrow('LinkedIn image upload URL must be an HTTPS URL without credentials or fragments')
    }
  })

  it('rejects non-Uint8Array or empty binary bytes without inventing a provider size cap', () => {
    expect(() =>
      buildLinkedInImageBinaryUploadPayload({
        ...validBinaryUploadInput(),
        bytes: 'not bytes' as never,
      }),
    ).toThrow('LinkedIn image upload bytes must be a Uint8Array')

    expect(() =>
      buildLinkedInImageBinaryUploadPayload({
        ...validBinaryUploadInput(),
        bytes: new Uint8Array(0),
      }),
    ).toThrow('LinkedIn image upload bytes must be non-empty')

    const bytes = new Uint8Array(1024)
    const payload = buildLinkedInImageBinaryUploadPayload({
      ...validBinaryUploadInput(),
      bytes,
    })
    expect(payload.bytes).not.toBe(bytes)
    expect(payload.bytes).toEqual(bytes)
  })

  it('accepts only the JPEG, PNG, and GIF formats documented by LinkedIn', () => {
    const invalidTypes = [
      'application/json',
      'application/octet-stream',
      'text/plain',
      'image',
      'images/png',
      'image/svg+xml',
      'image/webp',
      'image/png;charset=bearer',
      'Bearer eyJhbGciOiJIUzI1NiJ9',
      '',
      '   ',
      null,
      undefined,
      12,
    ]

    for (const contentType of invalidTypes) {
      expect(() =>
        buildLinkedInImageBinaryUploadPayload({
          ...validBinaryUploadInput(),
          contentType: contentType as never,
        }),
      ).toThrow('LinkedIn image upload content type must be JPEG, PNG, or GIF')
    }

    for (const [contentType, expected] of [
      ['IMAGE/PNG', 'image/png'],
      ['image/jpeg', 'image/jpeg'],
      ['image/gif', 'image/gif'],
    ]) {
      const accepted = buildLinkedInImageBinaryUploadPayload({
        ...validBinaryUploadInput(),
        contentType,
      })
      expect(accepted.contentType).toBe(expected)
    }
  })

  it('copies binary upload bytes before freezing the transport envelope', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03])
    const payload = buildLinkedInImageBinaryUploadPayload({
      ...validBinaryUploadInput(),
      bytes,
      contentType: 'image/jpeg',
    })
    expect(Object.isFrozen(payload)).toBe(true)
    expect(payload.bytes).not.toBe(bytes)
    bytes[0] = 0xff
    expect(payload.bytes).toEqual(new Uint8Array([0x01, 0x02, 0x03]))
    expect(payload.method).toBe('PUT')
    expect(payload.uploadUrlExpiresAt).toBe(binaryUploadNow + 60_000)

    const buffer = Buffer.from([0x04, 0x05, 0x06])
    const bufferPayload = buildLinkedInImageBinaryUploadPayload({
      ...validBinaryUploadInput(),
      bytes: buffer,
    })
    expect(Buffer.isBuffer(bufferPayload.bytes)).toBe(false)
    buffer[0] = 0xff
    expect(bufferPayload.bytes).toEqual(new Uint8Array([0x04, 0x05, 0x06]))

    class SharedSliceBytes extends Uint8Array {
      override slice(): Uint8Array {
        return this
      }
    }
    const subclass = new SharedSliceBytes([0x07, 0x08, 0x09])
    const subclassPayload = buildLinkedInImageBinaryUploadPayload({
      ...validBinaryUploadInput(),
      bytes: subclass,
    })
    expect(subclassPayload.bytes).not.toBe(subclass)
    subclass[0] = 0xff
    expect(subclassPayload.bytes).toEqual(new Uint8Array([0x07, 0x08, 0x09]))
  })

  it('rejects expired or malformed provider upload expiry evidence', () => {
    for (const uploadUrlExpiresAt of [
      binaryUploadNow,
      binaryUploadNow - 1,
      0,
      1.5,
      Number.NaN,
      '1753600060000',
    ]) {
      expect(() =>
        buildLinkedInImageBinaryUploadPayload({
          ...validBinaryUploadInput(),
          uploadUrlExpiresAt: uploadUrlExpiresAt as never,
        }),
      ).toThrow(/LinkedIn image upload (URL has expired|expiry timestamp is invalid)/)
    }

    expect(() =>
      buildLinkedInImageBinaryUploadPayload({
        ...validBinaryUploadInput(),
        nowMilliseconds: Number.NaN,
      }),
    ).toThrow('LinkedIn image upload expiry timestamp is invalid')
  })

  it('preserves a long provider-issued signed upload URL instead of applying an invented 2048-character cap', () => {
    const uploadUrl = `https://upload.linkedin.com/facade?signature=${'a'.repeat(4_096)}`

    expect(
      buildLinkedInImageBinaryUploadPayload({
        ...validBinaryUploadInput(),
        uploadUrl,
      }).uploadUrl,
    ).toBe(uploadUrl)
  })

  it('never calls fetch and never opens a network socket when building any LinkedIn request', () => {
    const fetchSpy = vi.fn()
    const originalFetch = globalThis.fetch
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchSpy,
      writable: true,
    })
    try {
      buildLinkedInTextPostRequest(validTextInput())
      buildLinkedInImagePostRequest(validImageInput())
      buildLinkedInImageInitializeUploadRequest(validInitializeUploadInput())
      buildLinkedInImageBinaryUploadPayload({
        ...validBinaryUploadInput(),
      })
      buildLinkedInPostStatusRequest(validStatusInput())
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: originalFetch,
        writable: true,
      })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never carries a token or credential through any output field', () => {
    const requests: LinkedInPublishingHttpRequest[] = [
      buildLinkedInTextPostRequest(validTextInput()),
      buildLinkedInImagePostRequest(validImageInput()),
      buildLinkedInImageInitializeUploadRequest(validInitializeUploadInput()),
      buildLinkedInPostStatusRequest(validStatusInput()),
    ]

    for (const request of requests) {
      for (const token of SENSITIVE_TOKENS) {
        expect(tokenize(request)).not.toContain(token)
      }
      if (request.headers) {
        for (const key of Object.keys(request.headers)) {
          expect(key.toLowerCase()).not.toContain('authorization')
          expect(key.toLowerCase()).not.toContain('cookie')
        }
      }
    }
  })
})

describe('LinkedIn publishing response parsers', () => {
  it('parses a post creation response by surfacing the x-restli-id header value as the post URN', () => {
    expect(
      parseLinkedInPostCreationResponse({
        xRestliId: 'urn:li:share:7123456789012345678',
      }),
    ).toEqual<LinkedInPostCreationResponse>({
      postUrn: 'urn:li:share:7123456789012345678',
    })
  })

  it('parses an initializeUpload response with uploadUrl, image URN, and uploadUrlExpiresAt', () => {
    expect(
      parseLinkedInImageInitializeUploadResponse({
        value: {
          image: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
          uploadUrl: 'https://upload.linkedin.com/facade-token=abc',
          uploadUrlExpiresAt: 1_650_567_510_704,
        },
      }),
    ).toEqual<LinkedInImageInitializeUploadResponse>({
      imageUrn: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
      uploadUrl: 'https://upload.linkedin.com/facade-token=abc',
      uploadUrlExpiresAt: 1_650_567_510_704,
    })
  })

  it('rejects an initializeUpload response without a usable expiry timestamp', () => {
    expect(() =>
      parseLinkedInImageInitializeUploadResponse({
        value: {
          image: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
          uploadUrl: 'https://upload.linkedin.com/facade-token=xyz',
        },
      }),
    ).toThrow('LinkedIn image initialize upload response requires an expiry timestamp')

    for (const uploadUrlExpiresAt of [0, -1, 1, 1.5, 1_650_567_510, '1650567510704', null]) {
      expect(() =>
        parseLinkedInImageInitializeUploadResponse({
          value: {
            image: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
            uploadUrl: 'https://upload.linkedin.com/facade-token=xyz',
            uploadUrlExpiresAt,
          },
        }),
      ).toThrow('LinkedIn image initialize upload response requires an expiry timestamp')
    }
  })

  it('parses a post status response by surfacing the documented lifecycleState', () => {
    expect(
      parseLinkedInPostStatusResponse({ lifecycleState: 'PUBLISHED' }),
    ).toEqual<LinkedInPostStatusResponse>({ lifecycleState: 'PUBLISHED' })
    expect(
      parseLinkedInPostStatusResponse({ lifecycleState: 'PROCESSING' }),
    ).toEqual<LinkedInPostStatusResponse>({ lifecycleState: 'PROCESSING' })
  })

  it('accepts unknown input shapes for every parser and rejects malformed provider responses without echoing raw provider text', () => {
    for (const value of [
      null,
      undefined,
      'string',
      42,
      true,
      [],
      ['x-restli-id'],
      () => undefined,
    ]) {
      expect(() =>
        parseLinkedInPostCreationResponse({
          xRestliId: value as never,
        }),
      ).toThrow(ProviderPublicationResultUnknownError)
      expect(() => parseLinkedInImageInitializeUploadResponse(value)).toThrow(
        'LinkedIn image initialize upload response is invalid',
      )
      expect(() => parseLinkedInPostStatusResponse(value)).toThrow(
        'LinkedIn post status response is invalid',
      )
    }

    expect(() => parseLinkedInPostCreationResponse({})).toThrow(
      ProviderPublicationResultUnknownError,
    )
    expect(() => parseLinkedInPostCreationResponse({ xRestliId: '' })).toThrow(
      ProviderPublicationResultUnknownError,
    )
    expect(() => parseLinkedInPostCreationResponse({ xRestliId: 'not-a-urn' })).toThrow(
      ProviderPublicationResultUnknownError,
    )
    expect(() => parseLinkedInPostCreationResponse({ xRestliId: 'urn:li:share:ABC' })).toThrow(
      ProviderPublicationResultUnknownError,
    )

    expect(() => parseLinkedInImageInitializeUploadResponse({})).toThrow(
      'LinkedIn image initialize upload response is invalid',
    )
    expect(() => parseLinkedInImageInitializeUploadResponse({ value: {} })).toThrow(
      'LinkedIn image initialize upload response requires an upload URL',
    )
    expect(() =>
      parseLinkedInImageInitializeUploadResponse({
        value: { uploadUrl: 'https://upload.linkedin.com/x' },
      }),
    ).toThrow('LinkedIn image initialize upload response requires an image URN')
    expect(() =>
      parseLinkedInImageInitializeUploadResponse({
        value: {
          image: 'urn:li:image:ABC/DEF',
          uploadUrl: 'https://upload.linkedin.com/x',
          uploadUrlExpiresAt: 1_650_567_510_704,
        },
      }),
    ).toThrow('LinkedIn image URN is not allowed')
    expect(() =>
      parseLinkedInImageInitializeUploadResponse({
        value: {
          image: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
          uploadUrl: 'http://upload.linkedin.com/x',
          uploadUrlExpiresAt: 1_650_567_510_704,
        },
      }),
    ).toThrow('LinkedIn image upload URL must be an HTTPS URL without credentials or fragments')

    expect(() => parseLinkedInPostStatusResponse({})).toThrow(
      'LinkedIn post lifecycle state is not allowed',
    )
    for (const state of ['published', 'PUBLISHED_PROCESSING', '', null, undefined, 1, {}]) {
      expect(() => parseLinkedInPostStatusResponse({ lifecycleState: state })).toThrow(
        'LinkedIn post lifecycle state is not allowed',
      )
    }
  })

  it('never echoes provider raw body text or raw header text in any sanitized error', () => {
    const trackedInputs = [
      'Bearer AQU',
      'urn:li:share:7123456789012345678',
      'urn:li:image:C5b1234AB5d5E6fG7h8I9J0K1L2M',
      'trace=AbCdEf',
      '(400) Invalid request body',
      'Not enough permissions',
    ]

    for (const body of providerErrorBodies) {
      const creationError = interceptError(() =>
        parseLinkedInPostCreationResponse({ xRestliId: JSON.stringify(body) }),
      )
      const initializeError = interceptError(() => parseLinkedInImageInitializeUploadResponse(body))
      const statusError = interceptError(() => parseLinkedInPostStatusResponse(body))

      for (const caught of [creationError, initializeError, statusError]) {
        expect(caught).toBeInstanceOf(Error)
        expect(containsSensitiveErrorText(caught.message)).toBe(false)
        for (const tracked of trackedInputs) {
          expect(caught.message.includes(tracked)).toBe(false)
        }
      }
    }
  })
})

const tokenize = (request: LinkedInPublishingHttpRequest): string => {
  const segments = [request.method, request.path]
  if (request.body) segments.push(JSON.stringify(request.body))
  if (request.headers) segments.push(JSON.stringify(request.headers))
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
