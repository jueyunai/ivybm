import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import {
  INSTAGRAM_OAUTH_CALLBACK_PATH,
  INSTAGRAM_OAUTH_TRANSACTION_COOKIE,
} from '@/modules/platforms/instagram/oauth'
import config from '@/payload.config'
import type { PlatformAccount, User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const json = (status: number, body: Record<string, unknown>): Response =>
  NextResponse.json(body, {
    headers: { 'cache-control': 'private, no-store' },
    status,
  })

const isInstagramAccount = (account: PlatformAccount): boolean =>
  account.accountKind === 'instagram-professional' && account.platformFamily === 'meta'

export async function POST(request: NextRequest): Promise<Response> {
  const origin = request.headers.get('origin')
  const trustedOrigin = new URL(request.url).origin
  const untrustedOrigin = !origin || origin !== trustedOrigin
  if (untrustedOrigin) {
    return json(403, { error: { code: 'forbidden' } })
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json(415, { error: { code: 'unsupported_media_type' } })
  }
  const contentLength = Number(request.headers.get('content-length') || '0')
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 4_096) {
    return json(413, { error: { code: 'request_too_large' } })
  }

  let body: { accountId?: number }
  try {
    body = (await request.json()) as { accountId?: number }
  } catch {
    return json(400, { error: { code: 'invalid_request' } })
  }

  const accountId = body.accountId
  if (!accountId || !Number.isSafeInteger(accountId) || accountId <= 0) {
    return json(400, { error: { code: 'invalid_account_id' } })
  }

  try {
    const payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return NextResponse.json(
        { error: { code: 'authentication_required' } },
        { headers: { 'cache-control': 'private, no-store' }, status: 401 },
      )
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin') {
      return NextResponse.json(
        { error: { code: 'forbidden' } },
        { headers: { 'cache-control': 'private, no-store' }, status: 403 },
      )
    }

    let account: PlatformAccount
    try {
      account = await payload.findByID({
        collection: 'platform-accounts',
        id: accountId,
        overrideAccess: true,
      })
    } catch {
      return json(404, { error: { code: 'platform_account_not_found' } })
    }
    if (!isInstagramAccount(account)) {
      return json(409, { error: { code: 'instagram_account_required' } })
    }

    await payload.update({
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
      user: actor,
    })

    const response = NextResponse.json(
      { data: { accountId, disconnected: true } },
      { headers: { 'cache-control': 'private, no-store' }, status: 200 },
    )
    response.cookies.set(INSTAGRAM_OAUTH_TRANSACTION_COOKIE, '', {
      httpOnly: true,
      maxAge: 0,
      path: INSTAGRAM_OAUTH_CALLBACK_PATH,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
    })
    return response
  } catch {
    return NextResponse.json(
      { error: { code: 'unavailable' } },
      { headers: { 'cache-control': 'private, no-store' }, status: 503 },
    )
  }
}
