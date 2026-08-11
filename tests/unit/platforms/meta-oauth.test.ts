import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  META_OAUTH_CALLBACK_PATH,
  MetaOAuthError,
  buildMetaAuthorizationURL,
  createMetaOAuthTransaction,
  exchangeMetaAuthorizationCode,
  readMetaOAuthConfiguration,
  requiredMetaPermissions,
  resolveMetaAuthorizedAccount,
  verifyMetaOAuthTransaction,
} from '@/modules/platforms/meta/oauth'

const environment = {
  META_APP_ID: '1111111111111111',
  META_LOGIN_CONFIG_ID: 'test-business-login-config',
  META_OAUTH_REDIRECT_URI: `http://localhost:3000${META_OAUTH_CALLBACK_PATH}`,
  META_WEBHOOK_APP_SECRET: 'test-meta-app-secret',
  PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
}

describe('Meta OAuth', () => {
  it('requires a complete server-only configuration and an exact trusted callback', () => {
    expect(readMetaOAuthConfiguration(environment)).toEqual({
      appId: '1111111111111111',
      appSecret: 'test-meta-app-secret',
      loginConfigId: 'test-business-login-config',
      redirectUri: `http://localhost:3000${META_OAUTH_CALLBACK_PATH}`,
    })

    expect(() =>
      readMetaOAuthConfiguration({ ...environment, META_WEBHOOK_APP_SECRET: '' }),
    ).toThrowError(MetaOAuthError)
    expect(() =>
      readMetaOAuthConfiguration({
        ...environment,
        META_OAUTH_REDIRECT_URI: `https://untrusted.example${META_OAUTH_CALLBACK_PATH}`,
        NEXT_PUBLIC_SERVER_URL: 'https://ivybm.com',
      }),
    ).toThrowError(MetaOAuthError)
    expect(
      readMetaOAuthConfiguration({
        ...environment,
        META_OAUTH_REDIRECT_URI: `https://ivybm.com${META_OAUTH_CALLBACK_PATH}`,
        NEXT_PUBLIC_SERVER_URL: 'https://ivybm.com',
      }).redirectUri,
    ).toBe(`https://ivybm.com${META_OAUTH_CALLBACK_PATH}`)
  })

  it('requires only the permissions present in the Facebook Business Login configuration', () => {
    expect(requiredMetaPermissions('facebook-page')).toEqual([
      'pages_show_list',
      'pages_manage_metadata',
      'pages_messaging',
      'pages_read_engagement',
    ])
  })

  it('encrypts and verifies a short-lived account-bound transaction', () => {
    const issued = createMetaOAuthTransaction({
      accountId: 42,
      accountKind: 'facebook-page',
      authorizationRevision: 7,
      environment,
      externalAccountId: '123456789012345',
      nowMilliseconds: 1_000,
    })

    expect(issued.cookieValue).not.toContain('"accountId":"42"')
    expect(issued.cookieValue).not.toContain(issued.state)
    expect(
      verifyMetaOAuthTransaction({
        cookieValue: issued.cookieValue,
        environment,
        nowMilliseconds: 2_000,
        returnedState: issued.state,
      }),
    ).toMatchObject({
      accountId: '42',
      accountKind: 'facebook-page',
      authorizationRevision: 7,
      externalAccountId: '123456789012345',
      state: issued.state,
    })

    expect(() =>
      verifyMetaOAuthTransaction({
        cookieValue: issued.cookieValue,
        environment,
        nowMilliseconds: 601_000,
        returnedState: issued.state,
      }),
    ).toThrowError(MetaOAuthError)
  })

  it('builds Facebook Login for Business authorization without exposing the secret', () => {
    const url = buildMetaAuthorizationURL({
      config: readMetaOAuthConfiguration(environment),
      state: 's'.repeat(43),
    })

    expect(url.origin).toBe('https://www.facebook.com')
    expect(url.pathname).toMatch(/^\/v[0-9]+\.[0-9]+\/dialog\/oauth$/)
    expect(url.searchParams.get('client_id')).toBe(environment.META_APP_ID)
    expect(url.searchParams.get('config_id')).toBe(environment.META_LOGIN_CONFIG_ID)
    expect(url.searchParams.get('redirect_uri')).toBe(environment.META_OAUTH_REDIRECT_URI)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('s'.repeat(43))
    expect(url.toString()).not.toContain('test-meta-app-secret')
  })

  it('exchanges a callback code for a long-lived user token without putting secrets in URLs', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-user-token', token_type: 'bearer' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long-user-token', expires_in: '5184000' }), {
          status: 200,
        }),
      )

    await expect(
      exchangeMetaAuthorizationCode({
        code: 'authorization-code',
        config: readMetaOAuthConfiguration(environment),
        fetcher,
        nowMilliseconds: 1_000,
      }),
    ).resolves.toEqual({
      accessToken: 'long-user-token',
      expiresAt: new Date(5_184_001_000).toISOString(),
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toContain('test-meta-app-secret')
      expect(init).toMatchObject({ method: 'POST' })
      expect(new URLSearchParams(String(init?.body)).get('client_secret')).toBe(
        'test-meta-app-secret',
      )
    }
  })

  it('rejects a long-lived token response without a bounded expiry and reports only safe shape', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-user-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'long-user-token', expires_in: 'not-a-number' }),
          { status: 200 },
        ),
      )

    const result = exchangeMetaAuthorizationCode({
      code: 'authorization-code',
      config: readMetaOAuthConfiguration(environment),
      fetcher,
      nowMilliseconds: 1_000,
    })

    await expect(result).rejects.toMatchObject({
      code: 'token_response_invalid',
      diagnostic: {
        providerResponseKeys: ['access_token', 'expires_in'],
        providerStatus: 200,
        stage: 'token_exchange_long',
      },
    })
  })

  it('reports whether a provider network failure happened during short or long token exchange', async () => {
    const shortFailure = exchangeMetaAuthorizationCode({
      code: 'authorization-code',
      config: readMetaOAuthConfiguration(environment),
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('short exchange timed out')),
    })

    await expect(shortFailure).rejects.toMatchObject({
      code: 'token_exchange_failed',
      diagnostic: { stage: 'token_exchange_short' },
    })

    const longFailure = exchangeMetaAuthorizationCode({
      code: 'authorization-code',
      config: readMetaOAuthConfiguration(environment),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'short-user-token' }), { status: 200 }),
        )
        .mockRejectedValueOnce(new Error('long exchange timed out')),
    })

    await expect(longFailure).rejects.toMatchObject({
      code: 'token_exchange_failed',
      diagnostic: { stage: 'token_exchange_long' },
    })
  })

  it('binds the Page token to the configured Facebook Page and granted permissions', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: requiredMetaPermissions('facebook-page').map((permission) => ({
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
            data: [
              {
                access_token: 'page-access-token',
                id: '123456789012345',
                name: 'Foshan Ivy Building Material Co., Ltd.',
                tasks: ['CREATE_CONTENT', 'MESSAGING', 'MODERATE'],
              },
            ],
          }),
          { status: 200 },
        ),
      )

    await expect(
      resolveMetaAuthorizedAccount({
        accountKind: 'facebook-page',
        appSecret: 'test-meta-app-secret',
        externalAccountId: '123456789012345',
        fetcher,
        userAccessToken: 'long-user-token',
      }),
    ).resolves.toEqual({
      accessToken: 'page-access-token',
      displayName: 'Foshan Ivy Building Material Co., Ltd.',
      pageId: '123456789012345',
      scopes: requiredMetaPermissions('facebook-page'),
    })
  })

  it('resolves the exact configured Page when Meta omits it from /me/accounts', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: requiredMetaPermissions('facebook-page').map((permission) => ({
              permission,
              status: 'granted',
            })),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'direct-page-access-token',
            id: '123456789012345',
            name: 'Foshan Ivy Building Material Co., Ltd.',
            tasks: ['CREATE_CONTENT', 'MESSAGING', 'MODERATE'],
          }),
          { status: 200 },
        ),
      )

    await expect(
      resolveMetaAuthorizedAccount({
        accountKind: 'facebook-page',
        appSecret: 'test-meta-app-secret',
        externalAccountId: '123456789012345',
        fetcher,
        userAccessToken: 'long-user-token',
      }),
    ).resolves.toEqual({
      accessToken: 'direct-page-access-token',
      displayName: 'Foshan Ivy Building Material Co., Ltd.',
      pageId: '123456789012345',
      scopes: requiredMetaPermissions('facebook-page'),
    })

    const [directURL, directRequest] = fetcher.mock.calls[2]
    expect(String(directURL)).not.toContain('long-user-token')
    expect(new URL(String(directURL)).pathname).toBe('/v25.0/123456789012345')
    expect(new URL(String(directURL)).searchParams.get('fields')).toBe('id,name,access_token,tasks')
    expect(new URL(String(directURL)).searchParams.get('appsecret_proof')).toBe(
      createHmac('sha256', 'test-meta-app-secret').update('long-user-token').digest('hex'),
    )
    expect(directRequest?.headers).toMatchObject({
      authorization: 'Bearer long-user-token',
    })
  })

  it('keeps only bounded diagnostics when the direct Page lookup is rejected', async () => {
    const providerMessage = 'provider failure containing long-user-token and test-meta-app-secret'
    const oversizedProviderKey = `x${'y'.repeat(199_999)}`
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: requiredMetaPermissions('facebook-page').map((permission) => ({
              permission,
              status: 'granted',
            })),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            [oversizedProviderKey]: 'provider-controlled value',
            error: {
              code: 200,
              error_subcode: 2018065,
              message: providerMessage,
              type: 'long-user-token',
            },
          }),
          { status: 403 },
        ),
      )

    const error = await resolveMetaAuthorizedAccount({
      accountKind: 'facebook-page',
      appSecret: 'test-meta-app-secret',
      externalAccountId: '123456789012345',
      fetcher,
      userAccessToken: 'long-user-token',
    }).catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      code: 'identity_verification_failed',
      diagnostic: {
        providerErrorCode: 200,
        providerErrorSubcode: 2018065,
        providerResponseKeys: ['error'],
        providerStatus: 403,
        returnedPageIds: [],
        stage: 'page_direct',
        targetPageId: '123456789012345',
      },
    })
    expect(error).not.toHaveProperty('diagnostic.providerErrorType')
    const serialized = JSON.stringify(error)
    expect(serialized).not.toContain(providerMessage)
    expect(serialized).not.toContain('long-user-token')
    expect(serialized).not.toContain('test-meta-app-secret')
    expect(serialized).not.toContain(oversizedProviderKey)
  })

  it('fails closed on missing scopes, identity mismatch, and provider errors', async () => {
    const oversizedPermission = `pages_${'x'.repeat(199_994)}`
    const missingPermissionError = await resolveMetaAuthorizedAccount({
      accountKind: 'facebook-page',
      appSecret: 'test-meta-app-secret',
      externalAccountId: '123456789012345',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { permission: 'pages_show_list', status: 'granted' },
              { permission: oversizedPermission, status: 'granted' },
            ],
          }),
          { status: 200 },
        ),
      ),
      userAccessToken: 'long-user-token',
    }).catch((reason: unknown) => reason)

    expect(missingPermissionError).toMatchObject({
      code: 'required_permission_missing',
      diagnostic: {
        grantedScopes: ['pages_show_list'],
        missingScopes: ['pages_manage_metadata', 'pages_messaging', 'pages_read_engagement'],
        providerStatus: 200,
        stage: 'permissions',
      },
    })
    expect(JSON.stringify(missingPermissionError)).not.toContain(oversizedPermission)

    const identityFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: requiredMetaPermissions('facebook-page').map((permission) => ({
              permission,
              status: 'granted',
            })),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'different-page-token',
            id: '999999999999999',
            name: 'Different Page',
          }),
          { status: 200 },
        ),
      )
    await expect(
      resolveMetaAuthorizedAccount({
        accountKind: 'facebook-page',
        appSecret: 'test-meta-app-secret',
        externalAccountId: '123456789012345',
        fetcher: identityFetcher,
        userAccessToken: 'long-user-token',
      }),
    ).rejects.toMatchObject({ code: 'identity_mismatch' })

    const missingPageTokenFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: requiredMetaPermissions('facebook-page').map((permission) => ({
              permission,
              status: 'granted',
            })),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: '123456789012345', name: 'Page without a token' }), {
          status: 200,
        }),
      )
    await expect(
      resolveMetaAuthorizedAccount({
        accountKind: 'facebook-page',
        appSecret: 'test-meta-app-secret',
        externalAccountId: '123456789012345',
        fetcher: missingPageTokenFetcher,
        userAccessToken: 'long-user-token',
      }),
    ).rejects.toMatchObject({
      code: 'identity_verification_failed',
      diagnostic: {
        returnedPageIds: ['123456789012345'],
        stage: 'page_direct',
        targetPageId: '123456789012345',
      },
    })

    const secretBearingBody = 'provider failure with test-meta-app-secret and long-user-token'
    await expect(
      exchangeMetaAuthorizationCode({
        code: 'authorization-code',
        config: readMetaOAuthConfiguration(environment),
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(secretBearingBody, { status: 401 })),
      }),
    ).rejects.toMatchObject({
      code: 'token_exchange_failed',
      message: 'Meta OAuth token exchange failed',
    })
  })
})
