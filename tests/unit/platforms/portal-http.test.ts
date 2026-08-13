import { describe, expect, it } from 'vitest'

import { readPlatformPortalJSON } from '@/modules/platforms/portalHttp'

const request = ({
  body = '{}',
  contentType = 'application/json',
  origin = 'https://ivybm.test',
}: {
  body?: string
  contentType?: string
  origin?: string
} = {}): Request =>
  new Request('https://ivybm.test/api/platforms/accounts', {
    body,
    headers: { 'content-type': contentType, origin },
    method: 'POST',
  })

describe('platform Portal JSON boundary', () => {
  it('accepts JSON with an optional charset parameter', async () => {
    await expect(
      readPlatformPortalJSON(request({ contentType: 'application/json; charset=utf-8' })),
    ).resolves.toEqual({})
  })

  it('rejects JSON-like but non-JSON media types', async () => {
    await expect(
      readPlatformPortalJSON(request({ contentType: 'application/jsonp' })),
    ).rejects.toMatchObject({
      code: 'unsupported_media_type',
      status: 415,
    })
  })

  it('rejects cross-origin and oversized streamed requests', async () => {
    await expect(
      readPlatformPortalJSON(request({ origin: 'https://evil.example' })),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await expect(readPlatformPortalJSON(request({ body: '"12345"' }), 4)).rejects.toMatchObject({
      code: 'request_too_large',
      status: 413,
    })
  })
})
