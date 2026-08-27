import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

    const trigger = screen.getByRole('button', { name: /新增成员/ })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('heading', { name: '新增团队成员' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '新增团队成员' })).toBeNull()
  })

  it('exposes dialog semantics, closes with Escape, and keeps API errors visible inside the dialog', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          error: {
            code: 'email-already-exists',
            message: 'A user with this email address already exists.',
          },
        }),
      ok: false,
    })
    globalThis.fetch = fetchMock

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

    const trigger = screen.getByRole('button', { name: /新增成员/ })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '新增团队成员' })).toBeTruthy()
    const dialog = screen.getByRole('dialog', { name: '新增团队成员' })
    expect(document.activeElement).toBe(screen.getByLabelText('登录邮箱'))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '新增团队成员' })).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /新增成员/ }))
    })

    fireEvent.click(screen.getByRole('button', { name: /新增成员/ }))
    fireEvent.change(screen.getByLabelText('登录邮箱'), {
      target: { value: 'duplicate@example.com' },
    })
    fireEvent.change(screen.getByLabelText('初始密码'), {
      target: { value: 'InitialPassword123!' },
    })
    fireEvent.change(screen.getByLabelText('确认初始密码'), {
      target: { value: 'InitialPassword123!' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: '新增团队成员' })
      expect(dialog.textContent).toContain('该邮箱已被使用，请更换邮箱后重试。')
      expect(dialog.textContent).not.toContain('A user with this email address already exists.')
    })
  })

  it('keeps the idempotency key and refreshes without replaying after an unknown response', async () => {
    const createdMember: PortalTeamMemberDTO = {
      createdAt: '2026-08-26T00:00:00.000Z',
      email: 'unknown-result@example.com',
      id: 4,
      lockedUntil: null,
      role: 'sales',
      status: 'normal',
      updatedAt: '2026-08-26T00:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: () => Promise.reject(new SyntaxError('HTML response')),
        ok: true,
      })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ members: mockMembers }), ok: true })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ member: createdMember }), ok: true })
    globalThis.fetch = fetchMock

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

    const submitSameMember = () => {
      fireEvent.click(screen.getByRole('button', { name: /新增成员/ }))
      fireEvent.change(screen.getByLabelText('登录邮箱'), {
        target: { value: createdMember.email },
      })
      fireEvent.change(screen.getByLabelText('初始密码'), {
        target: { value: 'InitialPassword123!' },
      })
      fireEvent.change(screen.getByLabelText('确认初始密码'), {
        target: { value: 'InitialPassword123!' },
      })
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    }

    submitSameMember()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/portal/settings/users')
      expect(screen.queryByRole('dialog', { name: '新增团队成员' })).toBeNull()
      expect(screen.getByText(/操作结果未知，列表已刷新/)).toBeTruthy()
    })

    const firstKey = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    submitSameMember()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(screen.getByText(createdMember.email)).toBeTruthy()
    })
    const retriedKey = (fetchMock.mock.calls[2]?.[1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(retriedKey['Idempotency-Key']).toBe(firstKey['Idempotency-Key'])
  })

  it('localizes assignment errors and displays only safe positive reference counts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          error: {
            code: 'user-has-assignments',
            details: {
              leads: 2,
              feishuMemberMappings: 1,
              publishJobs: 0,
              unsafeServerValue: '<script>alert(1)</script>',
            },
            message: 'Cannot delete a user with retained business history.',
          },
        }),
      ok: false,
    })
    globalThis.fetch = fetchMock

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

    const operatorRow = screen.getByText('operator@example.com').closest('article')
    fireEvent.click(within(operatorRow as HTMLElement).getByRole('button', { name: '删除成员' }))
    fireEvent.change(screen.getByLabelText('登录邮箱'), {
      target: { value: 'operator@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: '删除成员' })
      expect(dialog.textContent).toContain('该成员仍有关联业务或历史记录')
      expect(dialog.textContent).toContain('线索: 2')
      expect(dialog.textContent).toContain('飞书成员映射: 1')
      expect(dialog.textContent).not.toContain('Cannot delete a user')
      expect(dialog.textContent).not.toContain('unsafeServerValue')
      expect(dialog.textContent).not.toContain('<script>')
      expect(dialog.textContent).not.toContain('发布历史: 0')
    })
  })

  it('refreshes after stale errors and requires a fresh confirmation instead of replaying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: { code: 'stale-user-version', message: 'stale user' },
          }),
        ok: false,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ members: mockMembers }),
        ok: true,
      })
    globalThis.fetch = fetchMock

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

    const operatorRow = screen.getByText('operator@example.com').closest('article')
    fireEvent.click(within(operatorRow as HTMLElement).getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/portal/settings/users')
      expect(screen.queryByRole('dialog', { name: '编辑成员信息' })).toBeNull()
      expect(
        screen.getByText('该成员已被其他管理员修改，列表已刷新，请重新确认后操作。'),
      ).toBeTruthy()
    })
  })

  it('shows an explicit read error and recovers only after a successful reload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ members: mockMembers }),
      ok: true,
    })
    globalThis.fetch = fetchMock

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(TeamMembersPanel, {
          currentUserId: 1,
          initialMembers: [],
          initialReadError: true,
        }),
      ),
    )

    expect(screen.getByRole('alert').textContent).toContain('成员列表加载失败')
    expect((screen.getByRole('button', { name: '新增成员' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: '重新加载成员列表' }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByText('operator@example.com')).toBeTruthy()
    })
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

  it('removes a member from the list after the delete command succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ deletedId: 2, success: true }),
      ok: true,
    })
    globalThis.fetch = fetchMock

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

    const operatorRow = screen.getByText('operator@example.com').closest('article')
    expect(operatorRow).toBeTruthy()
    fireEvent.click(within(operatorRow as HTMLElement).getByRole('button', { name: '删除成员' }))
    fireEvent.change(screen.getByLabelText('登录邮箱'), {
      target: { value: 'operator@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(screen.queryByText('operator@example.com')).toBeNull()
      expect(screen.getByText('成员已成功删除。')).toBeTruthy()
    })
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
