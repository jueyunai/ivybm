import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlatformOperationsClient } from '@/admin/views/PlatformOperationsClient'
import type { PlatformSimulationResult } from '@/modules/platforms/simulationCatalog'

const readinessResponse = {
  accounts: [
    {
      accountKind: 'facebook-page',
      externalAccountId: 'demo-page-1',
      id: 1,
      name: 'Demo Facebook Page',
      readiness: {
        capabilities: [
          {
            capability: 'messaging-inbound',
            implementation: 'implemented',
            missing: ['authorization'],
            status: 'action-required',
          },
          {
            capability: 'publishing',
            implementation: 'blocked',
            missing: ['publishing_job_adapter'],
            status: 'blocked',
          },
        ],
        connection: { missing: ['authorization'], status: 'action-required' },
        family: 'meta',
      },
    },
  ],
}

const simulationResult: PlatformSimulationResult = {
  id: 'unknown-outcome-recovery',
  status: 'passed',
  steps: [
    {
      detail: { en: 'delivery_unknown', zh: 'delivery_unknown' },
      label: { en: 'Manual reconciliation selected', zh: '进入人工核对' },
      status: 'passed',
    },
  ],
  summary: {
    en: 'The recovery path stopped without a second send.',
    zh: '恢复路径未执行第二次发送。',
  },
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlatformOperationsClient', () => {
  it('loads readiness, runs a selected mock, and exposes blockers as clickable tabs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/platforms/readiness')) {
        return new Response(JSON.stringify(readinessResponse), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      if (url.endsWith('/api/platforms/simulations') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ scenarioId: 'unknown-outcome-recovery' })
        return new Response(JSON.stringify({ result: simulationResult }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(React.createElement(PlatformOperationsClient, { language: 'zh' }))

    expect(await screen.findByText('Demo Facebook Page')).not.toBeNull()
    expect(screen.getByRole('link', { name: /打开账号/ }).getAttribute('href')).toBe(
      '/admin/collections/platform-accounts/1',
    )

    const tiktokCard = screen.getByRole('heading', { name: 'TikTok' }).closest('article')
    const linkedInCard = screen.getByRole('heading', { name: 'LinkedIn' }).closest('article')
    expect(tiktokCard).not.toBeNull()
    expect(linkedInCard).not.toBeNull()
    expect(
      within(tiktokCard as HTMLElement).getByText('Webhook 验签').parentElement?.textContent,
    ).toBe('Webhook 验签可受控测试代码就绪')
    expect(
      within(linkedInCard as HTMLElement).getByText('辅助发布包').parentElement?.textContent,
    ).toBe('辅助发布包可受控测试代码就绪')

    const readinessTab = screen.getByRole('tab', { name: '状态矩阵' })
    const simulationTab = screen.getByRole('tab', { name: /Mock 演练/ })
    expect(readinessTab.getAttribute('aria-controls')).toBe('platform-ops-panel-readiness')
    expect(readinessTab.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(readinessTab, { key: 'ArrowRight' })
    expect(simulationTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(simulationTab)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      'platform-ops-tab-simulations',
    )
    const blockersTab = screen.getByRole('tab', { name: '阻塞项' })
    fireEvent.keyDown(simulationTab, { key: 'End' })
    expect(document.activeElement).toBe(blockersTab)
    fireEvent.keyDown(blockersTab, { key: 'Home' })
    expect(document.activeElement).toBe(readinessTab)
    fireEvent.keyDown(readinessTab, { key: 'ArrowRight' })

    fireEvent.click(screen.getByRole('button', { name: /未知结果恢复/ }))
    fireEvent.click(screen.getByRole('button', { name: '运行演练' }))

    expect(await screen.findByText('恢复路径未执行第二次发送。')).not.toBeNull()
    expect(screen.getByText('delivery_unknown')).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('tab', { name: '阻塞项' }))
    expect(screen.getByText('发布数据库 adapter')).not.toBeNull()
    expect(screen.getByText(/PublishJobs \/ PublishLogs/)).not.toBeNull()
  })

  it('shows stable errors when readiness or a simulation is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    render(React.createElement(PlatformOperationsClient, { language: 'zh' }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('无法加载平台 readiness'),
    )
    fireEvent.click(screen.getByRole('tab', { name: /Mock 演练/ }))
    fireEvent.click(screen.getByRole('button', { name: '运行演练' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('演练执行失败'))
  })
})
