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
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
      publishingEnabled: false,
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

  it('maintains draft list visibility side-by-side and uses drawer overlay container', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'Draft post content',
          contentLocale: 'en',
          contentType: 'post',
          id: 101,
          knowledgeSources: [],
          platform: 'linkedin',
          publishJobs: [],
          reviews: [],
          sourceReferences: [{ claim: 'Precision engineering', source: 'Engineering manual' }],
          status: 'draft',
          title: 'First Draft Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
        {
          assets: [],
          body: 'Second draft post content',
          contentLocale: 'en',
          contentType: 'post',
          id: 102,
          knowledgeSources: [],
          platform: 'facebook',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'draft',
          title: 'Second Draft Post',
          updatedAt: '2026-08-31T11:00:00.000Z',
        },
      ],
      options: {
        assets: [],
        knowledgeSources: [],
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 2, totalPages: 1 },
      publishingEnabled: true,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    // Initially, list items are visible
    expect(screen.getByRole('button', { name: /First Draft Post/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Second Draft Post/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'First Draft Post' })).toBeTruthy()

    // 1. Open New Draft Editor
    fireEvent.click(screen.getByRole('button', { name: '新建草稿' }))

    // Editor is open and has drawer class
    const editorHeading = screen.getByRole('heading', { name: '新建草稿' })
    expect(editorHeading).toBeTruthy()
    const editorContainer = editorHeading.closest('.portal-content-studio__editor--drawer')
    expect(editorContainer).toBeTruthy()

    // CRITICAL: Draft list must remain rendered and visible side-by-side in workspace
    expect(screen.getByRole('button', { name: /First Draft Post/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Second Draft Post/ })).toBeTruthy()

    // Cancel editor
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '新建草稿' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'First Draft Post' })).toBeTruthy()

    // 2. Open Draft Generator
    fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))

    // Generator is open and has drawer class
    const generatorHeading = screen.getByRole('heading', { name: '生成草稿' })
    expect(generatorHeading).toBeTruthy()
    expect(generatorHeading.closest('.portal-content-studio__editor--drawer')).toBeTruthy()

    // CRITICAL: Draft list must still remain rendered and visible side-by-side
    expect(screen.getByRole('button', { name: /First Draft Post/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Second Draft Post/ })).toBeTruthy()

    // Cancel generator
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '生成草稿' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'First Draft Post' })).toBeTruthy()
  })

  it('enforces mutual exclusivity between actions and never revives older action panels on cancel', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'Approved post body ready for schedule or publish',
          contentLocale: 'en',
          contentType: 'post',
          id: 201,
          knowledgeSources: [],
          platform: 'facebook',
          publishJobs: [],
          reviews: [],
          sourceReferences: [{ claim: 'Global supply', source: 'Brochure' }],
          status: 'approved',
          title: 'Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
      options: {
        assets: [],
        knowledgeSources: [],
        platformAccounts: [{ id: 11, label: 'Facebook Page', platform: 'facebook' }],
      },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      publishingEnabled: true,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    // 1. Generator -> Create switch: clicking "新建草稿" while "生成草稿" is open immediately shows "新建草稿"
    fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
    expect(screen.getByRole('heading', { name: '生成草稿' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '新建草稿' }))
    expect(screen.getByRole('heading', { name: '新建草稿' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '生成草稿' })).toBeNull()

    // 2. Close Create and verify detail view
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '新建草稿' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Approved Post' })).toBeTruthy()

    // 3. Open Publish Now from detail view
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }))
    expect(screen.getByRole('heading', { name: '立即发布' })).toBeTruthy()

    // 4. Switch from Publish Now to Generator via top button
    fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
    expect(screen.getByRole('heading', { name: '生成草稿' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '立即发布' })).toBeNull()

    // 5. Switch from Generator to Schedule via Detail button (cancel generator first)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '生成草稿' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Approved Post' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '创建内部排期' }))
    expect(screen.getByRole('heading', { level: 3, name: '创建内部排期' })).toBeTruthy()

    // 6. Cancel Schedule: should return to ContentDetail and never revive Publish Now or Generator
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { level: 3, name: '创建内部排期' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '立即发布' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '新建草稿' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '生成草稿' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Approved Post' })).toBeTruthy()
  })
})
