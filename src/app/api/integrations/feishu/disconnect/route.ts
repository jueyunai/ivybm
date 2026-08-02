import { NextRequest, NextResponse } from 'next/server'
import {
  commitTransaction,
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'cache-control': 'no-store' }

const isSameOriginRequest = (request: NextRequest): boolean => {
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  if (!source) return true
  try {
    return new URL(source).origin === request.nextUrl.origin
  } catch {
    return false
  }
}

const parseConnectionId = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

export const disconnectFeishuConnection = async ({
  connectionId,
  payload,
  updateMapping = ({ id, req }) =>
    payload
      .update({
        collection: 'feishu-mappings',
        data: { status: 'disabled' },
        id,
        overrideAccess: true,
        req,
      })
      .then(() => undefined),
  user,
}: {
  connectionId: number | string
  payload: Payload
  updateMapping?: (input: { id: number | string; req: PayloadRequest }) => Promise<void>
  user: User
}): Promise<void> => {
  const req = await createLocalReq({ user }, payload)
  await initTransaction(req)
  try {
    await payload.update({
      collection: 'feishu-connections',
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        lastErrorCode: null,
        refreshTokenEncrypted: null,
        refreshTokenExpiresAt: null,
        status: 'disconnected',
      },
      id: connectionId,
      overrideAccess: true,
      req,
    })
    const mappings = await payload.find({
      collection: 'feishu-mappings',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
      where: { connection: { equals: connectionId } },
    })
    for (const mapping of mappings.docs) {
      await updateMapping({ id: mapping.id, req })
    }
    await commitTransaction(req)
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

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
    if (!isSameOriginRequest(request)) {
      return NextResponse.json(
        { error: { code: 'invalid_origin' } },
        { headers: noStore, status: 403 },
      )
    }
    const body = (await request.json().catch(() => undefined)) as
      { connectionId?: unknown } | undefined
    const connectionId = parseConnectionId(body?.connectionId)
    if (connectionId === undefined) {
      return NextResponse.json(
        { error: { code: 'connection_id_required' } },
        { headers: noStore, status: 400 },
      )
    }
    await disconnectFeishuConnection({
      connectionId,
      payload,
      user: authenticated.user as User,
    })
    return NextResponse.json({ disconnected: true }, { headers: noStore })
  } catch {
    return NextResponse.json(
      { error: { code: 'feishu_disconnect_failed' } },
      { headers: noStore, status: 503 },
    )
  }
}
