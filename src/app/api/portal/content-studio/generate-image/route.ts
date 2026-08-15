import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import { generateContentStudioImage } from '@/admin-portal/modules/content-studio/contentStudioCommands'
import {
  authorizeContentStudioRequest,
  contentStudioErrorResponse,
  contentStudioJSON,
  readContentStudioJSON,
} from '@/admin-portal/modules/content-studio/contentStudioRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeContentStudioRequest(request)
    const input = await readContentStudioJSON(request)
    const result = await executePortalRouteCommand({
      atomic: false,
      fingerprintInput: input,
      operation: (commandReq, execution) =>
        generateContentStudioImage({
          input,
          onProviderDispatch: execution.markExternalDispatch,
          payload,
          req: commandReq,
        }),
      payload,
      replayPolicy: 'unknown-on-expiry',
      req,
      request,
      scope: 'portal.content-studio:generate-image',
    })
    return contentStudioJSON(result, { status: 201 })
  } catch (error) {
    return contentStudioErrorResponse(error)
  }
}
