import React from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import {
  getKnowledgePage,
  KnowledgePageReadError,
  loadKnowledgePageData,
  parseKnowledgeQuery,
} from '@/admin-portal/modules/knowledge/getKnowledgePage'
import { KnowledgeWorkspace } from '@/admin-portal/modules/knowledge/KnowledgeWorkspace'
import {
  KnowledgeIndexClientError,
  requestKnowledgeIndex,
} from '@/admin-portal/modules/knowledge/requestKnowledgeIndex'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const baseQuery = {
  index: 'all' as const,
  locale: 'all' as const,
  page: 1,
  q: '',
  review: 'all' as const,
  sourceType: 'all' as const,
  visibility: 'all' as const,
}

const knowledgeFind = vi.fn(async (options: { collection: string }) => {
  if (options.collection === 'knowledge-documents') {
    return {
      docs: [
        {
          content: 'must not cross the Portal boundary',
          customerVisible: true,
          embeddingModel: 'text-embedding-3-small',
          embeddingSpace: 'safe-fingerprint',
          id: 21,
          indexJobId: 501,
          indexOwnerToken: 'secret-owner',
          indexStatus: 'pending',
          indexedAt: null,
          locale: 'en',
          reviewStatus: 'reviewed',
          reviewedAt: '2026-07-30T09:00:00.000Z',
          sourceTitle: 'Facade installation FAQ',
          sourceType: 'faq',
          sourceVersion: '2.1',
          updatedAt: '2026-07-30T09:30:00.000Z',
        },
      ],
      page: 1,
      totalDocs: 1,
      totalPages: 1,
    }
  }
  if (options.collection === 'prompt-templates') {
    return {
      docs: [
        {
          id: 31,
          key: 'customer-chat',
          locale: 'all',
          model: 'gpt-compatible',
          purpose: 'customer-chat',
          status: 'active',
          template: 'must not cross the Portal boundary',
          updatedAt: '2026-07-30T08:00:00.000Z',
          variables: { secret: true },
          version: 3,
        },
      ],
    }
  }
  if (options.collection === 'ai-usage-routes') {
    return {
      docs: [
        {
          enabled: true,
          id: 41,
          operation: 'embedding',
          profile: {
            enabled: true,
            id: 51,
            model: 'text-embedding-3-small',
            name: 'Knowledge embedding',
            parameters: { dimensions: 1536 },
            provider: {
              apiKey: 'must-not-leak',
              apiKeyConfigured: true,
              enabled: true,
              id: 61,
              name: 'OpenAI compatible',
            },
          },
          usageKey: 'knowledge.embedding',
        },
      ],
    }
  }
  throw new Error(`Unexpected collection: ${options.collection}`)
})

describe('Portal knowledge workspace', () => {
  it('normalizes URL filters into a bounded query', () => {
    expect(
      parseKnowledgeQuery({
        index: 'failed',
        locale: 'ar',
        page: '4',
        q: '  facade  ',
        review: 'reviewed',
        sourceType: 'technical-specification',
        visibility: 'customer',
      }),
    ).toEqual({
      index: 'failed',
      locale: 'ar',
      page: 4,
      q: 'facade',
      review: 'reviewed',
      sourceType: 'technical-specification',
      visibility: 'customer',
    })

    expect(
      parseKnowledgeQuery({
        index: 'unknown',
        locale: 'fr',
        page: '-1',
        q: 'x'.repeat(120),
        review: 'approved',
        sourceType: 'spreadsheet',
        visibility: 'unknown',
      }),
    ).toEqual({ ...baseQuery, q: 'x'.repeat(80) })
  })

  it('uses bounded access-controlled reads and maps only safe DTO fields', async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce({ totalDocs: 4 })
      .mockResolvedValueOnce({ totalDocs: 2 })
      .mockResolvedValueOnce({ totalDocs: 1 })
      .mockResolvedValueOnce({ totalDocs: 1 })
    const find = knowledgeFind.mockClear()
    const payload = { count, find } as unknown as Payload

    const summary = await getKnowledgePage({
      payload,
      query: baseQuery,
      req,
      role: 'admin',
    })

    expect(count).toHaveBeenCalledTimes(4)
    expect(find).toHaveBeenCalledTimes(3)
    for (const call of [...count.mock.calls, ...find.mock.calls]) {
      expect(call[0]).toMatchObject({ overrideAccess: false, req })
    }
    expect(summary.counts).toEqual({ draft: 2, failed: 1, processing: 1, ready: 4 })
    expect(summary.documents[0]).toMatchObject({
      id: 21,
      indexStatus: 'pending',
      reviewStatus: 'reviewed',
      sourceTitle: 'Facade installation FAQ',
    })
    expect(summary.ai.access).toBe('admin')
    expect(summary.ai.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimensions: 1536,
          model: 'text-embedding-3-small',
          provider: 'OpenAI compatible',
          status: 'ready',
          usageKey: 'knowledge.embedding',
        }),
        expect.objectContaining({
          status: 'action-required',
          usageKey: 'chat.reply',
        }),
      ]),
    )
    expect(JSON.stringify(summary)).not.toMatch(
      /must not cross|secret-owner|must-not-leak|indexJobId|indexOwnerToken|template|variables/i,
    )
  })

  it('does not expose admin AI configuration to operators', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 0 })
    const find = knowledgeFind.mockClear()
    const payload = { count, find } as unknown as Payload

    const summary = await getKnowledgePage({
      payload,
      query: baseQuery,
      req,
      role: 'operator',
    })

    expect(summary.ai).toEqual({ access: 'admin-only', routes: [] })
    expect(summary.commands).not.toContain('knowledge:ai-debug')
    expect(find).toHaveBeenCalledTimes(2)
    expect(find).not.toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'ai-usage-routes' }),
    )
  })

  it('short-circuits forbidden and disabled states before knowledge reads', async () => {
    const payload = {
      count: vi.fn(() => Promise.reject(new Error('must not execute'))),
      find: vi.fn(() => Promise.reject(new Error('must not execute'))),
    } as unknown as Payload

    await expect(
      loadKnowledgePageData({
        env: { ADMIN_PORTAL_ENABLED: 'true', ADMIN_PORTAL_KNOWLEDGE_ENABLED: 'true' },
        payload,
        query: baseQuery,
        req,
        role: 'sales',
      }),
    ).resolves.toEqual({ state: 'forbidden', summary: null })

    await expect(
      loadKnowledgePageData({
        env: { ADMIN_PORTAL_ENABLED: 'true' },
        payload,
        query: baseQuery,
        req,
        role: 'admin',
      }),
    ).resolves.toEqual({ state: 'module-disabled', summary: null })

    expect(payload.count).not.toHaveBeenCalled()
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('surfaces read failures instead of returning an empty workspace', async () => {
    const payload = {
      count: vi.fn().mockRejectedValue(new Error('database unavailable')),
      find: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as Payload

    await expect(
      getKnowledgePage({ payload, query: baseQuery, req, role: 'operator' }),
    ).rejects.toBeInstanceOf(KnowledgePageReadError)
  })

  it('maps the protected index command response and stable failures', async () => {
    const acceptedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jobId: 71, state: 'created', status: 'pending' }), {
        status: 202,
      }),
    )
    await expect(requestKnowledgeIndex(21, acceptedFetch)).resolves.toEqual({
      jobId: 71,
      state: 'created',
      status: 'pending',
    })
    expect(acceptedFetch).toHaveBeenCalledWith('/api/portal/knowledge/documents/21/index', {
      headers: {
        'Idempotency-Key': expect.stringMatching(/^portal-knowledge-index:[0-9a-f-]{36}$/),
      },
      method: 'POST',
    })

    const rejectedFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'knowledge-not-reviewed', message: 'Review required' } }),
          { status: 409 },
        ),
      )
    await expect(requestKnowledgeIndex(21, rejectedFetch)).rejects.toMatchObject({
      code: 'knowledge-not-reviewed',
      status: 409,
    } satisfies Partial<KnowledgeIndexClientError>)

    const duplicateFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jobId: 71, state: 'duplicate', status: 'failed' }), {
        status: 200,
      }),
    )
    await expect(requestKnowledgeIndex(21, duplicateFetch)).resolves.toEqual({
      jobId: 71,
      state: 'duplicate',
      status: 'failed',
    })

    for (const invalidBody of [
      { jobId: '71', state: 'created', status: 'pending' },
      { jobId: 71, state: 'retried', status: 'pending' },
      { jobId: 71, state: 'created', status: 'ready' },
    ]) {
      const invalidFetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(invalidBody), { status: 200 }))
      await expect(requestKnowledgeIndex(21, invalidFetch)).rejects.toMatchObject({
        code: 'knowledge_index_invalid_response',
        status: 200,
      } satisfies Partial<KnowledgeIndexClientError>)
    }

    await expect(requestKnowledgeIndex(0, vi.fn())).rejects.toMatchObject({
      code: 'invalid_document_id',
      status: 400,
    })
    await expect(
      requestKnowledgeIndex(21, vi.fn().mockRejectedValue(new Error('offline'))),
    ).rejects.toMatchObject({ code: 'knowledge_index_network_failure', status: 0 })
    await expect(
      requestKnowledgeIndex(21, vi.fn().mockResolvedValue(new Response('{', { status: 202 }))),
    ).rejects.toMatchObject({ code: 'knowledge_index_invalid_response', status: 202 })
  })

  it('renders review/index states, safe configuration, and a guarded index action', () => {
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(KnowledgeWorkspace, {
          pageState: 'available',
          summary: {
            ai: { access: 'admin-only', routes: [] },
            commands: [
              'knowledge:create',
              'knowledge:update',
              'knowledge:review',
              'knowledge:archive',
              'knowledge:delete',
              'knowledge:index',
            ],
            counts: { draft: 2, failed: 1, processing: 1, ready: 4 },
            documents: [
              {
                customerVisible: true,
                embeddingModel: null,
                embeddingSpace: null,
                id: 21,
                indexStatus: 'pending',
                indexedAt: null,
                locale: 'en',
                reviewStatus: 'reviewed',
                reviewedAt: '2026-07-30T09:00:00.000Z',
                sourceTitle: 'Facade installation FAQ',
                sourceType: 'faq',
                sourceVersion: '2.1',
                updatedAt: '2026-07-30T09:30:00.000Z',
              },
            ],
            editor: { status: 'available' },
            pagination: { page: 1, totalDocs: 1, totalPages: 1 },
            prompts: [],
            query: baseQuery,
            role: 'operator',
          },
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: '知识文档' })).toBeTruthy()
    expect(screen.getAllByText('审核通过').length).toBeGreaterThan(0)
    expect(screen.getAllByText('等待索引').length).toBeGreaterThan(0)
    expect(screen.getByText('仅管理员可查看模型配置')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始索引' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新增文档' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '编辑文档' })).toBeTruthy()
  })
})
