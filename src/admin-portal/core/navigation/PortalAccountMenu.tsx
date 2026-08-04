'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import {
  IconChevronDown,
  IconLanguage,
  IconLogout,
  IconSettings,
} from '@tabler/icons-react'

import type { PortalUser } from '@/admin-portal/core/auth/types'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import type { PortalLocale } from '@/admin-portal/core/i18n/types'
import { requestPortalLogout } from '@/modules/auth/payloadLogout'

export interface PortalAccountMenuProps {
  collapsed?: boolean
  locale: PortalLocale
  onLocaleToggle?: () => void
  user: PortalUser
}

export function PortalAccountMenu({
  collapsed = false,
  locale,
  onLocaleToggle,
  user,
}: PortalAccountMenuProps) {
  const messages = getPortalMessages(locale)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLElement | null>>([])
  const displayName = user.email.split('@')[0] || user.email
  const roleLabel = {
    admin: messages.shell.roleAdmin,
    operator: messages.shell.roleOperator,
    sales: messages.shell.roleSales,
  }[user.role]

  const closeMenu = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter(Boolean) as HTMLElement[]
    items[((index % items.length) + items.length) % items.length]?.focus()
  }

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
        return
      }

      const items = itemRefs.current.filter(Boolean) as HTMLElement[]
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusItem(index + 1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusItem(index - 1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        focusItem(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        focusItem(items.length - 1)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.requestAnimationFrame(() => focusItem(0))
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleLogout = async () => {
    if (pending) return
    setError(false)
    setPending(true)
    try {
      await requestPortalLogout()
      window.location.assign('/dashboard/login')
    } catch {
      setError(true)
      setPending(false)
    }
  }

  return (
    <div className="portal-account" ref={rootRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={messages.shell.accountMenu}
        className="portal-account__trigger"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            window.requestAnimationFrame(() => focusItem(event.key === 'ArrowUp' ? -1 : 0))
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="portal-account__avatar">
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        {!collapsed ? (
          <span className="portal-account__identity">
            <strong>{displayName}</strong>
            <span>
              {roleLabel} · {locale === 'zh' ? '中文' : 'English'}
            </span>
          </span>
        ) : null}
        {!collapsed ? <IconChevronDown aria-hidden="true" size={16} stroke={1.8} /> : null}
      </button>

      {open ? (
        <div
          aria-label={messages.shell.accountMenu}
          className="portal-account__menu"
          id={menuId}
          role="menu"
        >
          <Link
            className="portal-account__menu-item"
            href="/dashboard/settings#account"
            onClick={() => closeMenu()}
            ref={(element) => {
              itemRefs.current[0] = element
            }}
            role="menuitem"
            tabIndex={-1}
          >
            <IconSettings aria-hidden="true" size={17} stroke={1.8} />
            {messages.shell.accountSettings}
          </Link>
          <button
            className="portal-account__menu-item"
            onClick={() => {
              onLocaleToggle?.()
              closeMenu(true)
            }}
            ref={(element) => {
              itemRefs.current[1] = element
            }}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            <IconLanguage aria-hidden="true" size={17} stroke={1.8} />
            {messages.shell.changeLanguage}
          </button>
          <button
            aria-busy={pending || undefined}
            className="portal-account__menu-item portal-account__menu-item--danger"
            disabled={pending}
            onClick={handleLogout}
            ref={(element) => {
              itemRefs.current[2] = element
            }}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            <IconLogout aria-hidden="true" size={17} stroke={1.8} />
            {pending ? messages.shell.signingOut : messages.shell.signOut}
          </button>
          {error ? (
            <p className="portal-account__error" role="alert">
              {messages.shell.signOutError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
