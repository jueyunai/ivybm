import React from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import {
  ContentStudio,
  PublishNowEditor,
  ScheduleEditor,
} from '@/admin-portal/modules/content-studio/ContentStudio'
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
  vi.useRealTimers()
})

describe('Portal create command keys', () => {
  it('allows an administrator to create a Lead before the country is confirmed', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ result: { id: 28, updatedAt: '2026-08-12T00:00:00.000Z' } }, 201),
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
    expect(screen.getByLabelText('国家 / 地区').hasAttribute('required')).toBe(false)
    fireEvent.change(screen.getByLabelText('联系人'), { target: { value: 'Country pending' } })
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'buyer@example.invalid' } })
    fireEvent.change(screen.getByLabelText('需求说明'), { target: { value: 'Please contact me.' } })
    fireEvent.click(screen.getByRole('button', { name: '创建线索' }))

    await screen.findByText('线索已保存。')
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body.country).toBe('')
  })

  it('renders a qualification heading distinct from the project-stage field label', () => {
    const summary: LeadsSummary = {
      items: [
        {
          assignedTo: null,
          budget: 'USD 450,000',
          company: 'Facade Engineering LLC',
          country: 'UAE',
          email: 'buyer@example.invalid',
          hasDrawings: true,
          id: 27,
          interest: 'aluminum panels',
          intentLevel: 'a',
          locale: 'en',
          message: 'Need facade panels.',
          name: 'Buyer',
          phone: null,
          procurementPlan: 'within 3 months',
          projectStage: 'tender',
          quantitySquareMeters: 3200,
          relatedConversations: [],
          source: 4,
          status: 'qualified',
          timeline: 'within_3_months',
          updatedAt: '2026-08-12T00:00:00.000Z',
        },
      ],
      options: { sources: [{ id: 4, label: 'Website' }], users: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      query: { intent: 'all', page: 1, q: '', status: 'all' },
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(LeadsHub, { pageState: 'available', role: 'admin', summary }),
      ),
    )

    expect(screen.getByRole('heading', { name: '资格详情' })).toBeTruthy()
    expect(screen.getByText('项目阶段', { selector: 'dt' })).toBeTruthy()
  })

  it('reuses the AI debug key after an interrupted response body and rotates when the prompt changes', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(interruptedJsonResponse())
      .mockResolvedValueOnce(
        jsonResponse({ result: { text: 'second', usage: { totalTokens: 2 } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ result: { text: 'changed', usage: { totalTokens: 3 } } }),
      )
    vi.stubGlobal('fetch', request)
    render(
      React.createElement(PortalPreferencesProvider, null, React.createElement(KnowledgeAiDebug)),
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
      React.createElement(PortalPreferencesProvider, null, React.createElement(KnowledgeAiDebug)),
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

  it('reuses the immediate publication key after an interrupted response body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(interruptedJsonResponse())
      .mockResolvedValueOnce(jsonResponse({ publication: { jobs: [] } }, 202))
    vi.stubGlobal('fetch', request)
    const item: ContentStudioItem = {
      assets: [],
      body: 'Approved body',
      contentLocale: 'en',
      contentType: 'post',
      id: 18,
      knowledgeSources: [],
      platform: 'facebook',
      publishJobs: [],
      reviews: [],
      sourceReferences: [{ claim: 'Claim', source: 'Source' }],
      status: 'approved',
      title: 'Approved publication',
      updatedAt: '2026-08-13T00:00:00.000Z',
    }
    const onDone = vi.fn()
    render(
      React.createElement(PublishNowEditor, {
        copy: getContentStudioMessages('zh'),
        item,
        onClose: vi.fn(),
        onDone,
        options: [
          { id: 11, label: 'Facebook page', platform: 'facebook' },
          { id: 12, label: 'Instagram account', platform: 'instagram' },
          { id: 13, label: 'LinkedIn page', platform: 'linkedin' },
        ],
      }),
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /Facebook page/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Instagram account/ }))
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))

    const bodies = request.mock.calls.map(
      (call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>,
    )
    expect(bodies[0]).toMatchObject({
      action: 'publish-now',
      targetAccountIds: [11, 12],
      updatedAt: item.updatedAt,
    })
    expect(bodies[0]?.idempotencyKey).toMatch(/^portal-content-studio:publish-now:/)
    expect(bodies[1]?.idempotencyKey).toBe(bodies[0]?.idempotencyKey)
  })

  it('shows independent platform results and an unknown-result warning', () => {
    const summary = {
      items: [
        {
          assets: [],
          body: 'Approved body',
          contentLocale: 'en' as const,
          contentType: 'post' as const,
          id: 19,
          knowledgeSources: [],
          platform: 'facebook' as const,
          publishJobs: [
            {
              externalPublicationId: 'facebook-post-19',
              externalPublicationUrl: 'https://facebook.example.invalid/post-19',
              id: 201,
              lastErrorSummary: null,
              mode: 'automatic' as const,
              platform: 'facebook' as const,
              scheduledFor: '2026-08-13T01:30:00.000Z',
              status: 'published' as const,
              updatedAt: '2026-08-13T01:31:00.000Z',
            },
            {
              externalPublicationId: null,
              externalPublicationUrl: null,
              id: 202,
              lastErrorSummary: 'Provider response could not be confirmed; verify Instagram.',
              mode: 'automatic' as const,
              platform: 'instagram' as const,
              scheduledFor: '2026-08-13T01:30:00.000Z',
              status: 'delivery_unknown' as const,
              updatedAt: '2026-08-13T01:32:00.000Z',
            },
          ],
          reviews: [],
          sourceReferences: [],
          status: 'approved' as const,
          title: 'Independent results',
          updatedAt: '2026-08-13T00:00:00.000Z',
        },
      ],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      publishingEnabled: true,
      query: { page: 1, platform: 'all' as const, q: '', status: 'all' as const },
    }
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    expect(screen.getByText('facebook-post-19')).toBeTruthy()
    expect(screen.getByText('结果未知')).toBeTruthy()
    expect(
      screen.getByText('Provider response could not be confirmed; verify Instagram.'),
    ).toBeTruthy()
    expect(screen.getByText('Facebook · 自动发布')).toBeTruthy()
    expect(screen.getByText('Instagram · 自动发布')).toBeTruthy()
    expect(screen.getByRole('button', { name: '刷新发布结果' })).toBeTruthy()
  })

  it('keeps immediate publication unavailable while the kill switch is disabled', () => {
    const summary = {
      items: [
        {
          assets: [],
          body: 'Approved body',
          contentLocale: 'en' as const,
          contentType: 'post' as const,
          id: 20,
          knowledgeSources: [],
          platform: 'facebook' as const,
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved' as const,
          title: 'Disabled publication',
          updatedAt: '2026-08-13T00:00:00.000Z',
        },
      ],
      options: {
        assets: [],
        knowledgeSources: [],
        platformAccounts: [{ id: 11, label: 'Facebook page', platform: 'facebook' as const }],
      },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      publishingEnabled: false,
      query: { page: 1, platform: 'all' as const, q: '', status: 'all' as const },
    }
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    expect(screen.getByRole('button', { name: '立即发布' }).hasAttribute('disabled')).toBe(true)
  })

  it('polls active publication results without sending another publish command', async () => {
    vi.useFakeTimers()
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    const summary = {
      items: [
        {
          assets: [],
          body: 'Approved body',
          contentLocale: 'en' as const,
          contentType: 'post' as const,
          id: 21,
          knowledgeSources: [],
          platform: 'facebook' as const,
          publishJobs: [
            {
              externalPublicationId: null,
              externalPublicationUrl: null,
              id: 203,
              lastErrorSummary: null,
              mode: 'automatic' as const,
              platform: 'facebook' as const,
              scheduledFor: '2026-08-13T01:30:00.000Z',
              status: 'publishing' as const,
              updatedAt: '2026-08-13T01:31:00.000Z',
            },
          ],
          reviews: [],
          sourceReferences: [],
          status: 'approved' as const,
          title: 'Active publication',
          updatedAt: '2026-08-13T00:00:00.000Z',
        },
      ],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      publishingEnabled: true,
      query: { page: 1, platform: 'all' as const, q: '', status: 'all' as const },
    }
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(router.refresh).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(router.refresh).toHaveBeenCalledTimes(15)
    expect(request).not.toHaveBeenCalled()
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
