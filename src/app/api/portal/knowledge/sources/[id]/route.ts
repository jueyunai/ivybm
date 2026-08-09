import { NextRequest } from 'next/server'

import {
  authorizeKnowledgeSourceRequest,
  knowledgeSourceErrorResponse,
  knowledgeSourceJSON,
  requireKnowledgeSourceID,
  safeKnowledgeSourceAsset,
  safeKnowledgeSourceOutput,
  safeKnowledgeSourceSummary,
} from '@/admin-portal/modules/knowledge/knowledgeSourceRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = requireKnowledgeSourceID((await params).id)
    const { payload, req } = await authorizeKnowledgeSourceRequest(request)
    const [source, outputs, assets] = await Promise.all([
      payload.findByID({ collection: 'knowledge-source-documents', depth: 0, id, overrideAccess: false, req }),
      payload.find({ collection: 'knowledge-documents', depth: 0, limit: 10, overrideAccess: false, pagination: false, req, select: { customerVisible: true, id: true, indexStatus: true, locale: true, reviewStatus: true, riskTopics: true, sourceTitle: true }, where: { ingestionSource: { equals: id } } }),
      payload.find({ collection: 'knowledge-source-assets', depth: 0, limit: 100, overrideAccess: false, pagination: false, req, select: { id: true, mimeType: true, originalName: true, sequence: true }, sort: 'sequence', where: { source: { equals: id } } }),
    ])
    return knowledgeSourceJSON({
      assets: assets.docs.map((asset) => safeKnowledgeSourceAsset(asset as unknown as Record<string, unknown>, id)),
      outputs: outputs.docs.map((document) => safeKnowledgeSourceOutput(document as unknown as Record<string, unknown>)),
      source: safeKnowledgeSourceSummary(source as unknown as Record<string, unknown>),
    })
  } catch (error) {
    return knowledgeSourceErrorResponse(error)
  }
}
