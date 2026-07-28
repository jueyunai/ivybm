'use client'

import { Link, useAuth, useTranslation } from '@payloadcms/ui'
import { IconChevronDown, IconLogout, IconSettings } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

import { getAdminCopy, getAdminLocale } from '../i18n'

const initialsFromEmail = (email: string): string => {
  const account = email.split('@')[0]?.trim()

  return account ? account.slice(0, 2).toUpperCase() : 'IV'
}

export default function AdminAccountMenu() {
  const { logOut, user } = useAuth()
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const copy = getAdminCopy(getAdminLocale(i18n.language))
  const email = typeof user?.email === 'string' ? user.email : copy.navHeading

  useEffect(() => {
    if (!open) return

    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

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

  const handleSignOut = async () => {
    if (signingOut) return

    setSignOutError(null)
    setSigningOut(true)

    try {
      await logOut()
      window.location.assign('/admin/login')
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
          setSignOutError(null)
          setOpen((current) => !current)
        }}
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
          <Link href="/admin/account" onClick={() => setOpen(false)} role="menuitem">
            <IconSettings aria-hidden="true" />
            <span>{copy.account}</span>
          </Link>
          <button
            aria-busy={signingOut}
            data-action="sign-out"
            disabled={signingOut}
            onClick={handleSignOut}
            role="menuitem"
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
