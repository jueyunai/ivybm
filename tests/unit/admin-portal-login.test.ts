import React from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalLoginForm } from '@/admin-portal/core/auth/PortalLoginForm'
import { requestPortalLogin } from '@/admin-portal/core/auth/requestPortalLogin'

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}))

describe('Portal login', () => {
  beforeEach(() => {
    navigation.refresh.mockReset()
    navigation.replace.mockReset()
  })

  afterEach(cleanup)

  it.each([
    [401, 'invalid-credentials'],
    [429, 'account-locked'],
    [503, 'service-unavailable'],
  ] as const)('maps login HTTP %s to %s without exposing response text', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('provider stack or user detail', { status }),
    )

    await expect(
      requestPortalLogin({ email: 'a@example.com', fetcher, password: 'not-logged' }),
    ).rejects.toMatchObject({ code, status })
  })

  it('maps a network failure to a stable retryable error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket includes secret'))

    await expect(
      requestPortalLogin({ email: 'a@example.com', fetcher, password: 'not-logged' }),
    ).rejects.toMatchObject({ code: 'network-failure', status: 0 })
  })

  it('prevents duplicate submission and navigates to the safe Portal target on success', async () => {
    let resolveLogin: ((response: Response) => void) | undefined
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveLogin = resolve
      }),
    )
    render(React.createElement(PortalLoginForm, { fetcher, returnTo: '/dashboard/media' }))

    expect(screen.getByRole('button', { name: '登录后台' }).closest('form')?.method).toBe('post')

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'operator@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'local-password-value' } })
    const submit = screen.getByRole('button', { name: '登录后台' }) as HTMLButtonElement
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(submit.disabled).toBe(true)
    expect(submit.getAttribute('aria-busy')).toBe('true')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/users/login', {
      body: JSON.stringify({ email: 'operator@example.com', password: 'local-password-value' }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    await act(async () => {
      resolveLogin?.(
        Response.json({ user: { collection: 'users', id: 2, role: 'operator' } }, { status: 200 }),
      )
      await Promise.resolve()
    })

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard/media'))
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the form retryable and renders a stable error message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }))
    render(React.createElement(PortalLoginForm, { fetcher, returnTo: '/dashboard' }))

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'operator@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录后台' }))

    expect((await screen.findByRole('alert')).textContent).toBe('邮箱或密码不正确，请重新输入。')
    expect((screen.getByRole('button', { name: '登录后台' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})
