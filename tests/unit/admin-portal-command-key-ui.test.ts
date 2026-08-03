import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { ScheduleEditor } from '@/admin-portal/modules/content-studio/ContentStudio'
import type { ContentStudioItem } from '@/admin-portal/modules/content-studio/getContentStudioPage'
import { getContentStudioMessages } from '@/admin-portal/modules/content-studio/messages'
import { KnowledgeEditor } from '@/admin-portal/modules/knowledge/KnowledgeEditor'
import { MediaEditor } from '@/admin-portal/modules/media/MediaEditor'

const router = { refresh: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })

const headerValue = (init: RequestInit | undefined, name: string): string | null =>
  new Headers(init?.headers).get(name)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  router.refresh.mockReset()
})

describe('Portal create command keys', () => {
  it('reuses the media upload key after a lost response', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('response lost'))
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

  it('reuses the knowledge create key after a lost response', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ options: { media: [] } }))
      .mockRejectedValueOnce(new TypeError('response lost'))
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

  it('reuses the schedule key after a lost response', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('response lost'))
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
})
