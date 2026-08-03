import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
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
    const { payload, req } = await authorizeKnowledgeRequest(request, { adminOnly: true })
    const input = await readKnowledgeJSON(request)
    return knowledgeJSON({
      result: await executePortalRouteCommand({
        atomic: false,
        fingerprintInput: input,
        operation: () => runKnowledgeAiDebug({ input, payload }),
        payload,
        replayPolicy: 'unknown-on-expiry',
        req,
        request,
        scope: 'portal.knowledge:ai-debug',
      }),
    })
  } catch (error) {
    return knowledgeErrorResponse(error)
  }
}
