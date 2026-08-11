import { readFile } from 'node:fs/promises'

import { NextRequest } from 'next/server'

import {
  authorizeKnowledgeSourceRequest,
  knowledgeSourceErrorResponse,
  requireKnowledgeSourceID,
} from '@/admin-portal/modules/knowledge/knowledgeSourceRoute'
import { knowledgeSourceStoragePath } from '@/modules/knowledge/ingestion/source'
import { KNOWLEDGE_SOURCE_IMAGE_MIME_TYPES } from '@/modules/knowledge/ingestion/parser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> },
): Promise<Response> {
  try {
    const { id: sourceId, assetId: assetValue } = await params
    const id = requireKnowledgeSourceID(sourceId)
    const assetId = requireKnowledgeSourceID(assetValue)
    const { payload, req } = await authorizeKnowledgeSourceRequest(request)
    const asset = await payload.findByID({ collection: 'knowledge-source-assets', depth: 0, id: assetId, overrideAccess: false, req })
    const relation = asset.source && typeof asset.source === 'object' ? asset.source.id : asset.source
    if (
      String(relation) !== String(id) ||
      typeof asset.filename !== 'string' ||
      typeof asset.mimeType !== 'string' ||
      !KNOWLEDGE_SOURCE_IMAGE_MIME_TYPES.includes(asset.mimeType as never)
    ) {
      return new Response('Not found', { status: 404 })
    }
    const data = await readFile(knowledgeSourceStoragePath(asset.filename, true))
    return new Response(data, { headers: { 'Cache-Control': 'private, no-store', 'Content-Type': asset.mimeType, 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    if ((error as { status?: unknown })?.status === 404) return new Response('Not found', { status: 404 })
    return knowledgeSourceErrorResponse(error)
  }
}
