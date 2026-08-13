import { describe, expect, it } from 'vitest'

import { readPlatformPortalJSON } from '@/modules/platforms/portalHttp'

const request = ({
  body = '{}',
  contentType = 'application/json',
  origin = 'https://ivybm.test',
  url = 'https://ivybm.test/api/platforms/accounts',
}: {
  body?: string
  contentType?: string
  origin?: string
  url?: string
} = {}): Request =>
  new Request(url, {
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

  it('uses the configured public origin behind a production reverse proxy', async () => {
    const environment = {
      NEXT_PUBLIC_SERVER_URL: 'https://ivybm.test',
      NODE_ENV: 'production' as const,
    }

    await expect(
      readPlatformPortalJSON(
        request({ url: 'http://app:3000/api/platforms/accounts' }),
        4_096,
        environment,
      ),
    ).resolves.toEqual({})
    await expect(
      readPlatformPortalJSON(
        request({ origin: 'http://app:3000', url: 'http://app:3000/api/platforms/accounts' }),
        4_096,
        environment,
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })

  it('allows only an exact loopback HTTP origin for production-mode browser tests in CI', async () => {
    const environment = {
      CI: 'true',
      IVYBM_E2E_ALLOW_HTTP_LOOPBACK: 'true',
      NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000',
      NODE_ENV: 'production' as const,
    }

    await expect(
      readPlatformPortalJSON(
        request({
          origin: 'http://localhost:3000',
          url: 'http://localhost:3000/api/platforms/accounts',
        }),
        4_096,
        environment,
      ),
    ).resolves.toEqual({})
    await expect(
      readPlatformPortalJSON(
        request({
          origin: 'http://127.0.0.1:3000',
          url: 'http://localhost:3000/api/platforms/accounts',
        }),
        4_096,
        environment,
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })

  it('rejects HTTP public origins outside the CI loopback test boundary', async () => {
    await expect(
      readPlatformPortalJSON(request({ origin: 'http://localhost:3000' }), 4_096, {
        NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000',
        NODE_ENV: 'production',
      }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await expect(
      readPlatformPortalJSON(request({ origin: 'http://ivybm.test' }), 4_096, {
        CI: 'true',
        IVYBM_E2E_ALLOW_HTTP_LOOPBACK: 'true',
        NEXT_PUBLIC_SERVER_URL: 'http://ivybm.test',
        NODE_ENV: 'production',
      }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await expect(
      readPlatformPortalJSON(request({ origin: 'http://localhost:3000' }), 4_096, {
        CI: 'true',
        NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000',
        NODE_ENV: 'production',
      }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })

  it('fails closed when the production public origin is unavailable', async () => {
    await expect(
      readPlatformPortalJSON(request(), 4_096, { NODE_ENV: 'production' }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })
})
