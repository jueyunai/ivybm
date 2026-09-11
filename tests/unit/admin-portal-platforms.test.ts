import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import {
  loadPlatformAccountsPageData,
  loadPlatformReadinessPageData,
} from '@/admin-portal/modules/platforms/getPlatformReadiness'
import { PlatformReadinessPage } from '@/admin-portal/modules/platforms/PlatformReadinessPage'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('Portal platform readiness', () => {
  it('keeps platform data unavailable to non-admin roles even with elevated permissions', async () => {
    const find = vi.fn()
    const payload = { find } as never
    const env = {
      ADMIN_PORTAL_ENABLED: 'true',
      ADMIN_PORTAL_PLATFORMS_ENABLED: 'true',
    } as never

    await expect(
      loadPlatformAccountsPageData({ env, payload, user: { role: 'operator' } }),
    ).resolves.toEqual({ accounts: [], state: 'forbidden' })
    await expect(
      loadPlatformReadinessPageData({ env, payload, user: { role: 'operator' } }),
    ).resolves.toEqual({ state: 'forbidden', summary: null })
    expect(find).not.toHaveBeenCalled()
  })

  it('shows credential-free capability-specific instructions before controlled testing', () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 8, aiAutoReplyEnabled: true } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { container } = render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(PlatformReadinessPage, {
          accounts: [],
          pageState: 'available',
          summary: {
            accounts: [
              {
                aiAutoReplyEnabled: false,
                accountKind: 'facebook-page',
                authorization: {
                  accessTokenConfigured: true,
                  refreshTokenConfigured: false,
                  state: 'connected',
                },
                authorizationRevision: 0,
                capabilities: { messagingInbound: 'approved', publishing: 'pending' },
                externalAccountId: 'page-123',
                id: 8,
                name: 'IVYBM Facebook',
                notes: null,
                readiness: {
                  capabilities: [
                    {
                      capability: 'messaging-inbound',
                      implementation: 'implemented',
                      missing: [],
                      productionRequirements: [],
                      status: 'ready-for-controlled-test',
                    },
                    {
                      capability: 'publishing',
                      implementation: 'implemented',
                      missing: [],
                      productionRequirements: [],
                      status: 'ready-for-controlled-test',
                    },
                  ],
                  connection: { missing: [], status: 'ready-for-controlled-test' },
                  family: 'meta',
                },
              },
            ],
          },
        }),
      ),
    )

    expect(screen.getByRole('heading', { name: '平台账号' })).toBeTruthy()
    const pageText = container.textContent ?? ''
    expect(pageText).toContain('已授权（待测试）')
    expect(pageText).toContain('责任人')
    expect(pageText).toContain('管理员')
    expect(pageText).toContain('请在 AI 内容工作台发布一条测试贴文，以验证该账号连接。')
    expect(pageText).toContain('请向已连接账号发送一条测试消息，以验证入站消息能力。')
    expect(pageText).toContain('连接')
    expect(pageText).toContain('管理账号')
    expect(screen.queryByRole('button', { name: '断开授权' })).toBeNull()
    expect(pageText).not.toMatch(
      /access token|refresh token|app secret|accessToken|refreshToken|authorization\.accessToken/i,
    )

    fireEvent.click(screen.getByRole('button', { name: '管理账号' }))
    expect(screen.getByRole('button', { name: '断开授权' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('显示名称'), {
      target: { value: 'Unsaved account name' },
    })
    fireEvent.click(screen.getByRole('button', { name: '断开授权' }))
    expect(screen.getByRole('alertdialog', { name: '确认断开' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: '编辑账号: IVYBM Facebook' })).toBeTruthy()
    expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe(
      'Unsaved account name',
    )
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    const toggle = screen.getByRole('switch', { name: '恢复 AI 回复' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('alertdialog', { name: '恢复 AI 自动回复？' })).toBeTruthy()
    expect(screen.getByRole('alertdialog').textContent).toContain('恢复')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '恢复 AI 回复' }))
    return waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith('/api/platforms/accounts/8', {
        body: JSON.stringify({ authorizationRevision: 0, aiAutoReplyEnabled: true }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      })
      expect(screen.getByRole('status').textContent).toContain('AI 自动回复设置已更新')
    })
  })

  it('keeps edit failures visible inside the open account dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'stale_revision' } }), {
          headers: { 'content-type': 'application/json' },
          status: 409,
        }),
      ),
    )
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(PlatformReadinessPage, {
          accounts: [],
          pageState: 'available',
          summary: {
            accounts: [
              {
                aiAutoReplyEnabled: false,
                accountKind: 'facebook-page',
                authorization: {
                  accessTokenConfigured: true,
                  refreshTokenConfigured: false,
                  state: 'connected',
                },
                authorizationRevision: 2,
                capabilities: { messagingInbound: 'approved', publishing: 'pending' },
                externalAccountId: 'page-123',
                id: 8,
                name: 'IVYBM Facebook',
                notes: null,
                readiness: {
                  capabilities: [
                    {
                      capability: 'messaging-inbound',
                      implementation: 'implemented',
                      missing: [],
                      productionRequirements: [],
                      status: 'ready-for-controlled-test',
                    },
                  ],
                  connection: { missing: [], status: 'ready-for-controlled-test' },
                  family: 'meta',
                },
              },
            ],
          },
        }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: '管理账号' }))
    fireEvent.change(screen.getByLabelText('显示名称'), {
      target: { value: 'Updated account name' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: '编辑账号: IVYBM Facebook' })
      const alert = screen.getByRole('alert')
      expect(dialog.contains(alert)).toBe(true)
      expect(alert.textContent).toContain('该账号已在其他会话中更新')
      expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe(
        'Updated account name',
      )
    })
  })

  it('shows the specific API error when an auto-reply update is malformed', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'invalid_ai_auto_reply_enabled' } }), {
        headers: { 'content-type': 'application/json' },
        status: 400,
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(PlatformReadinessPage, {
          accounts: [],
          pageState: 'available',
          summary: {
            accounts: [
              {
                aiAutoReplyEnabled: false,
                accountKind: 'facebook-page',
                authorization: {
                  accessTokenConfigured: true,
                  refreshTokenConfigured: false,
                  state: 'connected',
                },
                authorizationRevision: 0,
                capabilities: { messagingInbound: 'approved', publishing: 'pending' },
                externalAccountId: 'page-123',
                id: 8,
                name: 'IVYBM Facebook',
                notes: null,
                readiness: {
                  capabilities: [
                    {
                      capability: 'messaging-inbound',
                      implementation: 'implemented',
                      missing: [],
                      productionRequirements: [],
                      status: 'ready-for-controlled-test',
                    },
                  ],
                  connection: { missing: [], status: 'ready-for-controlled-test' },
                  family: 'meta',
                },
              },
            ],
          },
        }),
      ),
    )

    fireEvent.click(screen.getByRole('switch', { name: '恢复 AI 回复' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复 AI 回复' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('请选择开启或暂停 AI 自动回复')
    })
  })

  it('does not offer OAuth actions for a historical unsupported account kind', () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 9 } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(PlatformReadinessPage, {
          accounts: [],
          pageState: 'available',
          summary: {
            accounts: [
              {
                aiAutoReplyEnabled: false,
                accountKind: 'tiktok-business' as never,
                authorization: {
                  accessTokenConfigured: true,
                  refreshTokenConfigured: false,
                  state: 'connected',
                },
                authorizationRevision: 1,
                capabilities: { messagingInbound: 'not_started', publishing: 'not_started' },
                externalAccountId: 'historical-account',
                id: 9,
                name: 'Historical TikTok',
                notes: null,
                readiness: {
                  capabilities: [],
                  connection: { missing: ['authorization'], status: 'action-required' },
                  family: 'tiktok',
                },
              },
            ],
          },
        }),
      ),
    )

    expect(screen.queryByRole('link', { name: '连接' })).toBeNull()
    expect(screen.queryByRole('link', { name: '重新授权' })).toBeNull()
    expect(screen.queryByRole('button', { name: '断开授权' })).toBeNull()
    expect(screen.getAllByText('不适用')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '管理账号' }))
    expect(screen.getByRole('heading', { name: '编辑账号: Historical TikTok' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy()

    expect(screen.queryByLabelText('外部账号 ID')).toBeNull()
    fireEvent.change(screen.getByLabelText('显示名称'), {
      target: { value: 'Renamed Historical TikTok' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    return waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith('/api/platforms/accounts/9', {
        body: JSON.stringify({
          authorizationRevision: 1,
          name: 'Renamed Historical TikTok',
          notes: null,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }),
    )
  })
})
