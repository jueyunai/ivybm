import React from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import {
  ContentSummaryReadError,
  getContentSummary,
  loadWebsiteContentPageData,
  parseContentQuery,
} from '@/admin-portal/modules/website-content/getContentSummary'
import { ContentHub } from '@/admin-portal/modules/website-content/ContentHub'
import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('Portal website content summary', () => {
  it('normalizes URL filters into a bounded query contract', () => {
    expect(
      parseContentQuery({
        page: '3',
        q: '  Solid Aluminum  ',
        status: 'draft',
        type: 'products',
      }),
    ).toEqual({ page: 3, q: 'Solid Aluminum', status: 'draft', type: 'products' })

    expect(
      parseContentQuery({ page: '-5', q: 'x'.repeat(120), status: 'unknown', type: 'users' }),
    ).toEqual({ page: 1, q: 'x'.repeat(80), status: 'all', type: 'pages' })
  })

  it('uses access-controlled localized reads and returns metadata instead of CMS bodies', async () => {
    const find = vi.fn().mockImplementation(async (options: Record<string, unknown>) => {
      if (options.limit === 1) {
        return {
          docs: [{ updatedAt: '2026-07-30T08:00:00.000Z' }],
          totalDocs: options.collection === 'products' ? 2 : 1,
        }
      }

      if (options.locale === 'ar') {
        return {
          docs: [
            {
              id: 21,
              seo: { description: 'وصف', title: 'عنوان' },
              slug: 'solid-aluminum-panel',
              title: 'ألواح الألمنيوم الصلبة',
              updatedAt: '2026-07-30T09:00:00.000Z',
            },
          ],
          totalDocs: 1,
        }
      }

      return {
        docs: [
          {
            _status: 'published',
            id: 21,
            seo: { description: 'Description', title: 'SEO title' },
            slug: 'solid-aluminum-panel',
            title: 'Solid Aluminum Panel',
            updatedAt: '2026-07-30T09:00:00.000Z',
          },
          {
            _status: 'draft',
            id: 22,
            seo: { description: null, title: null },
            slug: 'double-curved-panel',
            title: 'Double-curved Panel',
            updatedAt: '2026-07-30T07:00:00.000Z',
          },
        ],
        page: 1,
        totalDocs: 2,
        totalPages: 1,
      }
    })
    const count = vi.fn().mockResolvedValue({ totalDocs: 1 })
    const payload = { count, find } as unknown as Payload

    const summary = await getContentSummary({
      payload,
      query: { page: 1, q: '', status: 'all', type: 'products' },
      req,
    })

    expect(find).toHaveBeenCalledTimes(8)
    expect(count).toHaveBeenCalledTimes(2)
    for (const [options] of [...find.mock.calls, ...count.mock.calls]) {
      expect(options).toEqual(expect.objectContaining({ overrideAccess: false, req }))
    }
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackLocale: false, locale: 'ar', overrideAccess: false, req }),
    )
    expect(summary.statusBreakdown).toEqual({ draft: 1, published: 1 })
    expect(summary.items[0]).toMatchObject({
      localeCompleteness: { ar: 100, en: 100 },
      previewHref: '/en/products/solid-aluminum-panel',
      status: 'published',
      title: 'Solid Aluminum Panel',
    })
    expect(summary.items[1]).toMatchObject({
      localeCompleteness: { ar: 0, en: 33 },
      previewHref: null,
      status: 'draft',
    })
    expect(summary.editor).toEqual({ status: 'dependency-gated' })

    const serialized = JSON.stringify(summary)
    expect(serialized).not.toMatch(/\"(body|content|description|internalNotes|keywords)\":/i)
    expect(serialized).not.toContain('/admin')
  })

  it('surfaces CMS read failures instead of returning zero counts', async () => {
    const payload = {
      count: vi.fn(),
      find: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as Payload

    await expect(
      getContentSummary({
        payload,
        query: { page: 1, q: '', status: 'all', type: 'pages' },
        req,
      }),
    ).rejects.toBeInstanceOf(ContentSummaryReadError)
  })

  it('rejects sales and disabled modules before executing CMS reads', async () => {
    const payload = {
      count: vi.fn(() => Promise.reject(new Error('must not execute'))),
      find: vi.fn(() => Promise.reject(new Error('must not execute'))),
    } as unknown as Payload

    await expect(
      loadWebsiteContentPageData({
        env: {
          ADMIN_PORTAL_ENABLED: 'true',
          ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED: 'true',
        },
        payload,
        query: { page: 1, q: '', status: 'all', type: 'pages' },
        req,
        role: 'sales',
      }),
    ).resolves.toEqual({ state: 'forbidden', summary: null })

    await expect(
      loadWebsiteContentPageData({
        env: { ADMIN_PORTAL_ENABLED: 'true' },
        payload,
        query: { page: 1, q: '', status: 'all', type: 'pages' },
        req,
        role: 'admin',
      }),
    ).resolves.toEqual({ state: 'module-disabled', summary: null })

    expect(payload.find).not.toHaveBeenCalled()
    expect(payload.count).not.toHaveBeenCalled()
  })

  it('renders the six content types, filters, metadata detail, preview, and editor gate', () => {
    const { container } = render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentHub, {
          pageState: 'available',
          summary: {
            collections: [
              { id: 'pages', total: 2, updatedAt: '2026-07-30T08:00:00.000Z' },
              { id: 'products', total: 2, updatedAt: '2026-07-30T08:00:00.000Z' },
              { id: 'product-categories', total: 1, updatedAt: null },
              { id: 'projects', total: 1, updatedAt: null },
              { id: 'posts', total: 1, updatedAt: null },
              { id: 'downloads', total: 1, updatedAt: null },
            ],
            editor: { status: 'dependency-gated' },
            items: [
              {
                id: 21,
                localeCompleteness: { ar: 100, en: 100 },
                previewHref: '/en/products/solid-aluminum-panel',
                slug: 'solid-aluminum-panel',
                status: 'published',
                title: 'Solid Aluminum Panel',
                updatedAt: '2026-07-30T09:00:00.000Z',
              },
              {
                id: 22,
                localeCompleteness: { ar: 40, en: 67 },
                previewHref: null,
                slug: 'draft-panel',
                status: 'draft',
                title: 'Draft Panel',
                updatedAt: '2026-07-30T07:00:00.000Z',
              },
            ],
            pagination: { page: 1, totalDocs: 2, totalPages: 1 },
            query: { page: 1, q: '', status: 'all', type: 'products' },
            statusBreakdown: { draft: 1, published: 1 },
          },
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: '官网内容' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '官网内容' }).querySelectorAll('a')).toHaveLength(
      6,
    )
    expect(screen.getByRole('link', { name: /^产品2/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '打开官网预览' }).getAttribute('href')).toBe(
      '/en/products/solid-aluminum-panel',
    )
    expect(screen.getByText('语言完整度')).toBeTruthy()
    expect(
      screen.getByText(
        '复杂富文本、版本历史和完整 SEO 编辑仍受依赖限制；当前只提供安全摘要与官网预览。',
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Draft Panel/ }))
    expect(screen.getByRole('heading', { name: 'Draft Panel' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: '打开官网预览' })).toBeNull()
    expect(container.innerHTML).not.toContain('/admin')
  })
})
