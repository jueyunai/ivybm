import { beforeEach, describe, expect, it, vi } from 'vitest'

import { purgeCloudflareEverything, purgeCloudflareUrls } from '@/lib/cloudflare'

const enabledEnvironment = {
  CLOUDFLARE_API_TOKEN: 'test-cloudflare-token-not-a-real-secret',
  CLOUDFLARE_CACHE_PURGE_ENABLED: 'true',
  CLOUDFLARE_ZONE_ID: 'a'.repeat(32),
  NEXT_PUBLIC_SERVER_URL: 'https://ivybm.com',
}

const successResponse = () =>
  ({
    json: vi.fn().mockResolvedValue({ success: true }),
    ok: true,
    status: 200,
  }) as unknown as Response

describe('Cloudflare cache purge client', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips without calling Cloudflare when the feature is disabled', async () => {
    const fetchMock = vi.fn()

    await expect(
      purgeCloudflareUrls(['/en/projects'], {
        environment: { ...enabledEnvironment, CLOUDFLARE_CACHE_PURGE_ENABLED: 'false' },
        fetch: fetchMock,
        logger,
      }),
    ).resolves.toEqual({ batches: 0, status: 'skipped', urls: 0 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('constructs canonical localized URLs, removes duplicates and sends no more than 30 per batch', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => successResponse())
    const paths = Array.from({ length: 31 }, (_, index) => `/en/projects/project-${index}`)
    paths.push('/en/projects/project-0')

    await expect(
      purgeCloudflareUrls(paths, {
        environment: enabledEnvironment,
        fetch: fetchMock,
        logger,
      }),
    ).resolves.toEqual({ batches: 2, status: 'succeeded', urls: 31 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(String(firstRequest.body)).files).toHaveLength(30)
    expect(JSON.parse(String(secondRequest.body))).toEqual({
      files: ['https://ivybm.com/en/projects/project-30'],
    })
    expect((firstRequest.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${enabledEnvironment.CLOUDFLARE_API_TOKEN}`,
    )
  })

  it('rejects a non-HTTPS public origin without external calls', async () => {
    const fetchMock = vi.fn()

    await expect(
      purgeCloudflareUrls(['https://example.com/en/projects'], {
        environment: { ...enabledEnvironment, NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000' },
        fetch: fetchMock,
        logger,
      }),
    ).resolves.toEqual({ batches: 0, status: 'skipped', urls: 0 })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipped Cloudflare cache purge because the public site URL is not HTTPS',
    )
  })

  it('ignores cross-origin URLs instead of purging another zone target', async () => {
    const fetchMock = vi.fn()

    await expect(
      purgeCloudflareUrls(['https://example.com/en/projects'], {
        environment: enabledEnvironment,
        fetch: fetchMock,
        logger,
      }),
    ).resolves.toEqual({ batches: 0, status: 'skipped', urls: 0 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails open without exposing provider response details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ errors: [{ message: 'provider detail' }], success: false }),
      ok: false,
      status: 403,
    } as unknown as Response)

    await expect(
      purgeCloudflareUrls(['/en/projects'], {
        environment: enabledEnvironment,
        fetch: fetchMock,
        logger,
      }),
    ).resolves.toEqual({ batches: 1, status: 'failed', urls: 1 })

    expect(logger.warn).toHaveBeenCalledWith('Cloudflare cache purge failed with HTTP 403')
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('provider detail'))
  })

  it('fails open when the request times out', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'AbortError'
    const fetchMock = vi.fn().mockRejectedValue(timeout)

    await expect(
      purgeCloudflareUrls(['/en/projects'], {
        environment: enabledEnvironment,
        fetch: fetchMock,
        logger,
      }),
    ).resolves.toEqual({ batches: 1, status: 'failed', urls: 1 })

    expect(logger.warn).toHaveBeenCalledWith('Cloudflare cache purge request failed: AbortError')
  })

  it('uses purge_everything only for an explicit full-zone request', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => successResponse())

    await expect(
      purgeCloudflareEverything({
        environment: enabledEnvironment,
        fetch: fetchMock,
        logger,
      }),
    ).resolves.toEqual({ batches: 1, status: 'succeeded', urls: 0 })

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      purge_everything: true,
    })
  })
})
