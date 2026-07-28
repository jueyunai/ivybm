import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminAccountMenu from '@/admin/components/AdminAccountMenu'

const authMocks = vi.hoisted(() => ({
  logOut: vi.fn(),
}))

vi.mock('@payloadcms/ui', async () => {
  const react = await import('react')

  return {
    Link: ({
      children,
      href,
      onClick,
      role,
    }: {
      children?: ReactNode
      href: string
      onClick?: () => void
      role?: string
    }) => react.createElement('a', { href, onClick, role }, children),
    useAuth: () => ({
      logOut: authMocks.logOut,
      user: { email: 'operator@example.com' },
    }),
    useTranslation: () => ({ i18n: { language: 'en' } }),
  }
})

describe('AdminAccountMenu', () => {
  beforeEach(() => {
    authMocks.logOut.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    render(React.createElement(AdminAccountMenu))
    const trigger = screen.getByRole('button', { name: 'Account settings' })

    fireEvent.click(trigger)
    const accountLink = screen.getByRole('menuitem', { name: 'Account settings' })
    await waitFor(() => expect(document.activeElement).toBe(accountLink))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes when a pointer event starts outside the menu', () => {
    render(React.createElement(AdminAccountMenu))

    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }))
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('prevents duplicate sign out and exposes a recoverable error', async () => {
    let rejectLogout: ((reason?: unknown) => void) | undefined
    authMocks.logOut.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectLogout = reject
      }),
    )
    render(React.createElement(AdminAccountMenu))

    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }))
    const signOutButton = screen.getByRole('menuitem', { name: 'Sign out' }) as HTMLButtonElement
    fireEvent.click(signOutButton)
    fireEvent.click(signOutButton)

    expect(signOutButton.disabled).toBe(true)
    expect(signOutButton.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Signing out…')).toBeTruthy()
    expect(authMocks.logOut).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectLogout?.(new Error('provider unavailable'))
      await Promise.resolve()
    })

    expect(screen.getByRole('alert').textContent).toBe('Sign out failed. Please try again.')
    expect((screen.getByRole('menuitem', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})
