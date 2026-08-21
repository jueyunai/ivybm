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

  it('runs AI debug through the injected gateway and returns only safe output', async () => {
    const generateText = vi.fn().mockResolvedValue({
      cost: { currency: 'USD', estimated: 0.001 },
      model: 'private-model',
      provider: 'private-provider',
      requestId: 'private-request-id',
      text: 'Safe answer',
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    })
    const resolveGateway = vi.fn().mockResolvedValue({ generateText })

    const result = await runKnowledgeAiDebug({
      input: { prompt: 'Test reviewed knowledge' },
      payload: {} as Payload,
      resolveGateway: resolveGateway as never,
    })
    expect(result).toMatchObject({
      text: 'Safe answer',
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    })
    expect(JSON.stringify(result)).not.toMatch(/private-model|private-provider|private-request-id/)
    expect(resolveGateway).toHaveBeenCalledWith(
      expect.objectContaining({ routes: [{ operation: 'text', usageKey: 'chat.reply' }] }),
    )
  })
})
