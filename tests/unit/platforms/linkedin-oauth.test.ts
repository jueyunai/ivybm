import { describe, expect, it, vi } from 'vitest'

import {
  LINKEDIN_OAUTH_CALLBACK_PATH,
  LinkedInOAuthError,
  buildLinkedInAuthorizationURL,
  createLinkedInOAuthTransaction,
  exchangeLinkedInAuthorizationCode,
  readLinkedInOAuthConfiguration,
  requiredLinkedInPermissions,
  resolveLinkedInAuthorizedAccount,
  verifyLinkedInOAuthTransaction,
} from '@/modules/platforms/linkedin/oauth'

const environment = {
  LINKEDIN_API_VERSION: '202506',
  LINKEDIN_APP_ID: 'linkedin-app-id',
  LINKEDIN_APP_SECRET: 'test-linkedin-app-secret',
  LINKEDIN_OAUTH_REDIRECT_URI: `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}`,
  PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
}

describe('LinkedIn OAuth', () => {
  it('requires a complete server-only configuration and an exact trusted callback', () => {
    expect(readLinkedInOAuthConfiguration(environment)).toEqual({
      apiVersion: '202506',
      appId: 'linkedin-app-id',
      appSecret: 'test-linkedin-app-secret',
      redirectUri: `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}`,
    })

    expect(() =>
      readLinkedInOAuthConfiguration({ ...environment, LINKEDIN_APP_SECRET: '' }),
    ).toThrowError(LinkedInOAuthError)
    expect(() =>
      readLinkedInOAuthConfiguration({
        ...environment,
        LINKEDIN_OAUTH_REDIRECT_URI: `https://untrusted.example${LINKEDIN_OAUTH_CALLBACK_PATH}`,
        NEXT_PUBLIC_SERVER_URL: 'https://ivybm.com',
      }),
    ).toThrowError(LinkedInOAuthError)
    expect(
      readLinkedInOAuthConfiguration({
        ...environment,
        LINKEDIN_OAUTH_REDIRECT_URI: `https://ivybm.com${LINKEDIN_OAUTH_CALLBACK_PATH}`,
        NEXT_PUBLIC_SERVER_URL: 'https://ivybm.com',
      }).redirectUri,
    ).toBe(`https://ivybm.com${LINKEDIN_OAUTH_CALLBACK_PATH}`)
  })

  it('uses the permissions required for member and organization publishing', () => {
    expect(requiredLinkedInPermissions('linkedin-member')).toEqual([
      'openid',
      'profile',
      'w_member_social',
    ])
    expect(requiredLinkedInPermissions('linkedin-organization')).toEqual([
      'r_organization_admin',
      'r_organization_social',
      'w_organization_social',
    ])
  })

  it('encrypts and verifies a short-lived account-bound transaction', () => {
    const issued = createLinkedInOAuthTransaction({
      accountId: 42,
      accountKind: 'linkedin-member',
      authorizationRevision: 7,
      environment,
      externalAccountId: 'abc-123',
      nowMilliseconds: 1_000,
    })

    expect(issued.cookieValue).not.toContain('"accountId":"42"')
    expect(issued.cookieValue).not.toContain(issued.state)
    expect(
      verifyLinkedInOAuthTransaction({
        cookieValue: issued.cookieValue,
        environment,
        nowMilliseconds: 2_000,
        returnedState: issued.state,
      }),
    ).toMatchObject({
      accountId: '42',
      accountKind: 'linkedin-member',
      authorizationRevision: 7,
      externalAccountId: 'abc-123',
      requestedScopes: requiredLinkedInPermissions('linkedin-member'),
      state: issued.state,
    })

    expect(() =>
      verifyLinkedInOAuthTransaction({
        cookieValue: issued.cookieValue,
        environment,
        nowMilliseconds: 601_000,
        returnedState: issued.state,
      }),
    ).toThrowError(LinkedInOAuthError)
  })

  it('rejects tampered or mismatched OAuth states in constant time', () => {
    const issued = createLinkedInOAuthTransaction({
      accountId: 42,
      accountKind: 'linkedin-organization',
      authorizationRevision: 3,
      environment,
      externalAccountId: '12345',
      nowMilliseconds: 1_000,
    })

    expect(() =>
      verifyLinkedInOAuthTransaction({
        cookieValue: issued.cookieValue,
        environment,
        nowMilliseconds: 2_000,
        returnedState: `${issued.state}x`,
      }),
    ).toThrowError(LinkedInOAuthError)

    expect(() =>
      verifyLinkedInOAuthTransaction({
        cookieValue: issued.cookieValue.replace(/^v1/, 'v2'),
        environment,
        nowMilliseconds: 2_000,
        returnedState: issued.state,
      }),
    ).toThrowError(LinkedInOAuthError)
  })

  it('builds LinkedIn authorization without exposing the secret', () => {
    const url = buildLinkedInAuthorizationURL({
      config: readLinkedInOAuthConfiguration(environment),
      scopes: requiredLinkedInPermissions('linkedin-organization'),
      state: 's'.repeat(43),
    })

    expect(url.origin).toBe('https://www.linkedin.com')
    expect(url.pathname).toBe('/oauth/v2/authorization')
    expect(url.searchParams.get('client_id')).toBe('linkedin-app-id')
    expect(url.searchParams.get('redirect_uri')).toBe(environment.LINKEDIN_OAUTH_REDIRECT_URI)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe(
      requiredLinkedInPermissions('linkedin-organization').join(' '),
    )
    expect(url.searchParams.get('state')).toBe('s'.repeat(43))
    expect(url.toString()).not.toContain('test-linkedin-app-secret')
  })

  it('exchanges a flat provider callback response without putting secrets in URLs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'linkedin-member-token',
          expires_in: 5_184_000,
          scope: requiredLinkedInPermissions('linkedin-member').join(' '),
        }),
        { status: 200 },
      ),
    )

    await expect(
      exchangeLinkedInAuthorizationCode({
        code: 'authorization-code',
        config: readLinkedInOAuthConfiguration(environment),
        fetcher,
        nowMilliseconds: 1_000,
      }),
    ).resolves.toEqual({
      accessToken: 'linkedin-member-token',
      expiresAt: new Date(5_184_001_000).toISOString(),
      scopes: requiredLinkedInPermissions('linkedin-member'),
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [tokenCall] = fetcher.mock.calls
    expect(String(tokenCall[0])).toBe('https://www.linkedin.com/oauth/v2/accessToken')
    expect(tokenCall[1]).toMatchObject({ method: 'POST' })
    expect(new URLSearchParams(String(tokenCall[1]?.body)).get('client_secret')).toBe(
      'test-linkedin-app-secret',
    )
    expect(String(tokenCall[0])).not.toContain('test-linkedin-app-secret')
  })

  it('rejects malformed or oversized provider scope lists', async () => {
    const required = requiredLinkedInPermissions('linkedin-member').join(' ')
    const oversizedTotal = [
      required,
      ...Array.from({ length: 50 }, (_, index) => `extra_${index}_${'x'.repeat(80)}`),
    ].join(' ')
    for (const scope of [
      `${required} ${'x'.repeat(129)}`,
      `${required}\ninjected_scope`,
      `${required} control\u0000scope`,
      `${required} duplicate duplicate`,
      oversizedTotal,
    ]) {
      await expect(
        exchangeLinkedInAuthorizationCode({
          code: 'authorization-code',
          config: readLinkedInOAuthConfiguration(environment),
          fetcher: vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
              JSON.stringify({
                access_token: 'linkedin-member-token',
                expires_in: 5_184_000,
                scope,
              }),
              { status: 200 },
            ),
          ),
        }),
      ).rejects.toMatchObject({ code: 'token_response_invalid' })
    }
  })

  it('binds a LinkedIn member account by sub and name', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ name: 'IVYBM Member', sub: 'abc-123' }), { status: 200 }),
      )

    await expect(
      resolveLinkedInAuthorizedAccount({
        accountKind: 'linkedin-member',
        config: readLinkedInOAuthConfiguration(environment),
        externalAccountId: 'abc-123',
        fetcher,
        grantedScopes: [...requiredLinkedInPermissions('linkedin-member'), 'extra_provider_scope'],
        requiredScopes: requiredLinkedInPermissions('linkedin-member'),
        userAccessToken: 'linkedin-member-token',
      }),
    ).resolves.toEqual({
      accessToken: 'linkedin-member-token',
      displayName: 'IVYBM Member',
      externalAccountId: 'abc-123',
      scopes: requiredLinkedInPermissions('linkedin-member'),
    })
  })

  it('binds a LinkedIn organization only when the member has an approved publishing role', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          elements: [
            {
              organization: 'urn:li:organization:12345',
              role: 'CONTENT_ADMINISTRATOR',
              state: 'APPROVED',
            },
          ],
        }),
        { status: 200 },
      ),
    )

    await expect(
      resolveLinkedInAuthorizedAccount({
        accountKind: 'linkedin-organization',
        config: readLinkedInOAuthConfiguration(environment),
        externalAccountId: '12345',
        fetcher,
        grantedScopes: requiredLinkedInPermissions('linkedin-organization'),
        requiredScopes: requiredLinkedInPermissions('linkedin-organization'),
        userAccessToken: 'linkedin-organization-token',
      }),
    ).resolves.toEqual({
      accessToken: 'linkedin-organization-token',
      displayName: 'urn:li:organization:12345',
      externalAccountId: '12345',
      scopes: requiredLinkedInPermissions('linkedin-organization'),
    })
  })

  it('fails closed on missing scopes, identity mismatch, and provider errors', async () => {
    await expect(
      resolveLinkedInAuthorizedAccount({
        accountKind: 'linkedin-member',
        config: readLinkedInOAuthConfiguration(environment),
        externalAccountId: 'abc-123',
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ sub: 'abc-123' }), { status: 200 })),
        grantedScopes: ['openid', 'profile'],
        requiredScopes: requiredLinkedInPermissions('linkedin-member'),
        userAccessToken: 'linkedin-member-token',
      }),
    ).rejects.toMatchObject({
      code: 'required_permission_missing',
      diagnostic: { missingScopes: ['w_member_social'] },
    })

    await expect(
      resolveLinkedInAuthorizedAccount({
        accountKind: 'linkedin-member',
        config: readLinkedInOAuthConfiguration(environment),
        externalAccountId: 'abc-123',
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ sub: 'other-sub' }), { status: 200 })),
        grantedScopes: requiredLinkedInPermissions('linkedin-member'),
        requiredScopes: requiredLinkedInPermissions('linkedin-member'),
        userAccessToken: 'linkedin-member-token',
      }),
    ).rejects.toMatchObject({ code: 'identity_mismatch' })

    const secretBearingBody =
      'provider failure with test-linkedin-app-secret and linkedin-member-token'
    await expect(
      exchangeLinkedInAuthorizationCode({
        code: 'authorization-code',
        config: readLinkedInOAuthConfiguration(environment),
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(secretBearingBody, { status: 401 })),
      }),
    ).rejects.toMatchObject({
      code: 'token_exchange_failed',
      diagnostic: { providerStatus: 401, stage: 'token_exchange' },
      message: 'LinkedIn OAuth token exchange failed',
    })
  })

  it('keeps only bounded diagnostics from secret-bearing provider failures', async () => {
    const tokenFailure = await exchangeLinkedInAuthorizationCode({
      code: 'authorization-code',
      config: readLinkedInOAuthConfiguration(environment),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_request',
            error_description: 'invalid request test-linkedin-app-secret leaked-token',
          }),
          { status: 400 },
        ),
      ),
    }).catch((error: unknown) => error)

    expect(tokenFailure).toMatchObject({
      code: 'token_exchange_failed',
      diagnostic: {
        providerErrorCode: 'invalid_request',
        providerResponseKeys: ['error', 'error_description'],
        providerStatus: 400,
        stage: 'token_exchange',
      },
    })
    expect(JSON.stringify(tokenFailure)).not.toContain('authorization-code')
    expect(JSON.stringify(tokenFailure)).not.toContain('test-linkedin-app-secret')
    expect(JSON.stringify(tokenFailure)).not.toContain('leaked-token')

    const redirectFailure = await exchangeLinkedInAuthorizationCode({
      code: 'authorization-code',
      config: readLinkedInOAuthConfiguration(environment),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'invalid_redirect_uri' }), { status: 400 }),
        ),
    }).catch((error: unknown) => error)

    expect(redirectFailure).toMatchObject({
      code: 'token_exchange_failed',
      diagnostic: {
        providerErrorCode: 'invalid_redirect_uri',
        providerStatus: 400,
        stage: 'token_exchange',
      },
    })

    const identityFailure = await resolveLinkedInAuthorizedAccount({
      accountKind: 'linkedin-member',
      config: readLinkedInOAuthConfiguration(environment),
      externalAccountId: 'abc-123',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_token',
            error_description: 'invalid linkedin-member-token test-linkedin-app-secret',
          }),
          { status: 401 },
        ),
      ),
      grantedScopes: requiredLinkedInPermissions('linkedin-member'),
      requiredScopes: requiredLinkedInPermissions('linkedin-member'),
      userAccessToken: 'linkedin-member-token',
    }).catch((error: unknown) => error)

    expect(identityFailure).toMatchObject({
      code: 'identity_verification_failed',
      diagnostic: {
        providerErrorCode: 'invalid_token',
        providerResponseKeys: ['error', 'error_description'],
        providerStatus: 401,
        stage: 'userinfo_verification',
      },
    })
    expect(JSON.stringify(identityFailure)).not.toContain('linkedin-member-token')
    expect(JSON.stringify(identityFailure)).not.toContain('test-linkedin-app-secret')

    for (const unsafeError of [
      `invalid_request\n${'x'.repeat(512)}`,
      '\ninvalid_request',
      'invalid_request\u0000injected',
      'test-linkedin-app-secret',
      'linkedin-member-token',
    ]) {
      const failure = await exchangeLinkedInAuthorizationCode({
        code: 'authorization-code',
        config: readLinkedInOAuthConfiguration(environment),
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ error: unsafeError }), { status: 400 })),
      }).catch((error: unknown) => error)

      expect(failure).toMatchObject({
        code: 'token_exchange_failed',
        diagnostic: { providerStatus: 400, stage: 'token_exchange' },
      })
      expect(failure).toBeInstanceOf(LinkedInOAuthError)
      expect((failure as LinkedInOAuthError).diagnostic).not.toHaveProperty('providerErrorCode')
      expect(JSON.stringify(failure)).not.toContain(unsafeError)
    }
  })
})
