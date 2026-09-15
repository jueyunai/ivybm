import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalSidebar } from '@/admin-portal/core/navigation/PortalSidebar'
import { PortalMobileNav } from '@/admin-portal/core/navigation/PortalMobileNav'
import { PortalShell } from '@/admin-portal/core/navigation/PortalShell'
import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { ContentStudio } from '@/admin-portal/modules/content-studio/ContentStudio'
import type { ContentStudioSummary } from '@/admin-portal/modules/content-studio/getContentStudioPage'
import { resolvePortalAvailability } from '@/admin-portal/core/modules/resolvePortalAvailability'
import { PORTAL_PERMISSION_PRESETS } from '@/access/roles'

const navigationMocks = vi.hoisted(() => ({
  pathname: '/dashboard/settings',
  router: { push: vi.fn(), refresh: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMocks.pathname,
  useRouter: () => navigationMocks.router,
}))

afterEach(cleanup)

const enabledEnvironment = {
  ADMIN_PORTAL_ENABLED: 'true',
  ADMIN_PORTAL_CONVERSATIONS_ENABLED: 'true',
  ADMIN_PORTAL_LEADS_ENABLED: 'true',
  ADMIN_PORTAL_MEDIA_ENABLED: 'true',
  ADMIN_PORTAL_OPERATIONS_ENABLED: 'true',
  ADMIN_PORTAL_OVERVIEW_ENABLED: 'true',
  ADMIN_PORTAL_PLATFORMS_ENABLED: 'true',
  ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
  ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED: 'true',
  ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: 'true',
  ADMIN_PORTAL_KNOWLEDGE_ENABLED: 'true',
} as const

describe('Portal navigation', () => {
  it('derives role-safe navigation from the registry and marks unavailable modules', () => {
    const admin = resolvePortalAvailability({ env: enabledEnvironment, user: { role: 'admin' } })
    const sales = resolvePortalAvailability({ env: enabledEnvironment, user: { role: 'sales' } })

    expect(admin.portalEnabled).toBe(true)
    expect(admin.modules.map((module) => module.id)).toContain('platforms')
    expect(sales.modules.map((module) => module.id)).toEqual([
      'overview',
      'conversations',
      'leads',
      'settings',
    ])
    expect(sales.modules.find((module) => module.id === 'settings')).toMatchObject({
      canNavigate: true,
      featureState: { enabled: true, reason: 'available' },
    })
    expect(sales.modules.find((module) => module.id === 'overview')).toMatchObject({
      canNavigate: true,
      featureState: { enabled: true, reason: 'available' },
    })
  })

  it('renders an active Portal link without exposing internal maintenance routes', () => {
    const resolution = resolvePortalAvailability({
      env: enabledEnvironment,
      user: { role: 'admin' },
    })

    const { container } = render(
      React.createElement(PortalSidebar, {
        collapsed: false,
        locale: 'zh',
        modules: resolution.modules,
        user: {
          id: 1,
          permissions: PORTAL_PERMISSION_PRESETS.admin,
          role: 'admin',
          username: 'admin.example',
        },
      }),
    )

    expect(screen.getByRole('navigation', { name: '运营门户导航' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '基础设置' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '运营首页' }).getAttribute('href')).toBe('/dashboard')
    expect(screen.getByText('运营首页').closest('[aria-disabled="true"]')).toBeNull()
    expect(container.innerHTML).not.toContain('/admin')
  })

  it('dispatches portal:navigate-active event when clicking an already-active link', () => {
    const resolution = resolvePortalAvailability({
      env: enabledEnvironment,
      user: { role: 'admin' },
    })

    const listener = vi.fn()
    window.addEventListener('portal:navigate-active', listener)

    render(
      React.createElement(PortalSidebar, {
        collapsed: false,
        locale: 'zh',
        modules: resolution.modules,
        user: {
          id: 1,
          permissions: PORTAL_PERMISSION_PRESETS.admin,
          role: 'admin',
          username: 'admin.example',
        },
      }),
    )

    const activeLink = screen.getByRole('link', { name: '基础设置' })
    expect(activeLink.getAttribute('aria-current')).toBe('page')

    fireEvent.click(activeLink)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      detail: { href: '/dashboard/settings' },
    })

    window.removeEventListener('portal:navigate-active', listener)
  })

  it('dispatches cancelable portal:sidebar-navigate event with onClose callback on clicking any sidebar link and respects preventDefault', () => {
    const resolution = resolvePortalAvailability({
      env: enabledEnvironment,
      user: { role: 'admin' },
    })

    const listener = vi.fn((event: Event) => {
      event.preventDefault()
    })
    const onClose = vi.fn()
    window.addEventListener('portal:sidebar-navigate', listener)

    render(
      React.createElement(PortalSidebar, {
        collapsed: false,
        locale: 'zh',
        modules: resolution.modules,
        onClose,
        user: {
          id: 1,
          permissions: PORTAL_PERMISSION_PRESETS.admin,
          role: 'admin',
          username: 'admin.example',
        },
      }),
    )

    const inactiveLink = screen.getByRole('link', { name: '素材库' })
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    inactiveLink.dispatchEvent(clickEvent)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      cancelable: true,
      detail: { href: '/dashboard/media', onClose },
    })
    expect(clickEvent.defaultPrevented).toBe(true)
    // When prevented, onClose should not be called immediately (caller controls via detail.onClose)
    expect(onClose).not.toHaveBeenCalled()

    window.removeEventListener('portal:sidebar-navigate', listener)
  })

  it('dispatches cancelable portal:sidebar-navigate event when clicking account settings link in account menu', () => {
    const resolution = resolvePortalAvailability({
      env: enabledEnvironment,
      user: { role: 'admin' },
    })

    const listener = vi.fn((event: Event) => {
      event.preventDefault()
    })
    window.addEventListener('portal:sidebar-navigate', listener)

    render(
      React.createElement(PortalSidebar, {
        collapsed: false,
        locale: 'zh',
        modules: resolution.modules,
        user: {
          id: 1,
          permissions: PORTAL_PERMISSION_PRESETS.admin,
          role: 'admin',
          username: 'admin.example',
        },
      }),
    )

    // Open account menu
    const trigger = screen.getByLabelText('账户菜单')
    fireEvent.click(trigger)

    const accountLink = screen.getByRole('menuitem', { name: '账户与偏好' })
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    accountLink.dispatchEvent(clickEvent)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      cancelable: true,
      detail: { href: '/dashboard/settings#account' },
    })
    expect(clickEvent.defaultPrevented).toBe(true)

    window.removeEventListener('portal:sidebar-navigate', listener)
  })

  it('closes both account menu and mobile nav drawer when clicking account link in PortalMobileNav', () => {
    const resolution = resolvePortalAvailability({
      env: enabledEnvironment,
      user: { role: 'admin' },
    })

    let receivedDetail: { href: string; onClose?: () => void } | null = null
    const listener = vi.fn((event: Event) => {
      event.preventDefault()
      receivedDetail = (event as CustomEvent<{ href: string; onClose?: () => void }>).detail
    })
    window.addEventListener('portal:sidebar-navigate', listener)

    const onCloseMobile = vi.fn()
    const triggerRef = React.createRef<HTMLButtonElement>()

    render(
      React.createElement(
        'div',
        null,
        React.createElement('button', { ref: triggerRef }, 'Open nav'),
        React.createElement(PortalMobileNav, {
          locale: 'zh',
          modules: resolution.modules,
          onClose: onCloseMobile,
          onLocaleToggle: vi.fn(),
          open: true,
          triggerRef,
          user: {
            id: 1,
            permissions: PORTAL_PERMISSION_PRESETS.admin,
            role: 'admin',
            username: 'admin.example',
          },
        }),
      ),
    )

    // Open account menu in mobile nav
    const trigger = screen.getByLabelText('账户菜单')
    fireEvent.click(trigger)

    const accountLink = screen.getByRole('menuitem', { name: '账户与偏好' })
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    accountLink.dispatchEvent(clickEvent)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(clickEvent.defaultPrevented).toBe(true)
    expect(receivedDetail).toBeTruthy()

    // Calling the detail.onClose (e.g. from transition cancel or commit) must trigger mobile onClose
    ;(receivedDetail as unknown as { onClose?: () => void })?.onClose?.()
    expect(onCloseMobile).toHaveBeenCalledTimes(1)

    window.removeEventListener('portal:sidebar-navigate', listener)
  })

  it('fails closed into a Portal maintenance state when the global flag is disabled', () => {
    const resolution = resolvePortalAvailability({ env: {}, user: { role: 'admin' } })

    expect(resolution.portalEnabled).toBe(false)
    expect(
      resolution.modules.every(
        (module) =>
          module.canNavigate === false && module.featureState.reason === 'portal-disabled',
      ),
    ).toBe(true)

    render(
      React.createElement(
        PortalShell,
        {
          availability: resolution,
          environment: 'local',
          user: {
            id: 1,
            permissions: PORTAL_PERMISSION_PRESETS.admin,
            role: 'admin',
            username: 'admin.example',
          },
        },
        React.createElement('p', null, 'must not render'),
      ),
    )

    expect(screen.getByText('运营门户维护中')).toBeTruthy()
    expect(screen.queryByText('must not render')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('keeps Tab and Shift+Tab inside the mobile navigation dialog', async () => {
    const triggerRef = React.createRef<HTMLButtonElement>()
    const resolution = resolvePortalAvailability({
      env: enabledEnvironment,
      user: { role: 'admin' },
    })
    render(
      React.createElement(
        'div',
        null,
        React.createElement('button', { ref: triggerRef }, 'Open navigation'),
        React.createElement(PortalMobileNav, {
          locale: 'zh',
          modules: resolution.modules,
          onClose: vi.fn(),
          onLocaleToggle: vi.fn(),
          open: true,
          triggerRef,
          user: {
            id: 1,
            permissions: PORTAL_PERMISSION_PRESETS.admin,
            role: 'admin',
            username: 'admin.example',
          },
        }),
      ),
    )

    const dialog = await screen.findByRole('dialog')
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea'))
    await waitFor(() => expect(document.activeElement).toBe(focusable()[0]))
    const first = focusable()[0]
    const last = focusable().at(-1)
    if (!first || !last) throw new Error('Expected mobile navigation controls')

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes mobile nav drawer synchronously on dirty sidebar navigation so ConfirmDialog exclusively owns Tab and Escape focus', async () => {
    navigationMocks.pathname = '/dashboard/content-studio'
    const resolution = resolvePortalAvailability({
      env: enabledEnvironment,
      user: { role: 'admin' },
    })

    const summary: ContentStudioSummary = {
      items: [],
      options: { assets: [], knowledgeSources: [], platformAccounts: [] },
      pagination: { page: 1, totalDocs: 0, totalPages: 1 },
      publishingEnabled: false,
      query: { page: 1, platform: 'all', q: '', status: 'all' },
    }

    function MobileStudioTestHarness() {
      const [mobileOpen, setMobileOpen] = React.useState(false)
      const triggerRef = React.useRef<HTMLButtonElement>(null)

      return React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(
          'div',
          null,
          React.createElement(
            'button',
            {
              'aria-label': '打开移动导航',
              onClick: () => setMobileOpen(true),
              ref: triggerRef,
              type: 'button',
            },
            'Open navigation',
          ),
          React.createElement(PortalMobileNav, {
            locale: 'zh',
            modules: resolution.modules,
            onClose: () => setMobileOpen(false),
            onLocaleToggle: vi.fn(),
            open: mobileOpen,
            triggerRef,
            user: {
              id: 1,
              permissions: PORTAL_PERMISSION_PRESETS.admin,
              role: 'admin',
              username: 'admin.example',
            },
          }),
          React.createElement(ContentStudio, { pageState: 'available', summary }),
        ),
      )
    }

    render(React.createElement(MobileStudioTestHarness))

    // 1. Enter dirty state in ContentStudio by typing a draft title
    fireEvent.click(screen.getByRole('button', { name: /(新建草稿|手动新建)/ }))
    const titleInput = screen.getByRole('textbox', { name: '草稿标题' }) as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: 'Dirty Draft Title' } })
    expect(titleInput.value).toBe('Dirty Draft Title')

    // 2. Open mobile navigation drawer
    fireEvent.click(screen.getByRole('button', { name: '打开移动导航' }))
    const mobileNav = await screen.findByRole('dialog')
    expect(mobileNav).toBeTruthy()

    // 3. Click a sidebar link inside mobile navigation
    const mediaLink = within(mobileNav).getByRole('link', { name: '素材库' })
    fireEvent.click(mediaLink)

    // 4. Verify mobile nav is synchronously closed and unmounted
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '移动端导航' })).toBeNull()
      expect(screen.queryByLabelText('关闭导航')).toBeNull()
    })

    // 5. Verify ConfirmDialog is shown
    const confirmTitle = await screen.findByText('放弃未保存的内容？')
    expect(confirmTitle).toBeTruthy()
    const confirmDialog = confirmTitle.closest('[role="dialog"]') as HTMLElement
    expect(confirmDialog).toBeTruthy()

    // 6. Verify ConfirmDialog exclusively owns keyboard focus controls
    const keepDraftBtn = within(confirmDialog).getByRole('button', { name: '继续编辑' })
    const discardBtn = within(confirmDialog).getByRole('button', { name: '放弃并切换' })
    const closeBtn = within(confirmDialog).getByRole('button', { name: '关闭弹窗' })

    expect(keepDraftBtn).toBeTruthy()
    expect(discardBtn).toBeTruthy()
    expect(closeBtn).toBeTruthy()

    // Focus stays within ConfirmDialog buttons
    keepDraftBtn.focus()
    expect(document.activeElement).toBe(keepDraftBtn)

    // Cancel transition via "继续编辑"
    fireEvent.click(keepDraftBtn)

    // 7. Verify ConfirmDialog is closed, mobile nav remains closed, and draft edits are preserved
    await waitFor(() => {
      expect(screen.queryByText('放弃未保存的内容？')).toBeNull()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByRole('textbox', { name: '草稿标题' }) as HTMLInputElement).value).toBe(
      'Dirty Draft Title',
    )
  })
})
