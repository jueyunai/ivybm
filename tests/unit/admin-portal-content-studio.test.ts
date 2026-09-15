import React from 'react'

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { ContentStudio } from '@/admin-portal/modules/content-studio/ContentStudio'
import {
  loadContentStudioPageData,
  type ContentStudioSummary,
} from '@/admin-portal/modules/content-studio/getContentStudioPage'
import { selectUiOption } from './support/uiSelect'

const router = { push: vi.fn(), refresh: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  router.push.mockReset()
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
      user: { role: 'operator' },
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

    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form = screen
      .getByRole('heading', { name: /AI生成/ })
      .closest('.portal-content-studio__form')
    expect(form).toBeTruthy()
    expect(screen.getByRole('button', { name: '社媒内容' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    const assetOptions = container.querySelectorAll('.portal-content-studio__asset-option')
    expect(assetOptions).toHaveLength(3)
    expect(container.querySelector('.portal-content-studio__asset-upload-card')).toBeTruthy()
    expect(screen.getByText('上传配图')).toBeTruthy()
    expect(screen.getByText('点击或拖拽上传 1-3 张图片')).toBeTruthy()

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
    const generateBtn = within(form as HTMLElement).getByRole('button', {
      name: /AI生成/,
    })
    expect(generateBtn.hasAttribute('disabled')).toBe(true)

    // The real default is visible instead of being submitted as hidden state.
    const facebookCard = within(form as HTMLElement).getByRole('button', { name: /Facebook/ })
    const instagramCard = within(form as HTMLElement).getByRole('button', { name: /Instagram/ })
    const linkedinCard = within(form as HTMLElement).getByRole('button', { name: /LinkedIn/ })

    expect(facebookCard.getAttribute('aria-pressed')).toBe('false')
    expect(instagramCard.getAttribute('aria-pressed')).toBe('false')
    expect(linkedinCard.getAttribute('aria-pressed')).toBe('true')

    // Selecting another platform still leaves button disabled without brief or image
    fireEvent.click(facebookCard)
    expect(facebookCard.getAttribute('aria-pressed')).toBe('true')
    expect(generateBtn.hasAttribute('disabled')).toBe(true)

    // Clicking intent capsule populates the brief
    const shipmentCapsule = screen.getByRole('button', { name: /出口海运装箱防护/ })
    fireEvent.click(shipmentCapsule)
    const brief = screen.getByLabelText('生成需求') as HTMLTextAreaElement
    expect(brief.value).toContain('集装箱装运')
    expect(generateBtn.hasAttribute('disabled')).toBe(false)
    expect(generateBtn.textContent).toContain('2 个平台')

    // Clear brief, but select an image: generation remains enabled (vision analysis flow)
    fireEvent.change(brief, { target: { value: '' } })
    expect(generateBtn.hasAttribute('disabled')).toBe(true)

    fireEvent.click(imageOption)
    expect((imageOption as HTMLInputElement).checked).toBe(true)
    expect(imageOption.closest('label')?.classList.contains('is-selected')).toBe(true)
    expect(generateBtn.hasAttribute('disabled')).toBe(false)

    // Deselect LinkedIn: only the explicitly selected Facebook target remains.
    fireEvent.click(linkedinCard)
    expect(linkedinCard.getAttribute('aria-pressed')).toBe('false')
    expect(generateBtn.textContent).toContain('1 个平台')
    expect(window.localStorage.getItem('ivybm:content-studio:selected-platforms')).toContain(
      'facebook',
    )

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
    expect(window.localStorage.getItem('ivybm:content-studio:selected-platforms')).toContain(
      'instagram',
    )
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
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))

    // Generator is open and has drawer class
    const generatorHeading = screen.getByRole('heading', { name: /AI生成/ })
    expect(generatorHeading).toBeTruthy()
    expect(generatorHeading.closest('.portal-content-studio__editor--drawer')).toBeTruthy()

    // CRITICAL: Draft list must still remain rendered and visible side-by-side
    expect(screen.getByRole('button', { name: /First Draft Post/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Second Draft Post/ })).toBeTruthy()

    // Cancel generator
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'First Draft Post' })).toBeTruthy()
  })

  it('keeps the fact claim input mounted and focused across consecutive edits', () => {
    const summary: ContentStudioSummary = {
      items: [],
      options: {
        assets: [],
        knowledgeSources: [
          {
            id: 9,
            label: 'Facade specification v1',
            reference: 'Facade specification v1',
          },
        ],
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
      publishingEnabled: false,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Facade specification v1' }))
    fireEvent.click(screen.getByRole('button', { name: '添加事实' }))

    const claim = screen.getByPlaceholderText('关键事实 / 论据') as HTMLInputElement
    claim.focus()
    fireEvent.change(claim, { target: { value: 'A' } })
    expect(document.activeElement).toBe(claim)
    fireEvent.change(claim, { target: { value: 'AB' } })
    expect(screen.getByPlaceholderText('关键事实 / 论据')).toBe(claim)
    expect(document.activeElement).toBe(claim)
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

    // 1. Generator -> Create switch: clicking "新建草稿" while "AI生成" is open immediately shows "新建草稿"
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()

    // 2. Close Create and verify detail view
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Approved Post' })).toBeTruthy()

    // 3. Open Publish Now from detail view
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }))
    expect(screen.getByRole('heading', { name: '立即发布' })).toBeTruthy()

    // 4. Switch from Publish Now to Generator via top button
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '立即发布' })).toBeNull()

    // 5. Cancel generator: returns to ContentDetail
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Approved Post' })).toBeTruthy()

    // 6. Transitional schedule button is hidden from UI
    expect(screen.queryByRole('button', { name: '创建内部排期' })).toBeNull()
    expect(screen.getByRole('button', { name: '立即发布' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '立即发布' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
  })

  it('switches to draft details and closes drawer when clicking a draft item in the list while in create or generator mode', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
        {
          assets: [],
          body: 'Second body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 2,
          knowledgeSources: [],
          platform: 'linkedin',
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

    // 1. Enter create mode
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()

    // During create mode, list items should not be marked as selected
    const firstItemBtn = screen.getByRole('button', { name: /First Approved Post/ })
    const secondItemBtn = screen.getByRole('button', { name: /Second Draft Post/ })
    expect(firstItemBtn.getAttribute('aria-pressed')).toBe('false')
    expect(secondItemBtn.getAttribute('aria-pressed')).toBe('false')

    // Clicking an existing draft item closes create mode and switches to that draft's details
    fireEvent.click(firstItemBtn)
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'First Approved Post' })).toBeTruthy()
    expect(firstItemBtn.getAttribute('aria-pressed')).toBe('true')

    // 2. Enter generator mode
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()

    // During generator mode, list items should also not be marked as selected
    expect(firstItemBtn.getAttribute('aria-pressed')).toBe('false')
    expect(secondItemBtn.getAttribute('aria-pressed')).toBe('false')

    // Clicking a draft item closes generator mode and switches to that draft's details
    fireEvent.click(secondItemBtn)
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Second Draft Post' })).toBeTruthy()
    expect(secondItemBtn.getAttribute('aria-pressed')).toBe('true')

    // 3. Re-enter create mode, then trigger portal:navigate-active (simulating clicking active sidebar nav)
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('portal:navigate-active', {
          detail: { href: '/dashboard/content-studio' },
        }),
      )
    })
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Second Draft Post' })).toBeTruthy()

    // 4. Re-enter generator mode, then trigger portal:navigate-active
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('portal:navigate-active', {
          detail: { href: '/dashboard/content-studio' },
        }),
      )
    })
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Second Draft Post' })).toBeTruthy()
  })

  it('shows confirmation dialog when switching list items or clicking sidebar with unsaved draft edits', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
        {
          assets: [],
          body: 'Second body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 2,
          knowledgeSources: [],
          platform: 'linkedin',
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

    // 1. Open "新建草稿"
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()

    // Enter draft content
    const titleInput = screen.getByRole('textbox', { name: '草稿标题' })
    fireEvent.change(titleInput, { target: { value: 'My Unsaved Draft Title' } })

    // 2. Click another item in list -> confirmation dialog appears
    const secondItemBtn = screen.getByRole('button', { name: /Second Draft Post/ })
    fireEvent.click(secondItemBtn)

    // Verify confirmation dialog is visible
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    expect(screen.getByText(/当前草稿已有输入或生成的内容/)).toBeTruthy()

    // Click "继续编辑" -> stays in draft editor with input intact
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: '草稿标题' }) as HTMLInputElement).value).toBe(
      'My Unsaved Draft Title',
    )

    // Click another item in list again -> choose "放弃并切换" -> switches and closes editor
    fireEvent.click(secondItemBtn)
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Second Draft Post' })).toBeTruthy()

    // 3. Test with "AI生成": enter brief and trigger sidebar navigation to another module
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()

    const briefTextarea = screen.getByRole('textbox', { name: '生成需求' })
    fireEvent.change(briefTextarea, { target: { value: 'Brief requirements here' } })

    // Trigger sidebar navigation to another route (e.g. /dashboard/media)
    const onCloseMobileCancel = vi.fn()
    let navEvent = new CustomEvent('portal:sidebar-navigate', {
      cancelable: true,
      detail: { href: '/dashboard/media', onClose: onCloseMobileCancel },
    })
    act(() => {
      window.dispatchEvent(navEvent)
    })

    // Verify navigation was prevented and confirmation dialog appears
    expect(navEvent.defaultPrevented).toBe(true)
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    // Cancel ("继续编辑") -> stays in generator, router.push was not called, mobile nav closes
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()
    expect(router.push).not.toHaveBeenCalled()
    expect(onCloseMobileCancel).toHaveBeenCalledTimes(1)

    // Trigger sidebar navigation again and confirm ("放弃并切换") -> navigates to /dashboard/media
    const onCloseSidebar = vi.fn()
    navEvent = new CustomEvent('portal:sidebar-navigate', {
      cancelable: true,
      detail: { href: '/dashboard/media', onClose: onCloseSidebar },
    })
    act(() => {
      window.dispatchEvent(navEvent)
    })
    expect(navEvent.defaultPrevented).toBe(true)
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(router.push).toHaveBeenCalledWith('/dashboard/media')
    expect(onCloseSidebar).toHaveBeenCalledTimes(1)

    // 4. Test clicking active sidebar link (/dashboard/content-studio) while dirty
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '草稿标题' }), {
      target: { value: 'Another Unsaved Draft' },
    })

    const onCloseActive = vi.fn()
    const activeNavEvent = new CustomEvent('portal:sidebar-navigate', {
      cancelable: true,
      detail: { href: '/dashboard/content-studio', onClose: onCloseActive },
    })
    act(() => {
      window.dispatchEvent(activeNavEvent)
    })
    expect(activeNavEvent.defaultPrevented).toBe(true)
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Second Draft Post' })).toBeTruthy()
    expect(onCloseActive).toHaveBeenCalledTimes(1)
  })

  it('treats dropdown changes in create mode as dirty and triggers confirmation dialog', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
        {
          assets: [],
          body: 'Second body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 2,
          knowledgeSources: [],
          platform: 'linkedin',
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

    // Open "新建草稿"
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    const editor = screen.getByRole('heading', { name: /(新建草稿|手动新建)/ }).closest('.portal-content-studio__form') as HTMLElement
    expect(editor).toBeTruthy()

    // Change platform from LinkedIn to Facebook via UiSelect without entering any text
    const platformTrigger = within(editor).getByRole('combobox', { name: '平台' })
    selectUiOption(platformTrigger, 'Facebook')

    // Click second draft item in list -> confirmation dialog MUST appear because platform was changed
    const secondItemBtn = screen.getByRole('button', { name: /Second Draft Post/ })
    fireEvent.click(secondItemBtn)
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    // Cancel -> stays in editor
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()

    // Click again and confirm -> closes editor and switches
    fireEvent.click(secondItemBtn)
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Second Draft Post' })).toBeTruthy()
  })

  it('clears error banner and generation progress when confirming sub-mode change in generator', async () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
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

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'Failed generation server error' } }),
    })) as unknown as typeof fetch

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    // Open generator
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form = screen.getByRole('heading', { name: /AI生成/ }).closest('.portal-content-studio__form') as HTMLElement
    const briefTextarea = within(form).getByRole('textbox', { name: '生成需求' })
    fireEvent.change(briefTextarea, { target: { value: 'Brief requirements' } })

    // Trigger generate -> fails and displays error banner
    fireEvent.click(within(form).getByRole('button', { name: /AI生成/ }))
    await screen.findByText('Failed generation server error')
    expect(within(form).getByRole('alert')).toBeTruthy()

    // Switch to image mode -> confirmation dialog
    fireEvent.click(within(form).getByRole('button', { name: '图片生成' }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    // Confirm switch -> error banner MUST be cleared
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(within(form).queryByRole('alert')).toBeNull()

    globalThis.fetch = originalFetch
  })

  it('guards pagination navigation when editor has unsaved changes', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 25, totalPages: 2 },
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

    // Open create draft and enter text
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '草稿标题' }), {
      target: { value: 'Draft with unsaved title' },
    })

    // Click Next page link
    const nextPageLink = screen.getByRole('link', { name: '下一页' })
    fireEvent.click(nextPageLink)

    // Confirmation dialog should appear
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    // Cancel ("继续编辑") -> router.push is not called, editor remains open with title
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()
    expect(router.push).not.toHaveBeenCalled()

    // Click Next page link again and confirm ("放弃并切换") -> editor closes and router.push is called
    fireEvent.click(nextPageLink)
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeNull()
    expect(router.push).toHaveBeenCalledWith('/dashboard/content-studio?page=2')
  })

  it('detects contentLocale and autoGenerateImage changes in generator as dirty', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
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

    // 1. Open generator, change language to Arabic without typing brief
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form = screen.getByRole('heading', { name: /AI生成/ }).closest('.portal-content-studio__form') as HTMLElement
    const localeSelect = within(form).getByRole('combobox', { name: '语言' })
    selectUiOption(localeSelect, 'ar')

    // Click draft in list -> dialog should appear because locale changed
    fireEvent.click(screen.getByRole('button', { name: /First Approved Post/ }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()

    // 2. Open generator again, toggle auto-generate image
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form2 = screen.getByRole('heading', { name: /AI生成/ }).closest('.portal-content-studio__form') as HTMLElement
    const autoImageCheckbox = within(form2).getByRole('checkbox', { name: /AI 自动生成概念配图/ })
    fireEvent.click(autoImageCheckbox)

    fireEvent.click(screen.getByRole('button', { name: /First Approved Post/ }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
  })

  it('detects image size and reference selection in image generator mode as dirty', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
      options: {
        assets: [
          { id: 42, label: 'Ref Image', meta: 'image/png', previewUrl: '/ref.png' },
        ],
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

    // Open generator, switch to image mode
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    fireEvent.click(screen.getByRole('button', { name: '图片生成' }))

    // Change image size without typing prompt
    const sizeSelect = screen.getByRole('combobox', { name: '图片尺寸' })
    selectUiOption(sizeSelect, '1024x1536')

    // Click draft in list -> dialog should appear
    fireEvent.click(screen.getByRole('button', { name: /First Approved Post/ }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()

    // Open generator, switch to image mode, choose reference image
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    fireEvent.click(screen.getByRole('button', { name: '图片生成' }))
    const refSelect = screen.getByRole('combobox', { name: '参考素材' })
    selectUiOption(refSelect, '42')

    fireEvent.click(screen.getByRole('button', { name: /First Approved Post/ }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
  })

  it('disables input controls and blocks navigation and mode switching while copy generation is in-flight', async () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      publishingEnabled: true,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }

    let resolveRequest: (value: unknown) => void = () => {}
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() => new Promise((resolve) => {
      resolveRequest = () => resolve({
        ok: true,
        json: async () => ({ content: { id: 99, title: 'Async Generated Draft' } }),
      })
    })) as unknown as typeof fetch

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    // Open generator
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form = screen.getByRole('heading', { name: /AI生成/ }).closest('.portal-content-studio__form') as HTMLElement
    const briefTextarea = within(form).getByRole('textbox', { name: '生成需求' })
    fireEvent.change(briefTextarea, { target: { value: 'Long running generation brief' } })

    // Click generate button -> enters busy state
    const generateBtn = within(form).getByRole('button', { name: /AI生成/ })
    fireEvent.click(generateBtn)

    // 1. Inputs and mode buttons MUST be disabled while generation is in-flight
    expect(briefTextarea.hasAttribute('disabled')).toBe(true)
    const imageModeBtn = within(form).getByRole('button', { name: '图片生成' })
    expect(imageModeBtn.hasAttribute('disabled')).toBe(true)
    const cancelBtn = within(form).getByRole('button', { name: '取消' })
    expect(cancelBtn.hasAttribute('disabled')).toBe(true)

    // 2. Draft item clicks and sidebar navigate MUST be blocked while in-flight
    fireEvent.click(screen.getByRole('button', { name: /First Approved Post/ }))
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()

    const navEvent = new CustomEvent('portal:sidebar-navigate', {
      cancelable: true,
      detail: { href: '/dashboard/media' },
    })
    act(() => {
      window.dispatchEvent(navEvent)
    })
    expect(navEvent.defaultPrevented).toBe(true)
    expect(router.push).not.toHaveBeenCalled()

    // Now request resolves -> onDone executes, generator closes cleanly
    await act(async () => {
      resolveRequest({})
    })

    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'First Approved Post' })).toBeTruthy()

    globalThis.fetch = originalFetch
  })

  it('blocks mode switch, generate button, and navigation while copy asset upload is in-flight', async () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      publishingEnabled: true,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }

    let resolveUpload = () => {}
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn((input, init) => {
      const url = String(input)
      if (url === '/api/portal/media' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveUpload = () =>
            resolve(
              new Response(
                JSON.stringify({
                  result: {
                    alt: 'Test upload image',
                    id: 201,
                    mimeType: 'image/jpeg',
                    previewUrl: '/api/media/file/test-upload.jpg',
                  },
                }),
                { headers: { 'content-type': 'application/json' }, status: 201 },
              ),
            )
        })
      }
      return originalFetch(input, init)
    }) as unknown as typeof fetch

    const { container } = render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    // Open generator
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form = screen.getByRole('heading', { name: /AI生成/ }).closest('.portal-content-studio__form') as HTMLElement
    const briefTextarea = within(form).getByRole('textbox', { name: '生成需求' })
    fireEvent.change(briefTextarea, { target: { value: 'Test brief' } })

    // Trigger upload
    const fileInput = container.querySelector('.portal-content-studio__asset-upload-card input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()
    const testFile = new File(['image-content'], 'test-facade.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [testFile] } })

    // While uploading: mode button disabled, generate button disabled, cancel button disabled, brief disabled
    const imageModeBtn = within(form).getByRole('button', { name: '图片生成' })
    const generateBtn = within(form).getByRole('button', { name: /AI生成/ })
    const cancelBtn = within(form).getByRole('button', { name: '取消' })

    expect(imageModeBtn.hasAttribute('disabled')).toBe(true)
    expect(generateBtn.hasAttribute('disabled')).toBe(true)
    expect(cancelBtn.hasAttribute('disabled')).toBe(true)
    expect(briefTextarea.hasAttribute('disabled')).toBe(true)

    // Mode change must be blocked
    fireEvent.click(imageModeBtn)
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()
    expect(within(form).queryByRole('textbox', { name: '图片提示词' })).toBeNull()

    // Navigation must be blocked
    fireEvent.click(screen.getByRole('button', { name: /First Approved Post/ }))
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()

    const navEvent = new CustomEvent('portal:sidebar-navigate', {
      cancelable: true,
      detail: { href: '/dashboard/leads' },
    })
    act(() => {
      window.dispatchEvent(navEvent)
    })
    expect(navEvent.defaultPrevented).toBe(true)
    expect(router.push).not.toHaveBeenCalled()

    // Resolve upload
    await act(async () => {
      resolveUpload()
    })

    // Now upload finished: controls re-enabled
    expect(imageModeBtn.hasAttribute('disabled')).toBe(false)
    expect(generateBtn.hasAttribute('disabled')).toBe(false)
    expect(cancelBtn.hasAttribute('disabled')).toBe(false)

    globalThis.fetch = originalFetch
  })

  it('blocks mode switch, drawer close, and navigation while image generation, upload, or adopt is in-flight', async () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'draft',
          title: 'Target Draft',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
      options: {
        assets: [{ id: 42, label: 'Existing Ref', meta: 'image/png', previewUrl: '/ref.png' }],
        knowledgeSources: [],
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      publishingEnabled: true,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }

    let resolveOperation: (value: unknown) => void = () => {}
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() => new Promise((resolve) => {
      resolveOperation = (val) => resolve(val)
    })) as unknown as typeof fetch

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    // Open generator and switch to image mode
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    fireEvent.click(screen.getByRole('button', { name: '图片生成' }))

    const form = screen.getByRole('heading', { name: /AI生成/ }).closest('.portal-content-studio__form') as HTMLElement
    const promptTextarea = within(form).getByRole('textbox', { name: '图片提示词' })
    fireEvent.change(promptTextarea, { target: { value: 'A futuristic facade' } })

    // 1. Trigger generate image
    const generateImgBtn = within(form).getByRole('button', { name: '生成图片' })
    fireEvent.click(generateImgBtn)

    // While generating image: mode buttons disabled, prompt disabled, navigation blocked
    const copyModeBtn = within(form).getByRole('button', { name: '社媒内容' })
    expect(copyModeBtn.hasAttribute('disabled')).toBe(true)
    expect(promptTextarea.hasAttribute('disabled')).toBe(true)

    fireEvent.click(copyModeBtn)
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()

    const navEvent = new CustomEvent('portal:sidebar-navigate', {
      cancelable: true,
      detail: { href: '/dashboard/leads' },
    })
    act(() => {
      window.dispatchEvent(navEvent)
    })
    expect(navEvent.defaultPrevented).toBe(true)
    expect(router.push).not.toHaveBeenCalled()

    // Resolve generate image
    await act(async () => {
      resolveOperation({
        ok: true,
        json: async () => ({
          media: { id: 88, previewUrl: '/generated-88.png' },
          revisedPrompt: 'Revised prompt',
        }),
      })
    })

    // Image preview is rendered
    expect(screen.getByText('采用为草稿资产')).toBeTruthy()
    expect(copyModeBtn.hasAttribute('disabled')).toBe(false)

    // 2. Trigger adopt image
    const adoptBtn = screen.getByRole('button', { name: '采用为草稿资产' })
    fireEvent.click(adoptBtn)

    // While adopt in flight: mode buttons disabled, adopt disabled, navigation blocked
    expect(copyModeBtn.hasAttribute('disabled')).toBe(true)
    expect(adoptBtn.hasAttribute('disabled')).toBe(true)

    const navEvent2 = new CustomEvent('portal:sidebar-navigate', {
      cancelable: true,
      detail: { href: '/dashboard/leads' },
    })
    act(() => {
      window.dispatchEvent(navEvent2)
    })
    expect(navEvent2.defaultPrevented).toBe(true)
    expect(router.push).not.toHaveBeenCalled()

    // Resolve adopt
    await act(async () => {
      resolveOperation({
        ok: true,
        json: async () => ({ content: { id: 1, updatedAt: '2026-08-31T11:00:00.000Z' } }),
      })
    })

    // Adopt completes and closes drawer cleanly
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()

    globalThis.fetch = originalFetch
  })

  it('guards sub-mode switching within generator and preserves composite dirty state across copy and image modes', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
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

    // Open AI generator (defaults to "社媒内容" / copy mode)
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    expect(screen.getByRole('heading', { name: /AI生成/ })).toBeTruthy()

    // 1. Enter brief in copy mode
    const briefTextarea = screen.getByRole('textbox', { name: '生成需求' })
    fireEvent.change(briefTextarea, { target: { value: 'Architectural aluminum cladding' } })

    // Click "图片生成" mode button -> confirmation dialog should appear
    fireEvent.click(screen.getByRole('button', { name: '图片生成' }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    // Cancel ("继续编辑") -> stays in copy mode, brief intact
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.getByRole('button', { name: '社媒内容' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('textbox', { name: '生成需求' }) as HTMLTextAreaElement).value).toBe(
      'Architectural aluminum cladding',
    )

    // Click "图片生成" again and confirm ("放弃并切换") -> switches to image mode and clears copy brief
    fireEvent.click(screen.getByRole('button', { name: '图片生成' }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.getByRole('button', { name: '图片生成' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('textbox', { name: '图片提示词' })).toBeTruthy()

    // 2. In image mode, enter an image prompt
    const promptInput = screen.getByRole('textbox', { name: '图片提示词' })
    fireEvent.change(promptInput, { target: { value: 'Futuristic facade rendering' } })

    // Click "社媒内容" mode button -> confirmation dialog should appear
    fireEvent.click(screen.getByRole('button', { name: '社媒内容' }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    // Cancel -> stays in image mode, prompt intact
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.getByRole('button', { name: '图片生成' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('textbox', { name: '图片提示词' }) as HTMLTextAreaElement).value).toBe(
      'Futuristic facade rendering',
    )

    // In image mode with prompt entered, clicking draft item in list must also trigger confirmation
    const firstItemBtn = screen.getByRole('button', { name: /First Approved Post/ })
    fireEvent.click(firstItemBtn)
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /AI生成/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'First Approved Post' })).toBeTruthy()
  })

  it('guards filter changes and filter form submission when editor has unsaved changes', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'First body text',
          contentLocale: 'en',
          contentType: 'post',
          id: 1,
          knowledgeSources: [],
          platform: 'instagram',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'approved',
          title: 'First Approved Post',
          updatedAt: '2026-08-31T10:00:00.000Z',
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

    // Open "新建草稿" and type unsaved changes
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '草稿标题' }), {
      target: { value: 'Unsaved draft before filter change' },
    })

    // Change status filter via combobox
    const statusSelect = screen.getByRole('combobox', { name: '状态' })
    fireEvent.click(statusSelect)
    const draftOption = screen.getByRole('option', { name: '草稿' })
    fireEvent.click(draftOption)

    // Confirmation dialog must appear and router.push must NOT be called yet
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()
    expect(router.push).not.toHaveBeenCalled()

    // Cancel ("继续编辑") -> stays in editor, router.push never called
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(screen.getByRole('heading', { name: /(新建草稿|手动新建)/ })).toBeTruthy()
    expect(router.push).not.toHaveBeenCalled()

    // Change status filter again and confirm ("放弃并切换") -> editor closes and router.push is called
    fireEvent.click(statusSelect)
    fireEvent.click(screen.getByRole('option', { name: '草稿' }))
    expect(screen.getByRole('heading', { name: '放弃未保存的内容？' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }))
    expect(screen.queryByRole('heading', { name: '放弃未保存的内容？' })).toBeNull()
    expect(router.push).toHaveBeenCalledWith('/dashboard/content-studio?status=draft')
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

    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form = screen
      .getByRole('heading', { name: /AI生成/ })
      .closest('.portal-content-studio__form')
    expect(form).toBeTruthy()

    const facebookCard = within(form as HTMLElement).getByRole('button', { name: /Facebook/ })
    const instagramCard = within(form as HTMLElement).getByRole('button', { name: /Instagram/ })
    const linkedinCard = within(form as HTMLElement).getByRole('button', { name: /LinkedIn/ })

    expect(facebookCard.getAttribute('aria-pressed')).toBe('false')
    expect(instagramCard.getAttribute('aria-pressed')).toBe('true')
    expect(linkedinCard.getAttribute('aria-pressed')).toBe('true')

    const brief = screen.getByLabelText('生成需求') as HTMLTextAreaElement
    fireEvent.change(brief, { target: { value: 'Custom requirement' } })
    const generateBtn = within(form as HTMLElement).getByRole('button', {
      name: /AI生成/,
    })
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

    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form = screen
      .getByRole('heading', { name: /AI生成/ })
      .closest('.portal-content-studio__form')
    expect(form).toBeTruthy()

    // LinkedIn is selected by default; add Instagram for a two-platform batch.
    const instagramCard = within(form as HTMLElement).getByRole('button', { name: /Instagram/ })
    fireEvent.click(instagramCard)

    // Check auto generate image
    const autoImageCheckbox = screen.getByRole('checkbox', { name: /手头无图/ })
    fireEvent.click(autoImageCheckbox)

    const brief = screen.getByLabelText('生成需求') as HTMLTextAreaElement
    fireEvent.change(brief, { target: { value: 'Curtain wall engineering showcase' } })

    const generateBtn = within(form as HTMLElement).getByRole('button', {
      name: /AI生成/,
    })
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

  it('retries only failed platforms with stable per-platform idempotency keys', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ idempotencyKey: string; platform: string }> = []
    let instagramAttempts = 0
    globalThis.fetch = vi.fn(async (input, init) => {
      if (String(input) !== '/api/portal/content-studio/generate') {
        return originalFetch(input, init)
      }
      const body = JSON.parse(String(init?.body)) as {
        idempotencyKey: string
        platform: string
      }
      requests.push(body)
      if (body.platform === 'instagram' && instagramAttempts++ === 0) {
        return Response.json({ error: { message: 'Instagram failed' } }, { status: 500 })
      }
      return Response.json({ content: { assets: [88], id: requests.length } })
    })

    const summary: ContentStudioSummary = {
      items: [],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
      publishingEnabled: false,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const form = screen
      .getByRole('heading', { name: /AI生成/ })
      .closest('.portal-content-studio__form') as HTMLElement
    fireEvent.click(within(form).getByRole('button', { name: /LinkedIn/ }))
    fireEvent.click(within(form).getByRole('button', { name: /Facebook/ }))
    fireEvent.click(within(form).getByRole('button', { name: /Instagram/ }))
    fireEvent.change(within(form).getByLabelText('生成需求'), {
      target: { value: 'Prepare a platform post.' },
    })
    const generate = within(form).getByRole('button', { name: /AI生成/ })
    fireEvent.click(generate)

    expect((await screen.findByRole('alert')).textContent).toBe('Instagram failed')
    fireEvent.click(generate)
    await vi.waitFor(() => expect(requests).toHaveLength(3))

    expect(requests.map(({ platform }) => platform)).toEqual(['facebook', 'instagram', 'instagram'])
    expect(requests[1]?.idempotencyKey).toBe(requests[2]?.idempotencyKey)
    expect(requests.filter(({ platform }) => platform === 'facebook')).toHaveLength(1)
    globalThis.fetch = originalFetch
  })

  it('persists an explicit platform clear without restoring a hidden default', () => {
    const summary: ContentStudioSummary = {
      items: [],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
      publishingEnabled: false,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }
    const renderStudio = () =>
      render(
        React.createElement(
          PortalPreferencesProvider,
          null,
          React.createElement(ContentStudio, { pageState: 'available', summary }),
        ),
      )

    const first = renderStudio()
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const firstForm = screen
      .getByRole('heading', { name: /AI生成/ })
      .closest('.portal-content-studio__form') as HTMLElement
    expect(
      within(firstForm)
        .getByRole('button', { name: /LinkedIn/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(within(firstForm).getByRole('button', { name: '清空' }))
    expect(window.localStorage.getItem('ivybm:content-studio:selected-platforms')).toBe('[]')
    first.unmount()

    renderStudio()
    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const secondForm = screen
      .getByRole('heading', { name: /AI生成/ })
      .closest('.portal-content-studio__form') as HTMLElement
    fireEvent.change(within(secondForm).getByLabelText('生成需求'), {
      target: { value: 'This must not choose a platform implicitly.' },
    })
    expect(
      within(secondForm)
        .getByRole('button', { name: /LinkedIn/ })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      within(secondForm)
        .getByRole('button', { name: /AI生成/ })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('keeps direct uploads private and supports 1-3 publishable images', async () => {
    const originalFetch = globalThis.fetch
    let uploadedCount = 0
    globalThis.fetch = vi.fn((input, init) => {
      const url = String(input)
      if (url === '/api/portal/media' && init?.method === 'POST') {
        uploadedCount++
        expect((init.body as FormData).get('isPublic')).toBe('false')
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

    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    const file1 = new File(['pic1'], 'pic1.jpg', { type: 'image/jpeg' })
    const file2 = new File(['pic2'], 'pic2.jpg', { type: 'image/jpeg' })

    fireEvent.change(fileInput, { target: { files: [file1, file2] } })

    await vi.waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      const assetCheckboxes = checkboxes.filter((cb) =>
        cb.getAttribute('aria-label')?.startsWith('Uploaded image'),
      )
      expect(assetCheckboxes.length).toBe(2)
      expect(assetCheckboxes.every((cb) => cb.checked)).toBe(true)
    })

    expect(screen.getByText('当前平台发布链路每篇草稿支持 1-3 张配图。')).toBeTruthy()

    globalThis.fetch = originalFetch
  })

  it('blocks a fourth existing asset in the generator with the shared count message', () => {
    const summary: ContentStudioSummary = {
      items: [],
      options: {
        assets: [21, 22, 23, 24].map((id) => ({ id, label: `Existing image ${id}` })),
        knowledgeSources: [],
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
      publishingEnabled: false,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const first = screen.getByRole('checkbox', { name: 'Existing image 21' }) as HTMLInputElement
    const second = screen.getByRole('checkbox', { name: 'Existing image 22' }) as HTMLInputElement
    const third = screen.getByRole('checkbox', { name: 'Existing image 23' }) as HTMLInputElement
    const fourth = screen.getByRole('checkbox', { name: 'Existing image 24' }) as HTMLInputElement
    fireEvent.click(first)
    fireEvent.click(second)
    fireEvent.click(third)
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(fourth)
    expect(screen.getByRole('alert').textContent).toBe('每次请选择 1-3 张图片。')
    expect(fourth.checked).toBe(false)
    expect([first, second, third].every((input) => input.checked)).toBe(true)
  })

  it('blocks a fourth existing asset in the draft editor with the shared count message', () => {
    const summary: ContentStudioSummary = {
      items: [
        {
          assets: [],
          body: 'Draft ready for images',
          contentLocale: 'en',
          contentType: 'post',
          id: 101,
          knowledgeSources: [],
          platform: 'facebook',
          publishJobs: [],
          reviews: [],
          sourceReferences: [],
          status: 'draft',
          title: 'Fourth Image Draft',
          updatedAt: '2026-09-11T08:00:00.000Z',
        },
      ],
      options: {
        assets: [21, 22, 23, 24].map((id) => ({ id, label: `Draft image ${id}` })),
        knowledgeSources: [],
        platformAccounts: [],
      },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      publishingEnabled: false,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: /Fourth Image Draft/ }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const first = screen.getByRole('checkbox', { name: 'Draft image 21' }) as HTMLInputElement
    const second = screen.getByRole('checkbox', { name: 'Draft image 22' }) as HTMLInputElement
    const third = screen.getByRole('checkbox', { name: 'Draft image 23' }) as HTMLInputElement
    const fourth = screen.getByRole('checkbox', { name: 'Draft image 24' }) as HTMLInputElement
    fireEvent.click(first)
    fireEvent.click(second)
    fireEvent.click(third)
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(fourth)
    expect(screen.getByRole('alert').textContent).toBe('每次请选择 1-3 张图片。')
    expect(fourth.checked).toBe(false)
    expect([first, second, third].every((input) => input.checked)).toBe(true)
  })

  it('rejects a four-file upload without issuing media requests', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const summary: ContentStudioSummary = {
      items: [],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
      publishingEnabled: false,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ContentStudio, { pageState: 'available', summary }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: /AI生成/ }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const files = [1, 2, 3, 4].map(
      (index) => new File([`image-${index}`], `image-${index}.jpg`, { type: 'image/jpeg' }),
    )
    fireEvent.change(fileInput, { target: { files } })

    expect(screen.getByRole('alert').textContent).toBe('每次请选择 1-3 张图片。')
    expect(fetchMock).not.toHaveBeenCalled()
    globalThis.fetch = originalFetch
  })
})
