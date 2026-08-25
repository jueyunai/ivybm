import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createFakeLinkedInImagePublishingAuthority } from '@/modules/platforms/linkedin/fakeImagePublishingAuthority'
import {
  executeLinkedInImagePublishingStage,
  LINKEDIN_IMAGE_STATUS_POLL_MAX_ATTEMPTS,
  type LinkedInImagePublishingCheckpoint,
  type LinkedInImagePublishingIntent,
  type LinkedInImagePublishingLeaseFence,
} from '@/modules/platforms/linkedin/imagePublishingExecution'
import type {
  LinkedInImageUploadTicket,
  LinkedInPublishingTransport,
} from '@/modules/platforms/linkedin/publishingOutbound'
import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '@/modules/platforms/publishingResult'

const bytes = new Uint8Array([1, 2, 3, 4])
const digest = createHash('sha256').update(bytes).digest('hex')
const ticket: LinkedInImageUploadTicket = {
  imageUrn: 'urn:li:image:abc_123',
  sealedUpload: `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(24)}`,
  uploadUrlExpiresAt: 1_900_000_000_000,
}

const checkpoint = (
  overrides: Partial<LinkedInImagePublishingCheckpoint> = {},
): LinkedInImagePublishingCheckpoint => ({
  altText: 'Facade',
  author: { kind: 'organization', organizationId: '971937765923229' },
  authorizationRevision: 4,
  commentary: 'Facade project update',
  stage: 'scheduled',
  ...overrides,
})

const intent = (
  overrides: Partial<LinkedInImagePublishingIntent> = {},
): LinkedInImagePublishingIntent => ({
  asset: { byteLength: bytes.byteLength, contentType: 'image/png', id: 'asset-1', sha256: digest },
  checkpoint: checkpoint(),
  expectedRevision: 2,
  idempotencyKey: 'publish-job-42-linkedin-image',
  publishJobId: 42,
  platform: 'linkedin',
  platformAccountId: 19,
  ...overrides,
})

const lease = (
  overrides: Partial<LinkedInImagePublishingLeaseFence> = {},
): LinkedInImagePublishingLeaseFence => ({
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  ownerToken: 'worker-a',
  queueJobId: 142,
  ...overrides,
})

const transport = (
  overrides: Partial<LinkedInPublishingTransport> = {},
): LinkedInPublishingTransport => ({
  getPostStatus: vi.fn(async ({ postUrn }) => ({
    externalPublicationUrl: `https://www.linkedin.com/feed/update/${postUrn}/`,
    lifecycleState: 'PUBLISHED' as const,
  })),
  initializeImageUpload: vi.fn(),
  publishImagePost: vi.fn(),
  publishTextPost: vi.fn(),
  uploadImage: vi.fn(),
  ...overrides,
})

const setup = (input = intent(), fence = lease()) => ({
  authority: createFakeLinkedInImagePublishingAuthority({
    initialIntents: [input],
    initialJobLeases: [fence],
  }),
  fence,
  input,
})

describe('LinkedIn staged image publication', () => {
  it('initializes and checkpoints an encrypted upload ticket without asset bytes', async () => {
    const state = setup()
    const initializeImageUpload = vi.fn().mockResolvedValue(ticket)
    const adapter = transport({ initializeImageUpload })
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({
      checkpoint: {
        imageUrn: 'urn:li:image:abc_123',
        stage: 'image_initialized',
        uploadTicket: ticket,
      },
    })
    expect(initializeImageUpload).toHaveBeenCalledTimes(1)
    expect(state.authority.getIntent(42)).toMatchObject({
      expectedRevision: 3,
      checkpoint: { stage: 'image_initialized' },
    })
    expect(JSON.stringify(state.authority.getIntent(42))).not.toContain('[1,2,3,4]')
  })

  it('binds ephemeral bytes to the persisted asset digest before upload', async () => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        stage: 'image_initialized',
        uploadTicket: ticket,
      }),
    })
    const state = setup(input)
    const uploadImage = vi.fn().mockResolvedValue(undefined)
    const adapter = transport({ uploadImage })
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        readAssetBytes: vi.fn(async () => bytes),
        transport: adapter,
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'image_uploaded' } })
    expect(uploadImage).toHaveBeenCalledWith({
      authorization: { authorizationRevision: 4, platformAccountId: 19 },
      author: input.checkpoint.author,
      bytes,
      contentType: 'image/png',
      ticket,
    })
    expect(state.authority.getIntent(42)?.checkpoint.uploadTicket).toBeUndefined()
  })

  it('compares checkpoint identity structurally instead of by object key order', async () => {
    const input = intent({
      checkpoint: {
        uploadTicket: { ...ticket },
        stage: 'image_initialized',
        commentary: 'Facade project update',
        imageUrn: ticket.imageUrn,
        author: { organizationId: '971937765923229', kind: 'organization' },
        authorizationRevision: 4,
        altText: 'Facade',
      },
    })
    const state = setup(input)
    const uploadImage = vi.fn().mockResolvedValue(undefined)
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        readAssetBytes: vi.fn(async () => bytes),
        transport: transport({ uploadImage }),
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'image_uploaded' } })
    expect(uploadImage).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new Uint8Array([1, 2, 3]), 'wrong length'],
    [new Uint8Array([4, 3, 2, 1]), 'wrong digest'],
  ])('fails closed on %s bytes after fencing and before upload', async (assetBytes) => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        stage: 'image_initialized',
        uploadTicket: ticket,
      }),
    })
    const state = setup(input)
    const uploadImage = vi.fn()
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        readAssetBytes: vi.fn(async () => assetBytes),
        transport: transport({ uploadImage }),
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'failed' }, errorCode: 'invalid_request' })
    expect(uploadImage).not.toHaveBeenCalled()
  })

  it('revalidates after the provider fence and fails before upload when the asset is revoked', async () => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        stage: 'image_initialized',
        uploadTicket: ticket,
      }),
    })
    const state = setup(input)
    const order: string[] = []
    const originalMark = state.authority.markProviderIOStarted.bind(state.authority)
    state.authority.markProviderIOStarted = vi.fn(async (claim) => {
      order.push('marked')
      return originalMark(claim)
    })
    const readAssetBytes = vi.fn(async () => {
      order.push('read-current')
      return null
    })
    const uploadImage = vi.fn(async () => {
      order.push('uploaded')
    })

    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        readAssetBytes,
        transport: transport({ uploadImage }),
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'failed' }, errorCode: 'invalid_request' })
    expect(order).toEqual(['marked', 'read-current'])
    expect(readAssetBytes).toHaveBeenCalledWith(input.asset)
    expect(uploadImage).not.toHaveBeenCalled()
  })

  it('publishes only from the persisted uploaded checkpoint', async () => {
    const input = intent({
      checkpoint: checkpoint({ imageUrn: ticket.imageUrn, stage: 'image_uploaded' }),
    })
    const state = setup(input)
    const publishImagePost = vi.fn().mockResolvedValue({ postUrn: 'urn:li:share:123456789' })
    const adapter = transport({ publishImagePost })
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({
      checkpoint: {
        postUrn: 'urn:li:share:123456789',
        postUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123456789/',
        stage: 'published',
      },
      event: 'published',
    })
    expect(publishImagePost).toHaveBeenCalledTimes(1)
    expect(adapter.getPostStatus).toHaveBeenCalledWith({
      authorization: { authorizationRevision: 4, platformAccountId: 19 },
      author: { kind: 'organization', organizationId: '971937765923229' },
      postUrn: 'urn:li:share:123456789',
    })
    expect(adapter.initializeImageUpload).not.toHaveBeenCalled()
    expect(adapter.uploadImage).not.toHaveBeenCalled()
  })

  it.each(['PROCESSING', 'DRAFT'] as const)(
    'transitions to post_created and defers publication when initial post status is %s',
    async (lifecycleState) => {
      const input = intent({
        checkpoint: checkpoint({ imageUrn: ticket.imageUrn, stage: 'image_uploaded' }),
      })
      const state = setup(input)
      const publishImagePost = vi.fn().mockResolvedValue({ postUrn: 'urn:li:share:123456789' })
      const getPostStatus = vi.fn().mockResolvedValue({ lifecycleState })
      const adapter = transport({ getPostStatus, publishImagePost })
      await expect(
        executeLinkedInImagePublishingStage({
          authority: state.authority,
          intent: input,
          leaseFence: state.fence,
          transport: adapter,
        }),
      ).resolves.toMatchObject({
        checkpoint: {
          imageUrn: ticket.imageUrn,
          postUrn: 'urn:li:share:123456789',
          stage: 'post_created',
          statusPollAttempts: 1,
        },
        event: 'post-created',
      })
      expect(publishImagePost).toHaveBeenCalledTimes(1)
      expect(getPostStatus).toHaveBeenCalledTimes(1)
      expect(state.authority.getIntent(42)?.checkpoint).toMatchObject({
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
      })
    },
  )

  it('preserves postUrn at post_created if getPostStatus fails immediately after publishImagePost', async () => {
    const input = intent({
      checkpoint: checkpoint({ imageUrn: ticket.imageUrn, stage: 'image_uploaded' }),
    })
    const state = setup(input)
    const publishImagePost = vi.fn().mockResolvedValue({ postUrn: 'urn:li:share:123456789' })
    const getPostStatus = vi.fn().mockRejectedValue(new ProviderPublicationTransportError())
    const adapter = transport({ getPostStatus, publishImagePost })
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({
      checkpoint: {
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
      },
      event: 'post-created',
    })
    expect(publishImagePost).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      error: new ProviderPublicationConfirmedError('permission_required', false),
      errorCode: 'permission_required',
      event: 'failed',
      stage: 'failed',
    },
    {
      error: new ProviderPublicationConfirmedError('rate_limited', true, 30),
      errorCode: 'rate_limited',
      event: 'failed',
      stage: 'failed',
    },
    {
      error: new ProviderPublicationResultUnknownError('status result unknown'),
      errorCode: 'delivery_unknown',
      event: 'unknown',
      stage: 'delivery_unknown',
    },
    {
      error: new Error('unexpected status failure'),
      errorCode: 'delivery_unknown',
      event: 'unknown',
      stage: 'delivery_unknown',
    },
  ] as const)(
    'keeps the confirmed postUrn and stops automatic polling for an initial $errorCode status failure',
    async ({ error, errorCode, event, stage }) => {
      const input = intent({
        checkpoint: checkpoint({ imageUrn: ticket.imageUrn, stage: 'image_uploaded' }),
      })
      const state = setup(input)
      const publishImagePost = vi.fn().mockResolvedValue({ postUrn: 'urn:li:share:123456789' })
      await expect(
        executeLinkedInImagePublishingStage({
          authority: state.authority,
          intent: input,
          leaseFence: state.fence,
          transport: transport({
            getPostStatus: vi.fn().mockRejectedValue(error),
            publishImagePost,
          }),
        }),
      ).resolves.toMatchObject({
        checkpoint: { postUrn: 'urn:li:share:123456789', stage },
        errorCode,
        event,
      })
      expect(publishImagePost).toHaveBeenCalledTimes(1)
      expect(state.authority.getIntent(42)?.checkpoint).toMatchObject({
        postUrn: 'urn:li:share:123456789',
        stage,
      })
    },
  )

  it('polls post_created checkpoint and remains in publishing while PROCESSING', async () => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
      }),
    })
    const state = setup(input)
    const getPostStatus = vi.fn().mockResolvedValue({ lifecycleState: 'PROCESSING' })
    const adapter = transport({ getPostStatus })
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({
      changed: true,
      checkpoint: {
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
        statusPollAttempts: 2,
      },
      event: 'publishing',
    })
    expect(adapter.publishImagePost).not.toHaveBeenCalled()
    expect(getPostStatus).toHaveBeenCalledWith({
      authorization: { authorizationRevision: 4, platformAccountId: 19 },
      author: { kind: 'organization', organizationId: '971937765923229' },
      postUrn: 'urn:li:share:123456789',
    })
  })

  it.each(['PROCESSING', 'DRAFT'] as const)(
    'stops automatic polling as delivery_unknown after bounded %s status attempts',
    async (lifecycleState) => {
      const input = intent({
        checkpoint: checkpoint({
          imageUrn: ticket.imageUrn,
          postUrn: 'urn:li:share:123456789',
          stage: 'post_created',
          statusPollAttempts: LINKEDIN_IMAGE_STATUS_POLL_MAX_ATTEMPTS - 1,
        }),
      })
      const state = setup(input)
      const getPostStatus = vi.fn().mockResolvedValue({ lifecycleState })

      await expect(
        executeLinkedInImagePublishingStage({
          authority: state.authority,
          intent: input,
          leaseFence: state.fence,
          transport: transport({ getPostStatus }),
        }),
      ).resolves.toMatchObject({
        changed: true,
        checkpoint: {
          postUrn: 'urn:li:share:123456789',
          stage: 'delivery_unknown',
          statusPollAttempts: LINKEDIN_IMAGE_STATUS_POLL_MAX_ATTEMPTS,
        },
        errorCode: 'delivery_unknown',
        event: 'unknown',
        retryable: false,
        summary: expect.stringContaining('manual confirmation'),
      })
      expect(getPostStatus).toHaveBeenCalledTimes(1)
      expect(state.authority.getIntent(42)?.checkpoint.stage).toBe('delivery_unknown')
    },
  )

  it('keeps polling post_created after a temporary status transport failure', async () => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
      }),
    })
    const state = setup(input)
    const publishImagePost = vi.fn()
    const unavailable = transport({
      getPostStatus: vi.fn().mockRejectedValue(new ProviderPublicationTransportError()),
      publishImagePost,
    })

    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: unavailable,
      }),
    ).resolves.toMatchObject({
      changed: true,
      checkpoint: {
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
        statusPollAttempts: 2,
      },
      event: 'publishing',
      retryable: true,
    })

    const retryIntent = state.authority.getIntent(42)
    if (!retryIntent) throw new Error('Expected the retryable LinkedIn checkpoint')
    const retryFence = lease({ ownerToken: 'worker-b', queueJobId: 143 })
    state.authority.setJobLease(retryFence)
    const published = transport({
      getPostStatus: vi.fn().mockResolvedValue({ lifecycleState: 'PUBLISHED' }),
      publishImagePost,
    })
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: retryIntent,
        leaseFence: retryFence,
        transport: published,
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'published' }, event: 'published' })
    expect(publishImagePost).not.toHaveBeenCalled()
  })

  it('stops after a temporary status failure consumes the final polling attempt', async () => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
        statusPollAttempts: LINKEDIN_IMAGE_STATUS_POLL_MAX_ATTEMPTS - 1,
      }),
    })
    const state = setup(input)
    const getPostStatus = vi.fn().mockRejectedValue(new ProviderPublicationTransportError())

    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: transport({ getPostStatus }),
      }),
    ).resolves.toMatchObject({
      checkpoint: {
        stage: 'delivery_unknown',
        statusPollAttempts: LINKEDIN_IMAGE_STATUS_POLL_MAX_ATTEMPTS,
      },
      errorCode: 'delivery_unknown',
      retryable: false,
    })
    expect(getPostStatus).toHaveBeenCalledTimes(1)
  })

  it('does not query the provider when a persisted checkpoint already exhausted polling', async () => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
        statusPollAttempts: LINKEDIN_IMAGE_STATUS_POLL_MAX_ATTEMPTS,
      }),
    })
    const state = setup(input)
    const getPostStatus = vi.fn()

    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: transport({ getPostStatus }),
      }),
    ).resolves.toMatchObject({
      checkpoint: { stage: 'delivery_unknown' },
      errorCode: 'delivery_unknown',
    })
    expect(getPostStatus).not.toHaveBeenCalled()
  })

  it('reclaims an interrupted post_created status poll without marking delivery unknown', async () => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
      }),
    })
    const state = setup(input)
    const claimed = await state.authority.claimStage(input, state.fence)
    if (claimed.status !== 'claimed') throw new Error('Expected the status poll claim')
    await state.authority.markProviderIOStarted(claimed.claim)
    state.authority.expireClaim(42)

    const retryFence = lease({ ownerToken: 'worker-b', queueJobId: 143 })
    state.authority.setJobLease(retryFence)
    const publishImagePost = vi.fn()
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: retryFence,
        transport: transport({ publishImagePost }),
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'published' }, event: 'published' })
    expect(publishImagePost).not.toHaveBeenCalled()
  })

  it.each([
    {
      error: new ProviderPublicationConfirmedError('permission_required', false),
      errorCode: 'permission_required',
      event: 'failed',
      stage: 'failed',
    },
    {
      error: new ProviderPublicationResultUnknownError('status result unknown'),
      errorCode: 'delivery_unknown',
      event: 'unknown',
      stage: 'delivery_unknown',
    },
    {
      error: new Error('unexpected status failure'),
      errorCode: 'delivery_unknown',
      event: 'unknown',
      stage: 'delivery_unknown',
    },
  ] as const)(
    'keeps postUrn and stops automatic polling for a later $errorCode status failure',
    async ({ error, errorCode, event, stage }) => {
      const input = intent({
        checkpoint: checkpoint({
          imageUrn: ticket.imageUrn,
          postUrn: 'urn:li:share:123456789',
          stage: 'post_created',
        }),
      })
      const state = setup(input)
      const publishImagePost = vi.fn()
      await expect(
        executeLinkedInImagePublishingStage({
          authority: state.authority,
          intent: input,
          leaseFence: state.fence,
          transport: transport({
            getPostStatus: vi.fn().mockRejectedValue(error),
            publishImagePost,
          }),
        }),
      ).resolves.toMatchObject({
        checkpoint: { postUrn: 'urn:li:share:123456789', stage },
        errorCode,
        event,
      })
      expect(publishImagePost).not.toHaveBeenCalled()
    },
  )

  it('completes publication from post_created when status becomes PUBLISHED', async () => {
    const input = intent({
      checkpoint: checkpoint({
        imageUrn: ticket.imageUrn,
        postUrn: 'urn:li:share:123456789',
        stage: 'post_created',
      }),
    })
    const state = setup(input)
    const getPostStatus = vi.fn().mockResolvedValue({
      externalPublicationUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123456789/',
      lifecycleState: 'PUBLISHED',
    })
    const adapter = transport({ getPostStatus })
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({
      changed: true,
      checkpoint: {
        postUrn: 'urn:li:share:123456789',
        postUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123456789/',
        stage: 'published',
      },
      event: 'published',
    })
    expect(adapter.publishImagePost).not.toHaveBeenCalled()
  })

  it('allows only one concurrent worker per stage', async () => {
    let resolveInitialize: ((value: LinkedInImageUploadTicket) => void) | undefined
    const initializeImageUpload = vi.fn().mockImplementation(
      () =>
        new Promise<LinkedInImageUploadTicket>((resolve) => {
          resolveInitialize = resolve
        }),
    )
    const state = setup()
    const adapter = transport({ initializeImageUpload })
    const first = executeLinkedInImagePublishingStage({
      authority: state.authority,
      intent: state.input,
      leaseFence: state.fence,
      transport: adapter,
    })
    await vi.waitFor(() => expect(initializeImageUpload).toHaveBeenCalledTimes(1))
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ errorCode: 'busy', event: 'blocked' })
    expect(initializeImageUpload).toHaveBeenCalledTimes(1)
    resolveInitialize?.(ticket)
    await first
  })

  it('recovers a crashed post-I/O stage as unknown without replay', async () => {
    const state = setup()
    const claimed = await state.authority.claimStage(state.input, state.fence)
    if (claimed.status !== 'claimed') throw new Error('expected claim')
    await state.authority.markProviderIOStarted(claimed.claim)
    state.authority.expireClaim(42)
    const nextLease = lease({ ownerToken: 'worker-b' })
    state.authority.setJobLease(nextLease)
    const adapter = transport()
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: nextLease,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'delivery_unknown' }, retryable: false })
    expect(adapter.initializeImageUpload).not.toHaveBeenCalled()
    expect(adapter.uploadImage).not.toHaveBeenCalled()
    expect(adapter.publishImagePost).not.toHaveBeenCalled()
  })

  it('fails closed when provider success cannot commit', async () => {
    const state = setup()
    state.authority.failNextCommit()
    const initializeImageUpload = vi.fn().mockResolvedValue(ticket)
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: transport({ initializeImageUpload }),
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'delivery_unknown' } })
    expect(initializeImageUpload).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new ProviderPublicationResultUnknownError('unknown'), 'delivery_unknown'],
    [new ProviderPublicationTransportError(), 'scheduled'],
  ] as const)('maps provider error to %s', async (error, expectedStage) => {
    const state = setup()
    const initializeImageUpload = vi.fn().mockRejectedValue(error)
    const promise = executeLinkedInImagePublishingStage({
      authority: state.authority,
      intent: state.input,
      leaseFence: state.fence,
      transport: transport({ initializeImageUpload }),
    })
    if (error instanceof ProviderPublicationTransportError) {
      await expect(promise).rejects.toBeInstanceOf(ProviderPublicationTransportError)
      expect(state.authority.getIntent(42)).toMatchObject({
        checkpoint: { stage: expectedStage },
        expectedRevision: 2,
      })
    } else {
      await expect(promise).resolves.toMatchObject({ checkpoint: { stage: expectedStage } })
    }
  })

  it('fails closed when a proven pre-I/O failure cannot atomically clear its fence', async () => {
    const state = setup()
    state.authority.failNextPreIORelease()
    const initializeImageUpload = vi.fn().mockRejectedValue(new ProviderPublicationTransportError())
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: transport({ initializeImageUpload }),
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'delivery_unknown' } })
    expect(initializeImageUpload).toHaveBeenCalledTimes(1)
  })

  it.each<[string, Partial<LinkedInPublishingTransport>]>([
    [
      'malformed initialize ticket',
      { initializeImageUpload: vi.fn().mockResolvedValue({} as never) },
    ],
    [
      'malformed post URN',
      {
        publishImagePost: vi.fn().mockResolvedValue({ postUrn: 'not-a-linkedin-urn' } as never),
      },
    ],
  ])('fails closed on %s from a typed transport', async (_label, overrides) => {
    const input = overrides.publishImagePost
      ? intent({ checkpoint: checkpoint({ imageUrn: ticket.imageUrn, stage: 'image_uploaded' }) })
      : intent()
    const state = setup(input)
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: transport(overrides),
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'delivery_unknown' } })
  })

  it.each(['published', 'failed', 'delivery_unknown'] as const)(
    'never claims or calls provider after terminal %s',
    async (stage) => {
      const input = intent({
        checkpoint: checkpoint({
          ...(stage === 'published'
            ? { imageUrn: ticket.imageUrn, postUrn: 'urn:li:share:123456789' }
            : {}),
          stage,
        }),
      })
      const state = setup(input)
      const claim = vi.spyOn(state.authority, 'claimStage')
      const adapter = transport()
      await expect(
        executeLinkedInImagePublishingStage({
          authority: state.authority,
          intent: input,
          leaseFence: state.fence,
          transport: adapter,
        }),
      ).resolves.toMatchObject({ changed: false })
      expect(claim).not.toHaveBeenCalled()
      expect(adapter.initializeImageUpload).not.toHaveBeenCalled()
      expect(adapter.uploadImage).not.toHaveBeenCalled()
      expect(adapter.publishImagePost).not.toHaveBeenCalled()
    },
  )

  it('rejects an authorization revision replacement without crossing provider I/O', async () => {
    const state = setup()
    const stale = intent({
      checkpoint: checkpoint({ authorizationRevision: 5 }),
      expectedRevision: state.input.expectedRevision,
    })
    const adapter = transport()
    await expect(
      executeLinkedInImagePublishingStage({
        authority: state.authority,
        intent: stale,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ errorCode: 'intent_mismatch', event: 'blocked' })
    expect(adapter.initializeImageUpload).not.toHaveBeenCalled()
    expect(adapter.uploadImage).not.toHaveBeenCalled()
    expect(adapter.publishImagePost).not.toHaveBeenCalled()
  })
})
