import { describe, expect, it } from 'vitest'

import { createLinkedInAssistedExport } from '../../../src/modules/platforms/linkedin/export'
import type { PlatformPublishingPort } from '../../../src/modules/platforms/ports'
import type {
  PlatformCapability,
  PlatformPublishAcceptance,
  PlatformPublishErrorCode,
  PlatformPublishRequest,
  PublishingPlatform,
} from '../../../src/modules/platforms/types'

describe('phase-one publishing contract', () => {
  it('freezes conditional capability and mock publication correlation semantics', async () => {
    const capabilities: Record<PublishingPlatform, PlatformCapability> = {
      facebook: {
        availability: 'conditional',
        modes: ['automatic'],
        platform: 'facebook',
        reason: 'Meta Content Publishing permission requires controlled verification',
      },
      instagram: {
        availability: 'conditional',
        modes: ['automatic'],
        platform: 'instagram',
        reason: 'Instagram business account and publishing permission require verification',
      },
      linkedin: {
        availability: 'conditional',
        modes: ['assisted'],
        platform: 'linkedin',
        reason: 'Automatic publishing remains blocked until API permission is verified',
      },
    }
    type AcceptedPublication = Extract<PlatformPublishAcceptance, { status: 'accepted' }>
    const acceptedByCommand = new Map<
      string,
      { acceptance: AcceptedPublication; requestFingerprint: string }
    >()
    const commandKey = (request: PlatformPublishRequest): string =>
      `${request.platform}:${request.idempotencyKey}`
    const requestFingerprint = (request: PlatformPublishRequest): string =>
      JSON.stringify({
        assets: request.assets,
        scheduledFor: request.scheduledFor ?? null,
        text: request.text,
      })
    const port: PlatformPublishingPort = {
      getCapability: async (platform) => capabilities[platform],
      getStatus: async ({ externalPublicationId, platform }) => ({
        externalPublicationId,
        platform,
        status: 'published',
      }),
      publish: async (request) => {
        const key = commandKey(request)
        const fingerprint = requestFingerprint(request)
        const known = acceptedByCommand.get(key)
        if (known) {
          if (known.requestFingerprint !== fingerprint) {
            return {
              errorCode: 'invalid_request',
              idempotencyKey: request.idempotencyKey,
              platform: request.platform,
              retryable: false,
              status: 'blocked',
            }
          }
          return known.acceptance
        }

        const acceptance: AcceptedPublication = {
          externalPublicationId: `mock:${request.platform}:${request.idempotencyKey}`,
          idempotencyKey: request.idempotencyKey,
          platform: request.platform,
          status: 'accepted',
        }
        acceptedByCommand.set(key, { acceptance, requestFingerprint: fingerprint })
        return acceptance
      },
    }

    await expect(
      Promise.all(
        Object.keys(capabilities).map((key) => port.getCapability(key as PublishingPlatform)),
      ),
    ).resolves.toEqual([capabilities.facebook, capabilities.instagram, capabilities.linkedin])
    const request = {
      assets: [],
      idempotencyKey: 'fixture-publish-1',
      platform: 'facebook' as const,
      text: 'Fixture post',
    }
    const accepted = await port.publish(request)
    const duplicate = await port.publish(request)

    expect(accepted).toEqual({
      externalPublicationId: 'mock:facebook:fixture-publish-1',
      idempotencyKey: 'fixture-publish-1',
      platform: 'facebook',
      status: 'accepted',
    })
    expect(duplicate).toEqual(accepted)

    const conflicting = await port.publish({ ...request, text: 'Changed fixture post' })
    expect(conflicting).toEqual({
      errorCode: 'invalid_request',
      idempotencyKey: 'fixture-publish-1',
      platform: 'facebook',
      retryable: false,
      status: 'blocked',
    })
    await expect(
      port.publish({
        ...request,
        assets: [{ fileName: 'changed.jpg', id: 'asset-1', mimeType: 'image/jpeg' }],
      }),
    ).resolves.toEqual(conflicting)
    await expect(
      port.publish({ ...request, scheduledFor: '2026-08-01T00:00:00.000Z' }),
    ).resolves.toEqual(conflicting)

    const sameKeyOnInstagram = await port.publish({ ...request, platform: 'instagram' })
    expect(sameKeyOnInstagram).toEqual({
      externalPublicationId: 'mock:instagram:fixture-publish-1',
      idempotencyKey: 'fixture-publish-1',
      platform: 'instagram',
      status: 'accepted',
    })

    if (accepted.status !== 'accepted') throw new Error('Expected a fixture acceptance')

    await expect(
      port.getStatus({
        externalPublicationId: accepted.externalPublicationId,
        platform: accepted.platform,
      }),
    ).resolves.toMatchObject({
      externalPublicationId: 'mock:facebook:fixture-publish-1',
      platform: 'facebook',
      status: 'published',
    })
  })

  it('creates a deterministic LinkedIn assisted-delivery export without network or file writes', () => {
    expect(
      createLinkedInAssistedExport({
        assets: [
          {
            fileName: 'facade-panel.jpg',
            id: 'asset-2',
            mimeType: 'image/jpeg',
            sourceUrl: 'https://example.invalid/assets/facade-panel.jpg',
          },
          {
            fileName: 'project-detail.png',
            id: 'asset-1',
            mimeType: 'image/png',
          },
        ],
        text: '  Aluminum facade systems\r\nfor global projects.  ',
      }),
    ).toEqual({
      assets: [
        {
          fileName: 'project-detail.png',
          id: 'asset-1',
          mimeType: 'image/png',
        },
        {
          fileName: 'facade-panel.jpg',
          id: 'asset-2',
          mimeType: 'image/jpeg',
          sourceUrl: 'https://example.invalid/assets/facade-panel.jpg',
        },
      ],
      checklist: [
        'Copy the reviewed text into LinkedIn.',
        'Download and attach the listed assets in manifest order.',
        'Verify the final preview before publishing manually.',
      ],
      copyText: 'Aluminum facade systems\nfor global projects.',
      mode: 'assisted',
      platform: 'linkedin',
    })
  })

  it('rejects empty copy and duplicate asset identities', () => {
    expect(() => createLinkedInAssistedExport({ assets: [], text: '   ' })).toThrow(
      'LinkedIn assisted export text is required',
    )
    expect(() =>
      createLinkedInAssistedExport({
        assets: [
          { fileName: 'one.jpg', id: 'asset-1', mimeType: 'image/jpeg' },
          { fileName: 'two.jpg', id: 'asset-1', mimeType: 'image/jpeg' },
        ],
        text: 'Fixture post',
      }),
    ).toThrow('LinkedIn assisted export asset IDs must be unique')
  })

  it('freezes machine-readable blocked and failed publishing error codes', async () => {
    const blockedCode: PlatformPublishErrorCode = 'permission_required'
    const failedCode: PlatformPublishErrorCode = 'rate_limited'
    const port: PlatformPublishingPort = {
      getCapability: async (platform) => ({
        availability: 'conditional',
        modes: ['automatic'],
        platform,
      }),
      getStatus: async ({ externalPublicationId, platform }) => ({
        errorCode: failedCode,
        externalPublicationId,
        platform,
        retryable: true,
        status: 'failed',
      }),
      publish: async (request) => ({
        errorCode: blockedCode,
        idempotencyKey: request.idempotencyKey,
        platform: request.platform,
        retryable: false,
        status: 'blocked',
      }),
    }

    await expect(
      port.publish({
        assets: [],
        idempotencyKey: 'blocked-publish-1',
        platform: 'instagram',
        text: 'Fixture post',
      }),
    ).resolves.toEqual({
      errorCode: 'permission_required',
      idempotencyKey: 'blocked-publish-1',
      platform: 'instagram',
      retryable: false,
      status: 'blocked',
    })
    await expect(
      port.getStatus({ externalPublicationId: 'failed-publication-1', platform: 'instagram' }),
    ).resolves.toEqual({
      errorCode: 'rate_limited',
      externalPublicationId: 'failed-publication-1',
      platform: 'instagram',
      retryable: true,
      status: 'failed',
    })
  })
})
