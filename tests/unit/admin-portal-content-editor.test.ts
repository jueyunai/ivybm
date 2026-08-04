import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { ContentEditor } from '@/admin-portal/modules/website-content/ContentEditor'

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}))

const renderEditor = (type: 'pages' | 'products' = 'pages') =>
  render(
    React.createElement(
      PortalPreferencesProvider,
      null,
      React.createElement(ContentEditor, {
        item: null,
        mode: 'create',
        onClose: vi.fn(),
        type,
      }),
    ),
  )

describe('Portal website content editor', () => {
  beforeEach(() => {
    navigation.refresh.mockReset()
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('uses the Portal language consistently and never exposes raw API error text', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ options: { categories: [], media: [] } }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: 'content-invalid-slug',
              message: 'Slug must use lowercase Latin letters, numbers, and single hyphens',
            },
          },
          { status: 400 },
        ),
      )

    renderEditor()

    const title = await screen.findByLabelText('标题')
    expect(screen.getByLabelText('固定链接标识')).toBeTruthy()
    expect(screen.queryByText(/Title|Summary|Body|Stable slug/)).toBeNull()

    fireEvent.change(title, { target: { value: '关于我们' } })
    fireEvent.change(screen.getByLabelText('固定链接标识'), {
      target: { value: 'Invalid Slug' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('固定链接标识只能使用小写英文字母、数字和单个连字符。')
    expect(alert.textContent).not.toContain('Slug must')
  })

  it('blocks publish before the request and focuses and scrolls to the first invalid field', async () => {
    const fetcher = vi
      .mocked(fetch)
      .mockResolvedValueOnce(Response.json({ options: { categories: [], media: [] } }))
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    renderEditor()

    const title = (await screen.findByLabelText('标题')) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: '发布' }))

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(title)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(screen.getByRole('alert').textContent).toBe('请先补全必填项，再发布内容。')
  })

  it('switches all field labels and fixed options to English with the Portal preference', async () => {
    window.localStorage.setItem(
      'ivybm.portal.preferences',
      JSON.stringify({ locale: 'en', reducedMotion: false, theme: 'light' }),
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ options: { categories: [], media: [] } }),
    )

    renderEditor()

    expect(await screen.findByLabelText('Title')).toBeTruthy()
    expect(screen.getByLabelText('Stable slug')).toBeTruthy()
    expect(screen.queryByLabelText('标题')).toBeNull()
    expect(screen.queryByText(/标题|摘要|正文|头图/)).toBeNull()
  })

  it('selects single and gallery images directly through native controls', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        options: {
          categories: [{ id: 5, label: '幕墙' }],
          media: [
            {
              id: 91,
              label: 'facade-a.jpg',
              meta: 'image/jpeg',
              previewUrl: '/media/facade-a.jpg',
            },
            {
              id: 92,
              label: 'facade-b.jpg',
              meta: 'image/jpeg',
              previewUrl: '/media/facade-b.jpg',
            },
          ],
        },
      }),
    )

    renderEditor('products')

    const coverGroup = await screen.findByRole('group', { name: '封面图' })
    const firstCover = within(coverGroup).getByRole('radio', { name: 'facade-a.jpg' })
    const secondCover = within(coverGroup).getByRole('radio', { name: 'facade-b.jpg' })

    fireEvent.click(secondCover)
    expect((secondCover as HTMLInputElement).checked).toBe(true)
    expect((firstCover as HTMLInputElement).checked).toBe(false)
    expect(within(coverGroup).getByText('facade-b.jpg').closest('label')?.innerHTML).toContain(
      'portal-content-editor__image-check',
    )

    const galleryGroup = screen.getByRole('group', { name: '图库' })
    const firstGallery = within(galleryGroup).getByRole('checkbox', { name: 'facade-a.jpg' })
    const secondGallery = within(galleryGroup).getByRole('checkbox', { name: 'facade-b.jpg' })
    fireEvent.click(firstGallery)
    fireEvent.click(secondGallery)
    expect((firstGallery as HTMLInputElement).checked).toBe(true)
    expect((secondGallery as HTMLInputElement).checked).toBe(true)
  })

  it('emits create success feedback before closing so the hub-level notice remains visible', async () => {
    const onClose = vi.fn()
    const onNotice = vi.fn()
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ options: { categories: [], media: [] } }))
      .mockResolvedValueOnce(
        Response.json(
          {
            result: {
              id: 44,
              updatedAt: '2026-08-04T10:00:00.000Z',
            },
          },
          { status: 201 },
        ),
      )

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentEditor, {
          item: null,
          mode: 'create',
          onClose,
          onNotice,
          type: 'product-categories',
        }),
      ),
    )

    fireEvent.change(await screen.findByLabelText('标题'), { target: { value: '幕墙系统' } })
    fireEvent.change(screen.getByLabelText('固定链接标识'), {
      target: { value: 'curtain-wall-systems' },
    })
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '分类描述' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith({
        tone: 'success',
        value: '保存成功，列表已刷新。',
      }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
  })
})
