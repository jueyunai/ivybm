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
        if (init?.method === 'PATCH') {
          return Response.json({ result: { updatedAt: '2026-08-04T11:00:00.000Z' } })
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
    expect(screen.getByRole('dialog').textContent).toContain('正在编辑“第一项”')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('未保存的第一项')

    fireEvent.click(screen.getByRole('button', { name: /第二项/ }))
    fireEvent.click(screen.getByRole('button', { name: '不保存并切换' }))
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
})
