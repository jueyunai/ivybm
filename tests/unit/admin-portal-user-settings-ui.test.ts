import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { resolvePortalAvailability } from '@/admin-portal/core/modules/resolvePortalAvailability'
import { SettingsHub } from '@/admin-portal/modules/settings/SettingsHub'
import { ChangePasswordPanel } from '@/admin-portal/modules/settings/ChangePasswordPanel'
import { TeamMembersPanel } from '@/admin-portal/modules/settings/TeamMembersPanel'
import { portalAiSettingsAdminOnly } from '@/admin-portal/modules/settings/getPortalAiSettings'
import type { PortalTeamMemberDTO } from '@/admin-portal/modules/settings/userSettingsContracts'

const mockMembers: PortalTeamMemberDTO[] = [
  {
    createdAt: '2026-08-01T00:00:00.000Z',
    email: 'admin@example.com',
    id: 1,
    lockedUntil: null,
    role: 'admin',
    status: 'normal',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    createdAt: '2026-08-02T00:00:00.000Z',
    email: 'operator@example.com',
    id: 2,
    lockedUntil: null,
    role: 'operator',
    status: 'normal',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    createdAt: '2026-08-03T00:00:00.000Z',
    email: 'sales@example.com',
    id: 3,
    lockedUntil: '2026-08-25T12:00:00.000Z',
    role: 'sales',
    status: 'security_locked',
    updatedAt: '2026-08-03T00:00:00.000Z',
  },
]

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})
afterEach(cleanup)

describe('Portal ChangePasswordPanel UI', () => {
  it('opens password change form and validates password length and confirmation match', async () => {
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ChangePasswordPanel, null),
      ),
    )

    const trigger = screen.getByRole('button', { name: /修改密码/ })
    expect(trigger).toBeTruthy()
    fireEvent.click(trigger)

    expect(screen.getByRole('heading', { name: '修改登录密码' })).toBeTruthy()

    const currentPass = screen.getByLabelText('当前密码')
    const newPass = screen.getByLabelText('新密码')
    const confirmPass = screen.getByLabelText('确认新密码')
    const submitBtn = screen.getByRole('button', { name: '确认修改密码' })

    // Too short password
    fireEvent.change(currentPass, { target: { value: 'OldPassword123!' } })
    fireEvent.change(newPass, { target: { value: 'short' } })
    fireEvent.change(confirmPass, { target: { value: 'short' } })
    fireEvent.click(submitBtn)

    expect(screen.getByText(/密码长度需为 12 至 128 个字符/)).toBeTruthy()

    // Password mismatch
    fireEvent.change(newPass, { target: { value: 'NewPassword123!' } })
    fireEvent.change(confirmPass, { target: { value: 'DifferentPass123!' } })
    fireEvent.click(submitBtn)

    expect(screen.getByText(/两次输入的密码不一致/)).toBeTruthy()
  })

  it('submits valid password change and shows success status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
      ok: true,
    })
    globalThis.fetch = fetchMock

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(ChangePasswordPanel, null),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: /修改密码/ }))

    fireEvent.change(screen.getByLabelText('当前密码'), {
      target: { value: 'OldPassword123!' },
    })
    fireEvent.change(screen.getByLabelText('新密码'), {
      target: { value: 'ValidNewPassword123!' },
    })
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'ValidNewPassword123!' },
    })

    fireEvent.click(screen.getByRole('button', { name: '确认修改密码' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/portal/settings/change-password',
        expect.objectContaining({
          credentials: 'same-origin',
          method: 'POST',
        }),
      )
      expect(screen.getByText(/密码修改成功，正在跳转登录页/)).toBeTruthy()
    })
  })
})

describe('Portal TeamMembersPanel UI', () => {
  it('renders team member rows with role and status information', () => {
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(TeamMembersPanel, {
          currentUserId: 1,
          initialMembers: mockMembers,
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: '团队成员管理' })).toBeTruthy()
    expect(screen.getByText('admin@example.com')).toBeTruthy()
    expect(screen.getByText('(本人)')).toBeTruthy()
    expect(screen.getByText('operator@example.com')).toBeTruthy()
    expect(screen.getByText('sales@example.com')).toBeTruthy()
    expect(screen.getByText('登录失败临时锁定')).toBeTruthy()
  })

  it('opens and cancels the Add Member modal', () => {
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(TeamMembersPanel, {
          currentUserId: 1,
          initialMembers: mockMembers,
        }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: /新增成员/ }))
    expect(screen.getByRole('heading', { name: '新增团队成员' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '新增团队成员' })).toBeNull()
  })

  it('requires typing matching confirmation email before deleting member', async () => {
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(TeamMembersPanel, {
          currentUserId: 1,
          initialMembers: mockMembers,
        }),
      ),
    )

    const deleteButtons = screen.getAllByRole('button', { name: /删除/ })
    fireEvent.click(deleteButtons[0]) // delete operator@example.com

    expect(screen.getByRole('heading', { name: '删除成员' })).toBeTruthy()
    const confirmDeleteBtn = screen.getByRole('button', { name: '确认删除' })
    expect((confirmDeleteBtn as HTMLButtonElement).disabled).toBe(true)

    // Type non-matching email
    const emailInput = screen.getByLabelText('登录邮箱')
    fireEvent.change(emailInput, { target: { value: 'wrong@example.com' } })
    expect((confirmDeleteBtn as HTMLButtonElement).disabled).toBe(true)

    // Type exact matching email
    fireEvent.change(emailInput, { target: { value: 'operator@example.com' } })
    expect((confirmDeleteBtn as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Portal SettingsHub role visibility for team management', () => {
  it('does not render TeamMembersPanel for sales and operator roles', () => {
    const modules = resolvePortalAvailability({
      env: {
        ADMIN_PORTAL_ENABLED: 'true',
        ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
        ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED: 'true',
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
            siteDescription: null,
            siteName: 'IVYBM',
          },
          teamManagementEnabled: true,
          teamMembers: mockMembers,
          user: { email: 'sales@example.com', id: 3, role: 'sales' },
        }),
      ),
    )

    expect(screen.queryByRole('heading', { name: '团队成员管理' })).toBeNull()
    expect(screen.getByRole('button', { name: /修改密码/ })).toBeTruthy()
  })

  it('renders TeamMembersPanel for admin role when teamManagementEnabled is true', () => {
    const modules = resolvePortalAvailability({
      env: {
        ADMIN_PORTAL_ENABLED: 'true',
        ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
        ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED: 'true',
      },
      role: 'admin',
    }).modules

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(SettingsHub, {
          aiSettings: portalAiSettingsAdminOnly(),
          modules,
          summary: {
            canUpdate: true,
            siteDescription: null,
            siteName: 'IVYBM',
          },
          teamManagementEnabled: true,
          teamMembers: mockMembers,
          user: { email: 'admin@example.com', id: 1, role: 'admin' },
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: '团队成员管理' })).toBeTruthy()
    expect(screen.getByText('operator@example.com')).toBeTruthy()
  })
})
