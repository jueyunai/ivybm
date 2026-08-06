import { NextRequest, NextResponse } from 'next/server'
import { getPayload, type Payload } from 'payload'

import {
  INSTAGRAM_OAUTH_CALLBACK_PATH,
  INSTAGRAM_OAUTH_TRANSACTION_COOKIE,
  InstagramOAuthError,
  exchangeInstagramAuthorizationCode,
  readInstagramOAuthConfiguration,
  resolveInstagramAuthorizedAccount,
  verifyInstagramOAuthTransaction,
  type InstagramOAuthTransaction,
} from '@/modules/platforms/instagram/oauth'
import config from '@/payload.config'
import type { PlatformAccount, User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const resultRedirect = ({
  accountId,
  origin,
  result,
  secure,
}: {
  accountId?: string
  origin: string
  result: string
  secure: boolean
}): Response => {
  const path = accountId
    ? `/admin/collections/platform-accounts/${accountId}`
    : '/admin/collections/platform-accounts'
  const target = new URL(path, origin)
  target.searchParams.set('instagramOAuth', result)
  const response = NextResponse.redirect(target, 302)
  response.cookies.set(INSTAGRAM_OAUTH_TRANSACTION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    path: INSTAGRAM_OAUTH_CALLBACK_PATH,
    sameSite: 'lax',
    secure,
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

const callbackErrorCode = (error: unknown): string => {
  if (!(error instanceof InstagramOAuthError)) return 'unavailable'
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

const loadInstagramAccount = async (
  payload: Payload,
  transaction: InstagramOAuthTransaction,
): Promise<PlatformAccount | undefined> => {
  try {
    return await payload.findByID({
      collection: 'platform-accounts',
      id: Number(transaction.accountId),
      overrideAccess: true,
    })
  } catch {
    return undefined
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  let oauth
  try {
    oauth = readInstagramOAuthConfiguration()
  } catch {
    return NextResponse.json(
      { error: { code: 'instagram_oauth_unavailable' } },
      { headers: { 'cache-control': 'private, no-store' }, status: 503 },
    )
  }

  const redirectOrigin = new URL(oauth.redirectUri).origin
  const secureCookie = new URL(oauth.redirectUri).protocol === 'https:'
  let payload: Payload | undefined
  let transaction: InstagramOAuthTransaction | undefined
  try {
    transaction = verifyInstagramOAuthTransaction({
      cookieValue: request.cookies.get(INSTAGRAM_OAUTH_TRANSACTION_COOKIE)?.value,
      returnedState: request.nextUrl.searchParams.get('state') ?? undefined,
    })

    payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return resultRedirect({
        accountId: transaction.accountId,
        origin: redirectOrigin,
        result: 'authentication_required',
        secure: secureCookie,
      })
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin') {
      return resultRedirect({
        accountId: transaction.accountId,
        origin: redirectOrigin,
        result: 'forbidden',
        secure: secureCookie,
      })
    }

    const account = await loadInstagramAccount(payload, transaction)
    if (!account) {
      return resultRedirect({
        origin: redirectOrigin,
        result: 'account_not_found',
        secure: secureCookie,
      })
    }
    if (
      account.accountKind !== transaction.accountKind ||
      !account.externalAccountId?.trim() ||
      account.platformFamily !== 'meta'
    ) {
      return resultRedirect({
        accountId: transaction.accountId,
        origin: redirectOrigin,
        result: 'account_changed',
        secure: secureCookie,
      })
    }

    if (request.nextUrl.searchParams.has('error')) {
      return resultRedirect({
        accountId: transaction.accountId,
        origin: redirectOrigin,
        result: 'provider_denied',
        secure: secureCookie,
      })
    }
    const code = request.nextUrl.searchParams.get('code')
    if (!code) throw new InstagramOAuthError('token_exchange_failed')

    const userToken = await exchangeInstagramAuthorizationCode({ code, config: oauth })
    const authorizedAccount = await resolveInstagramAuthorizedAccount({
      externalAccountId: account.externalAccountId,
      userAccessToken: userToken.accessToken,
    })
    await payload.update({
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
      id: Number(transaction.accountId),
      overrideAccess: false,
      user: actor,
    })

    return resultRedirect({
      accountId: transaction.accountId,
      origin: redirectOrigin,
      result: 'connected',
      secure: secureCookie,
    })
  } catch (error) {
    if (payload) payload.logger.error('Instagram OAuth callback failed')
    return resultRedirect({
      accountId: transaction?.accountId,
      origin: redirectOrigin,
      result: callbackErrorCode(error),
      secure: secureCookie,
    })
  }
}
