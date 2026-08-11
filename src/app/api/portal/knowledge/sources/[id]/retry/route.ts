import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import { retryKnowledgeSource } from '@/modules/knowledge/ingestion/source'
import {
  authorizeKnowledgeSourceRequest,
  knowledgeSourceErrorResponse,
  knowledgeSourceJSON,
  requireKnowledgeSourceID,
} from '@/admin-portal/modules/knowledge/knowledgeSourceRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = requireKnowledgeSourceID((await params).id)
    const { payload, req } = await authorizeKnowledgeSourceRequest(request, { adminOnly: true })
    const result = await executePortalRouteCommand({
      fingerprintInput: { id },
      operation: (transactionReq) => retryKnowledgeSource({ actor: { id: req.user?.id ?? 0, role: 'admin' }, id, payload, req: transactionReq, }),
      payload,
      req,
      request,
      scope: `portal.knowledge:sources:retry:${id}`,
      target: { collection: 'knowledge-source-documents', id },
    })
    return knowledgeSourceJSON(result)
  } catch (error) {
    return knowledgeSourceErrorResponse(error)
  }
}
