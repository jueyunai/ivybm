import React from 'react'

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { ContentStudio } from '@/admin-portal/modules/content-studio/ContentStudio'
import {
  loadContentStudioPageData,
  type ContentStudioSummary,
} from '@/admin-portal/modules/content-studio/getContentStudioPage'

const router = { refresh: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  router.refresh.mockReset()
})

describe('Portal Content Studio', () => {
  it('projects safe official Media thumbnails for content relations and asset options', async () => {
    const image = {
      alt: 'Curved facade hero',
      filename: 'curved-facade.jpg',
      id: 21,
      mimeType: 'image/jpeg',
      sizes: {
        card: { url: '/api/media/file/card-curved-facade.jpg' },
        thumbnail: { url: '/api/media/file/thumbnail-curved-facade.jpg' },
      },
      thumbnailURL: '/api/media/file/fallback-curved-facade.jpg',
      url: '/api/media/file/curved-facade.jpg',
    }
    const unsafeImage = {
      alt: 'Unsafe image',
      filename: 'unsafe.jpg',
      id: 22,
      mimeType: 'image/jpeg',
      sizes: { card: { url: 'javascript:alert(1)' } },
      thumbnailURL: '//evil.example/unsafe.jpg',
      url: 'data:image/png;base64,unsafe',
    }
    const pdf = {
      alt: 'Technical catalogue',
      filename: 'catalogue.pdf',
      id: 23,
      mimeType: 'application/pdf',
      url: '/api/media/file/catalogue.pdf',
    }
    const find = vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'generated-contents') {
        return {
          docs: [
            {
              assets: [image],
              body: 'Draft body',
              contentLocale: 'en',
              contentType: 'post',
              id: 71,
              knowledgeSources: [],
              platform: 'linkedin',
              sourceReferences: [],
              status: 'draft',
              title: 'Draft with official Media',
              updatedAt: '2026-08-12T08:00:00.000Z',
            },
          ],
          page: 1,
          totalDocs: 1,
          totalPages: 1,
        }
      }
      if (collection === 'media') return { docs: [image, unsafeImage, pdf] }
      return { docs: [] }
    })

    const page = await loadContentStudioPageData({
      env: {
        ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: 'true',
        ADMIN_PORTAL_ENABLED: 'true',
      },
      payload: { find } as unknown as Payload,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
      req,
      role: 'operator',
    })

    expect(page.summary?.items[0]?.assets[0]).toMatchObject({
      id: 21,
      previewUrl: '/api/media/file/card-curved-facade.jpg',
    })
    expect(page.summary?.options.assets).toHaveLength(3)
    expect(page.summary?.options.assets[0]).toMatchObject({
      id: 21,
      previewUrl: '/api/media/file/card-curved-facade.jpg',
    })
    expect(page.summary?.options.assets[1]).not.toHaveProperty('previewUrl')
    expect(page.summary?.options.assets[2]).not.toHaveProperty('previewUrl')
    const mediaCall = find.mock.calls.find(([options]) => options.collection === 'media')?.[0]
    expect(mediaCall).toEqual(
      expect.objectContaining({
        select: expect.objectContaining({
          sizes: {
            card: { url: true },
            thumbnail: { url: true },
          },
          thumbnailURL: true,
          url: true,
        }),
      }),
    )
  })

  it('shows accessible asset thumbnails and fallbacks while allowing generation without knowledge', () => {
    const summary: ContentStudioSummary = {
      items: [],
      options: {
        assets: [
          {
            id: 21,
            label: 'Curved facade hero',
            meta: 'image/jpeg',
            previewUrl: '/api/media/file/card-curved-facade.jpg',
          },
          { id: 22, label: 'Missing image', meta: 'image/jpeg' },
          { id: 23, label: 'Technical catalogue', meta: 'application/pdf' },
        ],
        knowledgeSources: [],
      },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }
    const { container } = render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
    const form = screen
      .getByRole('heading', { name: '生成草稿' })
      .closest('.portal-content-studio__form')
    expect(form).toBeTruthy()
    const assetOptions = container.querySelectorAll('.portal-content-studio__asset-option')
    expect(assetOptions).toHaveLength(3)

    const imageOption = screen.getByRole('checkbox', { name: 'Curved facade hero' })
    expect(imageOption.closest('label')?.querySelector('img')?.getAttribute('src')).toContain(
      '/api/media/file/card-curved-facade.jpg',
    )
    expect(
      screen
        .getByRole('checkbox', { name: 'Missing image' })
        .closest('label')
        ?.querySelector('.portal-content-studio__asset-thumb.is-image svg'),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('checkbox', { name: 'Technical catalogue' })
        .closest('label')
        ?.querySelector('.portal-content-studio__asset-thumb.is-pdf svg'),
    ).toBeTruthy()

    fireEvent.click(imageOption)
    expect((imageOption as HTMLInputElement).checked).toBe(true)
    expect(imageOption.closest('label')?.classList.contains('is-selected')).toBe(true)

    const brief = screen.getByLabelText('生成需求')
    fireEvent.change(brief, { target: { value: 'Write a general introduction.' } })
    expect(
      within(form as HTMLElement)
        .getByRole('button', { name: '生成草稿' })
        .hasAttribute('disabled'),
    ).toBe(false)
  })
})
