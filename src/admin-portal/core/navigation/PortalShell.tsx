'use client'

import { type ReactNode, useCallback, useRef, useState } from 'react'

import type { PortalUser } from '@/admin-portal/core/auth/types'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import type { PortalAvailabilityResolution } from '@/admin-portal/core/modules/resolvePortalAvailability'
import { PortalState } from '@/admin-portal/core/ui'

import { PortalHeader } from './PortalHeader'
import { PortalMobileNav } from './PortalMobileNav'
import { PortalPreferencesProvider, usePortalPreferences } from './PortalPreferences'
import { PortalSidebar } from './PortalSidebar'

export interface PortalShellProps {
  availability: PortalAvailabilityResolution
  children?: ReactNode
  environment: 'local' | 'production'
  user: PortalUser
}

function PortalShellFrame({ availability, children, environment, user }: PortalShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { locale, setLocale } = usePortalPreferences()
  const messages = getPortalMessages(locale)
  const toggleLocale = useCallback(
    () => setLocale(locale === 'zh' ? 'en' : 'zh'),
    [locale, setLocale],
  )
  const closeMobileNav = useCallback(() => setMobileOpen(false), [])

  if (!availability.portalEnabled) {
    return (
      <main className="portal-maintenance">
        <div className="portal-maintenance__brand">
          <span aria-hidden="true">IV</span>
          <strong>{messages.shell.brandName}</strong>
        </div>
        <PortalState
          description={messages.nextSteps.settings}
          title={messages.states['portal-disabled']}
          type="blocked"
        />
      </main>
    )
  }

  return (
    <div className={`portal-layout${collapsed ? ' is-collapsed' : ''}`}>
      <PortalSidebar
        collapsed={collapsed}
        locale={locale}
        modules={availability.modules}
        onCollapseToggle={() => setCollapsed((current) => !current)}
        onLocaleToggle={toggleLocale}
        user={user}
      />
      <div className="portal-main">
        <PortalHeader
          environment={environment}
          locale={locale}
          menuButtonRef={menuButtonRef}
          modules={availability.modules}
          onLocaleToggle={toggleLocale}
          onOpenNavigation={() => setMobileOpen(true)}
        />
        <div className="portal-main__body">{children}</div>
      </div>
      <PortalMobileNav
        locale={locale}
        modules={availability.modules}
        onClose={closeMobileNav}
        onLocaleToggle={toggleLocale}
        open={mobileOpen}
        triggerRef={menuButtonRef}
        user={user}
      />
    </div>
  )
}

export function PortalShell(props: PortalShellProps) {
  return (
    <PortalPreferencesProvider>
      <PortalShellFrame {...props} />
    </PortalPreferencesProvider>
  )
}
