import React from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { PlatformReadinessPage } from '@/admin-portal/modules/platforms/PlatformReadinessPage'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('Portal platform readiness', () => {
  it('shows credential-free responsibility and next action for every readiness state', () => {
    const { container } = render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(PlatformReadinessPage, {
          pageState: 'available',
          summary: {
            accounts: [
              {
                accountKind: 'facebook-page',
                externalAccountId: 'page-123',
                id: 8,
                name: 'IVYBM Facebook',
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

    expect(screen.getByRole('heading', { name: '平台状态' })).toBeTruthy()
    const pageText = container.textContent ?? ''
    expect(pageText).toContain('可用')
    expect(pageText).toContain('责任人')
    expect(pageText).toContain('管理员')
    expect(pageText).toContain('开发团队')
    expect(pageText).toContain('请先通过受限维护流程补齐发布运行时配置，再进行受控测试。')
    expect(pageText).not.toMatch(
      /access token|refresh token|app secret|accessToken|refreshToken|authorization\.accessToken/i,
    )
  })
})
