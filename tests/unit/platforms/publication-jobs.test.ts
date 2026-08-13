import { describe, expect, it, vi } from 'vitest'

import {
  enqueuePublicationExecution,
  parsePlatformPublicationJobPayload,
  PLATFORM_PUBLICATION_JOB_TYPE,
  createPlatformPublicationJobHandler,
} from '@/modules/platforms/publicationJobs'
import type { PublicationJobRuntime } from '@/modules/platforms/publicationJobs'

describe('publication queue jobs', () => {
  it('parses the queue revision separately from the PublishJob identity', () => {
    expect(
      parsePlatformPublicationJobPayload({ expectedExecutionRevision: 7, publishJobId: 42 }),
    ).toEqual({ expectedExecutionRevision: 7, publishJobId: 42 })
    expect(() =>
      parsePlatformPublicationJobPayload({ expectedExecutionRevision: -1, publishJobId: 42 }),
    ).toThrow('expectedExecutionRevision')
    expect(() =>
      parsePlatformPublicationJobPayload({ expectedExecutionRevision: 0, publishJobId: 0 }),
    ).toThrow('publishJobId')
  })

  it('creates one revision-scoped queue job with only one proven-pre-IO retry', async () => {
    const enqueue = vi.fn().mockResolvedValue({ job: { id: 9 }, state: 'created' })
    await expect(
      enqueuePublicationExecution({ publishJobId: 42, queue: { enqueue }, revision: 7 }),
    ).resolves.toMatchObject({ state: 'created' })
    expect(enqueue).toHaveBeenCalledWith(
      {
        idempotencyKey: 'publication-execute:42:7',
        maxAttempts: 2,
        payload: { expectedExecutionRevision: 7, publishJobId: 42 },
        type: PLATFORM_PUBLICATION_JOB_TYPE,
      },
      undefined,
    )
  })

  it('fails before LinkedIn upload when the current media asset is revoked', async () => {
    const readLinkedInAssetBytes = vi
      .fn<PublicationJobRuntime['readLinkedInAssetBytes']>()
      .mockRejectedValue(
        new Error('LinkedIn media bytes no longer match the approved publication asset'),
      )
    const initializeImageUpload = vi.fn()
    const uploadImage = vi.fn()
    const publishImagePost = vi.fn()
    const getPostStatus = vi.fn()
    const publishJob = {
      executionRevision: 0,
      executionRoute: 'linkedin-image-staged',
      id: 42,
      idempotencyKey: 'publish-linkedin-image-42',
      platformAccount: 9,
      providerCheckpoint: {
        asset: {
          byteLength: 3,
          contentType: 'image/png',
          id: '81',
          sha256: 'a'.repeat(64),
        },
        checkpoint: {
          author: { kind: 'organization', organizationId: '971937765923229' },
          authorizationRevision: 4,
          commentary: 'Revoked asset',
          imageUrn: 'urn:li:image:abc_123',
          stage: 'image_initialized',
          uploadTicket: {
            imageUrn: 'urn:li:image:abc_123',
            sealedUpload: `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(24)}`,
            uploadUrlExpiresAt: 1_900_000_000_000,
          },
        },
      },
      requestSnapshot: {
        assets: [],
        idempotencyKey: 'publish-linkedin-image-42',
        platform: 'linkedin',
        platformAccountId: 9,
        status: 'publishing',
        text: 'Revoked asset',
      },
      status: 'publishing',
    } as never
    const payload = {
      findByID: vi.fn().mockResolvedValue(publishJob),
    } as never
    const transport = {
      getPostStatus,
      initializeImageUpload,
      publishImagePost,
      publishTextPost: vi.fn(),
      uploadImage,
    } as never
    const handler = createPlatformPublicationJobHandler({
      payload,
      resolveRuntime: () => ({
        directService: {} as never,
        linkedInTransport: transport,
        metaTransport: {} as never,
        readLinkedInAssetBytes,
      }),
    })

    await expect(
      handler(
        {
          attempts: 1,
          completedAt: null,
          createdAt: new Date().toISOString(),
          deadAt: null,
          id: 7,
          idempotencyKey: 'publication-execute:42:0',
          lastError: null,
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          manualRetryCount: 0,
          maxAttempts: 2,
          nextRunAt: null,
          ownerToken: 'worker-a',
          payload: { expectedExecutionRevision: 0, publishJobId: 42 },
          status: 'processing',
          type: PLATFORM_PUBLICATION_JOB_TYPE,
          updatedAt: new Date().toISOString(),
        },
        { assertLease: vi.fn(), renewLease: vi.fn(), signal: new AbortController().signal },
      ),
    ).rejects.toThrow('LinkedIn media bytes no longer match')
    expect(readLinkedInAssetBytes).toHaveBeenCalledOnce()
    expect(initializeImageUpload).not.toHaveBeenCalled()
    expect(uploadImage).not.toHaveBeenCalled()
    expect(publishImagePost).not.toHaveBeenCalled()
    expect(getPostStatus).not.toHaveBeenCalled()
  })
})
