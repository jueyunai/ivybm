import { describe, expect, it } from 'vitest'

import {
  MAX_PUBLICATION_ASSETS,
  MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES,
  MAX_PUBLICATION_TEXT_CODE_POINTS,
  PLATFORM_PUBLISH_ERROR_CODES,
  type PlatformCapability,
  type PlatformPublishErrorCode,
  type PlatformPublishRequest,
  type PublishingService,
} from '@/modules/publishing/contracts'
import { createFakePublishingService } from '../../fakes/publishingService'

const facebookAccount = 101
const secondFacebookAccount = 102
const instagramAccount = 201

const capability = (
  platformAccountId: number,
  platform: 'facebook' | 'instagram',
  availability: PlatformCapability['availability'] = 'available',
): PlatformCapability => ({
  availability,
  modes: ['automatic'],
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
