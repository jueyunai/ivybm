'use client'

import { type RefObject, useEffect, useRef } from 'react'

import type { PortalUser } from '@/admin-portal/core/auth/types'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import type { PortalLocale } from '@/admin-portal/core/i18n/types'
import type { ResolvedPortalModule } from '@/admin-portal/core/modules/types'

import { PortalSidebar } from './PortalSidebar'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const focusableElements = (dialog: HTMLElement): HTMLElement[] =>
  Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.getAttribute('aria-hidden') !== 'true' &&
      element.getAttribute('aria-disabled') !== 'true',
  )

export interface PortalMobileNavProps {
  locale: PortalLocale
  modules: readonly ResolvedPortalModule[]
  onClose: () => void
  onLocaleToggle: () => void
  open: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
  user: PortalUser
}

export function PortalMobileNav({
  locale,
  modules,
  onClose,
  onLocaleToggle,
  open,
  triggerRef,
  user,
}: PortalMobileNavProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const messages = getPortalMessages(locale)

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    const trigger = triggerRef.current
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog) return
      const initialFocus = focusableElements(dialog)[0] ?? dialog
      initialFocus.focus()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const elements = focusableElements(dialog)
        if (elements.length === 0) {
          event.preventDefault()
          dialog.focus()
          return
        }
        const first = elements[0]
        const last = elements[elements.length - 1]
        const active = document.activeElement
        if (
          event.shiftKey
            ? active === first || !dialog.contains(active)
            : active === last || !dialog.contains(active)
        ) {
          event.preventDefault()
          const wrappedFocus = event.shiftKey ? last : first
          wrappedFocus.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      window.requestAnimationFrame(() => trigger?.focus())
    }
  }, [onClose, open, triggerRef])

  if (!open) return null

  return (
    <div className="portal-mobile-nav">
      <button
        aria-label={messages.shell.closeNavigation}
        className="portal-mobile-nav__backdrop"
        onClick={onClose}
        type="button"
      />
      <div
        aria-modal="true"
        className="portal-mobile-nav__dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <PortalSidebar
          collapsed={false}
          locale={locale}
          mobile
          modules={modules}
          onClose={onClose}
          onLocaleToggle={onLocaleToggle}
          user={user}
        />
      </div>
    </div>
  )
}
