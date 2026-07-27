import { describe, expect, it } from 'vitest'

import {
  MAX_PUBLICATION_ASSETS,
  MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES,
  MAX_PUBLICATION_TEXT_CODE_POINTS,
  PLATFORM_PUBLISH_ERROR_CODES,
  type AssistedPublicationRequest,
  type PlatformCapability,
  type PlatformPublishErrorCode,
  type PlatformPublishRequest,
  type PublishingPlatform,
  type PublishingService,
} from '@/modules/publishing/contracts'
import { createFakePublishingService } from '../../fakes/publishingService'

const facebookAccount = 101
const secondFacebookAccount = 102
const instagramAccount = 201
const linkedinAccount = 301

const capability = (
  platformAccountId: number | string,
  platform: PublishingPlatform,
  availability: PlatformCapability['availability'] = 'available',
): PlatformCapability => ({
  availability,
  modes: platform === 'linkedin' ? ['assisted'] : ['automatic'],
  platform,
  platformAccountId,
})

const request = (
  overrides: Partial<PlatformPublishRequest> = {},
): PlatformPublishRequest => ({
  assets: [],
  idempotencyKey: 'fixture-publish-1',
  platform: 'facebook',
  platformAccountId: facebookAccount,
  text: 'Fixture post',
  ...overrides,
})

const connectedService = () =>
  createFakePublishingService({
    capabilities: [
      capability(facebookAccount, 'facebook'),
      capability(secondFacebookAccount, 'facebook'),
      capability(instagramAccount, 'instagram'),
      capability(linkedinAccount, 'linkedin', 'conditional'),
    ],
  })

describe('PublishingService contract', () => {
  it('exposes account-scoped capability without pretending conditional platforms are available', async () => {
    const service: PublishingService = createFakePublishingService({
      capabilities: [capability(secondFacebookAccount, 'facebook')],
    })

    await expect(
      service.getCapability({ platform: 'facebook', platformAccountId: facebookAccount }),
    ).resolves.toMatchObject({
      availability: 'conditional',
      modes: ['automatic'],
      platform: 'facebook',
      platformAccountId: facebookAccount,
    })
    await expect(
      service.getCapability({ platform: 'facebook', platformAccountId: secondFacebookAccount }),
    ).resolves.toEqual(capability(secondFacebookAccount, 'facebook'))
    await expect(
      service.publish(request()),
    ).resolves.toEqual({
      errorCode: 'account_not_connected',
      idempotencyKey: 'fixture-publish-1',
      platform: 'facebook',
      platformAccountId: facebookAccount,
      retryable: false,
      status: 'blocked',
    })
  })

  it('scopes publish idempotency and status to the platform account', async () => {
    const service = connectedService()
    const first = await service.publish(request())
    expect(first).toMatchObject({
      idempotencyKey: 'fixture-publish-1',
      platform: 'facebook',
      platformAccountId: facebookAccount,
      status: 'accepted',
    })
    await expect(service.publish(request())).resolves.toEqual(first)
    await expect(service.publish(request({ text: 'Changed fixture post' }))).resolves.toEqual({
      errorCode: 'invalid_request',
      idempotencyKey: 'fixture-publish-1',
      platform: 'facebook',
      platformAccountId: facebookAccount,
      retryable: false,
      status: 'blocked',
    })

    const secondAccount = await service.publish(
      request({ platformAccountId: secondFacebookAccount }),
    )
    expect(secondAccount).toMatchObject({
      idempotencyKey: 'fixture-publish-1',
      platform: 'facebook',
      platformAccountId: secondFacebookAccount,
      status: 'accepted',
    })
    expect(secondAccount).not.toEqual(first)

    const instagram = await service.publish(
      request({ platform: 'instagram', platformAccountId: instagramAccount }),
    )
    expect(instagram).toMatchObject({
      idempotencyKey: 'fixture-publish-1',
      platform: 'instagram',
      platformAccountId: instagramAccount,
      status: 'accepted',
    })

    if (first.status !== 'accepted') throw new Error('Expected an accepted fixture publish')
    await expect(
      service.getStatus({
        externalPublicationId: first.externalPublicationId,
        idempotencyKey: first.idempotencyKey,
        platform: first.platform,
        platformAccountId: first.platformAccountId,
      }),
    ).resolves.toEqual({
      externalPublicationId: first.externalPublicationId,
      idempotencyKey: first.idempotencyKey,
      platform: first.platform,
      platformAccountId: first.platformAccountId,
      status: 'pending',
    })
    await expect(
      service.getStatus({
        externalPublicationId: first.externalPublicationId,
        idempotencyKey: first.idempotencyKey,
        platform: first.platform,
        platformAccountId: secondFacebookAccount,
      }),
    ).rejects.toThrow('Fake platform publication is not known')

    const referenceAccountA = 'account-a'
    const referenceAccountB = 'account-a\u0000key-b'
    const referenceService = createFakePublishingService({
      capabilities: [
        capability(referenceAccountA, 'facebook'),
        capability(referenceAccountB, 'facebook'),
      ],
    })
    referenceService.failNextPublish({
      errorCode: 'delivery_unknown',
      externalPublicationId: 'key-b\u0000external-c',
      platform: 'facebook',
      platformAccountId: referenceAccountA,
      retryable: false,
    })
    const firstReference = await referenceService.publish(
      request({ idempotencyKey: 'reference-a', platformAccountId: referenceAccountA }),
    )
    referenceService.failNextPublish({
      errorCode: 'delivery_unknown',
      externalPublicationId: 'external-c',
      platform: 'facebook',
      platformAccountId: referenceAccountB,
      retryable: false,
    })
    const secondReference = await referenceService.publish(
      request({ idempotencyKey: 'reference-b', platformAccountId: referenceAccountB }),
    )
    expect(firstReference).toMatchObject({
      externalPublicationId: 'key-b\u0000external-c',
      status: 'delivery_unknown',
    })
    expect(secondReference).toMatchObject({
      externalPublicationId: 'external-c',
      status: 'delivery_unknown',
    })
    await expect(
      referenceService.getStatus({
        externalPublicationId: 'key-b\u0000external-c',
        idempotencyKey: 'reference-a',
        platform: 'facebook',
        platformAccountId: referenceAccountA,
      }),
    ).resolves.toEqual(firstReference)
    await expect(
      referenceService.getStatus({
        externalPublicationId: 'external-c',
        idempotencyKey: 'reference-b',
        platform: 'facebook',
        platformAccountId: referenceAccountB,
      }),
    ).resolves.toEqual(secondReference)
  })

  it('keeps control characters from creating cross-account command or status collisions', async () => {
    const firstAccount = 'account-a'
    const secondAccount = 'account-a\u0000key-b'
    const service = createFakePublishingService({
      capabilities: [
        capability(firstAccount, 'facebook'),
        capability(secondAccount, 'facebook'),
      ],
    })
    const first = await service.publish(
      request({
        idempotencyKey: 'key-b\u0000command-c',
        platformAccountId: firstAccount,
      }),
    )
    await expect(
      service.getStatus({
        idempotencyKey: 'command-c',
        platform: 'facebook',
        platformAccountId: secondAccount,
      }),
    ).rejects.toThrow('Fake platform publication is not known')
    const second = await service.publish(
      request({ idempotencyKey: 'command-c', platformAccountId: secondAccount }),
    )

    expect(first).toMatchObject({ platformAccountId: firstAccount, status: 'accepted' })
    expect(second).toMatchObject({ platformAccountId: secondAccount, status: 'accepted' })
    if (first.status !== 'accepted' || second.status !== 'accepted') {
      throw new Error('Expected isolated accepted publications')
    }
    expect(second.externalPublicationId).not.toBe(first.externalPublicationId)
    await expect(
      service.getStatus({
        idempotencyKey: 'command-c',
        platform: 'facebook',
        platformAccountId: secondAccount,
      }),
    ).resolves.toMatchObject({
      externalPublicationId: second.externalPublicationId,
      platformAccountId: secondAccount,
    })
    await expect(
      service.getStatus({
        externalPublicationId: second.externalPublicationId,
        idempotencyKey: 'command-c',
        platform: 'facebook',
        platformAccountId: secondAccount,
      }),
    ).resolves.toMatchObject({
      externalPublicationId: second.externalPublicationId,
      platformAccountId: secondAccount,
    })
    await expect(
      service.getStatus({
        externalPublicationId: first.externalPublicationId,
        idempotencyKey: 'command-c',
        platform: 'facebook',
        platformAccountId: secondAccount,
      }),
    ).rejects.toThrow('Fake platform publication is not known')
  })

  it('prepares the LinkedIn assisted package through the public service boundary', async () => {
    const service = connectedService()
    const prepared = await service.prepareAssistedPublication({
      assets: [
        {
          bytes: new Uint8Array([1, 2, 3]),
          fileName: 'panel.jpg',
          id: 'asset-1',
          mimeType: 'image/jpeg',
        },
      ],
      platform: 'linkedin',
      platformAccountId: linkedinAccount,
      text: '  Reviewed LinkedIn post.  ',
    })

    expect(prepared).toMatchObject({
      artifact: {
        fileName: 'linkedin-assisted-post.zip',
        mimeType: 'application/zip',
        platform: 'linkedin',
      },
      manifest: {
        assets: [{ fileName: 'panel.jpg', id: 'asset-1', mimeType: 'image/jpeg' }],
        copyText: 'Reviewed LinkedIn post.',
        platform: 'linkedin',
      },
      mode: 'assisted',
      platform: 'linkedin',
      platformAccountId: linkedinAccount,
      status: 'prepared',
    })
    if (prepared.status !== 'prepared') throw new Error('Expected an assisted package')
    expect([...prepared.artifact.bytes.slice(0, 2)]).toEqual([0x50, 0x4b])
    expect(
      service.getPublishAttemptCount({
        platform: 'linkedin',
        platformAccountId: linkedinAccount,
      }),
    ).toBe(0)

    const unsafe = {
      assets: [
        {
          bytes: new Uint8Array([1]),
          fileName: 'panel.jpg',
          id: 'asset-1',
          mimeType: 'image/jpeg',
          sourceUrl: 'https://example.invalid/panel.jpg?token=secret',
        },
      ],
      platform: 'linkedin',
      platformAccountId: linkedinAccount,
      text: 'Reviewed LinkedIn post.',
    } as unknown as AssistedPublicationRequest
    await expect(service.prepareAssistedPublication(unsafe)).resolves.toEqual({
      errorCode: 'invalid_request',
      mode: 'assisted',
      platform: 'linkedin',
      platformAccountId: linkedinAccount,
      retryable: false,
      status: 'blocked',
    })
    expect(JSON.stringify(await service.prepareAssistedPublication(unsafe))).not.toContain('secret')

    await expect(
      service.prepareAssistedPublication({
        assets: [],
        platform: 'facebook',
        platformAccountId: facebookAccount,
        text: 'Not supported',
      } as never),
    ).resolves.toMatchObject({ errorCode: 'platform_blocked', status: 'blocked' })

    const blocked = createFakePublishingService({
      capabilities: [capability(linkedinAccount, 'linkedin', 'blocked')],
    })
    await expect(
      blocked.prepareAssistedPublication({
        assets: [],
        platform: 'linkedin',
        platformAccountId: linkedinAccount,
        text: 'Blocked account',
      }),
    ).resolves.toMatchObject({ errorCode: 'platform_blocked', status: 'blocked' })
  })

  it('fences a delivery-unknown outcome and recovers it by the same command key', async () => {
    const service = connectedService()
    const command = request({ idempotencyKey: 'unknown-result-1' })
    service.failNextPublish({
      errorCode: 'delivery_unknown',
      platform: command.platform,
      platformAccountId: command.platformAccountId,
      retryable: false,
    })

    const unknown = await service.publish(command)
    expect(unknown).toEqual({
      errorCode: 'delivery_unknown',
      idempotencyKey: command.idempotencyKey,
      platform: command.platform,
      platformAccountId: command.platformAccountId,
      retryable: false,
      status: 'delivery_unknown',
    })
    await expect(service.publish(command)).resolves.toEqual(unknown)
    await expect(
      service.getStatus({
        idempotencyKey: command.idempotencyKey,
        platform: command.platform,
        platformAccountId: command.platformAccountId,
      }),
    ).resolves.toEqual(unknown)
    expect(
      service.getPublishAttemptCount({
        platform: command.platform,
        platformAccountId: command.platformAccountId,
      }),
    ).toBe(1)

    service.setStatus({
      externalPublicationId: 'provider-publication-1',
      idempotencyKey: command.idempotencyKey,
      platform: command.platform,
      platformAccountId: command.platformAccountId,
      status: 'pending',
    })
    await expect(service.publish(command)).resolves.toEqual({
      externalPublicationId: 'provider-publication-1',
      idempotencyKey: command.idempotencyKey,
      platform: command.platform,
      platformAccountId: command.platformAccountId,
      status: 'accepted',
    })
    expect(
      service.getPublishAttemptCount({
        platform: command.platform,
        platformAccountId: command.platformAccountId,
      }),
    ).toBe(1)
  })

  it('returns a failed command snapshot instead of a stale accepted result', async () => {
    const service = connectedService()
    const command = request({ idempotencyKey: 'failed-command-1' })
    const accepted = await service.publish(command)
    if (accepted.status !== 'accepted') throw new Error('Expected an accepted fixture publish')
    const failed = {
      errorCode: 'rate_limited' as const,
      externalPublicationId: accepted.externalPublicationId,
      idempotencyKey: accepted.idempotencyKey,
      platform: accepted.platform,
      platformAccountId: accepted.platformAccountId,
      retryable: true,
      status: 'failed' as const,
    }
    service.setStatus(failed)

    await expect(service.publish(command)).resolves.toEqual(failed)
    expect(
      service.getPublishAttemptCount({
        platform: command.platform,
        platformAccountId: command.platformAccountId,
      }),
    ).toBe(1)
    await expect(
      service.publish(request({ idempotencyKey: 'failed-command-2' })),
    ).resolves.toMatchObject({ status: 'accepted' })
    expect(
      service.getPublishAttemptCount({
        platform: command.platform,
        platformAccountId: command.platformAccountId,
      }),
    ).toBe(2)
  })

  it('freezes bounded public inputs and machine-readable error codes', async () => {
    const service = connectedService()
    const atLimit = request({
      idempotencyKey: 'k'.repeat(MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES),
      text: '😀'.repeat(MAX_PUBLICATION_TEXT_CODE_POINTS),
    })
    await expect(service.publish(atLimit)).resolves.toMatchObject({ status: 'accepted' })
    await expect(
      service.publish(
        request({ idempotencyKey: 'k'.repeat(MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES + 1) }),
      ),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    await expect(
      service.publish(request({ text: '😀'.repeat(MAX_PUBLICATION_TEXT_CODE_POINTS + 1) })),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    await expect(
      service.publish(
        request({
          assets: Array.from({ length: MAX_PUBLICATION_ASSETS + 1 }, (_, index) => ({
            fileName: `asset-${index}.jpg`,
            id: `asset-${index}`,
            mimeType: 'image/jpeg',
          })),
        }),
      ),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })

    const blockedCode: PlatformPublishErrorCode = 'permission_required'
    const unknownCode: PlatformPublishErrorCode = 'delivery_unknown'
    expect(PLATFORM_PUBLISH_ERROR_CODES).toContain(blockedCode)
    expect(PLATFORM_PUBLISH_ERROR_CODES).toContain(unknownCode)
    expect(PLATFORM_PUBLISH_ERROR_CODES).not.toContain('unknown')
  })
})
