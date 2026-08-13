import { describe, expect, it } from 'vitest'

import {
  PORTAL_SUPPORTED_ACCOUNT_KINDS,
  isPortalSupportedAccountKind,
  toRedactedPlatformAccountSummary,
  validateCreatePlatformAccountInput,
  validateDeletePlatformAccountInput,
  validateDisconnectPlatformAccountInput,
  validateUpdatePlatformAccountInput,
} from '@/modules/platforms/accountPortalDto'

const account = {
  accountKind: 'facebook-page' as const,
  authorization: {
    accessToken: 'encrypted-access-token',
    accessTokenConfigured: true,
    appId: 'meta-app-id',
    expiresAt: '2026-08-20T00:00:00.000Z',
    refreshToken: 'encrypted-refresh-token',
    refreshTokenConfigured: false,
    scopes: [{ scope: 'pages_read_engagement' }, { scope: 'pages_manage_posts' }],
    state: 'connected' as const,
  },
  authorizationRevision: 5,
  capabilities: { messagingInbound: 'available' as const, publishing: 'available' as const },
  externalAccountId: '123456789012345',
  id: 42,
  name: 'Test Page',
  notes: 'Staging account',
  platformFamily: 'meta' as const,
}

describe('account portal DTO', () => {
  it('exposes only supported customer-facing account kinds', () => {
    expect(PORTAL_SUPPORTED_ACCOUNT_KINDS).toEqual([
      'facebook-page',
      'instagram-professional',
      'linkedin-member',
      'linkedin-organization',
    ])
    expect(isPortalSupportedAccountKind('facebook-page')).toBe(true)
    expect(isPortalSupportedAccountKind('tiktok-business')).toBe(false)
    expect(isPortalSupportedAccountKind(42)).toBe(false)
  })

  it('redacts credentials and tokens from a platform account', () => {
    const redacted = toRedactedPlatformAccountSummary(
      account as unknown as Parameters<typeof toRedactedPlatformAccountSummary>[0],
    )

    expect(redacted).toEqual({
      accountKind: 'facebook-page',
      authorization: {
        accessTokenConfigured: true,
        appId: 'meta-app-id',
        expiresAt: '2026-08-20T00:00:00.000Z',
        refreshTokenConfigured: false,
        scopes: [{ scope: 'pages_read_engagement' }, { scope: 'pages_manage_posts' }],
        state: 'connected',
      },
      authorizationRevision: 5,
      capabilities: { messagingInbound: 'available', publishing: 'available' },
      externalAccountId: '123456789012345',
      id: 42,
      name: 'Test Page',
      notes: 'Staging account',
      platformFamily: 'meta',
    })
    expect(redacted.authorization).not.toHaveProperty('accessToken')
    expect(redacted.authorization).not.toHaveProperty('refreshToken')
  })

  it('normalizes malformed scope arrays during redaction', () => {
    const malformed = {
      ...account,
      authorization: {
        ...account.authorization,
        scopes: [{ scope: 'valid' }, null, { notScope: 'x' }, 'raw-string', { scope: 7 }],
      },
    }

    const redacted = toRedactedPlatformAccountSummary(
      malformed as unknown as Parameters<typeof toRedactedPlatformAccountSummary>[0],
    )

    expect(redacted.authorization.scopes).toEqual([{ scope: 'valid' }])
  })

  it('validates create input for all supported kinds', () => {
    for (const accountKind of PORTAL_SUPPORTED_ACCOUNT_KINDS) {
      expect(
        validateCreatePlatformAccountInput({
          accountKind,
          externalAccountId: 'external-id',
          name: 'New Account',
          notes: 'notes',
        }),
      ).toEqual({
        success: true,
        value: {
          accountKind,
          externalAccountId: 'external-id',
          name: 'New Account',
          notes: 'notes',
        },
      })
    }

    expect(
      validateCreatePlatformAccountInput({ accountKind: 'tiktok-business', name: 'TikTok' }),
    ).toEqual({
      error: { code: 'unsupported_account_kind' },
      success: false,
    })
    expect(validateCreatePlatformAccountInput({ name: 'No Kind' })).toEqual({
      error: { code: 'unsupported_account_kind' },
      success: false,
    })
    expect(validateCreatePlatformAccountInput({ accountKind: 'facebook-page', name: '' })).toEqual({
      error: { code: 'invalid_name' },
      success: false,
    })
    expect(
      validateCreatePlatformAccountInput({ accountKind: 'facebook-page', name: 'x'.repeat(121) }),
    ).toEqual({
      error: { code: 'invalid_name' },
      success: false,
    })
    expect(
      validateCreatePlatformAccountInput({
        accountKind: 'facebook-page',
        externalAccountId: 'x'.repeat(241),
        name: 'Test',
      }),
    ).toEqual({
      error: { code: 'invalid_external_account_id' },
      success: false,
    })
    expect(
      validateCreatePlatformAccountInput({
        accountKind: 'facebook-page',
        name: 'Test',
        notes: 'x'.repeat(2001),
      }),
    ).toEqual({
      error: { code: 'invalid_notes' },
      success: false,
    })
  })

  it('validates update input with stale-write protection', () => {
    expect(
      validateUpdatePlatformAccountInput({
        authorizationRevision: 3,
        externalAccountId: 'new-id',
        name: 'Updated',
        notes: null,
      }),
    ).toEqual({
      success: true,
      value: {
        authorizationRevision: 3,
        externalAccountId: 'new-id',
        name: 'Updated',
        notes: null,
      },
    })

    expect(validateUpdatePlatformAccountInput({ name: 'Only name' })).toEqual({
      error: { code: 'invalid_authorization_revision' },
      success: false,
    })
    expect(
      validateUpdatePlatformAccountInput({ authorizationRevision: -1, name: 'Updated' }),
    ).toEqual({
      error: { code: 'invalid_authorization_revision' },
      success: false,
    })
    expect(validateUpdatePlatformAccountInput({ authorizationRevision: 3 })).toEqual({
      error: { code: 'no_changes' },
      success: false,
    })
    expect(
      validateUpdatePlatformAccountInput({ authorizationRevision: 3, name: 'x'.repeat(121) }),
    ).toEqual({
      error: { code: 'invalid_name' },
      success: false,
    })
    expect(validateUpdatePlatformAccountInput({ authorizationRevision: 3, name: '   ' })).toEqual({
      error: { code: 'invalid_name' },
      success: false,
    })
    expect(
      validateUpdatePlatformAccountInput({
        authorizationRevision: 3,
        externalAccountId: 'x'.repeat(241),
      }),
    ).toEqual({
      error: { code: 'invalid_external_account_id' },
      success: false,
    })
    expect(
      validateUpdatePlatformAccountInput({
        authorizationRevision: 3,
        notes: 'x'.repeat(2001),
      }),
    ).toEqual({
      error: { code: 'invalid_notes' },
      success: false,
    })
  })

  it('validates delete input with stale-write protection', () => {
    expect(validateDeletePlatformAccountInput({ authorizationRevision: 3 })).toEqual({
      success: true,
      value: { authorizationRevision: 3 },
    })

    expect(validateDeletePlatformAccountInput({})).toEqual({
      error: { code: 'invalid_authorization_revision' },
      success: false,
    })
    expect(validateDeletePlatformAccountInput({ authorizationRevision: -1 })).toEqual({
      error: { code: 'invalid_authorization_revision' },
      success: false,
    })
  })

  it('requires both account and authorization revision for disconnect', () => {
    expect(
      validateDisconnectPlatformAccountInput({ accountId: 42, authorizationRevision: 3 }),
    ).toEqual({
      success: true,
      value: { accountId: 42, authorizationRevision: 3 },
    })
    expect(validateDisconnectPlatformAccountInput({ accountId: 42 })).toEqual({
      error: { code: 'invalid_authorization_revision' },
      success: false,
    })
  })
})
