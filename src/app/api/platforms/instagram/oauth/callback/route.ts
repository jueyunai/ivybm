import { NextRequest, NextResponse } from 'next/server'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import {
  INSTAGRAM_OAUTH_CALLBACK_PATH,
  INSTAGRAM_OAUTH_TRANSACTION_COOKIE,
  InstagramOAuthError,
  exchangeInstagramAuthorizationCode,
  discoverInstagramMessagingAccountId,
  readInstagramOAuthConfiguration,
  resolveInstagramAuthorizedAccount,
  verifyInstagramOAuthTransaction,
  type InstagramOAuthTransaction,
} from '@/modules/platforms/instagram/oauth'
import {
  isMetaWebhookAccountConfigured,
  subscribeMetaMessagingWebhook,
} from '@/modules/platforms/meta/webhookSubscription'
import {
  PlatformOAuthAccountChangedError,
  withLockedPlatformOAuthAccount,
} from '@/modules/platforms/accountOAuthConcurrency'
import config from '@/payload.config'
import { platformMessagingIdentityWriteContextKey } from '@/collections/PlatformAccounts'
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
  if (error instanceof PlatformOAuthAccountChangedError) return 'account_changed'
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
    case 'webhook_subscription_failed':
      return 'webhook_subscription_failed'
    case 'invalid_configuration':
      return 'unavailable'
    case 'invalid_transaction':
      return 'invalid_transaction'
  }
}

const callbackErrorLog = (error: unknown): Record<string, unknown> => {
  const code = callbackErrorCode(error)
  if (!(error instanceof InstagramOAuthError)) {
    return { code, message: 'Instagram OAuth callback failed' }
  }
  const diagnostic = error.diagnostic
  return {
    code,
    message: 'Instagram OAuth callback failed',
    oauthCode: error.code,
    ...(diagnostic
      ? {
          stage: diagnostic.stage,
          ...(diagnostic.providerStatus === undefined
            ? {}
            : { providerStatus: diagnostic.providerStatus }),
          ...(diagnostic.providerErrorType === undefined
            ? {}
            : { providerErrorType: diagnostic.providerErrorType }),
          ...(diagnostic.providerErrorCode === undefined
            ? {}
            : { providerErrorCode: diagnostic.providerErrorCode }),
          ...(diagnostic.providerErrorSubcode === undefined
            ? {}
            : { providerErrorSubcode: diagnostic.providerErrorSubcode }),
          ...(diagnostic.providerResponseKeys === undefined
            ? {}
            : { providerResponseKeys: diagnostic.providerResponseKeys }),
          ...(diagnostic.permissionsType === undefined
            ? {}
            : { permissionsType: diagnostic.permissionsType }),
          ...(diagnostic.permissionsCount === undefined
            ? {}
            : { permissionsCount: diagnostic.permissionsCount }),
          ...(diagnostic.permissionsItemTypes === undefined
            ? {}
            : { permissionsItemTypes: diagnostic.permissionsItemTypes }),
          ...(diagnostic.providerScopes === undefined
            ? {}
            : { providerScopes: diagnostic.providerScopes }),
          ...(diagnostic.grantedScopes === undefined
            ? {}
            : { grantedScopes: diagnostic.grantedScopes }),
          ...(diagnostic.missingScopes === undefined
            ? {}
            : { missingScopes: diagnostic.missingScopes }),
        }
      : {}),
  }
}

const loadInstagramAccount = async (
  payload: Payload,
  req: PayloadRequest,
  transaction: InstagramOAuthTransaction,
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
    const account = await loadInstagramAccount(payload, req, transaction, actor)
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
    const code = request.nextUrl.searchParams.get('code') ?? ''

    const userToken = await exchangeInstagramAuthorizationCode({ code, config: oauth })
    if (transaction.requestedScopes.some((scope) => !userToken.scopes.includes(scope))) {
      throw new InstagramOAuthError('required_permission_missing')
    }
    payload.logger.info({
      grantedScopes: transaction.requestedScopes.filter((scope) =>
        userToken.scopes.includes(scope),
      ),
      message: 'Instagram OAuth permissions resolved',
      missingScopes: transaction.requestedScopes.filter(
        (scope) => !userToken.scopes.includes(scope),
      ),
      permissionsCount: userToken.permissionsCount,
      ...(userToken.permissionsItemTypes === undefined
        ? {}
        : { permissionsItemTypes: userToken.permissionsItemTypes }),
      permissionsType: userToken.permissionsType,
      providerScopes: userToken.scopes,
      stage: 'short_token_exchange',
    })
    const authorizedAccount = await resolveInstagramAuthorizedAccount({
      externalAccountId: transaction.externalAccountId,
      userAccessToken: userToken.accessToken,
    })
    const messagingExternalAccountId =
      account.capabilities?.messagingInbound === 'approved'
        ? await discoverInstagramMessagingAccountId({
            accessToken: authorizedAccount.accessToken,
            oauthAccountId: authorizedAccount.accountId,
            username: authorizedAccount.username,
          })
        : undefined
    if (account.capabilities?.messagingInbound === 'approved') {
      if (!isMetaWebhookAccountConfigured({
        accountExternalId: authorizedAccount.accountId,
        platform: 'instagram',
      })) {
        throw new InstagramOAuthError('webhook_subscription_failed')
      }
      try {
        await subscribeMetaMessagingWebhook({
          accessToken: authorizedAccount.accessToken,
          accountExternalId: authorizedAccount.accountId,
          platform: 'instagram',
        })
      } catch {
        throw new InstagramOAuthError('webhook_subscription_failed')
      }
    }
    await withLockedPlatformOAuthAccount({
      operation: (req) =>
        {
          (req.context ??= {})[platformMessagingIdentityWriteContextKey] = true
          return callbackPayload.update({
          collection: 'platform-accounts',
          data: {
            ...(messagingExternalAccountId ? { messagingExternalAccountId } : {}),
            authorization: {
              accessToken: authorizedAccount.accessToken,
              appId: oauth.appId,
              clearAccessToken: false,
              clearRefreshToken: true,
              expiresAt: userToken.expiresAt,
              // Instagram Login returns granted permissions during the code
              // exchange; graph.instagram.com has no supported readback edge.
              scopes: userToken.scopes.map((scope) => ({ scope })),
              state: 'connected',
            },
          },
          id: Number(callbackTransaction.accountId),
          overrideAccess: false,
          req,
          user: actor,
          })
        },
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
