import { readFile } from 'node:fs/promises'

import { NextRequest } from 'next/server'

import {
  authorizeKnowledgeSourceRequest,
  knowledgeSourceErrorResponse,
  requireKnowledgeSourceID,
} from '@/admin-portal/modules/knowledge/knowledgeSourceRoute'
import { knowledgeSourceStoragePath } from '@/modules/knowledge/ingestion/source'
import { validateStoredKnowledgeSourceFile } from '@/modules/knowledge/ingestion/parser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = requireKnowledgeSourceID((await params).id)
    const { payload, req } = await authorizeKnowledgeSourceRequest(request)
    const source = await payload.findByID({
      collection: 'knowledge-source-documents',
      depth: 0,
      id,
      overrideAccess: false,
      req,
    })
    if (typeof source.filename !== 'string' || typeof source.mimeType !== 'string') {
      return new Response('Not found', { status: 404 })
    }
    let data: Buffer
    try {
      data = await readFile(knowledgeSourceStoragePath(source.filename))
      // Payload can persist a DOCX as application/zip after content sniffing;
      // validate and normalize that representation before serving it.
      const valid = validateStoredKnowledgeSourceFile({
        data,
        mimetype: source.mimeType,
        name: source.filename,
        size: data.length,
      })
      return new Response(data, {
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
          'Content-Type': valid.mimetype,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      // A missing or tampered private object is intentionally indistinguishable
      // from a missing source to avoid leaking filesystem details.
      return new Response('Not found', { status: 404 })
    }
  } catch (error) {
    if ((error as { status?: unknown })?.status === 404) {
      return new Response('Not found', { status: 404 })
    }
    return knowledgeSourceErrorResponse(error)
  }
}
