import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  deletePortalKnowledgeDocument,
  getPortalKnowledgeEditor,
  getPortalKnowledgeOptions,
  updatePortalKnowledgeDocument,
} from '@/admin-portal/modules/knowledge/knowledgeCommands'
import {
  authorizeKnowledgeRequest,
  knowledgeErrorResponse,
  knowledgeJSON,
  readKnowledgeDocumentJSON,
  readKnowledgeJSON,
  requireKnowledgeID,
} from '@/admin-portal/modules/knowledge/knowledgeRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const documentID = async (params: Promise<{ id: string }>) => requireKnowledgeID((await params).id)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = await documentID(params)
    const { payload, req } = await authorizeKnowledgeRequest(request)
    const [record, options] = await Promise.all([
      getPortalKnowledgeEditor({ id, payload, req }),
      getPortalKnowledgeOptions({ payload, req }),
    ])
    return knowledgeJSON({ options, record })
  } catch (error) {
    return knowledgeErrorResponse(error)
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = await documentID(params)
    const { payload, req } = await authorizeKnowledgeRequest(request)
    const input = await readKnowledgeDocumentJSON(request)
    return knowledgeJSON({
      result: await executePortalRouteCommand({
        fingerprintInput: { id, input },
        operation: (transactionReq) =>
          updatePortalKnowledgeDocument({ id, input, payload, req: transactionReq }),
        payload,
        req,
        request,
        scope: `portal.knowledge:update:${id}:${String(input.action ?? 'save')}`,
        target: { collection: 'knowledge-documents', id },
      }),
    })
  } catch (error) {
    return knowledgeErrorResponse(error)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = await documentID(params)
    const { payload, req } = await authorizeKnowledgeRequest(request)
    const input = await readKnowledgeJSON(request)
    return knowledgeJSON({
      result: await executePortalRouteCommand({
        fingerprintInput: { id, input },
        operation: (transactionReq) =>
          deletePortalKnowledgeDocument({
            id,
            payload,
            req: transactionReq,
            updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
          }),
        payload,
        req,
        request,
        scope: `portal.knowledge:delete:${id}`,
        target: { collection: 'knowledge-documents', id },
      }),
    })
  } catch (error) {
    return knowledgeErrorResponse(error)
  }
}
