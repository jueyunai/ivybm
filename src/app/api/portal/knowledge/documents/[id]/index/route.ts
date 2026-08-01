import { NextRequest } from 'next/server'

import { KnowledgeCommandError } from '@/admin-portal/modules/knowledge/knowledgeCommands'
import {
  authorizeKnowledgeRequest,
  knowledgeErrorResponse,
  knowledgeJSON,
  requireKnowledgeID,
} from '@/admin-portal/modules/knowledge/knowledgeRoute'
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit'
import { enqueueKnowledgeIndexJob, KnowledgeIndexRequestError } from '@/modules/knowledge/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Embedding work can be billable. Keep the Portal route bounded before it
// reaches the durable queue; the queue's revision-based key deduplicates clicks.
const knowledgeIndexRateLimiter = createFixedWindowRateLimiter({
  limit: 30,
  windowMs: 10 * 60 * 1_000,
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { payload, req, role } = await authorizeKnowledgeRequest(request)
    const documentId = requireKnowledgeID((await params).id)
    const document = await payload.findByID({
      collection: 'knowledge-documents',
      depth: 0,
      id: documentId,
      overrideAccess: false,
      req,
    })
    if (document.reviewStatus !== 'reviewed') {
      throw new KnowledgeCommandError(
        'knowledge-not-reviewed',
        'Only reviewed knowledge documents can be indexed',
        409,
      )
    }

    const actorID = Number(req.user?.id)
    if (!Number.isSafeInteger(actorID) || actorID < 1) {
      throw new KnowledgeCommandError('knowledge-unauthenticated', 'Authentication required', 401)
    }
    const rate = knowledgeIndexRateLimiter.consume(`portal-knowledge-index:${actorID}`)
    if (!rate.allowed) {
      return knowledgeJSON(
        {
          error: {
            code: 'knowledge-index-rate-limited',
            message: 'Too many knowledge indexing requests. Try again later.',
          },
        },
        { headers: { 'Retry-After': String(rate.retryAfterSeconds) }, status: 429 },
      )
    }

    const result = await enqueueKnowledgeIndexJob({
      documentId,
      manualRetryActor: { id: actorID, role },
      payload,
      requestedBy: actorID,
    })
    return knowledgeJSON(
      { jobId: result.job.id, state: result.state, status: result.job.status },
      { status: result.state === 'created' ? 202 : 200 },
    )
  } catch (error) {
    if (error instanceof KnowledgeIndexRequestError && error.code === 'not_reviewed') {
      return knowledgeJSON(
        { error: { code: 'knowledge-not-reviewed', message: error.message } },
        { status: 409 },
      )
    }
    const candidate = error as { status?: unknown }
    if (candidate?.status === 404) {
      return knowledgeJSON(
        { error: { code: 'knowledge-document-not-found', message: 'Knowledge document was not found' } },
        { status: 404 },
      )
    }
    return knowledgeErrorResponse(error)
  }
}
