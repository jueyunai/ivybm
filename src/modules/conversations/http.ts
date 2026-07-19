import { AiGatewayError } from '@/modules/ai/gateway'

import { ChatServiceError, type ChatErrorCode } from './contracts'

const statusFor = (code: ChatErrorCode): number => {
  switch (code) {
    case 'invalid_request': return 400
    case 'forbidden': return 403
    case 'not_found': return 404
    case 'conflict': return 409
    case 'rate_limited': return 429
    case 'ai_unavailable':
    case 'knowledge_unavailable': return 503
    default: return 500
  }
}

export const readChatJSON = async (request: Request): Promise<Record<string, unknown>> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 32 * 1024) {
    throw new ChatServiceError('invalid_request', 'Request body is too large')
  }
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > 32 * 1024) {
    throw new ChatServiceError('invalid_request', 'Request body is too large')
  }
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch {
    throw new ChatServiceError('invalid_request', 'Request body must be valid JSON')
  }
}

export const chatErrorResponse = (error: unknown): Response => {
  const normalized =
    error instanceof ChatServiceError
      ? error
      : error instanceof AiGatewayError
        ? new ChatServiceError('ai_unavailable', 'AI service is temporarily unavailable', {
            retryable: error.retryable,
          })
        : new ChatServiceError('internal_error', 'Chat service request failed')
  const headers = normalized.retryAfterSeconds
    ? { 'Retry-After': String(normalized.retryAfterSeconds) }
    : undefined
  return Response.json(
    {
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        ...(normalized.retryAfterSeconds
          ? { retryAfterSeconds: normalized.retryAfterSeconds }
          : {}),
      },
    },
    { headers, status: statusFor(normalized.code) },
  )
}

export const requireString = (
  body: Record<string, unknown>,
  field: string,
  maxLength = 5_000,
): string => {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ChatServiceError('invalid_request', `${field} is required`)
  }
  return value.trim()
}
