import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { ContentStudio } from '@/admin-portal/modules/content-studio/ContentStudio'
import type { ContentStudioSummary } from '@/admin-portal/modules/content-studio/getContentStudioPage'

const router = { refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status })

const summary: ContentStudioSummary = {
  items: [{
    assets: [], body: 'Draft body', contentLocale: 'en', contentType: 'post', id: 71,
    knowledgeSources: [], platform: 'linkedin', publishJobs: [], reviews: [], sourceReferences: [],
    status: 'draft', title: 'Target draft', updatedAt: '2026-08-12T10:00:00.000Z',
  }],
  options: {
    assets: [{ id: 21, label: 'Facade reference', meta: 'image/webp', previewUrl: '/media/reference.webp' }],
    knowledgeSources: [],
    platformAccounts: [],
  },
  pagination: { page: 1, totalDocs: 1, totalPages: 1 },
  publishingEnabled: false,
  query: { page: 1, platform: 'all', q: '', status: 'all' },
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  router.refresh.mockReset()
})

describe('Portal Content Studio image workspace', () => {
  it('uploads a private reference, generates a safe preview, and explicitly adopts it into a draft', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ result: { id: 91, previewUrl: '/media/uploaded-reference.png' } }, 201))
      .mockResolvedValueOnce(response({
        media: { id: 81, mimeType: 'image/png', previewUrl: '/media/generated.png' },
        revisedPrompt: 'Refined facade prompt',
      }, 201))
      .mockResolvedValueOnce(response({ content: { id: 71, updatedAt: '2026-08-12T10:01:00.000Z' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(React.createElement(PortalPreferencesProvider, null, React.createElement(ContentStudio, {
      pageState: 'available',
      summary,
    })))

    fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '图片生成' }))
    fireEvent.change(screen.getByLabelText('图片提示词'), { target: { value: 'Create a premium facade hero image' } })
    fireEvent.change(screen.getByLabelText('图片尺寸'), { target: { value: '1536x1024' } })
    fireEvent.change(screen.getByLabelText('参考素材'), { target: { value: '21' } })
    expect(screen.getByRole('img', { name: '参考图预览' }).getAttribute('src')).toContain('/media/reference.webp')

    fireEvent.change(screen.getByLabelText('上传参考图'), {
      target: { files: [new File(['image'], 'reference.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: '上传参考图' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/portal/media')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData)
    const uploadBody = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(uploadBody.get('alt')).toBe('Create a premium facade hero image')
    expect(uploadBody.get('isPublic')).toBe('false')
    expect(uploadBody.get('source')).toBe('Content Studio protected reference upload')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')).toMatch(/^portal-content-studio:image-upload:/)

    fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
    await screen.findByRole('img', { name: '生成图片预览' })
    expect(screen.getByText('Refined facade prompt')).toBeTruthy()
    const generationBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(generationBody).toEqual({
      prompt: 'Create a premium facade hero image',
      referenceMediaId: 91,
      size: '1536x1024',
    })

    expect((screen.getByLabelText('目标草稿') as HTMLSelectElement).value).toBe('71')
    fireEvent.click(screen.getByRole('button', { name: '采用为草稿资产' }))
    await screen.findByText('图片已采用为草稿资产。')
    const adoptionBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as Record<string, unknown>
    expect(adoptionBody).toEqual({
      action: 'adopt-image',
      mediaId: 81,
      updatedAt: '2026-08-12T10:00:00.000Z',
    })
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/portal/content-studio/71')
  })

  it('reuses the same image command key when the provider result is unknown', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ error: { code: 'portal-command-result-unknown', message: 'Result unknown' } }, 409))
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(PortalPreferencesProvider, null, React.createElement(ContentStudio, {
      pageState: 'available',
      summary,
    })))

    fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '图片生成' }))
    fireEvent.change(screen.getByLabelText('图片提示词'), { target: { value: 'Unknown provider result' } })
    fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
    await screen.findByText('Result unknown')
    fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const firstKey = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')
    const secondKey = new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')
    expect(firstKey).toMatch(/^portal-content-studio:image-generate:/)
    expect(secondKey).toBe(firstKey)
  })

  it('keeps the image command key when media was saved without a safe preview', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ media: { id: 81, previewUrl: null }, revisedPrompt: null }, 201))
    vi.stubGlobal('fetch', fetchMock)
    render(React.createElement(PortalPreferencesProvider, null, React.createElement(ContentStudio, {
      pageState: 'available',
      summary,
    })))

    fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '图片生成' }))
    fireEvent.change(screen.getByLabelText('图片提示词'), { target: { value: 'Saved without preview' } })
    fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
    await screen.findByText(/没有可用的安全预览地址/)
    fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const firstKey = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')
    const secondKey = new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')
    expect(secondKey).toBe(firstKey)
  })
})
