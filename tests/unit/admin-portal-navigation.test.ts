import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalSidebar } from '@/admin-portal/core/navigation/PortalSidebar'
import { PortalMobileNav } from '@/admin-portal/core/navigation/PortalMobileNav'
import { PortalShell } from '@/admin-portal/core/navigation/PortalShell'
import { resolvePortalAvailability } from '@/admin-portal/core/modules/resolvePortalAvailability'

const navigationMocks = vi.hoisted(() => ({ pathname: '/dashboard/settings' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMocks.pathname,
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
    const admin = resolvePortalAvailability({ env: enabledEnvironment, role: 'admin' })
    const sales = resolvePortalAvailability({ env: enabledEnvironment, role: 'sales' })

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
    const resolution = resolvePortalAvailability({ env: enabledEnvironment, role: 'admin' })

    const { container } = render(
      React.createElement(PortalSidebar, {
        collapsed: false,
        locale: 'zh',
        modules: resolution.modules,
        user: { email: 'admin@example.com', id: 1, role: 'admin' },
      }),
    )

    expect(screen.getByRole('navigation', { name: '运营门户导航' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '基础设置' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '运营首页' }).getAttribute('href')).toBe('/dashboard')
    expect(screen.getByText('运营首页').closest('[aria-disabled="true"]')).toBeNull()
    expect(container.innerHTML).not.toContain('/admin')
  })

  it('fails closed into a Portal maintenance state when the global flag is disabled', () => {
    const resolution = resolvePortalAvailability({ env: {}, role: 'admin' })

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
          user: { email: 'admin@example.com', id: 1, role: 'admin' },
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
    const resolution = resolvePortalAvailability({ env: enabledEnvironment, role: 'admin' })
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
          user: { email: 'admin@example.com', id: 1, role: 'admin' },
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
})
