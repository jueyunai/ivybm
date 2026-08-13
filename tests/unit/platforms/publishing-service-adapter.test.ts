import { describe, expect, it, vi } from 'vitest'

import { PublishingContractValidationError } from '@/modules/publishing/contracts'
import type { PublishingAccountResolverPort } from '@/modules/platforms/publishingAccountResolver'
import { createPlatformPublishingService } from '@/modules/platforms/publishingServiceAdapter'
import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '@/modules/platforms/publishingResult'
import type { LinkedInPublishingTransport } from '@/modules/platforms/linkedin/publishingOutbound'
import type { MetaPublishingTransport } from '@/modules/platforms/meta/publishingOutbound'

const account = (platform: 'facebook' | 'instagram' | 'linkedin') => ({
  accountKind:
    platform === 'facebook'
      ? ('facebook-page' as const)
      : platform === 'instagram'
        ? ('instagram-professional' as const)
        : ('linkedin-member' as const),
  authorizationRevision: 4,
  externalAccountId: platform === 'linkedin' ? 'Anna_123' : '129472283584550',
  family: platform === 'linkedin' ? ('linkedin' as const) : ('meta' as const),
  platform,
  platformAccountId: 7,
  publishingApproval: 'approved' as const,
})

const resolver = (
  resolve: PublishingAccountResolverPort['resolve'] = vi.fn(async (input) => ({
    account: { ...account(input.platform), platformAccountId: input.platformAccountId },
    status: 'resolved' as const,
  })),
): PublishingAccountResolverPort => ({ resolve })

const metaTransport = (
  overrides: Partial<MetaPublishingTransport> = {},
): MetaPublishingTransport => ({
  createInstagramMedia: vi.fn(),
  getFacebookPagePostPermalink: vi.fn(async () => ({
    permalinkUrl: 'https://www.facebook.com/129472283584550/posts/7654321',
  })),
  getInstagramContainerStatus: vi.fn(),
  getInstagramMediaPermalink: vi.fn(),
  publishFacebookPagePhoto: vi.fn(async () => ({
    photoId: '7654321',
    postId: '129472283584550_7654321',
  })),
  publishInstagramMedia: vi.fn(),
  ...overrides,
})

const linkedInTransport = (
  overrides: Partial<LinkedInPublishingTransport> = {},
): LinkedInPublishingTransport => ({
  getPostStatus: vi.fn(async () => ({
    externalPublicationUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123456789/',
    lifecycleState: 'PUBLISHED' as const,
  })),
  initializeImageUpload: vi.fn(),
  publishImagePost: vi.fn(),
  publishTextPost: vi.fn(async () => ({ postUrn: 'urn:li:share:123456789' })),
  uploadImage: vi.fn(),
  ...overrides,
})

const serviceWith = ({
  accountResolver = resolver(),
  linkedIn = linkedInTransport(),
  meta = metaTransport(),
}: {
  accountResolver?: PublishingAccountResolverPort
  linkedIn?: LinkedInPublishingTransport
  meta?: MetaPublishingTransport
} = {}) =>
  createPlatformPublishingService({
    accountResolver,
    linkedInTransport: linkedIn,
    metaTransport: meta,
  })

const facebookRequest = (overrides: Record<string, unknown> = {}) => ({
  assets: [
    {
      fileName: 'facade.jpg',
      id: 'asset-1',
      mimeType: 'image/jpeg',
      sourceUrl: 'https://media.example.test/facade.jpg?sig=opaque',
    },
  ],
  idempotencyKey: 'publish-facebook-1',
  platform: 'facebook' as const,
  platformAccountId: 7,
  text: 'Project update',
  ...overrides,
})

describe('platform publishing service adapter', () => {
  it('reports only routes that this adapter can execute safely', async () => {
    const service = serviceWith()

    await expect(
      service.getCapability({ platform: 'facebook', platformAccountId: 7 }),
    ).resolves.toMatchObject({
      availability: 'conditional',
      modes: ['automatic'],
      platform: 'facebook',
      platformAccountId: 7,
    })
    await expect(
      service.getCapability({ platform: 'instagram', platformAccountId: 7 }),
    ).resolves.toMatchObject({
      availability: 'conditional',
      modes: ['automatic'],
      platform: 'instagram',
    })
    await expect(
      service.getCapability({ platform: 'linkedin', platformAccountId: 7 }),
    ).resolves.toMatchObject({
      availability: 'conditional',
      modes: ['automatic', 'assisted'],
      platform: 'linkedin',
      platformAccountId: 7,
    })
  })

  it('blocks unresolved accounts without touching provider transports', async () => {
    const meta = metaTransport()
    const service = serviceWith({
      accountResolver: resolver(
        vi.fn(async () => ({
          reason: 'authorization_expired' as const,
          status: 'blocked' as const,
        })),
      ),
      meta,
    })

    await expect(service.publish(facebookRequest())).resolves.toMatchObject({
      errorCode: 'authorization_required',
      retryable: false,
      status: 'blocked',
    })
    expect(meta.publishFacebookPagePhoto).not.toHaveBeenCalled()
  })

  it('rejects a resolver result bound to another internal account', async () => {
    const meta = metaTransport()
    const service = serviceWith({
      accountResolver: resolver(
        vi.fn(async () => ({
          account: { ...account('facebook'), platformAccountId: 8 },
          status: 'resolved' as const,
        })),
      ),
      meta,
    })

    await expect(service.publish(facebookRequest())).resolves.toMatchObject({
      errorCode: 'account_not_connected',
      status: 'blocked',
    })
    expect(meta.publishFacebookPagePhoto).not.toHaveBeenCalled()
  })

  it('publishes one Facebook image with the resolved page identity', async () => {
    const meta = metaTransport()
    const service = serviceWith({ meta })

    await expect(service.publish(facebookRequest())).resolves.toEqual({
      externalPublicationId: '129472283584550_7654321',
      externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/7654321',
      idempotencyKey: 'publish-facebook-1',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'accepted',
    })
    expect(meta.publishFacebookPagePhoto).toHaveBeenCalledWith({
      accountExternalId: '129472283584550',
      authorizationRevision: 4,
      caption: 'Project update',
      platformAccountId: 7,
      url: 'https://media.example.test/facade.jpg?sig=opaque',
    })
    expect(meta.getFacebookPagePostPermalink).toHaveBeenCalledWith({
      accountExternalId: '129472283584550',
      authorizationRevision: 4,
      platformAccountId: 7,
      postId: '129472283584550_7654321',
    })
  })

  it.each<[Record<string, unknown>, string]>([
    [{ assets: [] }, 'missing image'],
    [
      {
        assets: facebookRequest().assets.concat(
          facebookRequest().assets.map((asset) => ({ ...asset, id: 'asset-2' })),
        ),
      },
      'multiple images',
    ],
    [
      { assets: [{ ...facebookRequest().assets[0], mimeType: 'image/gif' }] },
      'unsupported MIME type',
    ],
    [{ assets: [{ ...facebookRequest().assets[0], sourceUrl: undefined }] }, 'missing source URL'],
    [{ scheduledFor: '2026-08-13T00:00:00.000Z' }, 'scheduled mutation'],
  ])('blocks invalid Facebook direct publishing: %s (%s)', async (overrides, _label) => {
    const meta = metaTransport()
    const service = serviceWith({ meta })
    await expect(service.publish(facebookRequest(overrides))).resolves.toMatchObject({
      errorCode: 'invalid_request',
      status: 'blocked',
    })
    expect(meta.publishFacebookPagePhoto).not.toHaveBeenCalled()
  })

  it('rejects malformed correlation identity instead of fabricating an error result', async () => {
    const service = serviceWith()
    await expect(
      service.publish({ ...facebookRequest(), platform: 'unsupported' as never }),
    ).rejects.toBeInstanceOf(PublishingContractValidationError)
    await expect(
      service.publish({ ...facebookRequest(), idempotencyKey: ' invalid ' }),
    ).rejects.toBeInstanceOf(PublishingContractValidationError)
    await expect(
      service.prepareAssistedPublication({
        assets: [],
        platform: 'linkedin',
        platformAccountId: ' invalid ',
        text: 'Project update',
      }),
    ).rejects.toBeInstanceOf(PublishingContractValidationError)
  })

  it('fails closed when a Facebook mutation response has no valid provider ID', async () => {
    const service = serviceWith({
      meta: metaTransport({ publishFacebookPagePhoto: vi.fn(async () => ({}) as never) }),
    })
    await expect(service.publish(facebookRequest())).resolves.toMatchObject({
      errorCode: 'delivery_unknown',
      retryable: false,
      status: 'delivery_unknown',
    })
  })

  it.each([
    [
      new ProviderPublicationConfirmedError('permission_required', false),
      'blocked',
      'permission_required',
    ],
    [new ProviderPublicationTransportError(), 'blocked', 'provider_unavailable'],
    [new ProviderPublicationResultUnknownError('unknown'), 'delivery_unknown', 'delivery_unknown'],
    [new Error('unexpected'), 'delivery_unknown', 'delivery_unknown'],
  ])(
    'maps Facebook provider failure %s without a blind retry',
    async (error, status, errorCode) => {
      const service = serviceWith({
        meta: metaTransport({ publishFacebookPagePhoto: vi.fn(async () => Promise.reject(error)) }),
      })
      await expect(service.publish(facebookRequest())).resolves.toMatchObject({ errorCode, status })
    },
  )

  it('publishes LinkedIn text for a resolved member and rejects image work from the direct path', async () => {
    const linkedIn = linkedInTransport()
    const service = serviceWith({ linkedIn })
    const request = {
      assets: [],
      idempotencyKey: 'publish-linkedin-1',
      platform: 'linkedin' as const,
      platformAccountId: 7,
      text: 'Project update',
    }

    await expect(service.publish(request)).resolves.toMatchObject({
      externalPublicationId: 'urn:li:share:123456789',
      externalPublicationUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123456789/',
      status: 'accepted',
    })
    expect(linkedIn.publishTextPost).toHaveBeenCalledWith({
      authorization: { authorizationRevision: 4, platformAccountId: 7 },
      author: { kind: 'person', personId: 'Anna_123' },
      commentary: 'Project update',
    })

    await expect(
      service.publish({ ...request, assets: facebookRequest().assets }),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    expect(linkedIn.initializeImageUpload).not.toHaveBeenCalled()
    expect(linkedIn.publishImagePost).not.toHaveBeenCalled()
    expect(linkedIn.uploadImage).not.toHaveBeenCalled()
  })

  it('blocks Instagram direct publishing so the staged executor remains authoritative', async () => {
    const meta = metaTransport()
    const service = serviceWith({ meta })
    await expect(
      service.publish({ ...facebookRequest(), platform: 'instagram' }),
    ).resolves.toMatchObject({ errorCode: 'platform_blocked', status: 'blocked' })
    expect(meta.createInstagramMedia).not.toHaveBeenCalled()
    expect(meta.publishInstagramMedia).not.toHaveBeenCalled()
  })

  it.each([
    ['PUBLISHED', 'published'],
    ['PROCESSING', 'publishing'],
    ['DRAFT', 'pending'],
  ] as const)('maps LinkedIn %s status to %s', async (lifecycleState, status) => {
    const getPostStatus = vi.fn(async () => ({ lifecycleState }))
    const linkedIn = linkedInTransport({ getPostStatus })
    const service = serviceWith({ linkedIn })
    await expect(
      service.getStatus({
        externalPublicationId: 'urn:li:share:123456789',
        idempotencyKey: 'publish-linkedin-1',
        platform: 'linkedin',
        platformAccountId: 7,
      }),
    ).resolves.toMatchObject({ externalPublicationId: 'urn:li:share:123456789', status })
    expect(getPostStatus).toHaveBeenCalledWith({
      authorization: { authorizationRevision: 4, platformAccountId: 7 },
      author: { kind: 'person', personId: 'Anna_123' },
      postUrn: 'urn:li:share:123456789',
    })
  })

  it('lets the worker retry a proven pre-I/O LinkedIn status transport failure', async () => {
    const service = serviceWith({
      linkedIn: linkedInTransport({
        getPostStatus: vi.fn(async () => Promise.reject(new ProviderPublicationTransportError())),
      }),
    })
    await expect(
      service.getStatus({
        externalPublicationId: 'urn:li:share:123456789',
        idempotencyKey: 'publish-linkedin-1',
        platform: 'linkedin',
        platformAccountId: 7,
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationTransportError)
  })

  it('confirms Facebook publication only through the provider permalink field', async () => {
    const service = serviceWith()
    await expect(
      service.getStatus({
        externalPublicationId: '129472283584550_7654321',
        idempotencyKey: 'publish-facebook-1',
        platform: 'facebook',
        platformAccountId: 7,
      }),
    ).resolves.toMatchObject({
      externalPublicationId: '129472283584550_7654321',
      externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/7654321',
      status: 'published',
    })
  })

  it('builds LinkedIn assisted packages locally without provider I/O', async () => {
    const linkedIn = linkedInTransport()
    const meta = metaTransport()
    const service = serviceWith({ linkedIn, meta })
    const result = await service.prepareAssistedPublication({
      assets: [
        {
          bytes: new Uint8Array([1, 2, 3]),
          fileName: 'facade.jpg',
          id: 'asset-1',
          mimeType: 'image/jpeg',
        },
      ],
      platform: 'linkedin',
      platformAccountId: 7,
      text: 'Project update',
    })

    expect(result).toMatchObject({ mode: 'assisted', platform: 'linkedin', status: 'prepared' })
    expect(linkedIn.publishTextPost).not.toHaveBeenCalled()
    expect(meta.publishFacebookPagePhoto).not.toHaveBeenCalled()
  })
})
