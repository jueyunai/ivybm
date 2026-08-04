import { NextRequest } from 'next/server'

import {
  executePortalRouteCommand,
  portalCommandFingerprint,
} from '@/admin-portal/core/commands/portalCommandReceipts'
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
    const result = await executePortalRouteCommand({
      fingerprintInput: {
        file: {
          mimetype: file.mimetype,
          name: file.name,
          sha256: portalCommandFingerprint(file.data.toString('base64')),
          size: file.size,
        },
        input,
      },
      operation: (transactionReq) =>
        createPortalMedia({ file, input, payload, req: transactionReq }),
      payload,
      req,
      request,
      scope: 'portal.media:create',
    })
    return mediaJSON({ result }, { status: 201 })
  } catch (error) {
    return mediaErrorResponse(error)
  }
}
