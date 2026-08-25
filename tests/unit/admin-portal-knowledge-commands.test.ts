import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import { runKnowledgeAiDebug } from '@/admin-portal/modules/knowledge/knowledgeAiDebugCommand'
import {
  KnowledgeCommandError,
  createPortalKnowledgeDocument,
  deletePortalKnowledgeDocument,
  parseKnowledgeMutation,
  updatePortalKnowledgeDocument,
} from '@/admin-portal/modules/knowledge/knowledgeCommands'
import { KNOWLEDGE_DOCUMENT_MAX_CONTENT_CHARACTERS } from '@/modules/knowledge/limits'

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

describe('Portal knowledge commands', () => {
  it('normalizes document input and rejects unsafe source URLs', () => {
    expect(
      parseKnowledgeMutation({
        action: 'save',
        content: '  Reviewed product facts ',
        customerVisible: true,
        locale: 'ar',
        sourceFileId: '12',
        sourceTitle: ' Product manual ',
        sourceType: 'product-manual',
        sourceURL: 'https://docs.example.invalid/manual',
        sourceVersion: ' 2.0 ',
      }),
    ).toMatchObject({
      action: 'save',
      data: {
        content: 'Reviewed product facts',
        customerVisible: true,
        locale: 'ar',
        reviewStatus: 'draft',
        sourceFile: 12,
        sourceTitle: 'Product manual',
        sourceType: 'product-manual',
        sourceURL: 'https://docs.example.invalid/manual',
        sourceVersion: '2.0',
      },
    })
    expect(() =>
      parseKnowledgeMutation({
        action: 'save',
        content: 'x',
        locale: 'en',
        sourceTitle: 'x',
        sourceType: 'faq',
        sourceURL: 'javascript:alert(1)',
        sourceVersion: '1',
      }),
    ).toThrow(KnowledgeCommandError)
  })

  it('accepts imported drafts above the previous Portal limit and enforces the shared limit', () => {
    const input = {
      action: 'save',
      customerVisible: false,
      locale: 'en',
      sourceTitle: 'Large imported draft',
      sourceType: 'sales-script',
      sourceVersion: '1',
    }
    const importedContent = 'x'.repeat(200_001)

    expect(
      parseKnowledgeMutation({ ...input, content: importedContent }).data.content,
    ).toHaveLength(200_001)
    expect(() =>
      parseKnowledgeMutation({
        ...input,
        content: 'x'.repeat(KNOWLEDGE_DOCUMENT_MAX_CONTENT_CHARACTERS + 1),
      }),
    ).toThrow('content is too long')
  })

  it('creates drafts with access control and explicit audit', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        id: 20,
        indexStatus: 'pending',
        reviewStatus: 'draft',
        sourceTitle: 'FAQ',
        updatedAt: '2026-07-30T10:00:00.000Z',
      })
      .mockResolvedValueOnce({ id: 90 })

    await expect(
      createPortalKnowledgeDocument({
        input: {
          content: 'Answer',
          customerVisible: false,
          locale: 'en',
          sourceTitle: 'FAQ',
          sourceType: 'faq',
          sourceVersion: '1.0',
        },
        payload: { create },
        req,
      }),
    ).resolves.toMatchObject({ id: 20, indexStatus: 'pending', reviewStatus: 'draft' })
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        collection: 'knowledge-documents',
        context: { skipAudit: true },
        overrideAccess: false,
        req,
      }),
    )
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ collection: 'audit-logs', overrideAccess: true, req }),
    )
  })

  it('rejects stale reviews and blocks deletion while indexing', async () => {
    const create = vi.fn()
    const deleteDocument = vi.fn()
    const findByID = vi.fn().mockResolvedValue({
      id: 20,
      indexStatus: 'processing',
      reviewStatus: 'draft',
      sourceTitle: 'FAQ',
      updatedAt: '2026-07-30T10:00:00.000Z',
    })
    const update = vi.fn()

    await expect(
      updatePortalKnowledgeDocument({
        id: 20,
        input: { action: 'review', updatedAt: '2026-07-30T09:00:00.000Z' },
        payload: { create, findByID, update },
        req,
      }),
    ).rejects.toMatchObject({ code: 'knowledge-stale', status: 409 })
    await expect(
      deletePortalKnowledgeDocument({
        id: 20,
        payload: { create, delete: deleteDocument, findByID },
        req,
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'knowledge-index-processing', status: 409 })
    expect(update).not.toHaveBeenCalled()
    expect(deleteDocument).not.toHaveBeenCalled()
  })

  it('prevents a knowledge source from being deleted while generated content cites it', async () => {
    const deleteDocument = vi.fn()
    const findByID = vi.fn().mockResolvedValue({
      id: 20,
      indexStatus: 'pending',
      reviewStatus: 'draft',
      sourceTitle: 'FAQ',
      updatedAt: '2026-07-30T10:00:00.000Z',
    })

    await expect(
      deletePortalKnowledgeDocument({
        id: 20,
        payload: {
          count: vi.fn().mockResolvedValue({ totalDocs: 1 }),
          create: vi.fn(),
          delete: deleteDocument,
          findByID,
        },
        req,
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'knowledge-in-use', status: 409 })
    expect(deleteDocument).not.toHaveBeenCalled()
  })

  it('enforces review and archive transitions and protects indexed chunks from deletion', async () => {
    const current = {
      id: 20,
      indexStatus: 'ready',
      reviewStatus: 'reviewed',
      sourceTitle: 'FAQ',
      updatedAt: '2026-07-30T10:00:00.000Z',
    }
    const update = vi.fn()

    await expect(
      updatePortalKnowledgeDocument({
        id: 20,
        input: { action: 'review', updatedAt: current.updatedAt },
        payload: {
          create: vi.fn(),
          findByID: vi.fn().mockResolvedValue({ ...current, reviewStatus: 'archived' }),
          update,
        },
        req,
      }),
    ).rejects.toMatchObject({ code: 'knowledge-invalid-transition', status: 409 })

    await expect(
      updatePortalKnowledgeDocument({
        id: 20,
        input: { action: 'archive', updatedAt: current.updatedAt },
        payload: {
          create: vi.fn(),
          findByID: vi.fn().mockResolvedValue({ ...current, reviewStatus: 'draft' }),
          update,
        },
        req,
      }),
    ).rejects.toMatchObject({ code: 'knowledge-invalid-transition', status: 409 })

    const count = vi
      .fn()
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 3 })
    await expect(
      deletePortalKnowledgeDocument({
        id: 20,
        payload: {
          count,
          create: vi.fn(),
          delete: vi.fn(),
          findByID: vi.fn().mockResolvedValue(current),
        },
        req,
        updatedAt: current.updatedAt,
      }),
    ).rejects.toMatchObject({ code: 'knowledge-indexed', status: 409 })
    expect(count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        collection: 'knowledge-chunks',
        overrideAccess: false,
        req,
      }),
    )
  })

  it('runs AI debug through previewKnowledge and returns citations and prompt metadata', async () => {
    const previewKnowledge = vi.fn().mockResolvedValue({
      citations: [
        { documentId: 10, title: 'Aluminum Specs', url: 'https://example.invalid', version: '1.0' },
      ],
      content: 'Aluminum double-curved panel answer',
      model: 'gpt-4o',
      outcome: 'answer',
      promptVersion: 3,
      tokenUsage: { inputTokens: 12, outputTokens: 20, totalTokens: 32 },
    })

    const result = await runKnowledgeAiDebug({
      input: { locale: 'en', prompt: 'Tell me about curved panels' },
      payload: {} as Payload,
      previewKnowledge: previewKnowledge as never,
    })

    expect(result).toMatchObject({
      citations: [
        { documentId: 10, title: 'Aluminum Specs', url: 'https://example.invalid', version: '1.0' },
      ],
      model: 'gpt-4o',
      outcome: 'answer',
      promptVersion: 3,
      text: 'Aluminum double-curved panel answer',
      usage: { inputTokens: 12, outputTokens: 20, totalTokens: 32 },
    })
    expect(previewKnowledge).toHaveBeenCalledWith({
      locale: 'en',
      payload: expect.anything(),
      query: 'Tell me about curved panels',
    })
  })

  it('handles handoff outcome from previewKnowledge gracefully', async () => {
    const previewKnowledge = vi.fn().mockResolvedValue({
      outcome: 'handoff',
      reason: 'risk_detected',
    })

    const result = await runKnowledgeAiDebug({
      input: { prompt: 'Competitor pricing' },
      payload: {} as Payload,
      previewKnowledge: previewKnowledge as never,
    })

    expect(result).toMatchObject({
      outcome: 'handoff',
      reason: 'risk_detected',
    })
    expect(result).not.toHaveProperty('text')
  })

  it('surfaces preview failures instead of disguising them as ungrounded answers', async () => {
    const failure = new Error('knowledge database unavailable')
    await expect(
      runKnowledgeAiDebug({
        input: { prompt: 'Test reviewed knowledge' },
        payload: {} as Payload,
        previewKnowledge: vi.fn().mockRejectedValue(failure),
      }),
    ).rejects.toBe(failure)
  })
})
