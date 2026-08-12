import { describe, expect, it, vi } from 'vitest'

import { PublishingContractValidationError } from '@/modules/publishing/contracts'
import {
  executeMultiPlatformPublication,
  planMultiPlatformPublication,
  type PlatformPublicationExecutor,
} from '@/modules/platforms/multiPlatformPublishing'
const target = (platform: 'facebook' | 'instagram' | 'linkedin') => ({
  assets:
    platform === 'linkedin'
      ? []
      : [
          {
            fileName: 'facade.jpg',
            id: `asset-${platform}`,
            mimeType: 'image/jpeg',
            sourceUrl: 'https://media.example.test/facade.jpg',
          },
        ],
  platform,
  platformAccountId: platform === 'facebook' ? 7 : platform === 'instagram' ? 8 : 9,
  text: `${platform} project update`,
})

const plan = () =>
  planMultiPlatformPublication({
    idempotencyKey: 'content-studio-click-42',
    requestedAt: '2026-08-12T15:00:00.000Z',
    targets: [target('linkedin'), target('facebook'), target('instagram')],
  })

const snapshots = () => plan().commands.map(({ snapshot }) => snapshot)

describe('multi-platform publication orchestration', () => {
  it('derives stable globally unique platform keys in canonical order', () => {
    const first = plan()
    const second = plan()
    expect(first).toEqual(second)
    expect(first.commands.map(({ snapshot }) => snapshot.platform)).toEqual([
      'facebook',
      'instagram',
      'linkedin',
    ])
    const keys = first.commands.map(({ snapshot }) => snapshot.idempotencyKey)
    expect(new Set(keys).size).toBe(3)
    expect(keys).toEqual([
      expect.stringMatching(/^publish:v1:[a-f0-9]{64}:facebook$/),
      expect.stringMatching(/^publish:v1:[a-f0-9]{64}:instagram$/),
      expect.stringMatching(/^publish:v1:[a-f0-9]{64}:linkedin$/),
    ])
    expect(keys.every((key) => key.length <= 200)).toBe(true)
    expect(keys.join(' ')).not.toContain('content-studio-click-42')
    expect(first.commands.map(({ requestFingerprint }) => requestFingerprint)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ])
    expect(first.commands.map(({ scheduledFor }) => scheduledFor)).toEqual([
      '2026-08-12T15:00:00.000Z',
      '2026-08-12T15:00:00.000Z',
      '2026-08-12T15:00:00.000Z',
    ])
    expect(first.commands.every(({ snapshot }) => snapshot.scheduledFor === undefined)).toBe(true)
  })

  it('scopes derived keys by internal platform account and fingerprints command content', () => {
    const first = planMultiPlatformPublication({
      idempotencyKey: 'same-click-key',
      requestedAt: '2026-08-12T15:00:00.000Z',
      targets: [target('facebook')],
    }).commands[0]!
    const anotherAccount = planMultiPlatformPublication({
      idempotencyKey: 'same-click-key',
      requestedAt: '2026-08-12T15:00:00.000Z',
      targets: [{ ...target('facebook'), platformAccountId: 77 }],
    }).commands[0]!
    const changedContent = planMultiPlatformPublication({
      idempotencyKey: 'same-click-key',
      requestedAt: '2026-08-12T15:00:00.000Z',
      targets: [{ ...target('facebook'), text: 'Changed project update' }],
    }).commands[0]!

    expect(anotherAccount.snapshot.idempotencyKey).not.toBe(first.snapshot.idempotencyKey)
    expect(changedContent.snapshot.idempotencyKey).toBe(first.snapshot.idempotencyKey)
    expect(changedContent.requestFingerprint).not.toBe(first.requestFingerprint)
  })

  it('uses source URL only when no immutable asset digest is available', () => {
    const withoutDigest = target('facebook')
    const first = planMultiPlatformPublication({
      idempotencyKey: 'asset-click',
      requestedAt: '2026-08-12T15:00:00.000Z',
      targets: [withoutDigest],
    }).commands[0]!
    const changedURL = planMultiPlatformPublication({
      idempotencyKey: 'asset-click',
      requestedAt: '2026-08-12T15:00:00.000Z',
      targets: [
        {
          ...withoutDigest,
          assets: withoutDigest.assets.map((asset) => ({
            ...asset,
            sourceUrl: 'https://media.example.test/replaced.jpg',
          })),
        },
      ],
    }).commands[0]!
    expect(changedURL.requestFingerprint).not.toBe(first.requestFingerprint)

    const digest = 'a'.repeat(64)
    const withDigest = {
      ...withoutDigest,
      assets: withoutDigest.assets.map((asset) => ({ ...asset, sha256: digest })),
    }
    const signedURLA = planMultiPlatformPublication({
      idempotencyKey: 'asset-click-digest',
      requestedAt: '2026-08-12T15:00:00.000Z',
      targets: [withDigest],
    }).commands[0]!
    const signedURLB = planMultiPlatformPublication({
      idempotencyKey: 'asset-click-digest',
      requestedAt: '2026-08-12T15:00:00.000Z',
      targets: [
        {
          ...withDigest,
          assets: withDigest.assets.map((asset) => ({
            ...asset,
            sourceUrl: 'https://media.example.test/facade.jpg?signature=refreshed',
          })),
        },
      ],
    }).commands[0]!
    expect(signedURLB.requestFingerprint).toBe(signedURLA.requestFingerprint)
  })

  it.each<[unknown, string]>([
    [null, 'malformed command'],
    [
      { idempotencyKey: 'click', requestedAt: '2026-08-12T15:00:00.000Z', targets: [] },
      'empty selection',
    ],
    [
      {
        idempotencyKey: 'click',
        requestedAt: '2026-08-12T15:00:00.000Z',
        targets: [target('facebook'), target('facebook')],
      },
      'duplicate platform',
    ],
    [
      {
        idempotencyKey: ' invalid ',
        requestedAt: '2026-08-12T15:00:00.000Z',
        targets: [target('facebook')],
      },
      'invalid command key',
    ],
    [
      { idempotencyKey: 'click', requestedAt: 'not-a-time', targets: [target('facebook')] },
      'invalid click time',
    ],
    [
      { idempotencyKey: 'click', requestedAt: '2026-08-12', targets: [target('facebook')] },
      'non-canonical click time',
    ],
  ])('rejects an invalid one-click plan: %s (%s)', (command, _label) => {
    expect(() => planMultiPlatformPublication(command as never)).toThrow(
      PublishingContractValidationError,
    )
  })

  it('starts all platform executions concurrently and preserves canonical results', async () => {
    const releases = new Map<string, () => void>()
    const execute = vi.fn<PlatformPublicationExecutor>(
      (snapshot) =>
        new Promise((resolve) => {
          releases.set(snapshot.platform, () =>
            resolve({
              changed: true,
              event: 'accepted',
              externalPublicationId: `${snapshot.platform}-post`,
              status: 'accepted',
            }),
          )
        }),
    )
    const pending = executeMultiPlatformPublication({ execute, snapshots: snapshots() })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3))
    releases.get('linkedin')?.()
    releases.get('facebook')?.()
    releases.get('instagram')?.()

    await expect(pending).resolves.toMatchObject([
      { platform: 'facebook', transition: { status: 'accepted' } },
      { platform: 'instagram', transition: { status: 'accepted' } },
      { platform: 'linkedin', transition: { status: 'accepted' } },
    ])
  })

  it('isolates confirmed, unknown and successful platform outcomes', async () => {
    const execute = vi.fn<PlatformPublicationExecutor>(async (snapshot) => {
      if (snapshot.platform === 'facebook') {
        return {
          changed: true,
          event: 'failed',
          lastErrorCode: 'permission_required',
          retryable: false,
          status: 'failed',
        }
      }
      if (snapshot.platform === 'instagram') throw new Error('unproven adapter boundary')
      return {
        changed: true,
        event: 'accepted',
        externalPublicationId: 'urn:li:share:123456789',
        status: 'accepted',
      }
    })

    await expect(
      executeMultiPlatformPublication({ execute, snapshots: snapshots() }),
    ).resolves.toMatchObject([
      {
        platform: 'facebook',
        transition: { lastErrorCode: 'permission_required', status: 'failed' },
      },
      {
        platform: 'instagram',
        transition: {
          lastErrorCode: 'delivery_unknown',
          retryable: false,
          status: 'delivery_unknown',
        },
      },
      { platform: 'linkedin', transition: { status: 'accepted' } },
    ])
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('treats every thrown error as unknown without retrying or failing siblings', async () => {
    const execute = vi.fn<PlatformPublicationExecutor>(async (snapshot) => {
      if (snapshot.platform === 'instagram') throw new Error('claimed pre-I/O by unsafe executor')
      return {
        changed: true,
        event: 'accepted',
        externalPublicationId: `${snapshot.platform}-post`,
        status: 'accepted',
      }
    })
    const results = await executeMultiPlatformPublication({
      execute,
      snapshots: snapshots(),
    })
    expect(results).toMatchObject([
      { platform: 'facebook', transition: { status: 'accepted' } },
      {
        platform: 'instagram',
        transition: {
          changed: true,
          lastErrorCode: 'delivery_unknown',
          retryable: false,
          status: 'delivery_unknown',
        },
      },
      { platform: 'linkedin', transition: { status: 'accepted' } },
    ])
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('does not invoke any executor for terminal persisted platform results', async () => {
    const terminalSnapshots = snapshots().map((snapshot) => ({
      ...snapshot,
      status:
        snapshot.platform === 'facebook'
          ? ('published' as const)
          : snapshot.platform === 'instagram'
            ? ('delivery_unknown' as const)
            : ('failed' as const),
      ...(snapshot.platform === 'facebook' ? { externalPublicationId: 'facebook-post' } : {}),
    }))
    const execute = vi.fn<PlatformPublicationExecutor>()
    await expect(
      executeMultiPlatformPublication({ execute, snapshots: terminalSnapshots }),
    ).resolves.toMatchObject([
      {
        platform: 'facebook',
        transition: {
          changed: false,
          externalPublicationId: 'facebook-post',
          status: 'published',
        },
      },
      { platform: 'instagram', transition: { changed: false, status: 'delivery_unknown' } },
      { platform: 'linkedin', transition: { changed: false, status: 'failed' } },
    ])
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails only the malformed executor result as delivery_unknown', async () => {
    const execute = vi.fn<PlatformPublicationExecutor>(async (snapshot) =>
      snapshot.platform === 'facebook'
        ? ({ changed: true, status: 'not-a-state' } as never)
        : {
            changed: true,
            event: 'accepted',
            externalPublicationId: `${snapshot.platform}-post`,
            status: 'accepted',
          },
    )
    const results = await executeMultiPlatformPublication({
      execute,
      snapshots: snapshots(),
    })
    expect(results[0]).toMatchObject({
      platform: 'facebook',
      transition: { retryable: false, status: 'delivery_unknown' },
    })
    expect(results[1]?.transition.status).toBe('accepted')
    expect(results[2]?.transition.status).toBe('accepted')
  })

  it.each(['accepted', 'publishing', 'published'] as const)(
    'fails only an active %s result without a provider ID as delivery_unknown',
    async (status) => {
      const execute = vi.fn<PlatformPublicationExecutor>(async (snapshot) =>
        snapshot.platform === 'facebook'
          ? { changed: true, status }
          : {
              changed: true,
              externalPublicationId: `${snapshot.platform}-post`,
              status: 'accepted',
            },
      )
      const results = await executeMultiPlatformPublication({
        execute,
        snapshots: snapshots(),
      })
      expect(results[0]).toMatchObject({
        platform: 'facebook',
        transition: {
          lastErrorCode: 'delivery_unknown',
          retryable: false,
          status: 'delivery_unknown',
        },
      })
      expect(results[1]?.transition.status).toBe('accepted')
      expect(results[2]?.transition.status).toBe('accepted')
    },
  )

  it('preserves a valid provider ID when a malformed unknown result is normalized', async () => {
    const execute = vi.fn<PlatformPublicationExecutor>(async (snapshot) =>
      snapshot.platform === 'facebook'
        ? ({
            changed: true,
            externalPublicationId: 'facebook-provider-id',
            retryable: true,
            status: 'delivery_unknown',
          } as never)
        : {
            changed: true,
            externalPublicationId: `${snapshot.platform}-post`,
            status: 'accepted',
          },
    )
    const results = await executeMultiPlatformPublication({ execute, snapshots: snapshots() })
    expect(results[0]).toMatchObject({
      transition: {
        externalPublicationId: 'facebook-provider-id',
        retryable: false,
        status: 'delivery_unknown',
      },
    })
  })
})
