import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'cache-control': 'no-store' }

export async function POST(request: NextRequest): Promise<Response> {
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
    const body = (await request.json().catch(() => undefined)) as
      { connectionId?: number | string } | undefined
    if (body?.connectionId === undefined) {
      return NextResponse.json(
        { error: { code: 'connection_id_required' } },
        { headers: noStore, status: 400 },
      )
    }
    await payload.update({
      collection: 'feishu-connections',
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        refreshTokenEncrypted: null,
        refreshTokenExpiresAt: null,
        status: 'disconnected',
      },
      id: body.connectionId,
      overrideAccess: true,
    })
    const mappings = await payload.find({
      collection: 'feishu-mappings',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      where: { connection: { equals: body.connectionId } },
    })
    for (const mapping of mappings.docs) {
      await payload.update({
        collection: 'feishu-mappings',
        data: { status: 'disabled' },
        id: mapping.id,
        overrideAccess: true,
      })
    }
    return NextResponse.json({ disconnected: true }, { headers: noStore })
  } catch {
    return NextResponse.json(
      { error: { code: 'feishu_disconnect_failed' } },
      { headers: noStore, status: 503 },
    )
  }
}
