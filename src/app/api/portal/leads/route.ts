import { NextRequest } from 'next/server'

import { createPortalLead } from '@/admin-portal/modules/leads/leadCommands'
import { authorizeLeadRequest, leadErrorResponse, leadJSON, readLeadJSON } from '@/admin-portal/modules/leads/leadRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { payload, req, role } = await authorizeLeadRequest(request)
    return leadJSON({ result: await createPortalLead({ input: await readLeadJSON(request), payload, req, role }) }, { status: 201 })
  } catch (error) {
    return leadErrorResponse(error)
  }
}
