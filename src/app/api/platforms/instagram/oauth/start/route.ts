import { NextRequest, NextResponse } from 'next/server'
import { createLocalReq, getPayload } from 'payload'

import {
  INSTAGRAM_OAUTH_CALLBACK_PATH,
  INSTAGRAM_OAUTH_TRANSACTION_COOKIE,
  INSTAGRAM_OAUTH_TRANSACTION_TTL_SECONDS,
  InstagramOAuthError,
  buildInstagramAuthorizationURL,
  createInstagramOAuthTransaction,
  readInstagramOAuthConfiguration,
} from '@/modules/platforms/instagram/oauth'
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

const isInstagramAccount = (
  account: PlatformAccount,
): account is PlatformAccount & { accountKind: 'instagram-professional' } =>
  account.accountKind === 'instagram-professional'

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
    if (!isInstagramAccount(account)) return errorResponse(409, 'instagram_account_required')
    if (!account.externalAccountId?.trim()) {
      return errorResponse(409, 'external_account_id_required')
    }
    if (!/^[1-9][0-9]{0,31}$/.test(account.externalAccountId.trim())) {
      return errorResponse(409, 'invalid_external_account_id')
    }

    const oauth = readInstagramOAuthConfiguration()
    const transaction = createInstagramOAuthTransaction({
      accountId: account.id,
      accountKind: account.accountKind,
      authorizationRevision: account.authorizationRevision,
      externalAccountId: account.externalAccountId,
    })
    const response = NextResponse.redirect(
      buildInstagramAuthorizationURL({ config: oauth, state: transaction.state }),
      302,
    )
    response.cookies.set(INSTAGRAM_OAUTH_TRANSACTION_COOKIE, transaction.cookieValue, {
      httpOnly: true,
      maxAge: INSTAGRAM_OAUTH_TRANSACTION_TTL_SECONDS,
      path: INSTAGRAM_OAUTH_CALLBACK_PATH,
      sameSite: 'lax',
      secure: new URL(oauth.redirectUri).protocol === 'https:',
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    if (error instanceof InstagramOAuthError) {
      return errorResponse(503, 'instagram_oauth_unavailable')
    }
    return errorResponse(503, 'instagram_oauth_unavailable')
  }
}
