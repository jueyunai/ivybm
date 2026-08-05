import React from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { ContentHub } from '@/admin-portal/modules/website-content/ContentHub'
import type { ContentSummary } from '@/admin-portal/modules/website-content/getContentSummary'

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => navigation }))

const summary: ContentSummary = {
  collections: [
    { id: 'pages', total: 0, updatedAt: null },
    { id: 'products', total: 0, updatedAt: null },
    { id: 'product-categories', total: 2, updatedAt: '2026-08-04T10:00:00.000Z' },
    { id: 'projects', total: 0, updatedAt: null },
    { id: 'posts', total: 0, updatedAt: null },
    { id: 'downloads', total: 0, updatedAt: null },
  ],
  editor: { status: 'available' },
  items: [
    {
      id: 1,
      localeCompleteness: { ar: 100, en: 100 },
      localeMissing: { ar: [], en: [] },
      previewHrefs: { ar: '/ar/products?category=first', en: '/en/products?category=first' },
      slug: 'first',
      status: 'always-visible',
      title: '第一项',
      updatedAt: '2026-08-04T10:00:00.000Z',
    },
    {
      id: 2,
      localeCompleteness: { ar: 100, en: 100 },
      localeMissing: { ar: [], en: [] },
      previewHrefs: { ar: '/ar/products?category=second', en: '/en/products?category=second' },
      slug: 'second',
      status: 'always-visible',
      title: '第二项',
      updatedAt: '2026-08-04T10:00:00.000Z',
    },
  ],
  pagination: { page: 1, totalDocs: 2, totalPages: 1 },
  query: { page: 1, q: '', status: 'all', type: 'product-categories' },
  statusBreakdown: null,
}

const editorResponse = (id: number) =>
  Response.json({
    options: { categories: [], media: [] },
    record: {
      data: {
        description: id === 1 ? '第一项描述' : '第二项描述',
        slug: id === 1 ? 'first' : 'second',
        title: id === 1 ? '第一项' : '第二项',
      },
      id,
      locale: 'en',
      status: 'always-visible',
      type: 'product-categories',
      updatedAt: '2026-08-04T10:00:00.000Z',
    },
  })

const renderHub = () =>
  render(
    React.createElement(
      PortalPreferencesProvider,
      null,
      React.createElement(ContentHub, { pageState: 'available', summary }),
    ),
  )

describe('Portal content hub editing transitions', () => {
  beforeEach(() => {
    navigation.refresh.mockReset()
    window.localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'POST') {
          return Response.json({
            result: {
              id: 3,
              slug: 'new-category',
              status: 'always-visible',
              title: '新分类',
              updatedAt: '2026-08-04T11:00:00.000Z',
            },
          })
        }
        if (init?.method === 'PATCH') {
          return Response.json({
            result: {
              id: 1,
              slug: 'first',
              status: 'always-visible',
              title: '第一项',
              updatedAt: '2026-08-04T11:00:00.000Z',
            },
          })
        }
        if (url.endsWith('/2?locale=en')) return editorResponse(2)
        if (url.includes('/product-categories/')) return editorResponse(1)
        return Response.json({ options: { categories: [], media: [] } })
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('clears the previous list selection when creating new content', async () => {
    renderHub()
    expect(screen.getByRole('button', { name: /第一项/ }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getAllByRole('button', { name: '新增内容' })[0])
    await screen.findByLabelText('标题')

    expect(screen.getByRole('button', { name: /第一项/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(screen.getByRole('button', { name: /第二项/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('automatically expires a global save notice', async () => {
    renderHub()
    fireEvent.click(screen.getAllByRole('button', { name: '新增内容' })[0])
    fireEvent.change(await screen.findByLabelText('标题'), { target: { value: '新分类' } })
    fireEvent.change(screen.getByLabelText('固定链接标识'), {
      target: { value: 'new-category' },
    })
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect((await screen.findByRole('status')).textContent).toContain('保存成功，列表已刷新。')

    const expiry = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 5_000)?.[0]
    expect(expiry).toBeTypeOf('function')
    act(() => expiry?.())
    expect(screen.queryByRole('status')).toBeNull()
    setTimeoutSpy.mockRestore()
  })

  it('offers cancel, discard, and save paths before switching a dirty editor', async () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }))
    const title = await screen.findByLabelText('标题')
    fireEvent.change(title, { target: { value: '未保存的第一项' } })

    fireEvent.click(screen.getByRole('button', { name: /第二项/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('正在编辑“第一项”')
    expect(within(dialog).queryByRole('button', { name: '取消' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '不保存并切换' })).toBeNull()
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['保存并切换', '不保存', '关闭'])
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('未保存的第一项')

    fireEvent.click(screen.getByRole('button', { name: /第二项/ }))
    fireEvent.click(screen.getByRole('button', { name: '不保存' }))
    await waitFor(() =>
      expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('第二项'),
    )

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '第二项已修改' } })
    fireEvent.click(screen.getByRole('button', { name: /第一项/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存并切换' }))

    await waitFor(() =>
      expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('第一项'),
    )
    const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(patchCall).toBeTruthy()
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      action: 'save',
      title: '第二项已修改',
    })
  })

  it('guards opening a new record while the current editor is dirty', async () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }))
    const title = await screen.findByLabelText('标题')
    fireEvent.change(title, { target: { value: '尚未保存的标题' } })

    fireEvent.click(screen.getAllByRole('button', { name: '新增内容' })[0])
    let dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('正在编辑“第一项”')
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('尚未保存的标题')

    fireEvent.click(screen.getAllByRole('button', { name: '新增内容' })[0])
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '不保存' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: '新增内容' })).toBeTruthy())
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('')
  })

  it('guards locale changes while the current editor is dirty', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/1?locale=ar')) {
        return Response.json({
          options: { categories: [], media: [] },
          record: {
            data: { description: 'الوصف الأول', slug: 'first', title: 'العنصر الأول' },
            id: 1,
            locale: 'ar',
            status: 'always-visible',
            type: 'product-categories',
            updatedAt: '2026-08-04T10:00:00.000Z',
          },
        })
      }
      if (url.includes('/product-categories/')) return editorResponse(1)
      return Response.json({ options: { categories: [], media: [] } })
    })

    renderHub()
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }))
    const title = await screen.findByLabelText('标题')
    fireEvent.change(title, { target: { value: '尚未保存的标题' } })

    fireEvent.click(screen.getByRole('button', { name: '阿语' }))
    let dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('切换到“阿语”')
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('尚未保存的标题')

    fireEvent.click(screen.getByRole('button', { name: '阿语' }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '不保存' }))

    await waitFor(() =>
      expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('العنصر الأول'),
    )
    expect(screen.getByRole('button', { name: '阿语' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'عنوان غير محفوظ' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('切换到“关闭编辑器”')
    fireEvent.click(within(dialog).getByRole('button', { name: '不保存' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: '编辑内容' })).toBeNull())
  })

  it('promotes a saved create session before switching locale', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        return Response.json(
          {
            result: {
              id: 3,
              slug: 'new-category',
              status: 'always-visible',
              title: '新分类',
              updatedAt: '2026-08-04T11:00:00.000Z',
            },
          },
          { status: 201 },
        )
      }
      if (url.endsWith('/3?locale=ar')) {
        return Response.json({
          options: { categories: [], media: [] },
          record: {
            data: { description: '', slug: 'new-category', title: 'تصنيف جديد' },
            id: 3,
            locale: 'ar',
            status: 'always-visible',
            type: 'product-categories',
            updatedAt: '2026-08-04T11:00:00.000Z',
          },
        })
      }
      return Response.json({ options: { categories: [], media: [] } })
    })

    renderHub()
    fireEvent.click(screen.getAllByRole('button', { name: '新增内容' })[0])
    fireEvent.change(await screen.findByLabelText('标题'), { target: { value: '新分类' } })
    fireEvent.change(screen.getByLabelText('固定链接标识'), {
      target: { value: 'new-category' },
    })

    fireEvent.click(screen.getByRole('button', { name: '阿语' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并切换' }))

    await waitFor(() =>
      expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('تصنيف جديد'),
    )
    expect(screen.getByRole('region', { name: '编辑内容' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '阿语' }).getAttribute('aria-pressed')).toBe('true')

    const postCalls = vi.mocked(fetch).mock.calls.filter(([, request]) => request?.method === 'POST')
    expect(postCalls).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/3?locale=ar'))).toBe(
      true,
    )
  })

  it('keeps the editor frame height stable while switching records', async () => {
    let resolveSecond: ((response: Response) => void) | undefined
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/2?locale=en')) {
        return new Promise<Response>((resolve) => {
          resolveSecond = resolve
        })
      }
      if (url.includes('/product-categories/')) return editorResponse(1)
      return Response.json({ options: { categories: [], media: [] } })
    })

    renderHub()
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }))
    await screen.findByLabelText('标题')

    const frame = document.querySelector<HTMLElement>('.portal-content__editor-frame')
    expect(frame).toBeTruthy()
    vi.spyOn(frame as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      bottom: 860,
      height: 720,
      left: 620,
      right: 1180,
      toJSON: () => ({}),
      top: 140,
      width: 560,
      x: 620,
      y: 140,
    })

    fireEvent.click(screen.getByRole('button', { name: /第二项/ }))

    await screen.findByText('正在加载编辑器…')
    expect(frame?.style.minHeight).toBe('720px')
    expect(document.querySelector('.portal-content__editor-frame')).toBe(frame)

    await act(async () => {
      resolveSecond?.(editorResponse(2))
    })
    await waitFor(() =>
      expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('第二项'),
    )
    expect(frame?.style.minHeight).toBe('720px')
  })
})
