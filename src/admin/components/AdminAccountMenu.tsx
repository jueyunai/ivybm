'use client'

import { Link, useAuth, useConfig, useTranslation } from '@payloadcms/ui'
import { IconChevronDown, IconLogout, IconSettings } from '@tabler/icons-react'
import { formatAdminURL } from 'payload/shared'
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'

import { requestAdminLogout } from '../auth/logout'
import { getAdminCopy, getAdminLocale } from '../i18n'

type InitialMenuFocus = 'first' | 'last'

const getEnabledMenuItems = (menu: HTMLDivElement | null): HTMLElement[] =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])

const initialsFromEmail = (email: string): string => {
  const account = email.split('@')[0]?.trim()

  return account ? account.slice(0, 2).toUpperCase() : 'IV'
}

export default function AdminAccountMenu() {
  const { setUser, user } = useAuth()
  const { config } = useConfig()
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const initialFocusRef = useRef<InitialMenuFocus>('first')
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const copy = getAdminCopy(getAdminLocale(i18n.language))
  const email = typeof user?.email === 'string' ? user.email : copy.navHeading
  const accountHref = formatAdminURL({
    adminRoute: config.routes.admin,
    path: config.admin.routes.account,
  })
  const loginHref = formatAdminURL({
    adminRoute: config.routes.admin,
    path: config.admin.routes.login,
  })

  const openMenu = (initialFocus: InitialMenuFocus) => {
    initialFocusRef.current = initialFocus
    setSignOutError(null)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    const items = getEnabledMenuItems(menuRef.current)
    items[initialFocusRef.current === 'last' ? items.length - 1 : 0]?.focus()

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    openMenu(event.key === 'ArrowUp' ? 'last' : 'first')
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }

    if (!['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key)) return

    const items = getEnabledMenuItems(menuRef.current)
    if (items.length === 0) return

    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    let nextIndex = 0

    if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'ArrowDown')
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
    else nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1

    items[nextIndex]?.focus()
  }

  const handleSignOut = async () => {
    if (signingOut) return

    setSignOutError(null)
    setSigningOut(true)

    try {
      await requestAdminLogout({ apiRoute: config.routes.api, userSlug: config.admin.user })
      setUser(null)
      window.location.assign(loginHref)
    } catch {
      setSignOutError(copy.signOutError)
      setSigningOut(false)
      setOpen(true)
    }
  }

  return (
    <div className="ops-account-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={copy.account}
        aria-controls="admin-account-menu"
        className="ops-account-menu__trigger"
        data-testid="admin-account-menu-trigger"
        onClick={() => {
          if (open) setOpen(false)
          else openMenu('first')
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="ops-account-menu__avatar">
          {initialsFromEmail(email)}
        </span>
        <IconChevronDown aria-hidden="true" className="ops-account-menu__chevron" />
      </button>

      {open ? (
        <div
          aria-label={copy.account}
          className="ops-account-menu__popover"
          data-testid="admin-account-menu"
          id="admin-account-menu"
          onKeyDown={handleMenuKeyDown}
          aria-orientation="vertical"
          role="menu"
        >
          <div className="ops-account-menu__identity">
            <span
              aria-hidden="true"
              className="ops-account-menu__avatar ops-account-menu__avatar--large"
            >
              {initialsFromEmail(email)}
            </span>
            <span title={email}>{email}</span>
          </div>
          <div className="ops-account-menu__divider" />
          <Link href={accountHref} onClick={() => setOpen(false)} role="menuitem" tabIndex={-1}>
            <IconSettings aria-hidden="true" />
            <span>{copy.account}</span>
          </Link>
          <button
            aria-busy={signingOut}
            data-action="sign-out"
            disabled={signingOut}
            onClick={handleSignOut}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            <IconLogout aria-hidden="true" />
            <span>{signingOut ? copy.signingOut : copy.signOut}</span>
          </button>
          {signOutError ? (
            <p className="ops-account-menu__error" role="alert">
              {signOutError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
