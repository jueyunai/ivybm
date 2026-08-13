import { describe, expect, it, vi } from 'vitest'

import { PayloadPublishingAccountResolver } from '@/modules/platforms/publishingAccountResolver'

const ready = (overrides: Record<string, unknown> = {}) => ({
  accountKind: 'facebook-page',
  authorization: {
    accessTokenConfigured: true,
    expiresAt: '2026-08-13T00:00:00.000Z',
    state: 'connected',
  },
  authorizationRevision: 4,
  capabilities: { publishing: 'approved' },
  externalAccountId: '129472283584550',
  id: 7,
  platformFamily: 'meta',
  ...overrides,
})

const payloadWith = (docs: unknown[]) => ({ find: vi.fn().mockResolvedValue({ docs }) })

describe('credential-free publishing account resolver', () => {
  it.each([
    ['facebook', ready(), 'facebook-page'],
    [
      'instagram',
      ready({
        accountKind: 'instagram-professional',
        externalAccountId: '1789000012345678',
      }),
      'instagram-professional',
    ],
    [
      'linkedin',
      ready({
        accountKind: 'linkedin-member',
        externalAccountId: 'AbC_123',
        platformFamily: 'linkedin',
      }),
      'linkedin-member',
    ],
    [
      'linkedin',
      ready({
        accountKind: 'linkedin-organization',
        externalAccountId: '971937765923229',
        platformFamily: 'linkedin',
      }),
      'linkedin-organization',
    ],
  ] as const)(
    'resolves one ready %s identity without selecting credentials',
    async (platform, doc, kind) => {
      const payload = payloadWith([doc])
      const resolver = new PayloadPublishingAccountResolver({
        now: () => Date.parse('2026-08-12T00:00:00.000Z'),
        payload: payload as never,
      })
      await expect(
        resolver.resolve({
          expectedAuthorizationRevision: 4,
          platform,
          platformAccountId: 7,
        }),
      ).resolves.toMatchObject({
        account: { accountKind: kind, authorizationRevision: 4, platform, platformAccountId: 7 },
        status: 'resolved',
      })
      expect(payload.find).toHaveBeenCalledWith({
        collection: 'platform-accounts',
        depth: 0,
        limit: 2,
        overrideAccess: true,
        pagination: false,
        select: {
          accountKind: true,
          authorization: {
            accessTokenConfigured: true,
            expiresAt: true,
            state: true,
          },
          authorizationRevision: true,
          capabilities: { publishing: true },
          externalAccountId: true,
          platformFamily: true,
        },
        where: { id: { equals: 7 } },
      })
      expect(JSON.stringify(payload.find.mock.calls)).not.toMatch(/accessToken["']\s*:\s*true/u)
      expect(JSON.stringify(payload.find.mock.calls)).not.toContain('refreshToken')
    },
  )

  it.each([
    ['missing account', [], 'account_not_found'],
    ['ambiguous account', [ready(), ready()], 'account_ambiguous'],
    [
      'wrong platform kind',
      [ready({ accountKind: 'linkedin-organization', platformFamily: 'linkedin' })],
      'account_platform_mismatch',
    ],
    ['missing external ID', [ready({ externalAccountId: null })], 'external_account_id_missing'],
    [
      'pending authorization',
      [ready({ authorization: { accessTokenConfigured: true, state: 'pending' } })],
      'authorization_not_connected',
    ],
    [
      'expired authorization state',
      [ready({ authorization: { accessTokenConfigured: true, state: 'expired' } })],
      'authorization_expired',
    ],
    [
      'missing token flag',
      [ready({ authorization: { accessTokenConfigured: false, state: 'connected' } })],
      'credential_not_configured',
    ],
    [
      'expired authorization',
      [
        ready({
          authorization: {
            accessTokenConfigured: true,
            expiresAt: '2026-08-11T00:00:00.000Z',
            state: 'connected',
          },
        }),
      ],
      'authorization_expired',
    ],
    [
      'pending capability',
      [ready({ capabilities: { publishing: 'pending' } })],
      'capability_not_approved',
    ],
  ] as const)('blocks %s fail closed', async (_label, docs, reason) => {
    const resolver = new PayloadPublishingAccountResolver({
      now: () => Date.parse('2026-08-12T00:00:00.000Z'),
      payload: payloadWith([...docs]) as never,
    })
    await expect(
      resolver.resolve({
        expectedAuthorizationRevision: 4,
        platform: 'facebook',
        platformAccountId: 7,
      }),
    ).resolves.toEqual({ reason, status: 'blocked' })
  })

  it('blocks a stale authorization revision before provider routing', async () => {
    const resolver = new PayloadPublishingAccountResolver({
      payload: payloadWith([ready({ authorizationRevision: 5 })]) as never,
    })
    await expect(
      resolver.resolve({
        expectedAuthorizationRevision: 4,
        platform: 'facebook',
        platformAccountId: 7,
      }),
    ).resolves.toEqual({ reason: 'stale_authorization_revision', status: 'blocked' })
  })

  it('rejects malformed internal IDs before querying Payload', async () => {
    const payload = payloadWith([])
    const resolver = new PayloadPublishingAccountResolver({ payload: payload as never })
    await expect(
      resolver.resolve({ platform: 'facebook', platformAccountId: '../accounts' }),
    ).resolves.toEqual({ reason: 'account_platform_mismatch', status: 'blocked' })
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('rejects zero-valued provider IDs even when the account is otherwise ready', async () => {
    const resolver = new PayloadPublishingAccountResolver({
      payload: payloadWith([ready({ externalAccountId: '0000' })]) as never,
    })
    await expect(resolver.resolve({ platform: 'facebook', platformAccountId: 7 })).resolves.toEqual(
      { reason: 'external_account_id_missing', status: 'blocked' },
    )
  })
})
