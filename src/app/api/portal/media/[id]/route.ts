import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  authorizeMediaRequest,
  mediaErrorResponse,
  mediaJSON,
  readMediaJSON,
  requireMediaID,
} from '@/admin-portal/modules/media/mediaRoute'
import { deletePortalMedia, updatePortalMedia } from '@/modules/media'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const mediaID = async (params: Promise<{ id: string }>) => requireMediaID((await params).id)

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = await mediaID(params)
    const { payload, req } = await authorizeMediaRequest(request)
    const input = await readMediaJSON(request)
    return mediaJSON({
      result: await executePortalRouteCommand({
        fingerprintInput: { id, input },
        operation: (transactionReq) =>
          updatePortalMedia({ id, input, payload, req: transactionReq }),
        payload,
        req,
        request,
        scope: `portal.media:update:${id}`,
        target: { collection: 'media', id },
      }),
    })
  } catch (error) {
    return mediaErrorResponse(error)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = await mediaID(params)
    const { payload, req } = await authorizeMediaRequest(request)
    const input = await readMediaJSON(request)
    return mediaJSON({
      result: await executePortalRouteCommand({
        fingerprintInput: { id, input },
        operation: (transactionReq) =>
          deletePortalMedia({
            id,
            payload,
            req: transactionReq,
            updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
          }),
        payload,
        req,
        request,
        scope: `portal.media:delete:${id}`,
        target: { collection: 'media', id },
      }),
    })
  } catch (error) {
    return mediaErrorResponse(error)
  }
}
