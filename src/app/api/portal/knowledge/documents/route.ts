import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  createPortalKnowledgeDocument,
  getPortalKnowledgeOptions,
} from '@/admin-portal/modules/knowledge/knowledgeCommands'
import {
  authorizeKnowledgeRequest,
  knowledgeErrorResponse,
  knowledgeJSON,
  readKnowledgeDocumentJSON,
} from '@/admin-portal/modules/knowledge/knowledgeRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeKnowledgeRequest(request)
    return knowledgeJSON({ options: await getPortalKnowledgeOptions({ payload, req }) })
  } catch (error) {
    return knowledgeErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeKnowledgeRequest(request)
    const input = await readKnowledgeDocumentJSON(request)
    const result = await executePortalRouteCommand({
      fingerprintInput: input,
      operation: (transactionReq) =>
        createPortalKnowledgeDocument({ input, payload, req: transactionReq }),
      payload,
      req,
      request,
      scope: 'portal.knowledge:create',
    })
    return knowledgeJSON({ result }, { status: 201 })
  } catch (error) {
    return knowledgeErrorResponse(error)
  }
}
