import { describe, expect, it } from 'vitest'

import {
  createFakePlatformPublishingPort,
  type FakePlatformPublishingPortOptions,
} from '@/modules/platforms/fakePublishingPort'
import type {
  PlatformCapability,
  PlatformPublishRequest,
} from '@/modules/publishing/contracts'

const accountA = 101
const accountB = 102

const capability = (
  platformAccountId: number,
  availability: PlatformCapability['availability'] = 'available',
): PlatformCapability => ({
  availability,
  modes: ['automatic'],
  platform: 'facebook',
  platformAccountId,
})

const request = (
  overrides: Partial<PlatformPublishRequest> = {},
): PlatformPublishRequest => ({
  assets: [],
  idempotencyKey: 'fixture-facebook-1',
  platform: 'facebook',
  platformAccountId: accountA,
  text: 'Fixture post',
  ...overrides,
})

const connectedPort = (options: FakePlatformPublishingPortOptions = {}) =>
  createFakePlatformPublishingPort({
    capabilities: [capability(accountA), capability(accountB), ...(options.capabilities ?? [])],
  })

describe('fake platform publishing port', () => {
  it('keeps capabilities account-scoped and returns defensive copies', async () => {
    const port = createFakePlatformPublishingPort({
      capabilities: [capability(accountA), capability(accountB, 'blocked')],
    })
    const first = await port.getCapability({ platform: 'facebook', platformAccountId: accountA })
    first.modes.push('assisted')

    await expect(
      port.getCapability({ platform: 'facebook', platformAccountId: accountA }),
    ).resolves.toEqual(capability(accountA))
    await expect(
      port.getCapability({ platform: 'facebook', platformAccountId: accountB }),
    ).resolves.toEqual(capability(accountB, 'blocked'))
    await expect(
      port.getCapability({ platform: 'instagram', platformAccountId: accountA }),
    ).resolves.toMatchObject({
      availability: 'conditional',
      platform: 'instagram',
      platformAccountId: accountA,
    })
  })

  it('isolates same-platform commands and references by platform account', async () => {
    const port = connectedPort()
    const first = await port.publish(request())
    const second = await port.publish(request({ platformAccountId: accountB }))
    expect(first).toMatchObject({ platformAccountId: accountA, status: 'accepted' })
    expect(second).toMatchObject({ platformAccountId: accountB, status: 'accepted' })
    expect(second).not.toEqual(first)

    if (first.status !== 'accepted') throw new Error('Expected accepted publication')
    await expect(
      port.getStatus({
        externalPublicationId: first.externalPublicationId,
        idempotencyKey: first.idempotencyKey,
        platform: first.platform,
        platformAccountId: accountB,
      }),
    ).rejects.toThrow('Fake platform publication is not known')
  })

  it('uses stable asset identity rather than temporary source URLs in the command fingerprint', async () => {
    const port = connectedPort()
    const firstRequest = request({
      assets: [
        {
          fileName: 'panel.jpg',
          id: 'asset-1',
          mimeType: 'image/jpeg',
          sha256: 'a'.repeat(64),
          sourceUrl: 'https://EXAMPLE.invalid:443/media/panel.jpg?token=first#preview',
        },
      ],
    })
    const first = await port.publish(firstRequest)

    await expect(
      port.publish({
        ...firstRequest,
        assets: [
          {
            ...firstRequest.assets[0],
            fileName: 'renamed-panel.jpg',
            sourceUrl: 'https://example.invalid/media/panel.jpg?token=second',
          },
        ],
      }),
    ).resolves.toEqual(first)
    await expect(
      port.publish({
        ...firstRequest,
        assets: [{ ...firstRequest.assets[0], sha256: 'b'.repeat(64) }],
      }),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })

    const withoutDigest = request({
      idempotencyKey: 'asset-without-digest-1',
      assets: [
        {
          fileName: 'panel.jpg',
          id: 'stable-asset-2',
          mimeType: 'image/jpeg',
          sourceUrl: 'https://example.invalid/temporary/first.jpg?token=first',
        },
      ],
    })
    const acceptedWithoutDigest = await port.publish(withoutDigest)
    await expect(
      port.publish({
        ...withoutDigest,
        assets: [
          {
            ...withoutDigest.assets[0],
            sourceUrl: 'https://example.invalid/temporary/second.jpg?token=second',
          },
        ],
      }),
    ).resolves.toEqual(acceptedWithoutDigest)
  })

  it('normalizes URLs and rejects unsafe or overlong publishing input', async () => {
    const port = connectedPort()
    await expect(
      port.publish(
        request({
          assets: [
            {
              fileName: 'panel.jpg',
              id: 'asset-1',
              mimeType: 'IMAGE/JPEG',
              sourceUrl: 'https://EXAMPLE.invalid:443/media/panel.jpg?token=secret#preview',
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({ status: 'accepted' })
    await expect(
      port.publish(
        request({
          idempotencyKey: 'unsafe-url-1',
          assets: [
            {
              fileName: 'panel.jpg',
              id: 'asset-1',
              mimeType: 'image/jpeg',
              sourceUrl: 'https://user:password@example.invalid/panel.jpg',
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    await expect(
      port.publish(
        request({
          idempotencyKey: 'long-url-1',
          assets: [
            {
              fileName: 'panel.jpg',
              id: 'asset-1',
              mimeType: 'image/jpeg',
              sourceUrl: `https://example.invalid/${'a'.repeat(2_100)}`,
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    await expect(port.publish(request({ idempotencyKey: ' spaced ' }))).resolves.toMatchObject({
      errorCode: 'invalid_request',
      status: 'blocked',
    })
  })

  it('scopes provider failure injection to one platform account', async () => {
    const port = connectedPort()
    port.failNextPublish({
      errorCode: 'provider_unavailable',
      platform: 'facebook',
      platformAccountId: accountA,
      retryable: true,
    })

    await expect(port.publish(request())).resolves.toEqual({
      errorCode: 'provider_unavailable',
      idempotencyKey: 'fixture-facebook-1',
      platform: 'facebook',
      platformAccountId: accountA,
      retryable: true,
      status: 'blocked',
    })
    await expect(port.publish(request({ platformAccountId: accountB }))).resolves.toMatchObject({
      platformAccountId: accountB,
      status: 'accepted',
    })
    expect(
      port.getPublishAttemptCount({ platform: 'facebook', platformAccountId: accountA }),
    ).toBe(1)
    expect(
      port.getPublishAttemptCount({ platform: 'facebook', platformAccountId: accountB }),
    ).toBe(1)
  })

  it('does not resend delivery-unknown commands and supports evidence-based recovery', async () => {
    const port = connectedPort()
    const command = request({ idempotencyKey: 'unknown-1' })
    expect(() =>
      port.failNextPublish({
        errorCode: 'delivery_unknown',
        platform: command.platform,
        platformAccountId: command.platformAccountId,
        retryable: true,
      }),
    ).toThrow('Fake delivery-unknown result cannot be retryable')
    port.failNextPublish({
      errorCode: 'delivery_unknown',
      platform: command.platform,
      platformAccountId: command.platformAccountId,
      retryable: false,
    })

    const unknown = await port.publish(command)
    await expect(port.publish(command)).resolves.toEqual(unknown)
    expect(
      port.getPublishAttemptCount({
        platform: command.platform,
        platformAccountId: command.platformAccountId,
      }),
    ).toBe(1)
    port.setStatus({
      externalPublicationId: 'provider-recovered-1',
      idempotencyKey: command.idempotencyKey,
      platform: command.platform,
      platformAccountId: command.platformAccountId,
      status: 'pending',
    })
    await expect(port.publish(command)).resolves.toEqual({
      externalPublicationId: 'provider-recovered-1',
      idempotencyKey: command.idempotencyKey,
      platform: command.platform,
      platformAccountId: command.platformAccountId,
      status: 'accepted',
    })
  })

  it('keeps terminal failed metadata immutable and never returns stale accepted', async () => {
    const port = connectedPort()
    const command = request({ idempotencyKey: 'terminal-failure-1' })
    const accepted = await port.publish(command)
    if (accepted.status !== 'accepted') throw new Error('Expected accepted publication')
    const failure = {
      errorCode: 'rate_limited' as const,
      externalPublicationId: accepted.externalPublicationId,
      idempotencyKey: accepted.idempotencyKey,
      platform: accepted.platform,
      platformAccountId: accepted.platformAccountId,
      retryable: true,
      status: 'failed' as const,
    }
    port.setStatus(failure)

    await expect(port.publish(command)).resolves.toEqual(failure)
    expect(() => port.setStatus(failure)).not.toThrow()
    expect(() => port.setStatus({ ...failure, errorCode: 'provider_unavailable' })).toThrow(
      'Fake platform publication cannot replace failed failure metadata',
    )
    expect(() =>
      port.setStatus({
        externalPublicationId: accepted.externalPublicationId,
        idempotencyKey: accepted.idempotencyKey,
        platform: accepted.platform,
        platformAccountId: accepted.platformAccountId,
        status: 'published',
      }),
    ).toThrow('Fake platform publication cannot transition from failed to published')
  })

  it('rejects malformed runtime inputs and duplicate capability overrides', async () => {
    expect(() =>
      createFakePlatformPublishingPort({
        capabilities: [capability(accountA), capability(accountA)],
      }),
    ).toThrow('Fake platform capability overrides must be unique per account')
    expect(() =>
      createFakePlatformPublishingPort({ capabilities: {} } as never),
    ).toThrow('Fake platform capability overrides must be an array')

    const port = connectedPort()
    await expect(port.getCapability({ platform: 'tiktok' as never, platformAccountId: accountA }))
      .rejects.toThrow('Publishing platform is unsupported')
    await expect(port.publish(null as never)).rejects.toThrow('Fake publish request must be an object')
    await expect(
      port.publish({ ...request(), platformAccountId: null } as never),
    ).rejects.toThrow('Platform account ID is invalid')
    await expect(
      port.getStatus({
        idempotencyKey: 'missing-1',
        platform: 'facebook',
        platformAccountId: accountA,
      }),
    ).rejects.toThrow('Fake platform publication is not known')
    expect(() => port.setStatus(null as never)).toThrow('Fake publication status must be an object')
  })
})
