import React from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import {
  getMediaPage,
  loadMediaPageData,
  MediaPageReadError,
  parseMediaQuery,
} from '@/admin-portal/modules/media/getMediaPage'
import { MediaWorkspace } from '@/admin-portal/modules/media/MediaWorkspace'

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('Portal media workspace', () => {
  it('normalizes URL filters into a bounded query contract', () => {
    expect(
      parseMediaQuery({
        kind: 'pdf',
        page: '3',
        q: '  Facade  ',
        source: '  IVYBM  ',
        view: 'list',
        visibility: 'private',
      }),
    ).toEqual({
      kind: 'pdf',
      page: 3,
      q: 'Facade',
      source: 'IVYBM',
      view: 'list',
      visibility: 'private',
    })

    expect(
      parseMediaQuery({
        kind: 'video',
        page: '-2',
        q: 'x'.repeat(120),
        source: 'y'.repeat(120),
        view: 'table',
        visibility: 'unknown',
      }),
    ).toEqual({
      kind: 'all',
      page: 1,
      q: 'x'.repeat(80),
      source: 'y'.repeat(80),
      view: 'grid',
      visibility: 'all',
    })
  })

  it('uses an access-controlled bounded query and returns safe media metadata', async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [
        {
          alt: 'Facade hero',
          filename: 'hero.webp',
          filesize: 1024,
          height: 1200,
          id: 21,
          isPublic: true,
          mimeType: 'image/webp',
          sizes: { card: { url: '/api/media/file/card-hero.webp' } },
          source: 'IVYBM project photography',
          updatedAt: '2026-07-30T09:00:00.000Z',
          url: '/api/media/file/hero.webp',
          width: 1800,
        },
        {
          alt: 'Technical chart',
          filename: 'chart.pdf',
          filesize: 2048,
          height: null,
          id: 22,
          isPublic: false,
          mimeType: 'application/pdf',
          source: 'IVYBM technical team',
          updatedAt: '2026-07-30T08:00:00.000Z',
          url: 'javascript:alert(1)',
          width: null,
        },
      ],
      page: 1,
      totalDocs: 2,
      totalPages: 1,
    })
    const payload = { find } as unknown as Payload

    const summary = await getMediaPage({
      payload,
      query: {
        kind: 'all',
        page: 1,
        q: '',
        source: '',
        view: 'grid',
        visibility: 'all',
      },
      req,
    })

    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'media',
        depth: 0,
        limit: 12,
        overrideAccess: false,
        page: 1,
        pagination: true,
        req,
        sort: '-updatedAt',
      }),
    )
    expect(summary.items[0]).toMatchObject({
      kind: 'image',
      originalUrl: '/api/media/file/hero.webp',
      previewUrl: '/api/media/file/card-hero.webp',
    })
    expect(summary.items[1]).toMatchObject({
      kind: 'pdf',
      originalUrl: null,
      previewUrl: null,
    })
    expect(summary.editor).toEqual({ status: 'dependency-gated' })
    expect(JSON.stringify(summary)).not.toMatch(/\/admin|focalX|focalY|password|token/i)
  })

  it('surfaces media read failures instead of returning an empty page', async () => {
    const payload = {
      find: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as Payload

    await expect(
      getMediaPage({
        payload,
        query: {
          kind: 'all',
          page: 1,
          q: '',
          source: '',
          view: 'grid',
          visibility: 'all',
        },
        req,
      }),
    ).rejects.toBeInstanceOf(MediaPageReadError)
  })

  it('rejects sales and disabled modules before executing Media reads', async () => {
    const payload = {
      find: vi.fn(() => Promise.reject(new Error('must not execute'))),
    } as unknown as Payload
    const query = {
      kind: 'all' as const,
      page: 1,
      q: '',
      source: '',
      view: 'grid' as const,
      visibility: 'all' as const,
    }

    await expect(
      loadMediaPageData({
        env: { ADMIN_PORTAL_ENABLED: 'true', ADMIN_PORTAL_MEDIA_ENABLED: 'true' },
        payload,
        query,
        req,
        role: 'sales',
      }),
    ).resolves.toEqual({ state: 'forbidden', summary: null })

    await expect(
      loadMediaPageData({
        env: { ADMIN_PORTAL_ENABLED: 'true' },
        payload,
        query,
        req,
        role: 'admin',
      }),
    ).resolves.toEqual({ state: 'module-disabled', summary: null })

    expect(payload.find).not.toHaveBeenCalled()
  })

  it('renders grid/list controls, safe preview metadata, limits, and the editor gate', () => {
    const longFilename = `${'facade-detail-'.repeat(8)}.webp`
    const { container } = render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(MediaWorkspace, {
          pageState: 'available',
          summary: {
            editor: { status: 'dependency-gated' },
            items: [
              {
                alt: 'Curved aluminum facade panels',
                filename: longFilename,
                filesize: 2_621_440,
                height: 1600,
                id: 21,
                isPublic: true,
                kind: 'image',
                mimeType: 'image/webp',
                originalUrl: '/api/media/file/hero.webp',
                previewUrl: '/api/media/file/card-hero.webp',
                source: 'IVYBM project photography',
                updatedAt: '2026-07-30T09:00:00.000Z',
                width: 2400,
              },
              {
                alt: 'Internal pricing reference',
                filename: 'pricing-reference.pdf',
                filesize: 4_800_000,
                height: null,
                id: 22,
                isPublic: false,
                kind: 'pdf',
                mimeType: 'application/pdf',
                originalUrl: '/api/media/file/pricing-reference.pdf',
                previewUrl: '/api/media/file/pricing-reference.pdf',
                source: 'IVYBM internal',
                updatedAt: '2026-07-30T08:00:00.000Z',
                width: null,
              },
            ],
            limits: {
              imageMaxBytes: 8_388_608,
              mimeTypes: ['image/avif', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
              pdfMaxBytes: 20_971_520,
            },
            pagination: { page: 1, totalDocs: 2, totalPages: 1 },
            query: {
              kind: 'all',
              page: 1,
              q: '',
              source: '',
              view: 'grid',
              visibility: 'all',
            },
          },
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: '媒体素材' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '网格视图' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '列表视图' }).getAttribute('href')).toContain(
      'view=list',
    )
    expect(screen.getAllByText(longFilename)).toHaveLength(3)
    expect(screen.getByText('IVYBM project photography')).toBeTruthy()
    expect(screen.getByText('图片 ≤ 8 MB · PDF ≤ 20 MB')).toBeTruthy()
    expect(screen.getByRole('button', { name: '上传素材' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /pricing-reference\.pdf/ }))
    expect(screen.getByRole('heading', { name: 'pricing-reference.pdf' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '在新标签页预览 PDF' }).getAttribute('href')).toBe(
      '/api/media/file/pricing-reference.pdf',
    )
    expect(container.innerHTML).not.toContain('/admin')
  })
})
