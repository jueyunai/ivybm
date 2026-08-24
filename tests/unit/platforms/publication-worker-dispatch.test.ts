import { describe, expect, it, vi } from 'vitest'

import {
  PublishingContractValidationError,
  type PublicationAsset,
  type PublishingService,
} from '@/modules/publishing/contracts'
import type { LinkedInImagePublishingIntent } from '@/modules/platforms/linkedin/imagePublishingExecution'
import type { InstagramPublishingIntent } from '@/modules/platforms/meta/instagramPublishingExecution'
import {
  dispatchPublicationWorkItem,
  type PublicationWorkerExecutors,
} from '@/modules/platforms/publicationWorkerDispatch'
import type { PlatformPublicationIntent } from '@/modules/platforms/publishingAuthority'

const lease = { queueJobId: 42, leaseExpiresAt: '2026-08-12T16:00:00.000Z', ownerToken: 'worker-a' }

const directIntent = (
  platform: 'facebook' | 'linkedin',
  assets: PublicationAsset[] = platform === 'facebook'
    ? [
        {
          fileName: 'facade.jpg',
          id: 'asset-1',
          mimeType: 'image/jpeg',
          sourceUrl: 'https://media.example.test/facade.jpg',
        },
      ]
    : [],
): PlatformPublicationIntent => ({
  expectedRevision: 2,
  publishJobId: 42,
  snapshot: {
    assets,
    expectedAuthorizationRevision: 4,
    idempotencyKey: `publish-${platform}-42`,
    platform,
    platformAccountId: platform === 'facebook' ? 7 : 9,
    status: 'scheduled',
    text: 'Project update',
  },
})

const instagramIntent = (): InstagramPublishingIntent => ({
  checkpoint: {
    accountExternalId: '1789000012345678',
    authorizationRevision: 4,
    caption: 'Project update',
    imageUrl: 'https://media.example.test/facade.jpg',
    stage: 'scheduled',
  },
  expectedRevision: 2,
  idempotencyKey: 'publish-instagram-42',
  publishJobId: 42,
  platform: 'instagram',
  platformAccountId: 8,
})

const linkedInImageIntent = (stage: LinkedInImagePublishingIntent['checkpoint']['stage']) =>
  ({
    asset: {
      byteLength: 3,
      contentType: 'image/png' as const,
      id: 'asset-linkedin',
      sha256: 'a'.repeat(64),
    },
    checkpoint: {
      author: { kind: 'organization' as const, organizationId: '971937765923229' },
      authorizationRevision: 4,
      commentary: 'Project update',
      ...(stage === 'image_initialized'
        ? {
            imageUrn: 'urn:li:image:abc_123',
            uploadTicket: {
              imageUrn: 'urn:li:image:abc_123',
              sealedUpload: `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(24)}`,
              uploadUrlExpiresAt: 1_900_000_000_000,
            },
          }
        : {}),
      stage,
    },
    expectedRevision: 2,
    idempotencyKey: 'publish-linkedin-image-42',
    publishJobId: 42,
    platform: 'linkedin' as const,
    platformAccountId: 9,
  }) satisfies LinkedInImagePublishingIntent

const service = {} as PublishingService
const authority = {} as never
const transport = {} as never

const executors = (): PublicationWorkerExecutors => ({
  executeInstagram: vi.fn(async ({ intent }) => ({
    changed: false,
    checkpoint: intent.checkpoint,
  })),
  executeLinkedInImage: vi.fn(async ({ intent }) => ({
    changed: false,
    checkpoint: intent.checkpoint,
  })),
  executeSingle: vi.fn(async () => ({
    status: 'transitioned' as const,
    transition: { changed: true, status: 'accepted' as const },
  })),
})

describe('publication worker dispatch', () => {
  it('routes Facebook photo and LinkedIn text through the single-call authority', async () => {
    const operations = executors()
    await expect(
      dispatchPublicationWorkItem(
        {
          authority,
          intent: directIntent('facebook'),
          leaseFence: lease,
          route: 'facebook-photo-single',
          service,
        },
        operations,
      ),
    ).resolves.toMatchObject({ route: 'facebook-photo-single' })
    await expect(
      dispatchPublicationWorkItem(
        {
          authority,
          intent: directIntent('linkedin'),
          leaseFence: lease,
          route: 'linkedin-text-single',
          service,
        },
        operations,
      ),
    ).resolves.toMatchObject({ route: 'linkedin-text-single' })
    expect(operations.executeSingle).toHaveBeenCalledTimes(2)
    expect(operations.executeInstagram).not.toHaveBeenCalled()
    expect(operations.executeLinkedInImage).not.toHaveBeenCalled()
  })

  it('routes Instagram and LinkedIn image work only to staged authorities', async () => {
    const operations = executors()
    await expect(
      dispatchPublicationWorkItem(
        {
          authority,
          intent: instagramIntent(),
          leaseFence: lease,
          route: 'instagram-image-staged',
          transport,
        },
        operations,
      ),
    ).resolves.toMatchObject({ route: 'instagram-image-staged' })
    const image = linkedInImageIntent('image_initialized')
    const readAssetBytes = vi.fn(async () => new Uint8Array([1, 2, 3]))
    await expect(
      dispatchPublicationWorkItem(
        {
          authority,
          intent: image,
          leaseFence: lease,
          readAssetBytes,
          route: 'linkedin-image-staged',
          transport,
        },
        operations,
      ),
    ).resolves.toMatchObject({ route: 'linkedin-image-staged' })
    expect(operations.executeInstagram).toHaveBeenCalledTimes(1)
    expect(operations.executeLinkedInImage).toHaveBeenCalledTimes(1)
    expect(operations.executeLinkedInImage).toHaveBeenCalledWith(
      expect.objectContaining({ readAssetBytes }),
    )
    expect(operations.executeSingle).not.toHaveBeenCalled()
  })

  it.each([
    ['Facebook text-only', 'facebook-photo-single', directIntent('facebook', [])],
    [
      'Facebook multiple assets',
      'facebook-photo-single',
      directIntent('facebook', [
        ...directIntent('facebook').snapshot.assets,
        { ...directIntent('facebook').snapshot.assets[0]!, id: 'asset-2' },
      ]),
    ],
    [
      'LinkedIn media through text route',
      'linkedin-text-single',
      directIntent('linkedin', directIntent('facebook').snapshot.assets),
    ],
    ['Facebook through LinkedIn route', 'linkedin-text-single', directIntent('facebook')],
    ['LinkedIn through Facebook route', 'facebook-photo-single', directIntent('linkedin')],
  ])('rejects mismatched direct route: %s', async (_label, route, intent) => {
    const operations = executors()
    await expect(
      dispatchPublicationWorkItem(
        { authority, intent, leaseFence: lease, route, service } as never,
        operations,
      ),
    ).rejects.toBeInstanceOf(PublishingContractValidationError)
    expect(operations.executeSingle).not.toHaveBeenCalled()
  })

  it('rejects delayed scheduling while keeping queue and publication IDs distinct', async () => {
    const operations = executors()
    await expect(
      dispatchPublicationWorkItem(
        {
          authority,
          intent: {
            ...directIntent('facebook'),
            snapshot: {
              ...directIntent('facebook').snapshot,
              scheduledFor: '2026-08-13T00:00:00.000Z',
            },
          },
          leaseFence: lease,
          route: 'facebook-photo-single',
          service,
        },
        operations,
      ),
    ).rejects.toBeInstanceOf(PublishingContractValidationError)
    await expect(
      dispatchPublicationWorkItem(
        {
          authority,
          intent: directIntent('facebook'),
          leaseFence: { ...lease, queueJobId: 99 },
          route: 'facebook-photo-single',
          service,
        },
        operations,
      ),
    ).resolves.toMatchObject({ route: 'facebook-photo-single' })
    expect(operations.executeSingle).toHaveBeenCalledTimes(1)
    expect(operations.executeSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({ publishJobId: 42 }),
        leaseFence: expect.objectContaining({ queueJobId: 99 }),
      }),
    )
  })

  it.each([
    ['scheduled without reader', 'scheduled', undefined, true],
    ['scheduled with reader', 'scheduled', vi.fn(), false],
    ['upload without reader', 'image_initialized', undefined, false],
    ['upload with reader', 'image_initialized', vi.fn(), true],
  ] as const)(
    'enforces LinkedIn image reader boundary: %s',
    async (_label, stage, readAssetBytes, valid) => {
      const operations = executors()
      const promise = dispatchPublicationWorkItem(
        {
          authority,
          intent: linkedInImageIntent(stage),
          leaseFence: lease,
          ...(readAssetBytes ? { readAssetBytes } : {}),
          route: 'linkedin-image-staged',
          transport,
        },
        operations,
      )
      if (valid) {
        await expect(promise).resolves.toMatchObject({ route: 'linkedin-image-staged' })
        expect(operations.executeLinkedInImage).toHaveBeenCalledTimes(1)
      } else {
        await expect(promise).rejects.toBeInstanceOf(PublishingContractValidationError)
        expect(operations.executeLinkedInImage).not.toHaveBeenCalled()
      }
    },
  )

  it('rejects a platform-forged staged route without invoking any executor', async () => {
    const operations = executors()
    await expect(
      dispatchPublicationWorkItem(
        {
          authority,
          intent: { ...instagramIntent(), platform: 'facebook' },
          leaseFence: lease,
          route: 'instagram-image-staged',
          transport,
        } as never,
        operations,
      ),
    ).rejects.toBeInstanceOf(PublishingContractValidationError)
    expect(operations.executeInstagram).not.toHaveBeenCalled()
    expect(operations.executeLinkedInImage).not.toHaveBeenCalled()
    expect(operations.executeSingle).not.toHaveBeenCalled()
  })
})
