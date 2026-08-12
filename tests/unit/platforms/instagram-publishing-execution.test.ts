import { describe, expect, it, vi } from 'vitest'

import { createFakeInstagramPublishingAuthority } from '@/modules/platforms/meta/fakeInstagramPublishingAuthority'
import {
  executeInstagramPublishingStage,
  type InstagramPublishingCheckpoint,
  type InstagramPublishingIntent,
  type InstagramPublishingLeaseFence,
} from '@/modules/platforms/meta/instagramPublishingExecution'
import type { MetaPublishingTransport } from '@/modules/platforms/meta/publishingOutbound'
import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '@/modules/platforms/publishingResult'

const checkpoint = (
  overrides: Partial<InstagramPublishingCheckpoint> = {},
): InstagramPublishingCheckpoint => ({
  accountExternalId: '1789000012345678',
  authorizationRevision: 4,
  caption: 'Facade project update',
  imageUrl: 'https://cdn.example.invalid/project.jpg',
  stage: 'scheduled',
  ...overrides,
})

const intent = (overrides: Partial<InstagramPublishingIntent> = {}): InstagramPublishingIntent => ({
  checkpoint: checkpoint(),
  expectedRevision: 7,
  idempotencyKey: 'publish-job-42-instagram',
  publishJobId: 42,
  platform: 'instagram',
  platformAccountId: 17,
  ...overrides,
})

const lease = (
  overrides: Partial<InstagramPublishingLeaseFence> = {},
): InstagramPublishingLeaseFence => ({
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  ownerToken: 'worker-a',
  queueJobId: 142,
  ...overrides,
})

const transport = (overrides: Partial<MetaPublishingTransport> = {}): MetaPublishingTransport => ({
  createInstagramMedia: vi.fn(),
  getFacebookPagePostPermalink: vi.fn(),
  getInstagramContainerStatus: vi.fn(),
  getInstagramMediaPermalink: vi.fn(),
  publishFacebookPagePhoto: vi.fn(),
  publishInstagramMedia: vi.fn(),
  ...overrides,
})

const setup = (input = intent(), fence = lease()) => {
  const authority = createFakeInstagramPublishingAuthority({
    initialIntents: [input],
    initialJobLeases: [fence],
  })
  return { authority, fence, input }
}

describe('Instagram lease-fenced publishing execution', () => {
  it('creates exactly one container and atomically stores its provider ID', async () => {
    const state = setup()
    const createInstagramMedia = vi.fn().mockResolvedValue({ creationId: '112233' })
    const adapter = transport({ createInstagramMedia })

    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({
      checkpoint: { containerId: '112233', stage: 'container_created' },
      event: 'container-created',
    })
    expect(createInstagramMedia).toHaveBeenCalledTimes(1)
    expect(state.authority.getIntent(42)).toMatchObject({
      checkpoint: { containerId: '112233', stage: 'container_created' },
      expectedRevision: 8,
    })
    expect(adapter.getInstagramContainerStatus).not.toHaveBeenCalled()
    expect(adapter.publishInstagramMedia).not.toHaveBeenCalled()
  })

  it.each([
    [{ state: 'pending' }, 'container_created', false],
    [{ state: 'ready' }, 'container_ready', true],
  ] as const)('polls a persisted container without publishing', async (result, stage, changed) => {
    const input = intent({
      checkpoint: checkpoint({ containerId: '112233', stage: 'container_created' }),
    })
    const state = setup(input)
    const getInstagramContainerStatus = vi.fn().mockResolvedValue(result)
    const adapter = transport({ getInstagramContainerStatus })

    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ changed, checkpoint: { stage } })
    expect(getInstagramContainerStatus).toHaveBeenCalledTimes(1)
    expect(adapter.publishInstagramMedia).not.toHaveBeenCalled()
  })

  it('publishes only from a persisted ready checkpoint and stores the media ID', async () => {
    const input = intent({
      checkpoint: checkpoint({ containerId: '112233', stage: 'container_ready' }),
    })
    const state = setup(input)
    const publishInstagramMedia = vi.fn().mockResolvedValue({ igMediaId: '998877' })
    const getInstagramMediaPermalink = vi.fn().mockResolvedValue({
      permalink: 'https://www.instagram.com/p/ABC123/',
    })
    const adapter = transport({ getInstagramMediaPermalink, publishInstagramMedia })

    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({
      checkpoint: {
        containerId: '112233',
        mediaId: '998877',
        permalink: 'https://www.instagram.com/p/ABC123/',
        stage: 'published',
      },
      event: 'published',
    })
    expect(publishInstagramMedia).toHaveBeenCalledTimes(1)
    expect(state.authority.getIntent(42)).toMatchObject({
      checkpoint: {
        mediaId: '998877',
        permalink: 'https://www.instagram.com/p/ABC123/',
        stage: 'published',
      },
      expectedRevision: 8,
    })
    expect(adapter.createInstagramMedia).not.toHaveBeenCalled()
    expect(getInstagramMediaPermalink).toHaveBeenCalledWith({
      accountExternalId: '1789000012345678',
      authorizationRevision: 4,
      mediaId: '998877',
      platformAccountId: 17,
    })
  })

  it('allows only one concurrent worker to cross the provider fence', async () => {
    let resolveCreate: ((value: { creationId: string }) => void) | undefined
    const createInstagramMedia = vi.fn().mockImplementation(
      () =>
        new Promise<{ creationId: string }>((resolve) => {
          resolveCreate = resolve
        }),
    )
    const adapter = transport({ createInstagramMedia })
    const state = setup()
    const first = executeInstagramPublishingStage({
      authority: state.authority,
      intent: state.input,
      leaseFence: state.fence,
      transport: adapter,
    })
    await vi.waitFor(() => expect(createInstagramMedia).toHaveBeenCalledTimes(1))

    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ errorCode: 'busy', event: 'blocked', retryable: true })
    expect(createInstagramMedia).toHaveBeenCalledTimes(1)

    resolveCreate?.({ creationId: '112233' })
    await expect(first).resolves.toMatchObject({ checkpoint: { stage: 'container_created' } })
  })

  it('reclaims a crashed post-I/O attempt as unknown without creating again', async () => {
    const state = setup()
    const claimed = await state.authority.claimStage(state.input, state.fence)
    expect(claimed.status).toBe('claimed')
    if (claimed.status !== 'claimed') throw new Error('expected claim')
    await expect(state.authority.markProviderIOStarted(claimed.claim)).resolves.toEqual({
      status: 'fenced',
    })
    expect(state.authority.expireStageClaim(42)).toBe(true)
    const recoveredLease = lease({ ownerToken: 'worker-b' })
    state.authority.setJobLease(recoveredLease)
    const adapter = transport()

    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: recoveredLease,
        transport: adapter,
      }),
    ).resolves.toMatchObject({
      checkpoint: { stage: 'delivery_unknown' },
      retryable: false,
    })
    expect(adapter.createInstagramMedia).not.toHaveBeenCalled()
    expect(adapter.publishInstagramMedia).not.toHaveBeenCalled()
    expect(state.authority.getIntent(42)).toMatchObject({
      checkpoint: { stage: 'delivery_unknown' },
      expectedRevision: 8,
    })
  })

  it('permits a new worker after an unstarted stale claim', async () => {
    const state = setup()
    const claimed = await state.authority.claimStage(state.input, state.fence)
    expect(claimed.status).toBe('claimed')
    expect(state.authority.expireStageClaim(42)).toBe(true)
    const nextLease = lease({ ownerToken: 'worker-b' })
    state.authority.setJobLease(nextLease)
    const createInstagramMedia = vi.fn().mockResolvedValue({ creationId: '112233' })

    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: nextLease,
        transport: transport({ createInstagramMedia }),
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'container_created' } })
    expect(createInstagramMedia).toHaveBeenCalledTimes(1)
  })

  it('fails closed when provider success cannot be committed', async () => {
    const state = setup()
    state.authority.failNextCommit()
    const createInstagramMedia = vi.fn().mockResolvedValue({ creationId: '112233' })

    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: transport({ createInstagramMedia }),
      }),
    ).resolves.toMatchObject({
      checkpoint: { stage: 'delivery_unknown' },
      retryable: false,
    })
    expect(createInstagramMedia).toHaveBeenCalledTimes(1)
    expect(state.authority.getIntent(42)).toEqual(state.input)
  })

  it.each([
    ['job', intent({ publishJobId: 43 })],
    ['account', intent({ platformAccountId: 18 })],
    ['idempotency key', intent({ idempotencyKey: 'other-key' })],
    ['revision', intent({ expectedRevision: 8 })],
  ])('blocks a mismatched %s before provider I/O', async (_label, mismatched) => {
    const state = setup()
    const adapter = transport()
    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: mismatched,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ event: 'blocked' })
    expect(adapter.createInstagramMedia).not.toHaveBeenCalled()
    expect(adapter.getInstagramContainerStatus).not.toHaveBeenCalled()
    expect(adapter.publishInstagramMedia).not.toHaveBeenCalled()
  })

  it.each(['published', 'failed', 'delivery_unknown'] as const)(
    'never claims or performs provider I/O after terminal %s',
    async (stage) => {
      const input = intent({ checkpoint: checkpoint({ stage }) })
      const state = setup(input)
      const claim = vi.spyOn(state.authority, 'claimStage')
      const adapter = transport()
      await expect(
        executeInstagramPublishingStage({
          authority: state.authority,
          intent: input,
          leaseFence: state.fence,
          transport: adapter,
        }),
      ).resolves.toEqual({ changed: false, checkpoint: input.checkpoint })
      expect(claim).not.toHaveBeenCalled()
      expect(adapter.createInstagramMedia).not.toHaveBeenCalled()
      expect(adapter.getInstagramContainerStatus).not.toHaveBeenCalled()
      expect(adapter.publishInstagramMedia).not.toHaveBeenCalled()
    },
  )

  it.each([
    [new ProviderPublicationConfirmedError('permission_required', false), 'failed'],
    [new ProviderPublicationResultUnknownError('unknown'), 'delivery_unknown'],
  ] as const)('commits provider mutation error as %s', async (error, stage) => {
    const state = setup()
    const adapter = transport({ createInstagramMedia: vi.fn().mockRejectedValue(error) })
    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ checkpoint: { stage } })
    expect(state.authority.getIntent(42)).toMatchObject({ checkpoint: { stage } })
  })

  it('commits a retryable pre-network outage, then propagates it for scheduling', async () => {
    const state = setup()
    const adapter = transport({
      createInstagramMedia: vi.fn().mockRejectedValue(new ProviderPublicationTransportError()),
    })
    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationTransportError)
    expect(state.authority.getIntent(42)).toMatchObject({
      checkpoint: { stage: 'scheduled' },
      expectedRevision: 8,
    })
  })

  it('fails closed on malformed provider and persisted IDs', async () => {
    const state = setup()
    const adapter = transport({
      createInstagramMedia: vi.fn().mockResolvedValue({ creationId: undefined }),
    })
    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'delivery_unknown' } })

    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: intent({
          checkpoint: checkpoint({ containerId: '../me', stage: 'container_ready' }),
        }),
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).rejects.toThrow('Instagram publishing input is invalid')
  })

  it('treats an already-published container without a media ID as unknown', async () => {
    const input = intent({
      checkpoint: checkpoint({ containerId: '112233', stage: 'container_created' }),
    })
    const state = setup(input)
    const adapter = transport({
      getInstagramContainerStatus: vi.fn().mockResolvedValue({ state: 'published' }),
    })
    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ checkpoint: { stage: 'delivery_unknown' } })
    expect(adapter.publishInstagramMedia).not.toHaveBeenCalled()
  })

  it('rejects an authorization revision replacement even when the Job revision is unchanged', async () => {
    const state = setup()
    const stale = intent({
      checkpoint: checkpoint({ authorizationRevision: 5 }),
      expectedRevision: state.input.expectedRevision,
    })
    const adapter = transport()
    await expect(
      executeInstagramPublishingStage({
        authority: state.authority,
        intent: stale,
        leaseFence: state.fence,
        transport: adapter,
      }),
    ).resolves.toMatchObject({ errorCode: 'intent_mismatch', event: 'blocked' })
    expect(adapter.createInstagramMedia).not.toHaveBeenCalled()
    expect(adapter.getInstagramContainerStatus).not.toHaveBeenCalled()
    expect(adapter.publishInstagramMedia).not.toHaveBeenCalled()
  })
})
