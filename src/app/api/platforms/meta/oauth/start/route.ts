import { NextRequest, NextResponse } from 'next/server'
import { createLocalReq, getPayload } from 'payload'

import {
  META_OAUTH_CALLBACK_PATH,
  META_OAUTH_TRANSACTION_COOKIE,
  META_OAUTH_TRANSACTION_TTL_SECONDS,
  MetaOAuthError,
  buildMetaAuthorizationURL,
  createMetaOAuthTransaction,
  readMetaOAuthConfiguration,
} from '@/modules/platforms/meta/oauth'
import config from '@/payload.config'
import type { PlatformAccount, User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const errorResponse = (status: number, code: string): Response =>
  NextResponse.json(
    { error: { code } },
    { headers: { 'cache-control': 'private, no-store' }, status },
  )

const parseAccountId = (request: NextRequest): number | undefined => {
  const value = request.nextUrl.searchParams.get('accountId')
  if (!value || !/^[1-9][0-9]*$/.test(value)) return undefined
  const accountId = Number(value)
  return Number.isSafeInteger(accountId) ? accountId : undefined
}

const isFacebookPageAccount = (
  account: PlatformAccount,
): account is PlatformAccount & {
  accountKind: 'facebook-page'
} => account.accountKind === 'facebook-page'

export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    return errorResponse(503, 'portal_disabled')
  }
  if (process.env.ADMIN_PORTAL_PLATFORMS_ENABLED !== 'true') {
    return errorResponse(503, 'platform_module_disabled')
  }
  const accountId = parseAccountId(request)
  if (!accountId) return errorResponse(400, 'invalid_platform_account_id')

  try {
    const payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return errorResponse(401, 'authentication_required')
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin') return errorResponse(403, 'forbidden')
    const req = await createLocalReq({ user: actor }, payload)

    let account: PlatformAccount
    try {
      account = await payload.findByID({
        collection: 'platform-accounts',
        id: accountId,
        overrideAccess: false,
        req,
        user: actor,
      })
    } catch {
      return errorResponse(404, 'platform_account_not_found')
    }
    if (account.accountKind === 'instagram-professional') {
      return errorResponse(409, 'instagram_oauth_separate_configuration_required')
    }
    if (!isFacebookPageAccount(account)) return errorResponse(409, 'meta_account_required')
    if (!account.externalAccountId?.trim()) {
      return errorResponse(409, 'external_account_id_required')
    }
    if (!/^[1-9][0-9]{0,31}$/.test(account.externalAccountId.trim())) {
      return errorResponse(409, 'invalid_external_account_id')
    }

    const oauth = readMetaOAuthConfiguration()
    const transaction = createMetaOAuthTransaction({
      accountId: account.id,
      accountKind: account.accountKind,
      authorizationRevision: account.authorizationRevision,
      externalAccountId: account.externalAccountId,
    })
    const response = NextResponse.redirect(
      buildMetaAuthorizationURL({ config: oauth, state: transaction.state }),
      302,
    )
    response.cookies.set(META_OAUTH_TRANSACTION_COOKIE, transaction.cookieValue, {
      httpOnly: true,
      maxAge: META_OAUTH_TRANSACTION_TTL_SECONDS,
      path: META_OAUTH_CALLBACK_PATH,
      sameSite: 'lax',
      secure: new URL(oauth.redirectUri).protocol === 'https:',
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    if (error instanceof MetaOAuthError) return errorResponse(503, 'meta_oauth_unavailable')
    return errorResponse(503, 'meta_oauth_unavailable')
  }
}
