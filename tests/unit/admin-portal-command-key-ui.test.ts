import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { ScheduleEditor } from '@/admin-portal/modules/content-studio/ContentStudio'
import type { ContentStudioItem } from '@/admin-portal/modules/content-studio/getContentStudioPage'
import { getContentStudioMessages } from '@/admin-portal/modules/content-studio/messages'
import { KnowledgeEditor } from '@/admin-portal/modules/knowledge/KnowledgeEditor'
import { KnowledgeAiDebug } from '@/admin-portal/modules/knowledge/KnowledgeAiDebug'
import { LeadsHub } from '@/admin-portal/modules/leads/LeadsHub'
import type { LeadsSummary } from '@/admin-portal/modules/leads/getLeadsPage'
import { MediaEditor } from '@/admin-portal/modules/media/MediaEditor'

const router = { refresh: vi.fn(), replace: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}))

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })

const interruptedJsonResponse = () =>
  ({
    json: vi.fn().mockRejectedValue(new TypeError('response body interrupted')),
    ok: true,
    status: 200,
  }) as unknown as Response

const headerValue = (init: RequestInit | undefined, name: string): string | null =>
  new Headers(init?.headers).get(name)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  router.refresh.mockReset()
  router.replace.mockReset()
})

describe('Portal create command keys', () => {
  it('reuses the AI debug key after an interrupted response body and rotates when the prompt changes', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(interruptedJsonResponse())
      .mockResolvedValueOnce(jsonResponse({ result: { text: 'second', usage: { totalTokens: 2 } } }))
      .mockResolvedValueOnce(jsonResponse({ result: { text: 'changed', usage: { totalTokens: 3 } } }))
    vi.stubGlobal('fetch', request)
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(KnowledgeAiDebug),
      ),
    )

    const input = screen.getByLabelText('调试输入')
    fireEvent.change(input, { target: { value: 'same prompt' } })
    fireEvent.click(screen.getByRole('button', { name: '运行调试' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '运行调试' }))
    await screen.findByText(/second/)
    fireEvent.change(input, { target: { value: 'changed prompt' } })
    fireEvent.click(screen.getByRole('button', { name: '运行调试' }))
    await screen.findByText(/changed/)

    const keys = request.mock.calls.map((call) => headerValue(call[1], 'Idempotency-Key'))
    expect(keys[0]).toMatch(/^portal-knowledge-ai:/)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[1])
  })

  it('rotates the AI debug key after a fully parsed terminal error response', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Rejected prompt' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ result: { text: 'retry', usage: { totalTokens: 2 } } }))
    vi.stubGlobal('fetch', request)
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(KnowledgeAiDebug),
      ),
    )

    fireEvent.change(screen.getByLabelText('调试输入'), { target: { value: 'terminal error' } })
    fireEvent.click(screen.getByRole('button', { name: '运行调试' }))
    await screen.findByText('Rejected prompt')
    fireEvent.click(screen.getByRole('button', { name: '运行调试' }))
    await screen.findByText(/retry/)

    const firstKey = headerValue(request.mock.calls[0]?.[1], 'Idempotency-Key')
    const secondKey = headerValue(request.mock.calls[1]?.[1], 'Idempotency-Key')
    expect(firstKey).toMatch(/^portal-knowledge-ai:/)
    expect(secondKey).not.toBe(firstKey)
  })

  it('reuses the media upload key after an interrupted response body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(interruptedJsonResponse())
      .mockResolvedValueOnce(
        jsonResponse({ result: { updatedAt: '2026-08-03T00:00:00.000Z' } }, 201),
      )
    vi.stubGlobal('fetch', request)
    const onClose = vi.fn()
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(MediaEditor, { item: null, mode: 'create', onClose }),
      ),
    )

    fireEvent.change(screen.getByLabelText('文件'), {
      target: { files: [new File(['asset'], 'asset.png', { type: 'image/png' })] },
    })
    fireEvent.change(screen.getByLabelText('替代文本 alt'), { target: { value: 'Asset alt' } })
    fireEvent.change(screen.getByLabelText('版权 / 来源'), { target: { value: 'Internal test' } })
    fireEvent.click(screen.getByRole('button', { name: '上传素材' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '上传素材' }).hasAttribute('disabled')).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: '上传素材' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    const firstKey = headerValue(request.mock.calls[0]?.[1], 'Idempotency-Key')
    const secondKey = headerValue(request.mock.calls[1]?.[1], 'Idempotency-Key')
    expect(firstKey).toMatch(/^portal-media:/)
    expect(secondKey).toBe(firstKey)
  })

  it('reuses the knowledge create key after an interrupted response body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ options: { media: [] } }))
      .mockResolvedValueOnce(interruptedJsonResponse())
      .mockResolvedValueOnce(
        jsonResponse({ result: { updatedAt: '2026-08-03T00:00:00.000Z' } }, 201),
      )
    vi.stubGlobal('fetch', request)
    const onClose = vi.fn()
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(KnowledgeEditor, { item: null, mode: 'create', onClose }),
      ),
    )

    await screen.findByRole('heading', { name: '新增文档' })
    fireEvent.change(screen.getByLabelText('来源标题'), {
      target: { value: 'Stable key document' },
    })
    fireEvent.change(screen.getByLabelText('知识正文'), { target: { value: 'Verified content' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存草稿' }).hasAttribute('disabled')).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    const firstKey = headerValue(request.mock.calls[1]?.[1], 'Idempotency-Key')
    const secondKey = headerValue(request.mock.calls[2]?.[1], 'Idempotency-Key')
    expect(firstKey).toMatch(/^portal-knowledge:/)
    expect(secondKey).toBe(firstKey)
  })

  it('reuses the schedule key after an interrupted response body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(interruptedJsonResponse())
      .mockResolvedValueOnce(jsonResponse({ result: { duplicate: true } }))
    vi.stubGlobal('fetch', request)
    const item: ContentStudioItem = {
      assets: [],
      body: 'Approved body',
      contentLocale: 'en',
      contentType: 'post',
      id: 17,
      knowledgeSources: [],
      platform: 'linkedin',
      publishJobs: [],
      reviews: [],
      sourceReferences: [{ claim: 'Claim', source: 'Source' }],
      status: 'approved',
      title: 'Approved draft',
      updatedAt: '2026-08-03T00:00:00.000Z',
    }
    const onDone = vi.fn()
    render(
      React.createElement(ScheduleEditor, {
        copy: getContentStudioMessages('zh'),
        item,
        onClose: vi.fn(),
        onDone,
      }),
    )

    fireEvent.change(screen.getByLabelText('计划时间'), {
      target: { value: '2030-01-01T10:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建内部排期' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '创建内部排期' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))

    const firstBody = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as {
      idempotencyKey: string
    }
    const secondBody = JSON.parse(String(request.mock.calls[1]?.[1]?.body)) as {
      idempotencyKey: string
    }
    expect(firstBody.idempotencyKey).toMatch(/^portal-content-studio:schedule:/)
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey)
  })

  it('reuses the lead create key after an interrupted response body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(interruptedJsonResponse())
      .mockResolvedValueOnce(
        jsonResponse({ result: { id: 27, updatedAt: '2026-08-04T00:00:00.000Z' } }, 201),
      )
    vi.stubGlobal('fetch', request)
    const summary: LeadsSummary = {
      items: [],
      options: { sources: [{ id: 4, label: 'Manual' }], users: [] },
      pagination: { page: 1, totalDocs: 0, totalPages: 0 },
      query: { intent: 'all', page: 1, q: '', status: 'all' },
    }
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(LeadsHub, { pageState: 'available', role: 'admin', summary }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: '新增线索' }))
    fireEvent.change(screen.getByLabelText('联系人'), { target: { value: 'Stable lead' } })
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'stable-lead@example.invalid' },
    })
    fireEvent.change(screen.getByLabelText('国家 / 地区'), {
      target: { value: 'United Arab Emirates' },
    })
    fireEvent.change(screen.getByLabelText('需求说明'), {
      target: { value: 'Keep the command key while the response body is incomplete.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建线索' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '创建线索' }))
    await screen.findByText('线索已保存。')

    const firstKey = headerValue(request.mock.calls[0]?.[1], 'Idempotency-Key')
    const secondKey = headerValue(request.mock.calls[1]?.[1], 'Idempotency-Key')
    expect(firstKey).toMatch(/^portal-lead:/)
    expect(secondKey).toBe(firstKey)
  })
})
