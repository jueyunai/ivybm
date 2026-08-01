export interface KnowledgeIndexResult {
  jobId: number
  state: 'created' | 'duplicate'
  status: 'dead' | 'failed' | 'pending' | 'processing' | 'succeeded'
}

type FetchKnowledgeIndex = (input: string, init: RequestInit) => Promise<Response>

export class KnowledgeIndexClientError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'KnowledgeIndexClientError'
    this.code = code
    this.status = status
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object'

export async function requestKnowledgeIndex(
  documentId: number | string,
  fetchImpl: FetchKnowledgeIndex = fetch,
): Promise<KnowledgeIndexResult> {
  const normalizedId = Number(documentId)
  if (!Number.isInteger(normalizedId) || normalizedId < 1) {
    throw new KnowledgeIndexClientError(
      'invalid_document_id',
      'Knowledge document ID is invalid',
      400,
    )
  }

  let response: Response
  try {
    response = await fetchImpl(`/api/portal/knowledge/documents/${normalizedId}/index`, {
      method: 'POST',
    })
  } catch (error) {
    throw new KnowledgeIndexClientError(
      'knowledge_index_network_failure',
      'Knowledge indexing request failed',
      0,
      error,
    )
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null
    throw new KnowledgeIndexClientError(
      (error && typeof error.code === 'string' && error.code) || 'knowledge_index_unavailable',
      (error && typeof error.message === 'string' && error.message) ||
        'Knowledge indexing is unavailable',
      response.status,
    )
  }

  if (
    !isRecord(body) ||
    typeof body.jobId !== 'number' ||
    !['created', 'duplicate'].includes(String(body.state)) ||
    !['pending', 'processing', 'succeeded', 'failed', 'dead'].includes(String(body.status))
  ) {
    throw new KnowledgeIndexClientError(
      'knowledge_index_invalid_response',
      'Knowledge indexing returned an invalid response',
      response.status,
    )
  }

  return body as unknown as KnowledgeIndexResult
}
