import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { enqueueKnowledgeIndexJob, KnowledgeIndexRequestError } from '@/modules/knowledge/jobs'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const errorResponse = (status: number, code: string, message: string): Response =>
  NextResponse.json({ error: { code, message } }, { status })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return errorResponse(401, 'authentication_required', 'Authentication is required')
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin' && actor.role !== 'operator') {
      return errorResponse(403, 'forbidden', 'Knowledge indexing requires an operator')
    }

    const { id } = await params
    const documentId = Number(id)
    if (!Number.isInteger(documentId) || documentId < 1) {
      return errorResponse(400, 'invalid_document_id', 'Knowledge document ID is invalid')
    }

    const result = await enqueueKnowledgeIndexJob({
      documentId,
      payload,
      requestedBy: Number(actor.id),
    })
    return NextResponse.json(
      {
        jobId: result.job.id,
        state: result.state,
        status: result.job.status,
      },
      { status: result.state === 'created' ? 202 : 200 },
    )
  } catch (error) {
    if (error instanceof KnowledgeIndexRequestError && error.code === 'not_reviewed') {
      return errorResponse(409, 'knowledge_not_reviewed', error.message)
    }
    const status =
      typeof error === 'object' && error && 'status' in error && error.status === 404 ? 404 : 503
    return errorResponse(
      status,
      status === 404 ? 'knowledge_document_not_found' : 'knowledge_index_unavailable',
      status === 404 ? 'Knowledge document was not found' : 'Knowledge indexing is unavailable',
    )
  }
}
