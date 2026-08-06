import { describe, expect, it, vi } from 'vitest'

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
      authorizationRevision: '2026-07-31T00:00:00.000Z',
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
      authorizationRevision: '2026-07-31T00:00:00.000Z',
      externalAccountId: '987654321098765',
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
        new Response(
          JSON.stringify({ access_token: 'short-user-token', user_id: 987654321098765 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'long-user-token',
            expires_in: 5_184_000,
            token_type: 'bearer',
          }),
          { status: 200 },
        ),
      )

    await expect(
      exchangeInstagramAuthorizationCode({
        code: 'authorization-code',
        config: readInstagramOAuthConfiguration(environment),
        fetcher,
        nowMilliseconds: 1_000,
      }),
    ).resolves.toEqual({
      accessToken: 'long-user-token',
      expiresAt: new Date(5_184_001_000).toISOString(),
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
    const grantedScopes = [
      ...requiredInstagramPermissions('instagram-professional'),
      'instagram_business_content_publish',
    ]
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: grantedScopes.map((permission) => ({
              permission,
              status: 'granted',
            })),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            account_type: 'BUSINESS',
            id: '987654321098765',
            username: 'ivymetalglass',
          }),
          { status: 200 },
        ),
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
      scopes: grantedScopes,
    })
  })

  it('fails closed on personal accounts, identity mismatch, and provider errors', async () => {
    const missingPermissionFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ permission: 'instagram_business_basic', status: 'granted' }],
        }),
        { status: 200 },
      ),
    )
    await expect(
      resolveInstagramAuthorizedAccount({
        externalAccountId: '987654321098765',
        fetcher: missingPermissionFetcher,
        userAccessToken: 'long-user-token',
      }),
    ).rejects.toMatchObject({ code: 'required_permission_missing' })
    expect(missingPermissionFetcher).toHaveBeenCalledTimes(1)

    await expect(
      resolveInstagramAuthorizedAccount({
        externalAccountId: '987654321098765',
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                data: requiredInstagramPermissions('instagram-professional').map((permission) => ({
                  permission,
                  status: 'granted',
                })),
              }),
              { status: 200 },
            ),
          )
          .mockResolvedValueOnce(
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
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                data: requiredInstagramPermissions('instagram-professional').map((permission) => ({
                  permission,
                  status: 'granted',
                })),
              }),
              { status: 200 },
            ),
          )
          .mockResolvedValueOnce(
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
      message: 'Instagram OAuth token exchange failed',
    })
  })
})
