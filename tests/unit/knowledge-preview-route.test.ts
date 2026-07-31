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
