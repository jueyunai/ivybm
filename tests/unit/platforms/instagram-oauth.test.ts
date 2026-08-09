import { describe, expect, it, vi } from 'vitest'

import instagramOAuthFixture from '../../fixtures/platforms/instagram-oauth-success.json'

import {
  INSTAGRAM_OAUTH_CALLBACK_PATH,
  InstagramOAuthError,
  buildInstagramAuthorizationURL,
  createInstagramOAuthTransaction,
  exchangeInstagramAuthorizationCode,
  readInstagramOAuthConfiguration,
  requiredInstagramPermissions,
  resolveInstagramAuthorizedAccount,
  verifyInstagramOAuthTransaction,
} from '@/modules/platforms/instagram/oauth'

const environment = {
  INSTAGRAM_APP_ID: '1221206873460693',
  INSTAGRAM_APP_SECRET: 'test-instagram-app-secret',
  INSTAGRAM_OAUTH_REDIRECT_URI: `http://localhost:3000${INSTAGRAM_OAUTH_CALLBACK_PATH}`,
  PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
}

describe('Instagram OAuth', () => {
  it('requires a complete server-only configuration and an exact trusted callback', () => {
    expect(readInstagramOAuthConfiguration(environment)).toEqual({
      appId: '1221206873460693',
      appSecret: 'test-instagram-app-secret',
      redirectUri: `http://localhost:3000${INSTAGRAM_OAUTH_CALLBACK_PATH}`,
    })

    expect(() =>
      readInstagramOAuthConfiguration({ ...environment, INSTAGRAM_APP_SECRET: '' }),
    ).toThrowError(InstagramOAuthError)
    expect(() =>
      readInstagramOAuthConfiguration({
        ...environment,
        INSTAGRAM_OAUTH_REDIRECT_URI: `https://untrusted.example${INSTAGRAM_OAUTH_CALLBACK_PATH}`,
        NEXT_PUBLIC_SERVER_URL: 'https://ivybm.com',
      }),
    ).toThrowError(InstagramOAuthError)
    expect(
      readInstagramOAuthConfiguration({
        ...environment,
        INSTAGRAM_OAUTH_REDIRECT_URI: `https://ivybm.com${INSTAGRAM_OAUTH_CALLBACK_PATH}`,
        NEXT_PUBLIC_SERVER_URL: 'https://ivybm.com',
      }).redirectUri,
    ).toBe(`https://ivybm.com${INSTAGRAM_OAUTH_CALLBACK_PATH}`)
  })

  it('uses the permissions required for Instagram professional messaging and content', () => {
    expect(requiredInstagramPermissions('instagram-professional')).toEqual([
      'instagram_business_basic',
      'instagram_business_manage_comments',
      'instagram_business_manage_messages',
    ])
  })

  it('encrypts and verifies a short-lived account-bound transaction', () => {
    const issued = createInstagramOAuthTransaction({
      accountId: 42,
      accountKind: 'instagram-professional',
      authorizationRevision: 7,
      environment,
      externalAccountId: '987654321098765',
      nowMilliseconds: 1_000,
    })

    expect(issued.cookieValue).not.toContain('"accountId":"42"')
    expect(issued.cookieValue).not.toContain(issued.state)
    expect(
      verifyInstagramOAuthTransaction({
        cookieValue: issued.cookieValue,
        environment,
        nowMilliseconds: 2_000,
        returnedState: issued.state,
      }),
    ).toMatchObject({
      accountId: '42',
      accountKind: 'instagram-professional',
      authorizationRevision: 7,
      externalAccountId: '987654321098765',
      requestedScopes: requiredInstagramPermissions('instagram-professional'),
      state: issued.state,
    })

    expect(() =>
      verifyInstagramOAuthTransaction({
        cookieValue: issued.cookieValue,
        environment,
        nowMilliseconds: 601_000,
        returnedState: issued.state,
      }),
    ).toThrowError(InstagramOAuthError)
  })

  it('builds Instagram authorization without exposing the secret', () => {
    const url = buildInstagramAuthorizationURL({
      config: readInstagramOAuthConfiguration(environment),
      state: 's'.repeat(43),
    })

    expect(url.origin).toBe('https://www.instagram.com')
    expect(url.pathname).toBe('/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe(environment.INSTAGRAM_APP_ID)
    expect(url.searchParams.get('redirect_uri')).toBe(environment.INSTAGRAM_OAUTH_REDIRECT_URI)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe(
      requiredInstagramPermissions('instagram-professional').join(','),
    )
    expect(url.searchParams.get('state')).toBe('s'.repeat(43))
    expect(url.toString()).not.toContain('test-instagram-app-secret')
  })

  it('exchanges a callback code for a long-lived token without putting secrets in URLs', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(instagramOAuthFixture.responses.shortToken), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(instagramOAuthFixture.responses.longToken), { status: 200 }),
      )

    await expect(
      exchangeInstagramAuthorizationCode({
        code: 'authorization-code',
        config: readInstagramOAuthConfiguration(environment),
        fetcher,
        nowMilliseconds: 1_000,
      }),
    ).resolves.toEqual({
      accessToken: instagramOAuthFixture.responses.longToken.access_token,
      expiresAt: new Date(5_184_001_000).toISOString(),
      scopes: requiredInstagramPermissions('instagram-professional'),
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
    const [shortTokenCall, longTokenCall] = fetcher.mock.calls
    expect(String(shortTokenCall[0])).not.toContain('test-instagram-app-secret')
    expect(shortTokenCall[1]).toMatchObject({ method: 'POST' })
    expect(new URLSearchParams(String(shortTokenCall[1]?.body)).get('client_secret')).toBe(
      'test-instagram-app-secret',
    )
    // Instagram's long-lived token exchange is a GET and the provider requires
    // the client secret as a query parameter; this is their documented design.
    expect(String(longTokenCall[0])).toContain('client_secret=test-instagram-app-secret')
    expect(longTokenCall[1]).toMatchObject({ method: 'GET' })
  })

  it('binds the Instagram professional account by user id and username', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(instagramOAuthFixture.responses.profile), { status: 200 }),
      )

    await expect(
      resolveInstagramAuthorizedAccount({
        externalAccountId: '987654321098765',
        fetcher,
        userAccessToken: 'long-user-token',
      }),
    ).resolves.toEqual({
      accessToken: 'long-user-token',
      accountId: '987654321098765',
      displayName: '@ivymetalglass',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const requestURL = new URL(String(fetcher.mock.calls[0][0]))
    expect(requestURL.pathname).toBe('/v22.0/me')
    expect(requestURL.searchParams.get('fields')).toBe('id,username,account_type')
    expect(requestURL.pathname).not.toContain('permissions')
  })

  it('fails closed on personal accounts, identity mismatch, and provider errors', async () => {
    await expect(
      resolveInstagramAuthorizedAccount({
        externalAccountId: '987654321098765',
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              account_type: 'PERSONAL',
              id: '987654321098765',
              username: 'ivymetalglass',
            }),
            { status: 200 },
          ),
        ),
        userAccessToken: 'long-user-token',
      }),
    ).rejects.toMatchObject({ code: 'required_permission_missing' })

    await expect(
      resolveInstagramAuthorizedAccount({
        externalAccountId: '987654321098765',
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              account_type: 'BUSINESS',
              id: '111111111111111',
              username: 'other',
            }),
            { status: 200 },
          ),
        ),
        userAccessToken: 'long-user-token',
      }),
    ).rejects.toMatchObject({ code: 'identity_mismatch' })

    const secretBearingBody = 'provider failure with test-instagram-app-secret and long-user-token'
    await expect(
      exchangeInstagramAuthorizationCode({
        code: 'authorization-code',
        config: readInstagramOAuthConfiguration(environment),
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(secretBearingBody, { status: 401 })),
      }),
    ).rejects.toMatchObject({
      code: 'token_exchange_failed',
      diagnostic: {
        providerStatus: 401,
        stage: 'short_token_exchange',
      },
      message: 'Instagram OAuth token exchange failed',
    })
  })

  it('keeps only bounded diagnostics from secret-bearing provider failures', async () => {
    const shortTokenFailure = await exchangeInstagramAuthorizationCode({
      code: 'authorization-code',
      config: readInstagramOAuthConfiguration(environment),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'leaked-short-token',
            code: 400,
            error_message:
              'invalid code authorization-code test-instagram-app-secret leaked-short-token',
            error_type: 'OAuthException',
          }),
          { status: 401 },
        ),
      ),
    }).catch((error: unknown) => error)

    expect(shortTokenFailure).toMatchObject({
      code: 'token_exchange_failed',
      diagnostic: {
        providerErrorCode: 400,
        providerErrorType: 'OAuthException',
        providerResponseKeys: ['access_token', 'code', 'error_message', 'error_type'],
        providerStatus: 401,
        stage: 'short_token_exchange',
      },
    })
    expect(JSON.stringify(shortTokenFailure)).not.toContain('authorization-code')
    expect(JSON.stringify(shortTokenFailure)).not.toContain('test-instagram-app-secret')
    expect(JSON.stringify(shortTokenFailure)).not.toContain('leaked-short-token')

    const longTokenFailure = await exchangeInstagramAuthorizationCode({
      code: 'authorization-code',
      config: readInstagramOAuthConfiguration(environment),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(instagramOAuthFixture.responses.shortToken), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: 190,
                error_subcode: 463,
                message: 'expired long-user-token test-instagram-app-secret',
                type: 'OAuthException',
              },
            }),
            { status: 400 },
          ),
        ),
    }).catch((error: unknown) => error)

    expect(longTokenFailure).toMatchObject({
      code: 'token_exchange_failed',
      diagnostic: {
        providerErrorCode: 190,
        providerErrorSubcode: 463,
        providerErrorType: 'OAuthException',
        providerResponseKeys: [
          'error',
          'error.code',
          'error.error_subcode',
          'error.message',
          'error.type',
        ],
        providerStatus: 400,
        stage: 'long_token_exchange',
      },
    })
    expect(JSON.stringify(longTokenFailure)).not.toContain('long-user-token')
    expect(JSON.stringify(longTokenFailure)).not.toContain('test-instagram-app-secret')

    const invalidShortTokenShape = await exchangeInstagramAuthorizationCode({
      code: 'authorization-code',
      config: readInstagramOAuthConfiguration(environment),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'unexpected-flat-token', user_id: '987654321098765' }),
          { status: 200 },
        ),
      ),
    }).catch((error: unknown) => error)

    expect(invalidShortTokenShape).toMatchObject({
      code: 'token_response_invalid',
      diagnostic: {
        providerResponseKeys: ['access_token', 'user_id'],
        providerStatus: 200,
        stage: 'short_token_exchange',
      },
    })
    expect(JSON.stringify(invalidShortTokenShape)).not.toContain('unexpected-flat-token')

    const identityFailure = await resolveInstagramAuthorizedAccount({
      externalAccountId: '987654321098765',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 190,
              message: 'invalid long-user-token test-instagram-app-secret',
              type: 'OAuthException',
            },
          }),
          { status: 403 },
        ),
      ),
      userAccessToken: 'long-user-token',
    }).catch((error: unknown) => error)

    expect(identityFailure).toMatchObject({
      code: 'identity_verification_failed',
      diagnostic: {
        providerErrorCode: 190,
        providerErrorType: 'OAuthException',
        providerResponseKeys: ['error', 'error.code', 'error.message', 'error.type'],
        providerStatus: 403,
        stage: 'identity_profile',
      },
    })
    expect(JSON.stringify(identityFailure)).not.toContain('long-user-token')
    expect(JSON.stringify(identityFailure)).not.toContain('test-instagram-app-secret')
  })
})
