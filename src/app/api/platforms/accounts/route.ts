import { NextRequest, NextResponse } from 'next/server'
import { createLocalReq, getPayload } from 'payload'

import {
  toRedactedPlatformAccountSummary,
  validateCreatePlatformAccountInput,
} from '@/modules/platforms/accountPortalDto'
import { PlatformPortalRequestError, readPlatformPortalJSON } from '@/modules/platforms/portalHttp'
import { platformFamilyForAccountKind } from '@/modules/platforms/readiness'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const json = (status: number, body: Record<string, unknown>): Response =>
  NextResponse.json(body, {
    headers: { 'cache-control': 'private, no-store' },
    status,
  })

const authenticateAdmin = async (
  request: NextRequest,
): Promise<
  | { error: Response; success: false }
  | { payload: Awaited<ReturnType<typeof getPayload>>; success: true; user: User }
> => {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    return { error: json(503, { error: { code: 'portal_disabled' } }), success: false }
  }
  if (process.env.ADMIN_PORTAL_PLATFORMS_ENABLED !== 'true') {
    return { error: json(503, { error: { code: 'platform_module_disabled' } }), success: false }
  }
  const payload = await getPayload({ config })
  const authenticated = await payload.auth({ headers: request.headers })
  if (!authenticated.user || authenticated.user.collection !== 'users') {
    return { error: json(401, { error: { code: 'authentication_required' } }), success: false }
  }
  const user = authenticated.user as User
  if (user.role !== 'admin') {
    return { error: json(403, { error: { code: 'forbidden' } }), success: false }
  }
  return { payload, success: true, user }
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authenticateAdmin(request)
  if (!auth.success) return auth.error
  const { payload } = auth

  try {
    const req = await createLocalReq({ user: auth.user }, payload)
    const accounts = await payload.find({
      collection: 'platform-accounts',
      depth: 0,
      overrideAccess: false,
      pagination: false,
      req,
      sort: 'name',
      user: auth.user,
    })
    return json(200, {
      accounts: accounts.docs.map((account) => toRedactedPlatformAccountSummary(account)),
    })
  } catch {
    return json(503, { error: { code: 'platform_accounts_unavailable' } })
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown
  try {
    body = await readPlatformPortalJSON(request)
  } catch (error) {
    if (error instanceof PlatformPortalRequestError) {
      return json(error.status, { error: { code: error.code } })
    }
    return json(400, { error: { code: 'invalid_request' } })
  }

  const auth = await authenticateAdmin(request)
  if (!auth.success) return auth.error
  const { payload, user } = auth

  const input = validateCreatePlatformAccountInput(body)
  if (!input.success) return json(400, { error: input.error })

  try {
    const created = await payload.create({
      collection: 'platform-accounts',
      data: {
        accountKind: input.value.accountKind,
        authorization: { state: 'not_started' },
        authorizationRevision: 0,
        externalAccountId: input.value.externalAccountId ?? null,
        name: input.value.name,
        notes: input.value.notes ?? null,
        platformFamily: platformFamilyForAccountKind(input.value.accountKind),
      },
      overrideAccess: false,
      user,
    })
    return json(201, { data: toRedactedPlatformAccountSummary(created) })
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
    if (message.includes('unique') || message.includes('duplicate')) {
      return json(409, { error: { code: 'duplicate_account' } })
    }
    return json(503, { error: { code: 'platform_account_create_failed' } })
  }
}
