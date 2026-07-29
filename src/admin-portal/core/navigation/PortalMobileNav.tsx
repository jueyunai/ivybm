'use client'

import { type RefObject, useEffect, useRef } from 'react'

import type { PortalUser } from '@/admin-portal/core/auth/types'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import type { PortalLocale } from '@/admin-portal/core/i18n/types'
import type { ResolvedPortalModule } from '@/admin-portal/core/modules/types'

import { PortalSidebar } from './PortalSidebar'

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
      dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
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
