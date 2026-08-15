import { describe, expect, it } from 'vitest'

import {
  PORTAL_SUPPORTED_ACCOUNT_KINDS,
  isPortalSupportedAccountKind,
  isValidPortalExternalAccountId,
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
    const externalAccountIds = {
      'facebook-page': '123456789',
      'instagram-professional': '987654321',
      'linkedin-member': 'opaque_ABC-123',
      'linkedin-organization': '123456789',
    } as const
    for (const accountKind of PORTAL_SUPPORTED_ACCOUNT_KINDS) {
      expect(
        validateCreatePlatformAccountInput({
          accountKind,
          externalAccountId: externalAccountIds[accountKind],
          name: 'New Account',
          notes: 'notes',
        }),
      ).toEqual({
        success: true,
        value: {
          accountKind,
          externalAccountId: externalAccountIds[accountKind],
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
        externalAccountId: 123456789,
        name: 'Numeric JSON ID',
      }),
    ).toEqual({ error: { code: 'invalid_external_account_id' }, success: false })
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

  it('validates provider-specific external account identifiers', () => {
    expect(isValidPortalExternalAccountId('facebook-page', '123456789')).toBe(true)
    expect(isValidPortalExternalAccountId('instagram-professional', '987654321')).toBe(true)
    expect(isValidPortalExternalAccountId('linkedin-member', 'opaque_ABC-123')).toBe(true)
    expect(isValidPortalExternalAccountId('linkedin-organization', '123456789')).toBe(true)

    for (const invalid of [
      'https://provider.example/account/123',
      '123/456',
      '123\u0000',
      '账号123',
      '123 456',
    ]) {
      expect(isValidPortalExternalAccountId('facebook-page', invalid)).toBe(false)
    }
    expect(isValidPortalExternalAccountId('facebook-page', 'page-123')).toBe(false)
    expect(isValidPortalExternalAccountId('linkedin-organization', 'org-123')).toBe(false)
    expect(isValidPortalExternalAccountId('linkedin-member', 'x'.repeat(129))).toBe(false)

    expect(
      validateCreatePlatformAccountInput({
        accountKind: 'facebook-page',
        externalAccountId: ' 123456789 ',
        name: 'Trimmed Meta ID',
      }),
    ).toMatchObject({
      success: true,
      value: { externalAccountId: '123456789' },
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
        messagingInbound: undefined,
        name: 'Updated',
        notes: null,
        publishing: undefined,
      },
    })

    expect(
      validateUpdatePlatformAccountInput({
        authorizationRevision: 3,
        messagingInbound: 'approved',
        publishing: 'pending',
      }),
    ).toEqual({
      success: true,
      value: {
        authorizationRevision: 3,
        externalAccountId: undefined,
        messagingInbound: 'approved',
        name: undefined,
        notes: undefined,
        publishing: 'pending',
      },
    })

    expect(validateUpdatePlatformAccountInput({ name: 'Only name' })).toEqual({
      error: { code: 'invalid_authorization_revision' },
      success: false,
    })
    expect(
      validateUpdatePlatformAccountInput({
        authorizationRevision: 3,
        externalAccountId: { id: '123456789' },
      }),
    ).toEqual({ error: { code: 'invalid_external_account_id' }, success: false })
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
      validateUpdatePlatformAccountInput({
        authorizationRevision: 3,
        messagingInbound: 'approved',
      }),
    ).toEqual({ error: { code: 'invalid_capabilities' }, success: false })
    expect(
      validateUpdatePlatformAccountInput({
        authorizationRevision: 3,
        messagingInbound: 'approved',
        publishing: 'available',
      }),
    ).toEqual({ error: { code: 'invalid_capabilities' }, success: false })
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
