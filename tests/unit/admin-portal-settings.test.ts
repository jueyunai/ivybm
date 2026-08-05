import React from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Payload } from 'payload'
import type { PayloadRequest } from 'payload'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { resolvePortalAvailability } from '@/admin-portal/core/modules/resolvePortalAvailability'
import { SettingsHub } from '@/admin-portal/modules/settings/SettingsHub'
import {
  getPortalSettingsSummary,
  selectPortalSettingsSummary,
} from '@/admin-portal/modules/settings/getPortalSettingsSummary'
import { portalAiSettingsAdminOnly } from '@/admin-portal/modules/settings/getPortalAiSettings'

const readyAiSettings = {
  access: 'admin' as const,
  encryptionKeyConfigured: true,
  profiles: [
    {
      capability: 'text' as const,
      enabled: true,
      id: 2,
      model: 'gpt-example',
      name: 'Primary text',
      parameters: {
        dimensions: null,
        maxOutputTokens: 2048,
        reasoningEffort: 'medium',
        reasoningEnabled: false,
        temperature: null,
        timeoutMs: 30000,
        topP: null,
      },
      providerID: 1,
      providerName: 'Primary provider',
      updatedAt: '2026-08-05T00:00:00.000Z',
    },
  ],
  providers: [
    {
      apiKeyConfigured: true,
      baseURL: 'https://api.example.invalid/v1',
      enabled: true,
      id: 1,
      name: 'Primary provider',
      protocol: 'openai-compatible' as const,
      updatedAt: '2026-08-05T00:00:00.000Z',
    },
  ],
  readiness: [
    { key: 'customer-chat' as const, reason: 'route' as const, status: 'action-required' as const },
    { key: 'content-studio' as const, reason: null, status: 'ready' as const },
    { key: 'knowledge-index' as const, reason: 'route' as const, status: 'action-required' as const },
  ],
  routes: [],
}

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('Portal settings hub', () => {
  it('does not expose account or setting data when the module is disabled', () => {
    const modules = resolvePortalAvailability({
      env: { ADMIN_PORTAL_ENABLED: 'true' },
      role: 'admin',
    }).modules

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(SettingsHub, {
          aiSettings: portalAiSettingsAdminOnly(),
          modules,
          pageState: 'module-disabled',
          summary: null,
          user: { email: 'admin@example.com', id: 1, role: 'admin' },
        }),
      ),
    )

    expect(screen.getAllByText('模块尚未启用')).toHaveLength(2)
    expect(screen.queryByText('admin@example.com')).toBeNull()
  })

  it('reduces Site Settings to a safe read-only summary', () => {
    const summary = selectPortalSettingsSummary(
      {
        contact: { email: 'private@example.com', phone: '+86 123' },
        defaultSeo: { title: 'Sensitive draft title' },
        siteDescription: 'Building materials export operations',
        siteName: 'IVYBM',
        socialLinks: [{ platform: 'facebook', url: 'https://example.com' }],
      },
      { email: 'sales@example.com', id: 8, role: 'sales' },
    )

    expect(summary).toEqual({
      canUpdate: false,
      siteDescription: 'Building materials export operations',
      siteName: 'IVYBM',
    })
    expect(JSON.stringify(summary)).not.toContain('private@example.com')
    expect(JSON.stringify(summary)).not.toContain('Sensitive draft title')
  })

  it('queries only the safe Site Settings fields without bypassing access', async () => {
    const findGlobal = vi.fn().mockResolvedValue({
      contact: { email: 'private@example.com' },
      siteDescription: 'Building materials export operations',
      siteName: 'IVYBM',
    })

    const summary = await getPortalSettingsSummary({
      payload: { findGlobal } as unknown as Payload,
      req: { user: { collection: 'users', id: 5 } } as unknown as PayloadRequest,
      user: { email: 'operator@example.com', id: 5, role: 'operator' },
    })

    expect(findGlobal).toHaveBeenCalledWith({
      depth: 0,
      overrideAccess: false,
      req: expect.objectContaining({ user: expect.objectContaining({ id: 5 }) }),
      select: { siteDescription: true, siteName: true },
      slug: 'site-settings',
    })
    expect(summary).toEqual({
      canUpdate: true,
      siteDescription: 'Building materials export operations',
      siteName: 'IVYBM',
    })
    expect(JSON.stringify(summary)).not.toContain('private@example.com')
  })

  it('provides working language, theme, and reduced-motion preferences', () => {
    const modules = resolvePortalAvailability({
      env: {
        ADMIN_PORTAL_ENABLED: 'true',
        ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
      },
      role: 'sales',
    }).modules

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(SettingsHub, {
          aiSettings: portalAiSettingsAdminOnly(),
          modules,
          summary: {
            canUpdate: false,
            siteDescription: 'Building materials export operations',
            siteName: 'IVYBM',
          },
          user: { email: 'sales@example.com', id: 8, role: 'sales' },
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: '基础设置' })).toBeTruthy()
    expect(screen.getByText('sales@example.com')).toBeTruthy()
    expect(screen.getByText('只读摘要')).toBeTruthy()
    expect(screen.getByText('邮箱')).toBeTruthy()
    expect(screen.getByText('角色')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('SYSTEM / SETTINGS')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Reduce motion' }))
    expect((screen.getByRole('checkbox', { name: 'Reduce motion' }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(window.localStorage.getItem('ivybm.portal.preferences')).toContain('"reducedMotion":true')
  })

  it('exposes the safe AI control plane to admins without exposing a stored key', () => {
    const modules = resolvePortalAvailability({
      env: {
        ADMIN_PORTAL_ENABLED: 'true',
        ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
      },
      role: 'admin',
    }).modules
    const { container } = render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(SettingsHub, {
          aiSettings: readyAiSettings,
          modules,
          summary: { canUpdate: true, siteDescription: null, siteName: 'IVYBM' },
          user: { email: 'admin@example.com', id: 1, role: 'admin' },
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: 'AI 模型配置' })).toBeTruthy()
    expect(screen.getByText('Primary provider')).toBeTruthy()
    expect(screen.getByText('Key 已配置')).toBeTruthy()
    expect(container.textContent).not.toContain('stored-secret')
    expect(container.innerHTML).not.toContain('/admin')
  })

  it.each(['operator', 'sales'] as const)(
    'does not render AI configuration for the %s role even if an admin summary is passed',
    (role) => {
      const modules = resolvePortalAvailability({
        env: {
          ADMIN_PORTAL_ENABLED: 'true',
          ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
        },
        role,
      }).modules

      render(
        React.createElement(
          PortalPreferencesProvider,
          null,
          React.createElement(SettingsHub, {
            aiSettings: readyAiSettings,
            modules,
            summary: { canUpdate: false, siteDescription: null, siteName: 'IVYBM' },
            user: { email: `${role}@example.com`, id: 8, role },
          }),
        ),
      )

      expect(screen.queryByRole('heading', { name: 'AI 模型配置' })).toBeNull()
      expect(screen.queryByText('Primary provider')).toBeNull()
    },
  )

  it('keeps a stable admin-visible error state when the AI summary cannot be read', () => {
    const modules = resolvePortalAvailability({
      env: {
        ADMIN_PORTAL_ENABLED: 'true',
        ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
      },
      role: 'admin',
    }).modules

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(SettingsHub, {
          aiReadError: true,
          aiSettings: portalAiSettingsAdminOnly(),
          modules,
          summary: { canUpdate: true, siteDescription: null, siteName: 'IVYBM' },
          user: { email: 'admin@example.com', id: 1, role: 'admin' },
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: 'AI 模型配置' })).toBeTruthy()
    expect(screen.getAllByText('读取失败')).toHaveLength(2)
  })
})
