import { NextRequest } from 'next/server'

import { deletePortalLead, updatePortalLead } from '@/admin-portal/modules/leads/leadCommands'
import { authorizeLeadRequest, leadErrorResponse, leadJSON, readLeadJSON, requireLeadID } from '@/admin-portal/modules/leads/leadRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const leadID = async (params: Promise<{ id: string }>) => requireLeadID((await params).id)

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const [id, authorized, input] = await Promise.all([leadID(params), authorizeLeadRequest(request), readLeadJSON(request)])
    return leadJSON({ result: await updatePortalLead({ id, input, ...authorized }) })
  } catch (error) {
    return leadErrorResponse(error)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const [id, authorized, input] = await Promise.all([leadID(params), authorizeLeadRequest(request), readLeadJSON(request)])
    return leadJSON({ result: await deletePortalLead({ id, input, ...authorized }) })
  } catch (error) {
    return leadErrorResponse(error)
  }
}
