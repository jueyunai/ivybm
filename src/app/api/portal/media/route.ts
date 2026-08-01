import { NextRequest } from 'next/server'

import { createPortalMedia } from '@/admin-portal/modules/media/mediaCommands'
import {
  authorizeMediaRequest,
  mediaErrorResponse,
  mediaJSON,
  readMediaUpload,
} from '@/admin-portal/modules/media/mediaRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeMediaRequest(request)
    const { file, input } = await readMediaUpload(request)
    return mediaJSON(
      { result: await createPortalMedia({ file, input, payload, req }) },
      { status: 201 },
    )
  } catch (error) {
    return mediaErrorResponse(error)
  }
}
