import { NextRequest } from 'next/server'

import { deletePortalMedia, updatePortalMedia } from '@/admin-portal/modules/media/mediaCommands'
import {
  authorizeMediaRequest,
  mediaErrorResponse,
  mediaJSON,
  readMediaJSON,
  requireMediaID,
} from '@/admin-portal/modules/media/mediaRoute'

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
    return mediaJSON({
      result: await updatePortalMedia({ id, input: await readMediaJSON(request), payload, req }),
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
      result: await deletePortalMedia({
        id,
        payload,
        req,
        updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
      }),
    })
  } catch (error) {
    return mediaErrorResponse(error)
  }
}
