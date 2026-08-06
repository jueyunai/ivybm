import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  createPortalAiResource,
  parsePortalAiResource,
} from '@/admin-portal/modules/settings/aiSettingsCommands'
import {
  aiSettingsErrorResponse,
  aiSettingsJSON,
  authorizeAiSettingsRequest,
  readAiSettingsJSON,
} from '@/admin-portal/modules/settings/aiSettingsRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ resource: string }> }

export async function POST(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { payload, req } = await authorizeAiSettingsRequest(request)
    const resource = parsePortalAiResource((await params).resource)
    const input = await readAiSettingsJSON(request)
    const result = await executePortalRouteCommand({
      fingerprintInput: { input, resource },
      operation: (transactionReq) =>
        createPortalAiResource({ input, payload, req: transactionReq, resource }),
      payload,
      req,
      request,
      scope: `portal.ai-settings:${resource}:create`,
    })
    return aiSettingsJSON(result, { status: 201 })
  } catch (error) {
    return aiSettingsErrorResponse(error)
  }
}
