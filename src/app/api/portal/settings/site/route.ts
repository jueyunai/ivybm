import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  authorizeSiteSettingsRequest,
  readSiteSettingsJSON,
  siteSettingsErrorResponse,
  siteSettingsJSON,
} from '@/admin-portal/modules/settings/siteSettingsRoute'
import { updatePortalSiteSettings } from '@/admin-portal/modules/settings/siteSettingsCommands'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeSiteSettingsRequest(request)
    const input = await readSiteSettingsJSON(request)
    return siteSettingsJSON({
      result: await executePortalRouteCommand({
        fingerprintInput: input,
        operation: (transactionReq) =>
          updatePortalSiteSettings({ input, payload, req: transactionReq }),
        payload,
        req,
        request,
        scope: 'portal.settings:site:update',
      }),
    })
  } catch (error) {
    return siteSettingsErrorResponse(error)
  }
}
