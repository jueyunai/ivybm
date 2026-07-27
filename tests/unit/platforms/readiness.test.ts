import { describe, expect, it } from 'vitest'

import {
  assessPlatformAccountReadiness,
  derivePlatformConnectionKey,
} from '@/modules/platforms/readiness'

describe('platform account readiness', () => {
  it('reports a Meta Page ready for a controlled inbound test without claiming production availability', () => {
    const result = assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured: true,
        accessTokenReadable: true,
        accountKind: 'facebook-page',
        authorizationState: 'connected',
        capabilityApprovals: { messagingInbound: 'pending' },
        externalAccountId: 'page-123',
        refreshTokenConfigured: false,
        refreshTokenReadable: false,
      },
      environment: {
        META_WEBHOOK_ALLOWED_ACCOUNT_IDS: 'other-page, page-123 ',
        META_WEBHOOK_APP_SECRET: 'do-not-return-this-secret',
        META_WEBHOOK_VERIFY_TOKEN: 'do-not-return-this-token',
      },
    })

    expect(result.connection).toEqual({ missing: [], status: 'ready-for-controlled-test' })
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'messaging-inbound',
          implementation: 'implemented',
          productionRequirements: ['approval'],
          status: 'ready-for-controlled-test',
        }),
        expect.objectContaining({
          capability: 'publishing',
          implementation: 'blocked',
          reasonCode: 'publishing_job_adapter_pending',
          status: 'blocked',
        }),
      ]),
    )
    expect(JSON.stringify(result)).not.toContain('do-not-return-this-secret')
    expect(JSON.stringify(result)).not.toContain('do-not-return-this-token')
  })

  it('identifies only missing configuration for a Meta account that has not been authorized yet', () => {
    const result = assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured: false,
        accessTokenReadable: false,
        accountKind: 'instagram-professional',
        authorizationState: 'not_started',
        refreshTokenConfigured: false,
        refreshTokenReadable: false,
      },
      environment: {},
    })

    expect(result.connection).toEqual({
      missing: ['external_account_id', 'authorization', 'access_token'],
      status: 'action-required',
    })
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'messaging-inbound',
          missing: expect.arrayContaining([
            'external_account_id',
            'authorization',
            'access_token',
            'meta_app_secret',
            'meta_verify_token',
            'meta_account_allowlist',
          ]),
          status: 'action-required',
        }),
      ]),
    )
  })

  it('does not report an undecryptable configured credential as connection-ready', () => {
    const result = assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured: true,
        accessTokenReadable: false,
        accountKind: 'facebook-page',
        authorizationState: 'connected',
        capabilityApprovals: { messagingInbound: 'pending' },
        externalAccountId: 'page-123',
        refreshTokenConfigured: true,
        refreshTokenReadable: false,
      },
      environment: {
        META_WEBHOOK_ALLOWED_ACCOUNT_IDS: 'page-123',
        META_WEBHOOK_APP_SECRET: 'do-not-return-this-secret',
        META_WEBHOOK_VERIFY_TOKEN: 'do-not-return-this-token',
      },
    })

    expect(result.connection).toEqual({
      missing: ['credential_decryption', 'refresh_token_decryption'],
      status: 'action-required',
    })
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'messaging-inbound',
          missing: ['credential_decryption', 'refresh_token_decryption'],
          status: 'action-required',
        }),
      ]),
    )
    expect(JSON.stringify(result)).not.toContain('do-not-return-this-secret')
    expect(JSON.stringify(result)).not.toContain('do-not-return-this-token')
  })

  it('does not pretend TikTok DM is implemented before the official schema and eligibility exist', () => {
    const result = assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured: true,
        accessTokenReadable: true,
        accountKind: 'tiktok-business',
        authorizationState: 'connected',
        externalAccountId: 'tiktok-business-1',
        refreshTokenConfigured: false,
        refreshTokenReadable: false,
      },
      environment: {},
    })

    expect(result.capabilities).toEqual([
      expect.objectContaining({
        capability: 'messaging-inbound',
        implementation: 'blocked',
        missing: expect.arrayContaining(['official_tiktok_dm_schema', 'tiktok_dm_api_eligibility']),
        reasonCode: 'official_tiktok_dm_schema_unavailable',
        status: 'blocked',
      }),
    ])
  })

  it('keeps an explicitly blocked Meta capability blocked even when connection checks pass', () => {
    const result = assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured: true,
        accessTokenReadable: true,
        accountKind: 'facebook-page',
        authorizationState: 'connected',
        capabilityApprovals: { messagingInbound: 'blocked' },
        externalAccountId: 'page-123',
        refreshTokenConfigured: false,
        refreshTokenReadable: false,
      },
      environment: {
        META_WEBHOOK_ALLOWED_ACCOUNT_IDS: 'page-123',
        META_WEBHOOK_APP_SECRET: 'fixture-app-secret',
        META_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token',
      },
    })

    expect(result.connection).toEqual({ missing: [], status: 'ready-for-controlled-test' })
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'messaging-inbound',
          implementation: 'implemented',
          missing: ['approval'],
          reasonCode: 'platform_capability_blocked',
          status: 'blocked',
        }),
      ]),
    )
  })

  it('reports expired access tokens and unreadable refresh tokens without exposing credentials', () => {
    const expired = assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured: true,
        accessTokenExpiresAt: '2026-07-25T00:00:00.000Z',
        accessTokenReadable: true,
        accountKind: 'facebook-page',
        authorizationState: 'connected',
        externalAccountId: 'page-123',
        refreshTokenConfigured: false,
        refreshTokenReadable: false,
      },
      environment: {
        META_WEBHOOK_ALLOWED_ACCOUNT_IDS: 'page-123',
        META_WEBHOOK_APP_SECRET: 'fixture-app-secret',
        META_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token',
      },
      nowMilliseconds: Date.parse('2026-07-26T00:00:00.000Z'),
    })
    expect(expired.connection).toEqual({
      missing: ['access_token_expired', 'refresh_token'],
      status: 'action-required',
    })

    const unreadableRefresh = assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured: true,
        accessTokenExpiresAt: '2026-07-27T00:00:00.000Z',
        accessTokenReadable: true,
        accountKind: 'facebook-page',
        authorizationState: 'connected',
        externalAccountId: 'page-123',
        refreshTokenConfigured: true,
        refreshTokenReadable: false,
      },
      environment: {
        META_WEBHOOK_ALLOWED_ACCOUNT_IDS: 'page-123',
        META_WEBHOOK_APP_SECRET: 'fixture-app-secret',
        META_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token',
      },
      nowMilliseconds: Date.parse('2026-07-26T00:00:00.000Z'),
    })
    expect(unreadableRefresh.connection).toEqual({
      missing: ['refresh_token_decryption'],
      status: 'action-required',
    })
  })

  it.each(['2026-07-26T00:00:00.000Z', 'not-a-valid-date'])(
    'fails closed when the access-token expiry is %s',
    (accessTokenExpiresAt) => {
      const result = assessPlatformAccountReadiness({
        account: {
          accessTokenConfigured: true,
          accessTokenExpiresAt,
          accessTokenReadable: true,
          accountKind: 'facebook-page',
          authorizationState: 'connected',
          externalAccountId: 'page-123',
          refreshTokenConfigured: false,
          refreshTokenReadable: false,
        },
        environment: {
          META_WEBHOOK_ALLOWED_ACCOUNT_IDS: 'page-123',
          META_WEBHOOK_APP_SECRET: 'fixture-app-secret',
          META_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token',
        },
        nowMilliseconds: Date.parse('2026-07-26T00:00:00.000Z'),
      })

      expect(result.connection).toEqual({
        missing: ['access_token_expired', 'refresh_token'],
        status: 'action-required',
      })
    },
  )

  it('creates a stable account identity only after an external account is known', () => {
    expect(derivePlatformConnectionKey('linkedin-organization', ' organization:123 ')).toBe(
      'linkedin-organization:organization:123',
    )
    expect(derivePlatformConnectionKey('linkedin-organization', undefined)).toBeUndefined()
    expect(derivePlatformConnectionKey('linkedin-organization', '   ')).toBeUndefined()
  })
})
