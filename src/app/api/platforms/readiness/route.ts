import { NextRequest, NextResponse } from 'next/server'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { listPlatformReadiness } from '@/admin-portal/modules/platforms/getPlatformReadiness'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'cache-control': 'no-store' }

type ReadinessFailurePhase = 'assessing' | 'authenticating' | 'initializing' | 'loading_accounts'

const errorResponse = (status: number, code: string): Response =>
  NextResponse.json({ error: { code } }, { headers: noStore, status })

const logReadinessFailure = (payload: Payload | undefined, phase: ReadinessFailurePhase): void => {
  // The route may have transiently loaded ciphertext while checking it. Log a
  // stable phase only, never the error object/message, account fields, headers,
  // or response body, because any of those may contain secret material.
  const message = `Platform readiness endpoint unavailable during ${phase}`
  if (payload) {
    payload.logger.error(message)
    return
  }
  process.stderr.write(`${message}\n`)
}

export async function GET(request: NextRequest): Promise<Response> {
  let payload: Payload | undefined
  let phase: ReadinessFailurePhase = 'initializing'
  try {
    payload = await getPayload({ config })
    phase = 'authenticating'
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return errorResponse(401, 'authentication_required')
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin') return errorResponse(403, 'forbidden')
    if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
      return errorResponse(503, 'portal_disabled')
    }
    if (process.env.ADMIN_PORTAL_PLATFORMS_ENABLED !== 'true') {
      return errorResponse(503, 'platform_module_disabled')
    }

    phase = 'loading_accounts'
    phase = 'assessing'
    const req = await createLocalReq({ user: authenticated.user }, payload)
    return NextResponse.json(
      await listPlatformReadiness({ environment: process.env, payload, req }),
      { headers: noStore, status: 200 },
    )
  } catch {
    logReadinessFailure(payload, phase)
    return errorResponse(503, 'platform_readiness_unavailable')
  }
}
