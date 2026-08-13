import { NextRequest, NextResponse } from 'next/server'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import {
  META_OAUTH_CALLBACK_PATH,
  META_OAUTH_TRANSACTION_COOKIE,
  MetaOAuthError,
  exchangeMetaAuthorizationCode,
  readMetaOAuthConfiguration,
  resolveMetaAuthorizedAccount,
  verifyMetaOAuthTransaction,
  type MetaOAuthTransaction,
} from '@/modules/platforms/meta/oauth'
import {
  PlatformOAuthAccountChangedError,
  withLockedPlatformOAuthAccount,
} from '@/modules/platforms/accountOAuthConcurrency'
import config from '@/payload.config'
import type { PlatformAccount, User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PORTAL_REDIRECT_PATH = '/dashboard/platforms'

const resultRedirect = ({
  origin,
  result,
  secure,
}: {
  origin: string
  result: string
  secure: boolean
}): Response => {
  const target = new URL(PORTAL_REDIRECT_PATH, origin)
  target.searchParams.set('metaOAuth', result)
  const response = NextResponse.redirect(target, 302)
  response.cookies.set(META_OAUTH_TRANSACTION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    path: META_OAUTH_CALLBACK_PATH,
    sameSite: 'lax',
    secure,
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

const callbackErrorCode = (error: unknown): string => {
  if (error instanceof PlatformOAuthAccountChangedError) return 'account_changed'
  if (!(error instanceof MetaOAuthError)) return 'unavailable'
  switch (error.code) {
    case 'state_mismatch':
      return 'state_mismatch'
    case 'required_permission_missing':
      return 'required_permission_missing'
    case 'identity_mismatch':
      return 'identity_mismatch'
    case 'identity_verification_failed':
      return 'identity_verification_failed'
    case 'token_exchange_failed':
    case 'token_response_invalid':
      return 'token_exchange_failed'
    case 'invalid_configuration':
      return 'unavailable'
    case 'invalid_transaction':
      return 'invalid_transaction'
  }
}

const callbackErrorLog = (error: unknown): Record<string, unknown> => {
  const code = callbackErrorCode(error)
  if (!(error instanceof MetaOAuthError)) {
    return { code, message: 'Meta OAuth callback failed' }
  }
  const diagnostic = error.diagnostic
  return {
    code,
    message: 'Meta OAuth callback failed',
    oauthCode: error.code,
    ...(diagnostic
      ? {
          stage: diagnostic.stage,
          ...(diagnostic.providerStatus === undefined
            ? {}
            : { providerStatus: diagnostic.providerStatus }),
          ...(diagnostic.providerErrorCode === undefined
            ? {}
            : { providerErrorCode: diagnostic.providerErrorCode }),
          ...(diagnostic.providerErrorSubcode === undefined
            ? {}
            : { providerErrorSubcode: diagnostic.providerErrorSubcode }),
          ...(diagnostic.providerResponseKeys === undefined
            ? {}
            : { providerResponseKeys: diagnostic.providerResponseKeys }),
          ...(diagnostic.grantedScopes === undefined
            ? {}
            : { grantedScopes: diagnostic.grantedScopes }),
          ...(diagnostic.missingScopes === undefined
            ? {}
            : { missingScopes: diagnostic.missingScopes }),
          ...(diagnostic.returnedPageIds === undefined
            ? {}
            : { returnedPageIds: diagnostic.returnedPageIds }),
          ...(diagnostic.targetPageId === undefined
            ? {}
            : { targetPageId: diagnostic.targetPageId }),
        }
      : {}),
  }
}

const loadMetaAccount = async (
  payload: Payload,
  req: PayloadRequest,
  transaction: MetaOAuthTransaction,
  user: User,
): Promise<PlatformAccount | undefined> => {
  try {
    return await payload.findByID({
      collection: 'platform-accounts',
      id: Number(transaction.accountId),
      overrideAccess: false,
      req,
      user,
    })
  } catch {
    return undefined
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    return NextResponse.json(
      { error: { code: 'portal_disabled' } },
      { headers: { 'cache-control': 'private, no-store' }, status: 503 },
    )
  }
  if (process.env.ADMIN_PORTAL_PLATFORMS_ENABLED !== 'true') {
    return NextResponse.json(
      { error: { code: 'platform_module_disabled' } },
      { headers: { 'cache-control': 'private, no-store' }, status: 503 },
    )
  }
  let oauth
  try {
    oauth = readMetaOAuthConfiguration()
  } catch {
    return NextResponse.json(
      { error: { code: 'meta_oauth_unavailable' } },
      { headers: { 'cache-control': 'private, no-store' }, status: 503 },
    )
  }

  const redirectOrigin = new URL(oauth.redirectUri).origin
  const secureCookie = new URL(oauth.redirectUri).protocol === 'https:'
  let payload: Payload | undefined
  let transaction: MetaOAuthTransaction | undefined
  try {
    transaction = verifyMetaOAuthTransaction({
      cookieValue: request.cookies.get(META_OAUTH_TRANSACTION_COOKIE)?.value,
      returnedState: request.nextUrl.searchParams.get('state') ?? undefined,
    })

    payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return resultRedirect({
        origin: redirectOrigin,
        result: 'authentication_required',
        secure: secureCookie,
      })
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin') {
      return resultRedirect({
        origin: redirectOrigin,
        result: 'forbidden',
        secure: secureCookie,
      })
    }

    const req = await createLocalReq({ user: actor }, payload)
    const account = await loadMetaAccount(payload, req, transaction, actor)
    if (!account) {
      return resultRedirect({
        origin: redirectOrigin,
        result: 'account_not_found',
        secure: secureCookie,
      })
    }
    if (
      account.accountKind !== transaction.accountKind ||
      account.externalAccountId?.trim() !== transaction.externalAccountId ||
      account.authorizationRevision !== transaction.authorizationRevision ||
      account.authorization.state === 'blocked' ||
      account.authorization.state === 'disabled' ||
      account.platformFamily !== 'meta'
    ) {
      return resultRedirect({
        origin: redirectOrigin,
        result: 'account_changed',
        secure: secureCookie,
      })
    }
    const callbackPayload = payload
    const callbackTransaction = transaction

    if (request.nextUrl.searchParams.has('error')) {
      return resultRedirect({
        origin: redirectOrigin,
        result: 'provider_denied',
        secure: secureCookie,
      })
    }
    const code = request.nextUrl.searchParams.get('code')
    if (!code) throw new MetaOAuthError('token_exchange_failed')

    const userToken = await exchangeMetaAuthorizationCode({ code, config: oauth })
    const authorizedAccount = await resolveMetaAuthorizedAccount({
      accountKind: transaction.accountKind,
      appSecret: oauth.appSecret,
      externalAccountId: transaction.externalAccountId,
      userAccessToken: userToken.accessToken,
    })
    await withLockedPlatformOAuthAccount({
      operation: (req) =>
        callbackPayload.update({
          collection: 'platform-accounts',
          data: {
            authorization: {
              accessToken: authorizedAccount.accessToken,
              appId: oauth.appId,
              clearAccessToken: false,
              clearRefreshToken: true,
              expiresAt: userToken.expiresAt,
              scopes: authorizedAccount.scopes.map((scope) => ({ scope })),
              state: 'connected',
            },
          },
          id: Number(callbackTransaction.accountId),
          overrideAccess: false,
          req,
          user: actor,
        }),
      payload: callbackPayload,
      snapshot: callbackTransaction,
      user: actor,
    })

    return resultRedirect({
      origin: redirectOrigin,
      result: 'connected',
      secure: secureCookie,
    })
  } catch (error) {
    if (payload) payload.logger.error(callbackErrorLog(error))
    return resultRedirect({
      origin: redirectOrigin,
      result: callbackErrorCode(error),
      secure: secureCookie,
    })
  }
}
