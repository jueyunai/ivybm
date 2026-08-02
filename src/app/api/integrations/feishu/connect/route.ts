import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import {
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from '@/modules/feishu/credentials'
import { buildFeishuAuthorizeURL, createOAuthAttempt } from '@/modules/feishu/oauth'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const errorResponse = (status: number, code: string): Response =>
  NextResponse.json({ error: { code } }, { headers: { 'cache-control': 'no-store' }, status })

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return errorResponse(401, 'authentication_required')
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin') return errorResponse(403, 'forbidden')

    const appId = process.env.FEISHU_APP_ID?.trim()
    const redirectURI = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim()
    if (!appId || !process.env.FEISHU_APP_SECRET?.trim() || !redirectURI) {
      return errorResponse(503, 'feishu_oauth_not_configured')
    }

    const attempt = createOAuthAttempt()
    await payload.create({
      collection: 'feishu-oauth-states',
      data: {
        expiresAt: attempt.expiresAt,
        requestedBy: actor.id,
        stateHash: attempt.stateHash,
        verifierEncrypted: encryptFeishuCredential(
          attempt.verifier,
          readFeishuCredentialEncryptionKey(),
        ),
      },
      overrideAccess: true,
    })
    return NextResponse.redirect(
      buildFeishuAuthorizeURL({
        appId,
        challenge: attempt.challenge,
        redirectURI,
        state: attempt.state,
      }),
      { headers: { 'cache-control': 'no-store' }, status: 302 },
    )
  } catch {
    return errorResponse(503, 'feishu_connect_unavailable')
  }
}
