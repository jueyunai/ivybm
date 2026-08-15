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
  it('shows credential-free responsibility and next action for every readiness state', () => {
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
                      status: 'available',
                    },
                    {
                      capability: 'publishing',
                      implementation: 'implemented',
                      missing: ['publishing_disabled'],
                      productionRequirements: [],
                      status: 'action-required',
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
    expect(pageText).toContain('可用')
    expect(pageText).toContain('责任人')
    expect(pageText).toContain('管理员')
    expect(pageText).toContain('开发团队')
    expect(pageText).toContain('受控发布 kill switch 当前未启用。')
    expect(pageText).toContain('连接')
    expect(pageText).toContain('编辑')
    expect(pageText).toContain('删除')
    expect(pageText).not.toMatch(
      /access token|refresh token|app secret|accessToken|refreshToken|authorization\.accessToken/i,
    )
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
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
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
