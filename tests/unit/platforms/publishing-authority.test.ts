import { describe, expect, it, vi } from 'vitest'

import type { PublishingService } from '@/modules/publishing/contracts'
import { createFakePlatformPublicationAuthority } from '@/modules/platforms/fakePublishingAuthority'
import {
  executeLeaseFencedPublication,
  type PlatformPublicationIntent,
  type PlatformPublicationLeaseFence,
} from '@/modules/platforms/publishingAuthority'
import type { PlatformPublishExecutionSnapshot } from '@/modules/platforms/publishingExecution'
import { ProviderPublicationTransportError } from '@/modules/platforms/publishingResult'

const snapshot = (
  overrides: Partial<PlatformPublishExecutionSnapshot> = {},
): PlatformPublishExecutionSnapshot => ({
  assets: [
    {
      fileName: 'facade.jpg',
      id: 'asset-1',
      mimeType: 'image/jpeg',
      sourceUrl: 'https://cdn.example.invalid/facade.jpg',
    },
  ],
  expectedAuthorizationRevision: 4,
  idempotencyKey: 'publish-job-42-facebook',
  platform: 'facebook',
  platformAccountId: 7,
  status: 'scheduled',
  text: 'Facade project update',
  ...overrides,
})

const intent = (overrides: Partial<PlatformPublicationIntent> = {}): PlatformPublicationIntent => ({
  expectedRevision: 3,
  publishJobId: 42,
  snapshot: snapshot(),
  ...overrides,
})

const lease = (
  overrides: Partial<PlatformPublicationLeaseFence> = {},
): PlatformPublicationLeaseFence => ({
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  ownerToken: 'worker-a',
  queueJobId: 142,
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

const setup = (input = intent(), fence = lease()) => ({
  authority: createFakePlatformPublicationAuthority({
    initialIntents: [input],
    initialJobLeases: [fence],
  }),
  fence,
  input,
})

describe('lease-fenced single-call publication', () => {
  it('fences one scheduled mutation and atomically stores its provider ID', async () => {
    const state = setup()
    const publish = vi.fn().mockResolvedValue({
      externalPublicationId: 'provider-post-42',
      idempotencyKey: 'publish-job-42-facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'accepted',
    })

    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        service: service({ publish }),
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      transition: { externalPublicationId: 'provider-post-42', status: 'accepted' },
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(state.authority.getIntent(42)).toMatchObject({
      expectedRevision: 4,
      snapshot: { externalPublicationId: 'provider-post-42', status: 'accepted' },
    })
  })

  it('allows only one concurrent worker to call publish', async () => {
    let resolvePublish: ((value: unknown) => void) | undefined
    const publish = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePublish = resolve
        }),
    )
    const state = setup()
    const publisher = service({ publish })
    const first = executeLeaseFencedPublication({
      authority: state.authority,
      intent: state.input,
      leaseFence: state.fence,
      service: publisher,
    })
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))

    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        service: publisher,
      }),
    ).resolves.toEqual({ reason: 'busy', status: 'blocked' })
    expect(publish).toHaveBeenCalledTimes(1)
    resolvePublish?.({
      externalPublicationId: 'provider-post-42',
      idempotencyKey: 'publish-job-42-facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'accepted',
    })
    await first
  })

  it('reclaims a crashed post-I/O mutation as unknown without publishing again', async () => {
    const state = setup()
    const claimed = await state.authority.claimPublication(state.input, state.fence)
    if (claimed.status !== 'claimed') throw new Error('expected claim')
    await state.authority.markProviderIOStarted(claimed.claim)
    state.authority.expireClaim(42)
    const recoveredLease = lease({ ownerToken: 'worker-b' })
    state.authority.setJobLease(recoveredLease)
    const publish = vi.fn()

    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: state.input,
        leaseFence: recoveredLease,
        service: service({ publish }),
      }),
    ).resolves.toMatchObject({
      transition: { retryable: false, status: 'delivery_unknown' },
    })
    expect(publish).not.toHaveBeenCalled()
    expect(state.authority.getIntent(42)).toMatchObject({
      expectedRevision: 4,
      snapshot: { status: 'delivery_unknown' },
    })
  })

  it('fails the attempt on commit conflict and recovers without publishing again', async () => {
    const state = setup()
    state.authority.failNextCommit()
    const publish = vi.fn().mockResolvedValue({
      externalPublicationId: 'provider-post-42',
      idempotencyKey: 'publish-job-42-facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'accepted',
    })
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        service: service({ publish }),
      }),
    ).rejects.toThrow('checkpoint could not be committed')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(state.authority.getIntent(42)).toMatchObject({
      expectedRevision: 3,
      snapshot: { status: 'scheduled' },
    })

    const recoveryLease = lease({ ownerToken: 'worker-b' })
    state.authority.setJobLease(recoveryLease)
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: state.input,
        leaseFence: recoveryLease,
        service: service({ publish }),
      }),
    ).resolves.toMatchObject({ transition: { status: 'delivery_unknown' } })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(state.authority.getIntent(42)).toMatchObject({
      expectedRevision: 4,
      snapshot: { status: 'delivery_unknown' },
    })
  })

  it('commits an unchanged snapshot and propagates a proven pre-I/O outage for Job retry', async () => {
    const state = setup()
    const publish = vi.fn().mockRejectedValue(new ProviderPublicationTransportError())
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        service: service({ publish }),
      }),
    ).rejects.toBeInstanceOf(ProviderPublicationTransportError)
    expect(state.authority.getIntent(42)).toMatchObject({
      expectedRevision: 4,
      snapshot: { status: 'scheduled' },
    })
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('fails when a pre-I/O retry checkpoint cannot be committed', async () => {
    const state = setup()
    state.authority.failNextCommit()
    const publish = vi.fn().mockRejectedValue(new ProviderPublicationTransportError())
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: state.input,
        leaseFence: state.fence,
        service: service({ publish }),
      }),
    ).rejects.toThrow('checkpoint could not be committed')
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['job', intent({ publishJobId: 43 })],
    ['revision', intent({ expectedRevision: 4 })],
    ['platform account', intent({ snapshot: snapshot({ platformAccountId: 8 }) })],
    [
      'authorization revision',
      intent({ snapshot: snapshot({ expectedAuthorizationRevision: 5 }) }),
    ],
    ['command key', intent({ snapshot: snapshot({ idempotencyKey: 'other-key' }) })],
  ])('blocks a mismatched %s before publish', async (_label, mismatched) => {
    const state = setup()
    const publish = vi.fn()
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: mismatched,
        leaseFence: state.fence,
        service: service({ publish }),
      }),
    ).resolves.toMatchObject({ status: 'blocked' })
    expect(publish).not.toHaveBeenCalled()
  })

  it.each([
    ['null asset', { assets: [null] }],
    [
      'duplicate asset IDs',
      {
        assets: [
          { fileName: 'a.jpg', id: 'same', mimeType: 'image/jpeg' },
          { fileName: 'b.jpg', id: 'same', mimeType: 'image/jpeg' },
        ],
      },
    ],
    ['blank text', { text: '   ' }],
    ['invalid scheduled time', { scheduledFor: 'not-a-date' }],
    ['missing authorization revision', { expectedAuthorizationRevision: undefined }],
  ])(
    'rejects malformed authority %s before claiming or provider I/O',
    async (_label, malformed) => {
      const stored = intent()
      const state = setup(stored)
      const claim = vi.spyOn(state.authority, 'claimPublication')
      const publish = vi.fn()
      const input = {
        ...stored,
        snapshot: { ...stored.snapshot, ...malformed },
      } as PlatformPublicationIntent
      await expect(
        executeLeaseFencedPublication({
          authority: state.authority,
          intent: input,
          leaseFence: state.fence,
          service: service({ publish }),
        }),
      ).rejects.toThrow('Platform publication input is invalid')
      expect(claim).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    },
  )

  it('never routes Instagram through the single-call authority', async () => {
    const input = intent({ snapshot: snapshot({ platform: 'instagram' }) })
    const state = setup(input)
    const publish = vi.fn()
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        service: service({ publish }),
      }),
    ).resolves.toEqual({ reason: 'intent_mismatch', status: 'blocked' })
    expect(publish).not.toHaveBeenCalled()
  })

  it('polls accepted status without marking an irreversible mutation boundary', async () => {
    const input = intent({
      snapshot: snapshot({
        externalPublicationId: 'provider-post-42',
        status: 'accepted',
      }),
    })
    const state = setup(input)
    const mark = vi.spyOn(state.authority, 'markProviderIOStarted')
    const getStatus = vi.fn().mockResolvedValue({
      externalPublicationId: 'provider-post-42',
      idempotencyKey: 'publish-job-42-facebook',
      platform: 'facebook',
      platformAccountId: 7,
      status: 'published',
    })
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        service: service({ getStatus }),
      }),
    ).resolves.toMatchObject({ transition: { status: 'published' } })
    expect(mark).not.toHaveBeenCalled()
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('releases a status claim after retryable read failure', async () => {
    const input = intent({
      snapshot: snapshot({
        externalPublicationId: 'provider-post-42',
        status: 'accepted',
      }),
    })
    const state = setup(input)
    const getStatus = vi.fn().mockRejectedValue(new Error('status unavailable'))
    const publisher = service({ getStatus })
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        service: publisher,
      }),
    ).rejects.toThrow('status unavailable')
    await expect(
      executeLeaseFencedPublication({
        authority: state.authority,
        intent: input,
        leaseFence: state.fence,
        service: publisher,
      }),
    ).rejects.toThrow('status unavailable')
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it.each(['published', 'failed', 'delivery_unknown'] as const)(
    'does not claim or call provider after terminal %s',
    async (status) => {
      const input = intent({ snapshot: snapshot({ status }) })
      const state = setup(input)
      const claim = vi.spyOn(state.authority, 'claimPublication')
      const publish = vi.fn()
      await expect(
        executeLeaseFencedPublication({
          authority: state.authority,
          intent: input,
          leaseFence: state.fence,
          service: service({ publish }),
        }),
      ).resolves.toMatchObject({ transition: { changed: false, status } })
      expect(claim).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    },
  )
})
