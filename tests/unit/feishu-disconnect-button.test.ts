import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  fetch: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import FeishuDisconnectButton from '@/admin/components/FeishuDisconnectButton'

describe('FeishuDisconnectButton', () => {
  beforeEach(() => {
    mocks.confirm.mockReset()
    mocks.fetch.mockReset()
    mocks.refresh.mockReset()
    vi.stubGlobal('confirm', mocks.confirm)
    vi.stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('requires confirmation before disconnecting', () => {
    mocks.confirm.mockReturnValue(false)
    render(React.createElement(FeishuDisconnectButton, { connectionId: 7, connectionName: 'CRM' }))

    fireEvent.click(screen.getByRole('button', { name: '断开飞书连接' }))

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('prevents duplicate requests and reports success', async () => {
    let resolveRequest: ((response: Response) => void) | undefined
    mocks.confirm.mockReturnValue(true)
    mocks.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve
      }),
    )
    render(React.createElement(FeishuDisconnectButton, { connectionId: 7, connectionName: 'CRM' }))

    const button = screen.getByRole('button', { name: '断开飞书连接' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: '正在断开…' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    resolveRequest?.(new Response(JSON.stringify({ disconnected: true }), { status: 200 }))
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('shows a recoverable error without refreshing', async () => {
    mocks.confirm.mockReturnValue(true)
    mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }))
    render(React.createElement(FeishuDisconnectButton, { connectionId: 7, connectionName: 'CRM' }))

    fireEvent.click(screen.getByRole('button', { name: '断开飞书连接' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(
      (screen.getByRole('button', { name: '断开飞书连接' }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
