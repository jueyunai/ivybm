import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@/payload.config'
import type { PlatformAccount, User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const json = (status: number, body: Record<string, unknown>): Response =>
  NextResponse.json(body, {
    headers: { 'cache-control': 'private, no-store' },
    status,
  })

const readAccountId = async (request: NextRequest): Promise<number | undefined> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return undefined
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const value = (body as Record<string, unknown>).accountId
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

const isMetaAccount = (account: PlatformAccount): boolean => account.accountKind === 'facebook-page'

export async function POST(request: NextRequest): Promise<Response> {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return json(403, { error: { code: 'invalid_origin' } })
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json(415, { error: { code: 'unsupported_media_type' } })
  }
  const contentLength = Number(request.headers.get('content-length') || '0')
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 4_096) {
    return json(413, { error: { code: 'request_too_large' } })
  }

  const payload = await getPayload({ config })
  const authenticated = await payload.auth({ headers: request.headers })
  if (!authenticated.user || authenticated.user.collection !== 'users') {
    return json(401, { error: { code: 'authentication_required' } })
  }
  const actor = authenticated.user as User
  if (actor.role !== 'admin') return json(403, { error: { code: 'forbidden' } })

  const accountId = await readAccountId(request)
  if (!accountId) return json(400, { error: { code: 'invalid_platform_account_id' } })

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
  if (!isMetaAccount(account)) return json(409, { error: { code: 'meta_account_required' } })

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
  return json(200, { data: { accountId, disconnected: true } })
}
