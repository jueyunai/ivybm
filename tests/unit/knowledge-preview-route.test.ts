import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
  previewKnowledgeAnswer: vi.fn(),
}))

vi.mock('payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('@/payload.config', () => ({ default: {} }))
vi.mock('@/modules/knowledge/preview', () => ({
  previewKnowledgeAnswer: mocks.previewKnowledgeAnswer,
}))

import { POST } from '@/app/api/knowledge/preview/route'

const request = (body: unknown): NextRequest =>
  new NextRequest('http://localhost/api/knowledge/preview', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

const streamedRequest = (
  chunks: Array<string | Uint8Array>,
  headers: Record<string, string> = {},
): { cancel: ReturnType<typeof vi.fn>; request: NextRequest } => {
  const cancel = vi.fn()
  const encoder = new TextEncoder()
  const pending = [...chunks]
  const body = new ReadableStream<Uint8Array>(
    {
      cancel,
      pull(controller) {
        const chunk = pending.shift()
        if (chunk === undefined) {
          controller.close()
          return
        }
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      },
    },
    { highWaterMark: 0 },
  )
  return {
    cancel,
    request: new NextRequest(
      'http://localhost/api/knowledge/preview',
      {
        body,
        duplex: 'half',
        headers: { 'content-type': 'application/json', ...headers },
        method: 'POST',
      } as never,
    ),
  }
}

describe('knowledge preview route', () => {
  beforeEach(() => {
    mocks.getPayload.mockReset()
    mocks.previewKnowledgeAnswer.mockReset()
  })

  it('requires an admin or operator and never invokes AI for rejected users', async () => {
    const logger = { error: vi.fn() }
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user: null }),
      logger,
    })

    const unauthenticated = await POST(request({ locale: 'en', query: 'test' }))
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('cache-control')).toBe('no-store')

    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({
        user: { collection: 'users', id: 3, role: 'sales' },
      }),
      logger,
    })
    const forbidden = await POST(request({ locale: 'en', query: 'test' }))
    expect(forbidden.status).toBe(403)
    expect(mocks.previewKnowledgeAnswer).not.toHaveBeenCalled()
  })

  it('rejects malformed input before invoking AI', async () => {
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({
        user: { collection: 'users', id: 1, role: 'admin' },
      }),
      logger: { error: vi.fn() },
    })

    const response = await POST(request({ locale: 'fr', query: '' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_request' } })
    expect(mocks.previewKnowledgeAnswer).not.toHaveBeenCalled()
  })

  it.each([
    ['without Content-Length', {}],
    ['with a forged low Content-Length', { 'content-length': '1' }],
  ])('cancels an oversized streamed body %s', async (_description, headers) => {
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({
        user: { collection: 'users', id: 1, role: 'admin' },
      }),
      logger: { error: vi.fn() },
    })
    const raw = JSON.stringify({ locale: 'en', padding: 'x'.repeat(9_000), query: 'test' })
    const streamed = streamedRequest([raw.slice(0, 4_096), raw.slice(4_096)], headers)

    const response = await POST(streamed.request)

    expect(response.status).toBe(400)
    expect(streamed.cancel).toHaveBeenCalledTimes(1)
    expect(mocks.previewKnowledgeAnswer).not.toHaveBeenCalled()
  })

  it('cancels a body rejected by its declared Content-Length', async () => {
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({
        user: { collection: 'users', id: 1, role: 'admin' },
      }),
      logger: { error: vi.fn() },
    })
    const streamed = streamedRequest(['{}'], { 'content-length': '9000' })

    const response = await POST(streamed.request)

    expect(response.status).toBe(400)
    expect(streamed.cancel).toHaveBeenCalledTimes(1)
    expect(mocks.previewKnowledgeAnswer).not.toHaveBeenCalled()
  })

  it('cancels a stream containing malformed UTF-8', async () => {
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({
        user: { collection: 'users', id: 1, role: 'admin' },
      }),
      logger: { error: vi.fn() },
    })
    const streamed = streamedRequest([new Uint8Array([0xff]), '{}'])

    const response = await POST(streamed.request)

    expect(response.status).toBe(400)
    expect(streamed.cancel).toHaveBeenCalledTimes(1)
    expect(mocks.previewKnowledgeAnswer).not.toHaveBeenCalled()
  })

  it('returns a bounded preview without caching it', async () => {
    const payload = {
      auth: vi.fn().mockResolvedValue({
        user: { collection: 'users', id: 1, role: 'operator' },
      }),
      logger: { error: vi.fn() },
    }
    mocks.getPayload.mockResolvedValue(payload)
    mocks.previewKnowledgeAnswer.mockResolvedValue({
      citations: [{ documentId: 7, title: 'Panel guide', version: '1.0' }],
      content: 'Use the reviewed specification.',
      model: 'text-model',
      outcome: 'answer',
      promptVersion: 2,
      tokenUsage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    })

    const response = await POST(request({ locale: 'en', query: 'Which specification applies?' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ outcome: 'answer', model: 'text-model' })
    expect(mocks.previewKnowledgeAnswer).toHaveBeenCalledWith({
      locale: 'en',
      payload,
      query: 'Which specification applies?',
    })
  })

  it('returns a stable unavailable error without exposing provider failures', async () => {
    const logger = { error: vi.fn() }
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({
        user: { collection: 'users', id: 1, role: 'admin' },
      }),
      logger,
    })
    mocks.previewKnowledgeAnswer.mockRejectedValue(new Error('secret provider response'))

    const response = await POST(request({ locale: 'en', query: 'test query' }))
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).toBe(JSON.stringify({ error: { code: 'knowledge_preview_unavailable' } }))
    expect(body).not.toContain('secret provider response')
    expect(logger.error).toHaveBeenCalledWith('Knowledge preview endpoint unavailable')
  })
})
