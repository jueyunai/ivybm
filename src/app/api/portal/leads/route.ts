import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import { createPortalLead } from '@/admin-portal/modules/leads/leadCommands'
import {
  authorizeLeadRequest,
  leadErrorResponse,
  leadJSON,
  readLeadJSON,
} from '@/admin-portal/modules/leads/leadRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { payload, req, role } = await authorizeLeadRequest(request)
    const input = await readLeadJSON(request)
    const result = await executePortalRouteCommand({
      fingerprintInput: input,
      operation: (transactionReq) =>
        createPortalLead({ input, payload, req: transactionReq, role }),
      payload,
      req,
      request,
      scope: 'portal.leads:create',
    })
    return leadJSON({ result }, { status: 201 })
  } catch (error) {
    return leadErrorResponse(error)
  }
}
