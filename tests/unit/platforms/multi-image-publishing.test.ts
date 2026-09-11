import { describe, expect, it, vi } from 'vitest'

import {
  buildFacebookPageFeedPostRequest,
  buildFacebookUnpublishedPhotoRequest,
  buildInstagramCarouselContainerRequest,
  buildInstagramCarouselItemRequest,
} from '@/modules/platforms/meta/publishingRequests'
import { buildLinkedInMultiImagePostRequest } from '@/modules/platforms/linkedin/publishingRequests'
import {
  executeMultiImagePublishingStage,
  type FacebookPhotosMultiPublishingCheckpoint,
  type InstagramCarouselPublishingCheckpoint,
  type LinkedInMultiImagePublishingCheckpoint,
  type MultiImagePublishingAuthorityPort,
  type MultiImagePublishingClaim,
  type MultiImagePublishingIntent,
} from '@/modules/platforms/multiImagePublishingExecution'

const lease = {
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  ownerToken: 'worker-a',
  queueJobId: 321,
}

describe('multi-image publishing request contracts', () => {
  it('rejects invalid multi-image cardinalities before transport I/O', () => {
    expect(() =>
      buildFacebookPageFeedPostRequest({ pageId: '1234567890', photoIds: ['photo1'] }),
    ).toThrow('Facebook multi-photo post requires two or three persisted photo IDs')
    expect(() =>
      buildFacebookPageFeedPostRequest({
        pageId: '1234567890',
        photoIds: ['photo1', 'photo2', 'photo3', 'photo4'],
      }),
    ).toThrow('Facebook multi-photo post requires two or three persisted photo IDs')
    expect(() =>
      buildInstagramCarouselContainerRequest({
        children: ['child1'],
        igId: '17841400000000001',
      }),
    ).toThrow('Instagram carousel requires two or three child container IDs')
    expect(() =>
      buildInstagramCarouselContainerRequest({
        children: ['child1', 'child2', 'child3', 'child4'],
        igId: '17841400000000001',
      }),
    ).toThrow('Instagram carousel requires two or three child container IDs')
    expect(() =>
      buildLinkedInMultiImagePostRequest({
        author: { kind: 'person', personId: '1' },
        commentary: 'Too few images',
        images: [{ imageUrn: 'urn:li:image:1' }],
        linkedInVersion: '202405',
      }),
    ).toThrow('LinkedIn multi-image post requires two or three uploaded images')
    expect(() =>
      buildLinkedInMultiImagePostRequest({
        author: { kind: 'person', personId: '1' },
        commentary: 'Too many images',
        images: [
          { imageUrn: 'urn:li:image:1' },
          { imageUrn: 'urn:li:image:2' },
          { imageUrn: 'urn:li:image:3' },
          { imageUrn: 'urn:li:image:4' },
        ],
        linkedInVersion: '202405',
      }),
    ).toThrow('LinkedIn multi-image post requires two or three uploaded images')
  })

  it('builds Facebook unpublished photos and the attached_media feed post', () => {
    expect(buildFacebookUnpublishedPhotoRequest({ pageId: '1234567890', url: 'https://cdn.invalid/1.png' })).toEqual({
      body: { published: false, temporary: true, url: 'https://cdn.invalid/1.png' },
      method: 'POST',
      path: '/1234567890/photos',
    })
    expect(
      buildFacebookPageFeedPostRequest({
        caption: 'Facade catalogue',
        pageId: '1234567890',
        photoIds: ['photo1', 'photo2', 'photo3'],
      }),
    ).toEqual({
      body: {
        attached_media: [{ media_fbid: 'photo1' }, { media_fbid: 'photo2' }, { media_fbid: 'photo3' }],
        message: 'Facade catalogue',
      },
      method: 'POST',
      path: '/1234567890/feed',
    })
  })

  it('builds Instagram carousel child and parent containers', () => {
    expect(buildInstagramCarouselItemRequest({ igId: '17841400000000001', imageUrl: 'https://cdn.invalid/1.jpg' })).toEqual({
      body: { image_url: 'https://cdn.invalid/1.jpg', is_carousel_item: true },
      method: 'POST',
      path: '/17841400000000001/media',
    })
    expect(
      buildInstagramCarouselContainerRequest({
        caption: 'Finish options',
        children: ['child1', 'child2'],
        igId: '17841400000000001',
      }),
    ).toEqual({
      body: { caption: 'Finish options', children: 'child1,child2', media_type: 'CAROUSEL' },
      method: 'POST',
      path: '/17841400000000001/media',
    })
  })

  it('builds a LinkedIn multi-image post in declaration order', () => {
    expect(
      buildLinkedInMultiImagePostRequest({
        author: { kind: 'organization', organizationId: '123' },
        commentary: 'New catalogue images',
        images: [{ imageUrn: 'urn:li:image:1' }, { altText: 'Facility', imageUrn: 'urn:li:image:2' }],
        linkedInVersion: '202405',
      }),
    ).toEqual({
      body: {
        author: 'urn:li:organization:123',
        commentary: 'New catalogue images',
        content: {
          multiImage: {
            images: [{ id: 'urn:li:image:1' }, { altText: 'Facility', id: 'urn:li:image:2' }],
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
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      method: 'POST',
      path: '/rest/posts',
    })
  })
})

describe('multi-image publishing execution', () => {
  const authorityFor = (initial: MultiImagePublishingIntent, mode = 'send'): MultiImagePublishingAuthorityPort => {
    let current = initial
    return {
      async claimStage(intent) {
        const claim: MultiImagePublishingClaim = {
          claimId: 'claim-1',
          fencingGeneration: 1,
          intent: { ...intent, checkpoint: intent.checkpoint },
          leaseFence: lease,
          mode: mode as 'recover' | 'send',
        }
        return { claim, status: 'claimed' }
      },
      async markProviderIOStarted() {
        return { status: 'fenced' }
      },
      async commitStage(_claim, transition) {
        current = { ...current, checkpoint: transition.checkpoint }
        return { nextRevision: current.expectedRevision + 1, status: 'committed' }
      },
      async releaseStage() {},
    }
  }

  const facebookIntent = (checkpoint: FacebookPhotosMultiPublishingCheckpoint): MultiImagePublishingIntent => ({
    checkpoint,
    expectedRevision: 0,
    idempotencyKey: 'publish-multi-42',
    platform: 'facebook',
    platformAccountId: 7,
    publishJobId: 42,
    route: 'facebook-photos-multi',
  })

  const facebookCheckpoint: FacebookPhotosMultiPublishingCheckpoint = {
    accountExternalId: '1234567890',
    authorizationRevision: 2,
    caption: 'Facade catalogue',
    items: [
      { sourceUrl: 'https://cdn.invalid/1.png' },
      { sourceUrl: 'https://cdn.invalid/2.png' },
    ],
    stage: 'scheduled',
  }

  it('creates Facebook photos one at a time before creating the attached_media post', async () => {
    const createFacebookUnpublishedPhoto = vi
      .fn()
      .mockResolvedValueOnce({ photoId: 'photo1' })
      .mockResolvedValueOnce({ photoId: 'photo2' })
    const publishFacebookPageFeed = vi.fn().mockResolvedValue({ postId: 'page1_post1' })
    const transport = {
      createFacebookUnpublishedPhoto,
      publishFacebookPageFeed,
    } as never
    let intent = facebookIntent(facebookCheckpoint)

    const first = await executeMultiImagePublishingStage({
      authority: authorityFor(intent),
      intent,
      leaseFence: lease,
      transport,
    })
    intent = { ...intent, checkpoint: first.checkpoint as FacebookPhotosMultiPublishingCheckpoint }
    expect(createFacebookUnpublishedPhoto).toHaveBeenCalledTimes(1)
    expect(first.checkpoint).toMatchObject({ stage: 'scheduled', items: [{ photoId: 'photo1' }, {}] })

    const second = await executeMultiImagePublishingStage({
      authority: authorityFor(intent),
      intent,
      leaseFence: lease,
      transport,
    })
    intent = { ...intent, checkpoint: second.checkpoint as FacebookPhotosMultiPublishingCheckpoint }
    const third = await executeMultiImagePublishingStage({
      authority: authorityFor(intent),
      intent,
      leaseFence: lease,
      transport,
    })
    expect(createFacebookUnpublishedPhoto).toHaveBeenCalledTimes(2)
    expect(publishFacebookPageFeed).toHaveBeenCalledWith(
      expect.objectContaining({ caption: 'Facade catalogue', photoIds: ['photo1', 'photo2'] }),
    )
    expect(third.checkpoint).toMatchObject({ postId: 'page1_post1', stage: 'publication_created' })
  })

  it('commits each provider checkpoint through CAS and resumes the persisted chain', async () => {
    const transport = {
      createFacebookUnpublishedPhoto: vi
        .fn()
        .mockResolvedValueOnce({ photoId: 'photo1' })
        .mockResolvedValueOnce({ photoId: 'photo2' }),
      publishFacebookPageFeed: vi.fn().mockResolvedValue({ postId: 'page1_post1' }),
    } as never
    let checkpoint: FacebookPhotosMultiPublishingCheckpoint = facebookCheckpoint
    let expectedRevision = 0
    let commitCalls = 0
    const authority: MultiImagePublishingAuthorityPort = {
      async claimStage(intent) {
        return {
          claim: {
            claimId: `claim-${commitCalls + 1}`,
            fencingGeneration: commitCalls + 1,
            intent: { ...intent, checkpoint: structuredClone(intent.checkpoint) },
            leaseFence: lease,
            mode: 'send',
          },
          status: 'claimed',
        }
      },
      async markProviderIOStarted() {
        return { status: 'fenced' }
      },
      async commitStage(_claim, transition) {
        commitCalls++
        checkpoint = structuredClone(transition.checkpoint) as typeof checkpoint
        expectedRevision++
        return { nextRevision: expectedRevision, status: 'committed' }
      },
      async releaseStage() {},
    }
    const first = await executeMultiImagePublishingStage({
      authority,
      intent: facebookIntent(checkpoint),
      leaseFence: lease,
      transport,
    })

    expect(commitCalls).toBe(1)
    expect(checkpoint).toEqual(first.checkpoint)
    expect(checkpoint).toMatchObject({ stage: 'scheduled', items: [{ photoId: 'photo1' }, {}] })

    const second = await executeMultiImagePublishingStage({
      authority,
      intent: facebookIntent(checkpoint),
      leaseFence: lease,
      transport,
    })
    expect(checkpoint).toEqual(second.checkpoint)
    expect(checkpoint).toMatchObject({ stage: 'provider_assets_prepared' })
    expect(commitCalls).toBe(2)
  })

  it('turns a blocked commit into delivery_unknown instead of pretending success', async () => {
    const createFacebookUnpublishedPhoto = vi.fn().mockResolvedValue({ photoId: 'photo1' })
    const authority: MultiImagePublishingAuthorityPort = {
      async claimStage(intent) {
        return {
          claim: {
            claimId: 'claim-blocked',
            fencingGeneration: 1,
            intent,
            leaseFence: lease,
            mode: 'send',
          },
          status: 'claimed',
        }
      },
      async markProviderIOStarted() {
        return { status: 'fenced' }
      },
      async commitStage() {
        return { reason: 'claim_conflict', status: 'blocked' }
      },
      async releaseStage() {},
    }
    const result = await executeMultiImagePublishingStage({
      authority,
      intent: facebookIntent(facebookCheckpoint),
      leaseFence: lease,
      transport: { createFacebookUnpublishedPhoto } as never,
    })

    expect(createFacebookUnpublishedPhoto).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      changed: true,
      checkpoint: { stage: 'delivery_unknown' },
      event: 'unknown',
      retryable: false,
    })
  })

  it('runs a complete Instagram carousel stage chain to published', async () => {
    const createInstagramCarouselItem = vi
      .fn()
      .mockResolvedValueOnce({ creationId: 'child1' })
      .mockResolvedValueOnce({ creationId: 'child2' })
    const createInstagramCarouselContainer = vi.fn().mockResolvedValue({ creationId: 'parent1' })
    const getInstagramContainerStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: 'pending' })
      .mockResolvedValueOnce({ state: 'ready' })
    const publishInstagramMedia = vi.fn().mockResolvedValue({ igMediaId: 'ig-media-1' })
    const transport = {
      createInstagramCarouselContainer,
      createInstagramCarouselItem,
      getInstagramContainerStatus,
      publishInstagramMedia,
    } as never
    const checkpoint: InstagramCarouselPublishingCheckpoint = {
      accountExternalId: '17841400000000001',
      authorizationRevision: 2,
      caption: 'Facade finish options',
      items: [
        { imageUrl: 'https://cdn.invalid/1.jpg' },
        { imageUrl: 'https://cdn.invalid/2.jpg' },
      ],
      stage: 'scheduled',
    }
    let intent = {
      checkpoint,
      expectedRevision: 0,
      idempotencyKey: 'publish-multi-ig-42',
      platform: 'instagram' as const,
      platformAccountId: 7,
      publishJobId: 44,
      route: 'instagram-carousel-staged' as const,
    }

    for (let index = 0; index < 2; index++) {
      const result = await executeMultiImagePublishingStage({
        authority: authorityFor(intent),
        intent,
        leaseFence: lease,
        transport,
      })
      intent = { ...intent, checkpoint: result.checkpoint as InstagramCarouselPublishingCheckpoint }
    }
    const container = await executeMultiImagePublishingStage({
      authority: authorityFor(intent),
      intent,
      leaseFence: lease,
      transport,
    })
    intent = { ...intent, checkpoint: container.checkpoint as InstagramCarouselPublishingCheckpoint }
    expect(intent.checkpoint).toMatchObject({ carouselContainerId: 'parent1', stage: 'publication_created' })

    const pending = await executeMultiImagePublishingStage({
      authority: authorityFor(intent),
      intent,
      leaseFence: lease,
      transport,
    })
    expect(pending).toMatchObject({ changed: false, checkpoint: intent.checkpoint, event: 'publishing' })

    const published = await executeMultiImagePublishingStage({
      authority: authorityFor(intent),
      intent,
      leaseFence: lease,
      transport,
    })
    expect(published.checkpoint).toMatchObject({ mediaId: 'ig-media-1', stage: 'published' })
  })

  it('marks a proven provider I/O recovery as delivery_unknown and stops resend', async () => {
    const authority = authorityFor(facebookIntent(facebookCheckpoint), 'recover')
    const result = await executeMultiImagePublishingStage({
      authority,
      intent: facebookIntent(facebookCheckpoint),
      leaseFence: lease,
      transport: {} as never,
    })

    expect(result).toMatchObject({
      changed: true,
      checkpoint: { stage: 'delivery_unknown' },
      retryable: false,
    })
  })

  it('uploads a persisted LinkedIn ticket before accepting another initialization', async () => {
    const checkpoint: LinkedInMultiImagePublishingCheckpoint = {
      author: { kind: 'person', personId: 'member1' },
      authorizationRevision: 3,
      commentary: 'New images',
      items: [
        {
          asset: {
            byteLength: 4,
            contentType: 'image/png',
            id: 'asset-1',
            sha256: 'a'.repeat(64),
          },
          uploadTicket: JSON.stringify({
            imageUrn: 'urn:li:image:1',
            uploadUrlExpiresAt: Date.now() + 60_000,
          }),
        },
        {
          asset: {
            byteLength: 4,
            contentType: 'image/png',
            id: 'asset-2',
            sha256: 'b'.repeat(64),
          },
        },
      ],
      stage: 'provider_assets_preparing',
    }
    const readAssetBytes = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
    const uploadImage = vi.fn().mockResolvedValue(undefined)
    const initializeImageUpload = vi.fn().mockResolvedValue({
      imageUrn: 'urn:li:image:2',
      uploadUrlExpiresAt: Date.now() + 60_000,
    })
    const transport = {
      initializeImageUpload,
      publishMultiImagePost: vi.fn(),
      uploadImage,
    } as never
    const intent: MultiImagePublishingIntent = {
      checkpoint,
      expectedRevision: 1,
      idempotencyKey: 'publish-multi-linkedin-42',
      platform: 'linkedin',
      platformAccountId: 9,
      publishJobId: 43,
      route: 'linkedin-multi-image-staged',
    }

    const result = await executeMultiImagePublishingStage({
      authority: authorityFor(intent),
      intent,
      leaseFence: lease,
      readAssetBytes,
      transport,
    })

    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(initializeImageUpload).toHaveBeenCalledTimes(0)
    expect(result.checkpoint).toMatchObject({
      stage: 'scheduled',
      items: [{ imageUrn: 'urn:li:image:1', uploadTicket: undefined }, {}],
    })
  })
})
