import React from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalSidebar } from '@/admin-portal/core/navigation/PortalSidebar'
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
    expect(sales.modules.find((module) => module.id === 'overview')?.canNavigate).toBe(false)
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
    expect(screen.getByRole('link', { name: '基础设置' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.queryByRole('link', { name: '运营首页' })).toBeNull()
    expect(screen.getByText('运营首页').closest('[aria-disabled="true"]')).toBeTruthy()
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
})
