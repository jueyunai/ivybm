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

    fireEvent.click(screen.getByRole('button', { name: /(生成草稿|AI 生成)/ }))
    const form = screen
      .getByRole('heading', { name: /(生成草稿|AI 生成)/ })
      .closest('.portal-content-studio__form')
    expect(form).toBeTruthy()
    const assetOptions = container.querySelectorAll('.portal-content-studio__asset-option')
    expect(assetOptions).toHaveLength(3)
    expect(container.querySelector('.portal-content-studio__asset-upload-card')).toBeTruthy()
    expect(screen.getByText('上传配图')).toBeTruthy()
    expect(screen.getByText('点击或拖拽上传 1~3 张图片')).toBeTruthy()

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

    expect(screen.getByText('知识来源')).toBeTruthy()
    expect(screen.getByText('暂无已审核且已就绪的知识库文档。')).toBeTruthy()

    // Before selecting an image or typing brief, generation button is disabled
    const generateBtn = within(form as HTMLElement).getByRole('button', { name: /(生成草稿|AI 生成)/ })
    expect(generateBtn.hasAttribute('disabled')).toBe(true)

    // Platforms are not selected by default
    const facebookCard = within(form as HTMLElement).getByRole('button', { name: /Facebook/ })
    const instagramCard = within(form as HTMLElement).getByRole('button', { name: /Instagram/ })
    const linkedinCard = within(form as HTMLElement).getByRole('button', { name: /LinkedIn/ })

    expect(facebookCard.getAttribute('aria-pressed')).toBe('false')
    expect(instagramCard.getAttribute('aria-pressed')).toBe('false')
    expect(linkedinCard.getAttribute('aria-pressed')).toBe('false')

    // Selecting a platform still leaves button disabled without brief or image
    fireEvent.click(facebookCard)
    expect(facebookCard.getAttribute('aria-pressed')).toBe('true')
    expect(generateBtn.hasAttribute('disabled')).toBe(true)

    // Clicking intent capsule populates the brief
    const shipmentCapsule = screen.getByRole('button', { name: /工厂出货/ })
    fireEvent.click(shipmentCapsule)
    const brief = screen.getByLabelText('生成需求') as HTMLTextAreaElement
    expect(brief.value).toContain('集装箱装柜出海')
    expect(generateBtn.hasAttribute('disabled')).toBe(false)
    expect(generateBtn.textContent).toContain('1 个平台')

    // Clear brief, but select an image: generation remains enabled (vision analysis flow)
    fireEvent.change(brief, { target: { value: '' } })
    expect(generateBtn.hasAttribute('disabled')).toBe(true)

    fireEvent.click(imageOption)
    expect((imageOption as HTMLInputElement).checked).toBe(true)
    expect(imageOption.closest('label')?.classList.contains('is-selected')).toBe(true)
    expect(generateBtn.hasAttribute('disabled')).toBe(false)

    // Select LinkedIn: button enables and shows 2 platforms
    fireEvent.click(linkedinCard)
    expect(linkedinCard.getAttribute('aria-pressed')).toBe('true')
    expect(generateBtn.textContent).toContain('2 个平台')
    expect(window.localStorage.getItem('ivybm:content-studio:selected-platforms')).toContain('facebook')

    // Clear platforms: button becomes disabled again
    const clearBtn = within(form as HTMLElement).getByRole('button', { name: '清空' })
    fireEvent.click(clearBtn)
    expect(facebookCard.getAttribute('aria-pressed')).toBe('false')
    expect(linkedinCard.getAttribute('aria-pressed')).toBe('false')
    expect(generateBtn.hasAttribute('disabled')).toBe(true)

    // Select all platforms: button shows 3 platforms
    const selectAllBtn = within(form as HTMLElement).getByRole('button', { name: '全选' })
    fireEvent.click(selectAllBtn)
    expect(facebookCard.getAttribute('aria-pressed')).toBe('true')
    expect(instagramCard.getAttribute('aria-pressed')).toBe('true')
    expect(linkedinCard.getAttribute('aria-pressed')).toBe('true')
    expect(generateBtn.hasAttribute('disabled')).toBe(false)
    expect(generateBtn.textContent).toContain('3 个平台')
    expect(window.localStorage.getItem('ivybm:content-studio:selected-platforms')).toContain('instagram')
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
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))

    // Editor is open and has drawer class
    const editorHeading = screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })
    expect(editorHeading).toBeTruthy()
    const editorContainer = editorHeading.closest('.portal-content-studio__editor--drawer')
    expect(editorContainer).toBeTruthy()

    // CRITICAL: Draft list must remain rendered and visible side-by-side in workspace
    expect(screen.getByRole('button', { name: /First Draft Post/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Second Draft Post/ })).toBeTruthy()

    // Cancel editor
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'First Draft Post' })).toBeTruthy()

    // 2. Open Draft Generator
    fireEvent.click(screen.getByRole('button', { name: /(生成草稿|AI 生成)/ }))

    // Generator is open and has drawer class
    const generatorHeading = screen.getByRole('heading', { name: /(生成草稿|AI 生成)/ })
    expect(generatorHeading).toBeTruthy()
    expect(generatorHeading.closest('.portal-content-studio__editor--drawer')).toBeTruthy()

    // CRITICAL: Draft list must still remain rendered and visible side-by-side
    expect(screen.getByRole('button', { name: /First Draft Post/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Second Draft Post/ })).toBeTruthy()

    // Cancel generator
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: /(生成草稿|AI 生成)/ })).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: /(生成草稿|AI 生成)/ }))
    expect(screen.getByRole('heading', { name: /(生成草稿|AI 生成)/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /(生成草稿|AI 生成)/ })).toBeNull()

    // 2. Close Create and verify detail view
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Approved Post' })).toBeTruthy()

    // 3. Open Publish Now from detail view
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }))
    expect(screen.getByRole('heading', { name: '立即发布' })).toBeTruthy()

    // 4. Switch from Publish Now to Generator via top button
    fireEvent.click(screen.getByRole('button', { name: /(生成草稿|AI 生成)/ }))
    expect(screen.getByRole('heading', { name: /(生成草稿|AI 生成)/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '立即发布' })).toBeNull()

    // 5. Switch from Generator to Schedule via Detail button (cancel generator first)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: /(生成草稿|AI 生成)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Approved Post' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '创建内部排期' }))
    expect(screen.getByRole('heading', { level: 3, name: '创建内部排期' })).toBeTruthy()

    // 6. Cancel Schedule: should return to ContentDetail and never revive Publish Now or Generator
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { level: 3, name: '创建内部排期' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '立即发布' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: /(生成草稿|AI 生成)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Approved Post' })).toBeTruthy()
  })

  it('restores previously selected platforms from localStorage when opening generator', () => {
    window.localStorage.setItem(
      'ivybm:content-studio:selected-platforms',
      JSON.stringify(['instagram', 'linkedin']),
    )

    const summary: ContentStudioSummary = {
      items: [],
      options: {
        assets: [],
        knowledgeSources: [],
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
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

    fireEvent.click(screen.getByRole('button', { name: /(生成草稿|AI 生成)/ }))
    const form = screen.getByRole('heading', { name: /(生成草稿|AI 生成)/ }).closest('.portal-content-studio__form')
    expect(form).toBeTruthy()

    const facebookCard = within(form as HTMLElement).getByRole('button', { name: /Facebook/ })
    const instagramCard = within(form as HTMLElement).getByRole('button', { name: /Instagram/ })
    const linkedinCard = within(form as HTMLElement).getByRole('button', { name: /LinkedIn/ })

    expect(facebookCard.getAttribute('aria-pressed')).toBe('false')
    expect(instagramCard.getAttribute('aria-pressed')).toBe('true')
    expect(linkedinCard.getAttribute('aria-pressed')).toBe('true')

    const brief = screen.getByLabelText('生成需求') as HTMLTextAreaElement
    fireEvent.change(brief, { target: { value: 'Custom requirement' } })
    const generateBtn = within(form as HTMLElement).getByRole('button', { name: /(生成草稿|AI 生成)/ })
    expect(generateBtn.hasAttribute('disabled')).toBe(false)
    expect(generateBtn.textContent).toContain('2 个平台')
  })

  it('reuses auto-generated image asset from the first platform for subsequent platforms', async () => {
    const fetchCalls: Array<{ body: Record<string, unknown>; url: string }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const parsedBody = JSON.parse((init?.body as string) || '{}')
      fetchCalls.push({ body: parsedBody, url: String(url) })
      return {
        json: async () => ({
          content: {
            assets: [88],
            id: fetchCalls.length === 1 ? 101 : 102,
            status: 'draft',
            title: 'Draft',
            updatedAt: '2026-09-09T00:00:00.000Z',
          },
        }),
        ok: true,
        status: 201,
      } as Response
    })

    const summary: ContentStudioSummary = {
      items: [],
      options: {
        assets: [],
        knowledgeSources: [],
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
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

    fireEvent.click(screen.getByRole('button', { name: /(生成草稿|AI 生成)/ }))
    const form = screen.getByRole('heading', { name: /(生成草稿|AI 生成)/ }).closest('.portal-content-studio__form')
    expect(form).toBeTruthy()

    // Select Instagram and LinkedIn
    const instagramCard = within(form as HTMLElement).getByRole('button', { name: /Instagram/ })
    const linkedinCard = within(form as HTMLElement).getByRole('button', { name: /LinkedIn/ })
    fireEvent.click(instagramCard)
    fireEvent.click(linkedinCard)

    // Check auto generate image
    const autoImageCheckbox = screen.getByRole('checkbox', { name: /手头无图/ })
    fireEvent.click(autoImageCheckbox)

    const brief = screen.getByLabelText('生成需求') as HTMLTextAreaElement
    fireEvent.change(brief, { target: { value: 'Curtain wall engineering showcase' } })

    const generateBtn = within(form as HTMLElement).getByRole('button', { name: /(生成草稿|AI 生成)/ })
    fireEvent.click(generateBtn)

    // Wait for the two requests
    await vi.waitFor(() => expect(fetchCalls.length).toBe(2))

    // First call: initial assets are empty, autoGenerateImage is true
    expect(fetchCalls[0].body.assets).toEqual([])
    expect(fetchCalls[0].body.autoGenerateImage).toBe(true)

    // Second call: reused image asset 88, autoGenerateImage is turned false
    expect(fetchCalls[1].body.assets).toEqual(['88'])
    expect(fetchCalls[1].body.autoGenerateImage).toBe(false)

    globalThis.fetch = originalFetch
  })

  it('opens lightbox preview when clicking an asset thumbnail in the detail pane', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [
            {
              id: 99,
              label: 'facade-concept.jpg',
              meta: 'image/jpeg',
              previewUrl: '/api/media/file/facade-concept.jpg',
            },
          ],
          body: 'Draft body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 42,
          knowledgeSources: [],
          platform: 'linkedin',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'draft',
          title: 'Facade Engineering Excellence',
          updatedAt: '2026-09-09T00:00:00.000Z',
        },
      ],
      options: {
        assets: [],
        knowledgeSources: [],
        platformAccounts: [],
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

    // Select the draft to view its details
    fireEvent.click(screen.getByRole('button', { name: /Facade Engineering Excellence/ }))

    // Locate the zoom button for the asset
    const zoomBtn = screen.getByRole('button', { name: /facade-concept\.jpg/ })
    expect(zoomBtn).toBeTruthy()
    fireEvent.click(zoomBtn)

    // Verify lightbox dialog opened
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'facade-concept.jpg' })).toBeTruthy()
    const img = within(dialog).getByAltText('facade-concept.jpg') as HTMLImageElement
    expect(img.src).toContain('/api/media/file/facade-concept.jpg')
    const openOriginalLink = within(dialog).getByRole('link', { name: /新标签查看原图/ })
    expect(openOriginalLink.getAttribute('href')).toBe('/api/media/file/facade-concept.jpg')
  })

  it('multi-image direct upload in AI generator selects all uploaded images atomically and sets carousel', async () => {
    const originalFetch = globalThis.fetch
    let uploadedCount = 0
    globalThis.fetch = vi.fn((input, init) => {
      const url = String(input)
      if (url === '/api/portal/media' && init?.method === 'POST') {
        uploadedCount++
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: {
                alt: `Uploaded image ${uploadedCount}`,
                id: 100 + uploadedCount,
                mimeType: 'image/jpeg',
                previewUrl: `/api/media/file/img-${uploadedCount}.jpg`,
              },
            }),
            { headers: { 'content-type': 'application/json' }, status: 201 },
          ),
        )
      }
      return originalFetch(input, init)
    })

    const summary: ContentStudioSummary = {
      items: [],
      options: {
        assets: [],
        knowledgeSources: [],
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
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

    fireEvent.click(screen.getByRole('button', { name: /(生成草稿|AI 生成)/ }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    const file1 = new File(['pic1'], 'pic1.jpg', { type: 'image/jpeg' })
    const file2 = new File(['pic2'], 'pic2.jpg', { type: 'image/jpeg' })

    fireEvent.change(fileInput, { target: { files: [file1, file2] } })

    await vi.waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      const assetCheckboxes = checkboxes.filter(
        (cb) => cb.getAttribute('aria-label')?.startsWith('Uploaded image'),
      )
      expect(assetCheckboxes.length).toBe(2)
      expect(assetCheckboxes.every((cb) => cb.checked)).toBe(true)
    })

    expect(screen.getByText('系统将根据配图数量自动匹配最佳内容格式。')).toBeTruthy()

    globalThis.fetch = originalFetch
  })
})
