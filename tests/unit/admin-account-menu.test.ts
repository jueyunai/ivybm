import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminAccountMenu from '@/admin/components/AdminAccountMenu'

const accountMenuMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  setUser: vi.fn(),
}))

vi.mock('@payloadcms/ui', async () => {
  const react = await import('react')

  return {
    Link: ({
      children,
      href,
      onClick,
      role,
      tabIndex,
    }: {
      children?: ReactNode
      href: string
      onClick?: () => void
      role?: string
      tabIndex?: number
    }) => react.createElement('a', { href, onClick, role, tabIndex }, children),
    useAuth: () => ({
      setUser: accountMenuMocks.setUser,
      user: { email: 'operator@example.com' },
    }),
    useConfig: () => ({
      config: {
        admin: {
          routes: { account: '/account', login: '/login' },
          user: 'users',
        },
        routes: { admin: '/admin', api: '/api' },
      },
    }),
    useTranslation: () => ({ i18n: { language: 'en' } }),
  }
})

describe('AdminAccountMenu', () => {
  beforeEach(() => {
    accountMenuMocks.fetch.mockReset()
    accountMenuMocks.setUser.mockReset()
    vi.stubGlobal('fetch', accountMenuMocks.fetch)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
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

  it('implements the menu-button arrow, Home, and End keyboard model', async () => {
    render(React.createElement(AdminAccountMenu))
    const trigger = screen.getByRole('button', { name: 'Account settings' })

    fireEvent.keyDown(trigger, { key: 'ArrowUp' })

    const accountLink = screen.getByRole('menuitem', { name: 'Account settings' })
    const signOutButton = screen.getByRole('menuitem', { name: 'Sign out' })
    await waitFor(() => expect(document.activeElement).toBe(signOutButton))

    fireEvent.keyDown(signOutButton, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(accountLink)

    fireEvent.keyDown(accountLink, { key: 'End' })
    expect(document.activeElement).toBe(signOutButton)

    fireEvent.keyDown(signOutButton, { key: 'Home' })
    expect(document.activeElement).toBe(accountLink)

    fireEvent.keyDown(accountLink, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(signOutButton)
  })

  it('closes when a pointer event starts outside the menu', () => {
    render(React.createElement(AdminAccountMenu))

    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }))
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('prevents duplicate sign out and exposes a recoverable HTTP error', async () => {
    let resolveLogout: ((response: Response) => void) | undefined
    accountMenuMocks.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveLogout = resolve
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
    expect(accountMenuMocks.fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveLogout?.(new Response(null, { status: 503 }))
      await Promise.resolve()
    })

    expect(screen.getByRole('alert').textContent).toBe('Sign out failed. Please try again.')
    expect((screen.getByRole('menuitem', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    expect(accountMenuMocks.setUser).not.toHaveBeenCalled()
  })
})
