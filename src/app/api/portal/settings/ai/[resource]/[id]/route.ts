import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  deletePortalAiResource,
  parsePortalAiResource,
  requirePortalAiID,
  updatePortalAiResource,
} from '@/admin-portal/modules/settings/aiSettingsCommands'
import {
  aiSettingsErrorResponse,
  aiSettingsJSON,
  authorizeAiSettingsRequest,
  readAiSettingsJSON,
} from '@/admin-portal/modules/settings/aiSettingsRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ id: string; resource: string }> }

const targetFor = (resource: ReturnType<typeof parsePortalAiResource>, id: number) => ({
  collection: ({
    profiles: 'ai-model-profiles',
    providers: 'ai-providers',
    routes: 'ai-usage-routes',
  } as const)[resource],
  id,
})

export async function PATCH(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { id: idValue, resource: resourceValue } = await params
    const { payload, req } = await authorizeAiSettingsRequest(request)
    const resource = parsePortalAiResource(resourceValue)
    const id = requirePortalAiID(idValue)
    const input = await readAiSettingsJSON(request)
    return aiSettingsJSON(
      await executePortalRouteCommand({
        fingerprintInput: { id, input, resource },
        operation: (transactionReq) =>
          updatePortalAiResource({ id, input, payload, req: transactionReq, resource }),
        payload,
        req,
        request,
        scope: `portal.ai-settings:${resource}:update:${id}`,
        target: targetFor(resource, id),
      }),
    )
  } catch (error) {
    return aiSettingsErrorResponse(error)
  }
}

export async function DELETE(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { id: idValue, resource: resourceValue } = await params
    const { payload, req } = await authorizeAiSettingsRequest(request)
    const resource = parsePortalAiResource(resourceValue)
    const id = requirePortalAiID(idValue)
    const input = await readAiSettingsJSON(request)
    return aiSettingsJSON(
      await executePortalRouteCommand({
        fingerprintInput: { id, input, resource },
        operation: (transactionReq) =>
          deletePortalAiResource({ id, input, payload, req: transactionReq, resource }),
        payload,
        req,
        request,
        scope: `portal.ai-settings:${resource}:delete:${id}`,
        target: targetFor(resource, id),
      }),
    )
  } catch (error) {
    return aiSettingsErrorResponse(error)
  }
}
