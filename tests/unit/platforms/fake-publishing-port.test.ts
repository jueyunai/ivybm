import { describe, expect, it } from 'vitest'

import { createFakePlatformPublishingPort } from '../../../src/modules/platforms/fakePublishingPort'
import type {
  PlatformCapability,
  PlatformPublishAcceptance,
  PlatformPublishRequest,
} from '../../../src/modules/platforms/types'

const facebookRequest = (overrides: Partial<PlatformPublishRequest> = {}): PlatformPublishRequest => ({
  assets: [],
  idempotencyKey: 'fixture-facebook-1',
  platform: 'facebook',
  text: 'Fixture post',
  ...overrides,
})

const accepted = (
  value: PlatformPublishAcceptance,
): Extract<PlatformPublishAcceptance, { status: 'accepted' }> => {
  if (value.status !== 'accepted') throw new Error('Expected fake publish acceptance')
  return value
}

describe('fake platform publishing port', () => {
  it('exposes conditional capability without claiming a real platform is available', async () => {
    const port = createFakePlatformPublishingPort()

    await expect(port.getCapability('facebook')).resolves.toEqual({
      availability: 'conditional',
      modes: ['automatic'],
      platform: 'facebook',
      reason: 'Meta Content Publishing permission requires controlled verification',
    })
    await expect(port.getCapability('instagram')).resolves.toEqual({
      availability: 'conditional',
      modes: ['automatic'],
      platform: 'instagram',
      reason: 'Instagram business account and publishing permission require verification',
    })
    await expect(port.getCapability('linkedin')).resolves.toEqual({
      availability: 'conditional',
      modes: ['assisted'],
      platform: 'linkedin',
      reason: 'Automatic publishing remains blocked until API permission is verified',
    })
    await expect(port.publish(facebookRequest({ platform: 'linkedin' }))).resolves.toEqual({
      errorCode: 'platform_blocked',
      idempotencyKey: 'fixture-facebook-1',
      platform: 'linkedin',
      retryable: false,
      status: 'blocked',
    })
  })

  it('isolates capability overrides and returned capabilities from caller mutation', async () => {
    const override: PlatformCapability = {
      availability: 'conditional',
      modes: ['automatic'],
      platform: 'facebook',
    }
    const port = createFakePlatformPublishingPort({ capabilities: { facebook: override } })

    override.modes[0] = 'assisted'
    const firstRead = await port.getCapability('facebook')
    firstRead.modes[0] = 'assisted'

    await expect(port.getCapability('facebook')).resolves.toEqual({
      availability: 'conditional',
      modes: ['automatic'],
      platform: 'facebook',
    })
  })

  it('keeps concurrent duplicate commands stable and isolates platforms', async () => {
    const port = createFakePlatformPublishingPort()
    const request = facebookRequest()

    const [first, duplicate] = await Promise.all([port.publish(request), port.publish(request)])
    expect(accepted(first)).toEqual({
      externalPublicationId: 'mock:facebook:fixture-facebook-1',
      idempotencyKey: 'fixture-facebook-1',
      platform: 'facebook',
      status: 'accepted',
    })
    expect(duplicate).toEqual(first)

    await expect(port.publish({ ...request, text: 'Changed fixture post' })).resolves.toEqual({
      errorCode: 'invalid_request',
      idempotencyKey: 'fixture-facebook-1',
      platform: 'facebook',
      retryable: false,
      status: 'blocked',
    })
    await expect(
      port.publish({
        ...request,
        assets: [{ fileName: 'changed.jpg', id: 'asset-1', mimeType: 'image/jpeg' }],
      }),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    await expect(
      port.publish({ ...request, scheduledFor: '2026-08-01T00:00:00.000Z' }),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })

    await expect(port.publish({ ...request, platform: 'instagram' })).resolves.toEqual({
      externalPublicationId: 'mock:instagram:fixture-facebook-1',
      idempotencyKey: 'fixture-facebook-1',
      platform: 'instagram',
      status: 'accepted',
    })

    const canonicalRequest = facebookRequest({
      assets: [
        {
          fileName: 'panel.jpg',
          id: 'asset-1',
          mimeType: 'image/jpeg',
          sourceUrl: undefined,
        },
      ],
      idempotencyKey: 'canonical-assets-1',
    })
    const canonicalAcceptance = await port.publish(canonicalRequest)
    await expect(
      port.publish({
        ...canonicalRequest,
        assets: [{ id: 'asset-1', mimeType: 'image/jpeg', fileName: 'panel.jpg' }],
      }),
    ).resolves.toEqual(canonicalAcceptance)
  })

  it('advances a known publication without terminal state regression', async () => {
    const port = createFakePlatformPublishingPort()
    const result = accepted(await port.publish(facebookRequest()))
    const reference = {
      externalPublicationId: result.externalPublicationId,
      platform: result.platform,
    } as const

    await expect(port.getStatus(reference)).resolves.toEqual({ ...reference, status: 'pending' })
    port.setStatus({ ...reference, status: 'publishing' })
    await expect(port.getStatus(reference)).resolves.toEqual({ ...reference, status: 'publishing' })
    port.setStatus({ ...reference, status: 'published' })
    await expect(port.getStatus(reference)).resolves.toEqual({ ...reference, status: 'published' })
    expect(() => port.setStatus({ ...reference, status: 'pending' })).toThrow(
      'Fake platform publication cannot transition from published to pending',
    )
  })

  it('models a retryable provider failure without creating a publication reference', async () => {
    const port = createFakePlatformPublishingPort()
    port.failNextPublish({
      errorCode: 'provider_unavailable',
      platform: 'facebook',
      retryable: true,
    })

    await expect(port.publish(facebookRequest({ idempotencyKey: 'provider-failure-1' }))).resolves.toEqual({
      errorCode: 'provider_unavailable',
      idempotencyKey: 'provider-failure-1',
      platform: 'facebook',
      retryable: true,
      status: 'blocked',
    })
    await expect(
      port.getStatus({
        externalPublicationId: 'mock:facebook:provider-failure-1',
        platform: 'facebook',
      }),
    ).rejects.toThrow('Fake platform publication is not known')
  })

  it('does not consume a queued provider failure for an already accepted duplicate command', async () => {
    const port = createFakePlatformPublishingPort()
    const firstRequest = facebookRequest({ idempotencyKey: 'failure-queue-duplicate-1' })
    const first = accepted(await port.publish(firstRequest))

    port.failNextPublish({
      errorCode: 'provider_unavailable',
      platform: 'facebook',
      retryable: true,
    })

    await expect(port.publish(firstRequest)).resolves.toEqual(first)
    await expect(
      port.publish(facebookRequest({ idempotencyKey: 'failure-queue-next-1' })),
    ).resolves.toEqual({
      errorCode: 'provider_unavailable',
      idempotencyKey: 'failure-queue-next-1',
      platform: 'facebook',
      retryable: true,
      status: 'blocked',
    })
  })

  it('fails closed for an empty command key or empty reviewed copy', async () => {
    const port = createFakePlatformPublishingPort()

    await expect(port.publish(facebookRequest({ idempotencyKey: '   ' }))).resolves.toEqual({
      errorCode: 'invalid_request',
      idempotencyKey: '   ',
      platform: 'facebook',
      retryable: false,
      status: 'blocked',
    })
    await expect(port.publish(facebookRequest({ text: '   ' }))).resolves.toEqual({
      errorCode: 'invalid_request',
      idempotencyKey: 'fixture-facebook-1',
      platform: 'facebook',
      retryable: false,
      status: 'blocked',
    })
  })

  it('rejects malformed runtime input and unknown publishing platforms predictably', async () => {
    const port = createFakePlatformPublishingPort()

    await expect(port.getCapability('tiktok' as never)).rejects.toThrow(
      'Fake publishing platform is unsupported',
    )
    await expect(
      port.publish({ ...facebookRequest(), platform: 'tiktok' as never }),
    ).rejects.toThrow('Fake publishing platform is unsupported')
    expect(() =>
      port.failNextPublish({
        errorCode: 'provider_unavailable',
        platform: 'tiktok' as never,
        retryable: true,
      }),
    ).toThrow('Fake publishing platform is unsupported')
    expect(() =>
      createFakePlatformPublishingPort({
        capabilities: {
          facebook: {
            availability: 'conditional',
            modes: null,
            platform: 'facebook',
          },
        } as never,
      }),
    ).toThrow('Fake platform capability requires valid modes')
    expect(() => createFakePlatformPublishingPort({ capabilities: { facebook: null } as never })).toThrow(
      'Fake platform capability must be an object',
    )
    await expect(
      port.publish({ ...facebookRequest(), idempotencyKey: null } as unknown as PlatformPublishRequest),
    ).rejects.toThrow('Fake publish request has invalid fields')
    await expect(
      port.publish({ ...facebookRequest(), assets: [1n] } as unknown as PlatformPublishRequest),
    ).rejects.toThrow('Fake publication asset must be an object')
    await expect(port.publish(null as never)).rejects.toThrow('Fake publish request must be an object')
    expect(() => port.failNextPublish(null as never)).toThrow('Fake publish failure must be an object')
    await expect(port.getStatus(null as never)).rejects.toThrow(
      'Fake publication reference must be an object',
    )
    expect(() => port.setStatus(null as never)).toThrow('Fake publication status must be an object')
  })

  it('allows immediate completion but keeps a failed terminal outcome immutable', async () => {
    const port = createFakePlatformPublishingPort()
    const immediatelyPublished = accepted(
      await port.publish(facebookRequest({ idempotencyKey: 'immediate-publish-1' })),
    )
    const immediateReference = {
      externalPublicationId: immediatelyPublished.externalPublicationId,
      platform: immediatelyPublished.platform,
    } as const
    port.setStatus({ ...immediateReference, status: 'published' })
    await expect(port.getStatus(immediateReference)).resolves.toEqual({
      ...immediateReference,
      status: 'published',
    })

    const failed = accepted(await port.publish(facebookRequest({ idempotencyKey: 'terminal-failure-1' })))
    const failedReference = {
      externalPublicationId: failed.externalPublicationId,
      platform: failed.platform,
    } as const
    const failure = {
      errorCode: 'rate_limited' as const,
      ...failedReference,
      retryable: true,
      status: 'failed' as const,
    }
    port.setStatus(failure)
    expect(() => port.setStatus(failure)).not.toThrow()
    expect(() =>
      port.setStatus({ ...failure, errorCode: 'provider_unavailable' }),
    ).toThrow('Fake platform publication cannot replace failed failure metadata')
    expect(() => port.setStatus({ ...failedReference, status: 'published' })).toThrow(
      'Fake platform publication cannot transition from failed to published',
    )
  })

  it('rejects unknown references, platform mismatches, and malformed failure states', async () => {
    const port = createFakePlatformPublishingPort()
    const result = accepted(await port.publish(facebookRequest()))

    await expect(
      port.getStatus({ externalPublicationId: result.externalPublicationId, platform: 'instagram' }),
    ).rejects.toThrow('Fake platform publication is not known')
    expect(() =>
      port.setStatus({
        errorCode: 'rate_limited',
        externalPublicationId: result.externalPublicationId,
        platform: 'facebook',
        status: 'failed',
      } as never),
    ).toThrow('Fake failed publication requires retryable')
  })
})
