import { describe, expect, it, vi } from 'vitest'

import type { PublishingService } from '@/modules/publishing/contracts'
import {
  executePlatformPublication,
  type PlatformPublishExecutionSnapshot,
} from '@/modules/platforms/publishingExecution'

const snapshot = (
  overrides: Partial<PlatformPublishExecutionSnapshot> = {},
): PlatformPublishExecutionSnapshot => ({
  assets: [
    {
      fileName: 'facade.jpg',
      id: 'media-1',
      mimeType: 'image/jpeg',
      sourceUrl: 'https://cdn.example.invalid/facade.jpg',
    },
  ],
  expectedAuthorizationRevision: 4,
  idempotencyKey: 'publish:job:42:facebook',
  platform: 'facebook',
  platformAccountId: 7,
  status: 'scheduled',
  text: 'Facade project update',
  ...overrides,
})

const service = ({
  getStatus = vi.fn<PublishingService['getStatus']>(),
  publish = vi.fn<PublishingService['publish']>(),
}: {
  getStatus?: PublishingService['getStatus']
  publish?: PublishingService['publish']
} = {}): PublishingService => ({
  getCapability: vi.fn(),
  getStatus,
  prepareAssistedPublication: vi.fn(),
  publish,
})

describe('platform publication execution state machine', () => {
  it('rejects a worker snapshot without an authorization revision before provider I/O', async () => {
    const publish = vi.fn()

    await expect(
      executePlatformPublication({
        service: service({ publish }),
        snapshot: snapshot({ expectedAuthorizationRevision: undefined }),
      }),
    ).rejects.toThrow('authorization revision is required')
    expect(publish).not.toHaveBeenCalled()
  })

  it('sends one scheduled command with the persisted account-scoped idempotency key', async () => {
    const publish = vi.fn().mockResolvedValue({
      externalPublicationId: 'provider-post-42',
      idempotencyKey: 'publish:job:42:facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'accepted',
    })
    const getStatus = vi.fn()

    await expect(
      executePlatformPublication({
        service: service({ getStatus, publish }),
        snapshot: snapshot(),
      }),
    ).resolves.toEqual({
      changed: true,
      event: 'accepted',
      externalPublicationId: 'provider-post-42',
      status: 'accepted',
      summary: 'Provider accepted the publication command.',
    })
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAuthorizationRevision: 4,
        idempotencyKey: 'publish:job:42:facebook',
        platform: 'facebook',
        platformAccountId: 7,
      }),
    )
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('persists only provider-confirmed canonical URLs', async () => {
    const facebookPublish = vi.fn().mockResolvedValue({
      externalPublicationId: '129472283584550_7654321',
      externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/7654321',
      idempotencyKey: 'publish:job:42:facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'accepted',
    })
    await expect(
      executePlatformPublication({
        service: service({ publish: facebookPublish }),
        snapshot: snapshot(),
      }),
    ).resolves.toMatchObject({
      externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/7654321',
      status: 'published',
    })

    const linkedInPublish = vi.fn().mockResolvedValue({
      externalPublicationId: 'urn:li:share:123456789',
      externalPublicationUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123456789/',
      idempotencyKey: 'publish:job:42:linkedin',
      platform: 'linkedin',
      platformAccountId: 9,
      status: 'accepted',
    })
    await expect(
      executePlatformPublication({
        service: service({ publish: linkedInPublish }),
        snapshot: snapshot({
          assets: [],
          idempotencyKey: 'publish:job:42:linkedin',
          platform: 'linkedin',
          platformAccountId: 9,
        }),
      }),
    ).resolves.toMatchObject({
      externalPublicationUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123456789/',
      status: 'published',
    })

    await expect(
      executePlatformPublication({
        service: service({
          publish: vi.fn().mockResolvedValue({
            externalPublicationId: '129472283584550_1',
            externalPublicationUrl: 'https://evil.example.invalid/forged',
            idempotencyKey: 'publish:job:42:facebook',
            platform: 'facebook',
            platformAccountId: 7,
            status: 'accepted',
          }),
        }),
        snapshot: snapshot(),
      }),
    ).resolves.not.toHaveProperty('externalPublicationUrl')
  })

  it.each([
    [
      'blocked',
      { errorCode: 'permission_required', retryable: false, status: 'blocked' },
      'permission_required',
    ],
    [
      'failed',
      { errorCode: 'provider_unavailable', retryable: true, status: 'failed' },
      'provider_unavailable',
    ],
  ] as const)(
    'makes a confirmed %s result terminal without automatic retry',
    async (_label, result, code) => {
      const publish = vi.fn().mockResolvedValue({
        ...result,
        idempotencyKey: 'publish:job:42:facebook',
        platform: 'facebook',
        platformAccountId: 7,
      })

      await expect(
        executePlatformPublication({ service: service({ publish }), snapshot: snapshot() }),
      ).resolves.toMatchObject({ event: 'failed', lastErrorCode: code, status: 'failed' })
      expect(publish).toHaveBeenCalledTimes(1)
    },
  )

  it('stops at delivery_unknown and never claims a retry', async () => {
    const publish = vi.fn().mockResolvedValue({
      errorCode: 'delivery_unknown',
      idempotencyKey: 'publish:job:42:facebook',
      platform: 'facebook',
      platformAccountId: 7,
      retryable: false,
      status: 'delivery_unknown',
    })

    await expect(
      executePlatformPublication({ service: service({ publish }), snapshot: snapshot() }),
    ).resolves.toEqual({
      changed: true,
      event: 'delivery-unknown',
      lastErrorCode: 'delivery_unknown',
      retryable: false,
      status: 'delivery_unknown',
      summary: 'Provider outcome is unknown; automatic resend is disabled.',
    })
  })

  it.each([
    ['platform', { platform: 'instagram' }],
    ['account', { platformAccountId: 8 }],
    ['command key', { idempotencyKey: 'publish:other-job' }],
  ] as const)(
    'fails closed when provider acceptance mismatches the %s',
    async (_label, mismatch) => {
      const publish = vi.fn().mockResolvedValue({
        externalPublicationId: 'provider-post-42',
        idempotencyKey: 'publish:job:42:facebook',
        platform: 'facebook',
        platformAccountId: 7,
        status: 'accepted',
        ...mismatch,
      })

      await expect(
        executePlatformPublication({ service: service({ publish }), snapshot: snapshot() }),
      ).resolves.toMatchObject({
        lastErrorCode: 'delivery_unknown',
        retryable: false,
        status: 'delivery_unknown',
      })
    },
  )

  it.each(['', undefined, null, 42])(
    'fails closed on malformed acceptance external ID %s',
    async (externalPublicationId) => {
      const publish = vi.fn().mockResolvedValue({
        externalPublicationId,
        idempotencyKey: 'publish:job:42:facebook',
        platform: 'facebook',
        platformAccountId: 7,
        status: 'accepted',
      })

      await expect(
        executePlatformPublication({ service: service({ publish }), snapshot: snapshot() }),
      ).resolves.toMatchObject({ status: 'delivery_unknown' })
    },
  )

  it.each(['accepted', 'publishing'] as const)(
    'only polls status after %s and never sends again',
    async (status) => {
      const publish = vi.fn()
      const getStatus = vi.fn().mockResolvedValue({
        externalPublicationId: 'provider-post-42',
        idempotencyKey: 'publish:job:42:facebook',
        platform: 'facebook',
        platformAccountId: 7,
        status: 'published',
      })

      await expect(
        executePlatformPublication({
          service: service({ getStatus, publish }),
          snapshot: snapshot({ externalPublicationId: 'provider-post-42', status }),
        }),
      ).resolves.toMatchObject({ status: 'published' })
      expect(getStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedAuthorizationRevision: 4,
          externalPublicationId: 'provider-post-42',
          idempotencyKey: 'publish:job:42:facebook',
        }),
      )
      expect(publish).not.toHaveBeenCalled()
    },
  )

  it('maps pending provider status to publishing without resending', async () => {
    const getStatus = vi.fn().mockResolvedValue({
      externalPublicationId: 'provider-post-42',
      idempotencyKey: 'publish:job:42:facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'pending',
    })

    await expect(
      executePlatformPublication({
        service: service({ getStatus }),
        snapshot: snapshot({ externalPublicationId: 'provider-post-42', status: 'accepted' }),
      }),
    ).resolves.toMatchObject({ event: 'status-updated', status: 'publishing' })
  })

  it('fails closed when provider status changes its correlation handle', async () => {
    const getStatus = vi.fn().mockResolvedValue({
      externalPublicationId: 'different-provider-post',
      idempotencyKey: 'publish:job:42:facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'published',
    })

    await expect(
      executePlatformPublication({
        service: service({ getStatus }),
        snapshot: snapshot({ externalPublicationId: 'provider-post-42', status: 'accepted' }),
      }),
    ).resolves.toMatchObject({ status: 'delivery_unknown' })
  })

  it('normalizes a persisted provider ID before status lookup', async () => {
    const getStatus = vi.fn().mockResolvedValue({
      externalPublicationId: 'provider-post-42',
      idempotencyKey: 'publish:job:42:facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'published',
    })

    await expect(
      executePlatformPublication({
        service: service({ getStatus }),
        snapshot: snapshot({ externalPublicationId: ' provider-post-42 ', status: 'accepted' }),
      }),
    ).resolves.toMatchObject({ externalPublicationId: 'provider-post-42', status: 'published' })
    expect(getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ externalPublicationId: 'provider-post-42' }),
    )
  })

  it.each(['published', 'failed', 'delivery_unknown'] as const)(
    'never calls the provider again after terminal %s',
    async (status) => {
      const publish = vi.fn()
      const getStatus = vi.fn()

      await expect(
        executePlatformPublication({
          service: service({ getStatus, publish }),
          snapshot: snapshot({ status }),
        }),
      ).resolves.toEqual({ changed: false, status })
      expect(publish).not.toHaveBeenCalled()
      expect(getStatus).not.toHaveBeenCalled()
    },
  )
})
