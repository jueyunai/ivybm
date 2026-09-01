import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
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
    expect(pageText).not.toMatch(
      /access token|refresh token|app secret|accessToken|refreshToken|authorization\.accessToken/i,
    )

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
