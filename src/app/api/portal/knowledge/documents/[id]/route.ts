import { NextRequest } from 'next/server'

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
    return knowledgeJSON({
      result: await updatePortalKnowledgeDocument({
        id,
        input: await readKnowledgeJSON(request),
        payload,
        req,
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
      result: await deletePortalKnowledgeDocument({
        id,
        payload,
        req,
        updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
      }),
    })
  } catch (error) {
    return knowledgeErrorResponse(error)
  }
}
