import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import { generateContentStudioDraft } from '@/admin-portal/modules/content-studio/contentStudioCommands'
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
      operation: (commandReq) => generateContentStudioDraft({ input, payload, req: commandReq }),
      payload,
      replayPolicy: 'unknown-on-expiry',
      req,
      request,
      scope: 'portal.content-studio:generate',
    })
    return contentStudioJSON(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    return contentStudioErrorResponse(error)
  }
}
