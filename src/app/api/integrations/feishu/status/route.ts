import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { canDecryptFeishuCredential } from '@/modules/feishu/credentials'
import { isFeishuQRRegistrationEnabled } from '@/modules/feishu/appRegistration'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'cache-control': 'no-store' }

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return NextResponse.json(
        { error: { code: 'authentication_required' } },
        { headers: noStore, status: 401 },
      )
    }
    if ((authenticated.user as User).role !== 'admin') {
      return NextResponse.json({ error: { code: 'forbidden' } }, { headers: noStore, status: 403 })
    }
    const connections = await payload.find({
      collection: 'feishu-connections',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      sort: '-updatedAt',
    })
    return NextResponse.json(
      {
        connections: connections.docs.map((connection) => ({
          baseURL: connection.baseURL,
          credentialsUsable:
            canDecryptFeishuCredential(connection.accessTokenEncrypted) &&
            canDecryptFeishuCredential(connection.refreshTokenEncrypted),
          id: connection.id,
          lastConnectedAt: connection.lastConnectedAt,
          name: connection.name,
          status: connection.status,
        })),
        oauthConfigured: Boolean(
          process.env.FEISHU_APP_ID?.trim() &&
          process.env.FEISHU_APP_SECRET?.trim() &&
          process.env.FEISHU_OAUTH_REDIRECT_URI?.trim() &&
          process.env.FEISHU_CREDENTIAL_ENCRYPTION_KEY?.trim(),
        ),
        qrRegistrationEnabled: isFeishuQRRegistrationEnabled(),
      },
      { headers: noStore },
    )
  } catch {
    return NextResponse.json(
      { error: { code: 'feishu_status_unavailable' } },
      { headers: noStore, status: 503 },
    )
  }
}
