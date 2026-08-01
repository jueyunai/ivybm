import { NextRequest } from 'next/server'

import { runKnowledgeAiDebug } from '@/admin-portal/modules/knowledge/knowledgeAiDebugCommand'
import {
  authorizeKnowledgeRequest,
  knowledgeErrorResponse,
  knowledgeJSON,
  readKnowledgeJSON,
} from '@/admin-portal/modules/knowledge/knowledgeRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { payload } = await authorizeKnowledgeRequest(request, { adminOnly: true })
    return knowledgeJSON({
      result: await runKnowledgeAiDebug({ input: await readKnowledgeJSON(request), payload }),
    })
  } catch (error) {
    return knowledgeErrorResponse(error)
  }
}
