import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import { createKnowledgeSourceAndEnqueue } from '@/modules/knowledge/ingestion/source'
import { sha256 } from '@/modules/knowledge/ingestion/parser'
import {
  authorizeKnowledgeSourceRequest,
  knowledgeSourceErrorResponse,
  knowledgeSourceJSON,
  readKnowledgeSourceUpload,
  safeKnowledgeSourceSummary,
} from '@/admin-portal/modules/knowledge/knowledgeSourceRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeKnowledgeSourceRequest(request)
    const result = await payload.find({
      collection: 'knowledge-source-documents',
      depth: 0,
      limit: 50,
      overrideAccess: false,
      pagination: false,
      req,
      select: { completedAt: true, detectedLanguage: true, errorCode: true, errorSummary: true, filename: true, filesize: true, id: true, imageCount: true, mimeType: true, processingStage: true, processingStatus: true, sourceTitle: true, sourceType: true, sourceVersion: true, updatedAt: true },
      sort: '-updatedAt',
    })
    return knowledgeSourceJSON({ sources: result.docs.map((doc) => safeKnowledgeSourceSummary(doc as unknown as Record<string, unknown>)) })
  } catch (error) {
    return knowledgeSourceErrorResponse(error)
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeKnowledgeSourceRequest(request)
    const { file, input } = await readKnowledgeSourceUpload(request)
    const result = await executePortalRouteCommand({
      fingerprintInput: {
        file: { name: file.name, mimetype: file.mimetype, size: file.size, sha256: sha256(file.data) },
        input,
      },
      operation: (transactionReq) => createKnowledgeSourceAndEnqueue({ file, metadata: input, payload, req: transactionReq }),
      payload,
      req,
      request,
      scope: 'portal.knowledge:sources:create',
    })
    return knowledgeSourceJSON(result, { status: result.state === 'created' ? 201 : 200 })
  } catch (error) {
    return knowledgeSourceErrorResponse(error)
  }
}
