import { NextRequest, NextResponse } from 'next/server'
import { getPayload, type Payload } from 'payload'

import { canDecryptPlatformCredential } from '@/modules/platforms/credentials'
import { assessPlatformAccountReadiness } from '@/modules/platforms/readiness'
import config from '@/payload.config'
import type { PlatformAccount, User } from '@/payload-types'

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

const asReadinessAccount = (account: PlatformAccount) => {
  const authorization = account.authorization
  const capabilities = account.capabilities
  const accessTokenConfigured = authorization.accessTokenConfigured === true

  return {
    accountKind: account.accountKind,
    externalAccountId: account.externalAccountId,
    id: account.id,
    name: account.name,
    readiness: assessPlatformAccountReadiness({
      account: {
        accessTokenConfigured,
        accessTokenExpiresAt: authorization.expiresAt,
        accessTokenReadable:
          accessTokenConfigured && canDecryptPlatformCredential(authorization.accessToken),
        accountKind: account.accountKind,
        authorizationState: authorization.state,
        capabilityApprovals: {
          ...(capabilities?.messagingInbound
            ? { messagingInbound: capabilities.messagingInbound }
            : {}),
          ...(capabilities?.publishing ? { publishing: capabilities.publishing } : {}),
        },
        externalAccountId: account.externalAccountId,
        refreshTokenConfigured: authorization.refreshTokenConfigured === true,
        refreshTokenReadable:
          authorization.refreshTokenConfigured === true &&
          canDecryptPlatformCredential(authorization.refreshToken),
      },
      environment: process.env,
    }),
  }
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

    phase = 'loading_accounts'
    const accounts = await payload.find({
      collection: 'platform-accounts',
      depth: 0,
      pagination: false,
      sort: 'name',
      // The route has already authenticated an administrator and returns a
      // hand-built response. It needs the ciphertext only long enough to
      // authenticate it against the current deployment key; this catches a
      // missing or rotated key before the account is reported as usable. Neither
      // ciphertext nor plaintext is included in the result, logs, or errors.
      overrideAccess: true,
    })
    phase = 'assessing'
    return NextResponse.json(
      { accounts: accounts.docs.map(asReadinessAccount) },
      { headers: noStore, status: 200 },
    )
  } catch {
    logReadinessFailure(payload, phase)
    return errorResponse(503, 'platform_readiness_unavailable')
  }
}
