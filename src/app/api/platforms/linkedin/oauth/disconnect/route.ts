import { NextRequest, NextResponse } from 'next/server'
import { createLocalReq, getPayload } from 'payload'

import {
  LINKEDIN_OAUTH_CALLBACK_PATH,
  LINKEDIN_OAUTH_TRANSACTION_COOKIE,
} from '@/modules/platforms/linkedin/oauth'
import { validateDisconnectPlatformAccountInput } from '@/modules/platforms/accountPortalDto'
import {
  PlatformAccountMutationConflictError,
  withLockedPlatformAccountMutation,
} from '@/modules/platforms/accountOAuthConcurrency'
import { PlatformPortalRequestError, readPlatformPortalJSON } from '@/modules/platforms/portalHttp'
import config from '@/payload.config'
import type { PlatformAccount, User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const json = (status: number, body: Record<string, unknown>): Response =>
  NextResponse.json(body, {
    headers: { 'cache-control': 'private, no-store' },
    status,
  })

const isLinkedInAccount = (account: PlatformAccount): boolean =>
  account.platformFamily === 'linkedin'

export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    return json(503, { error: { code: 'portal_disabled' } })
  }
  if (process.env.ADMIN_PORTAL_PLATFORMS_ENABLED !== 'true') {
    return json(503, { error: { code: 'platform_module_disabled' } })
  }

  let body: unknown
  try {
    body = await readPlatformPortalJSON(request)
  } catch (error) {
    if (error instanceof PlatformPortalRequestError) {
      return json(error.status, { error: { code: error.code } })
    }
    return json(400, { error: { code: 'invalid_request' } })
  }

  const input = validateDisconnectPlatformAccountInput(body)
  if (!input.success) return json(400, { error: input.error })
  const { accountId, authorizationRevision } = input.value

  try {
    const payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return json(401, { error: { code: 'authentication_required' } })
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin') return json(403, { error: { code: 'forbidden' } })
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
      return json(404, { error: { code: 'platform_account_not_found' } })
    }
    if (!isLinkedInAccount(account)) {
      return json(409, { error: { code: 'linkedin_account_required' } })
    }

    await withLockedPlatformAccountMutation({
      operation: (lockedReq) =>
        payload.update({
          collection: 'platform-accounts',
          data: {
            authorization: {
              clearAccessToken: true,
              clearRefreshToken: true,
              expiresAt: null,
              scopes: [],
              state: 'not_started',
            },
          },
          id: accountId,
          overrideAccess: false,
          req: lockedReq,
          user: actor,
        }),
      payload,
      snapshot: { accountId, authorizationRevision },
      user: actor,
    })

    const response = NextResponse.json(
      { data: { accountId, disconnected: true } },
      {
        headers: { 'cache-control': 'private, no-store' },
        status: 200,
      },
    )
    response.cookies.set(LINKEDIN_OAUTH_TRANSACTION_COOKIE, '', {
      httpOnly: true,
      maxAge: 0,
      path: LINKEDIN_OAUTH_CALLBACK_PATH,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
    })
    return response
  } catch (error) {
    if (error instanceof PlatformAccountMutationConflictError) {
      return json(409, { error: { code: 'stale_revision' } })
    }
    return json(503, { error: { code: 'unavailable' } })
  }
}
