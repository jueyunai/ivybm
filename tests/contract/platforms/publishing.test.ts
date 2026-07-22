import { describe, expect, it } from 'vitest'

import { createLinkedInAssistedExport } from '../../../src/modules/platforms/linkedin/export'
import type { PlatformPublishingPort } from '../../../src/modules/platforms/ports'
import type {
  PlatformCapability,
  PlatformPublishErrorCode,
  PublishingPlatform,
} from '../../../src/modules/platforms/types'

describe('phase-one publishing contract', () => {
  it('represents Facebook, Instagram, and LinkedIn capability without claiming availability', async () => {
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
    const port: PlatformPublishingPort = {
      getCapability: async (platform) => capabilities[platform],
      getStatus: async ({ externalPublicationId, platform }) => ({
        externalPublicationId,
        platform,
        status: 'published',
      }),
      publish: async (request) => ({
        idempotencyKey: request.idempotencyKey,
        platform: request.platform,
        status: 'accepted',
      }),
    }

    await expect(
      Promise.all(
        Object.keys(capabilities).map((key) => port.getCapability(key as PublishingPlatform)),
      ),
    ).resolves.toEqual([capabilities.facebook, capabilities.instagram, capabilities.linkedin])
    await expect(
      port.publish({
        assets: [],
        idempotencyKey: 'fixture-publish-1',
        platform: 'facebook',
        text: 'Fixture post',
      }),
    ).resolves.toMatchObject({ platform: 'facebook', status: 'accepted' })
    await expect(
      port.getStatus({ externalPublicationId: 'fixture-publication-1', platform: 'facebook' }),
    ).resolves.toMatchObject({
      externalPublicationId: 'fixture-publication-1',
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
      getStatus: async ({ platform }) => ({
        errorCode: failedCode,
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
      platform: 'instagram',
      retryable: true,
      status: 'failed',
    })
  })
})
