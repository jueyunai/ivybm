'use client'

import type { RefObject } from 'react'
import { usePathname } from 'next/navigation'

import { IconBell, IconLanguage, IconMenu2 } from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import type { PortalLocale } from '@/admin-portal/core/i18n/types'
import type { ResolvedPortalModule } from '@/admin-portal/core/modules/types'
import { StatusBadge } from '@/admin-portal/core/ui'

export interface PortalHeaderProps {
  environment: 'local' | 'production'
  locale: PortalLocale
  menuButtonRef: RefObject<HTMLButtonElement | null>
  modules: readonly ResolvedPortalModule[]
  onLocaleToggle: () => void
  onOpenNavigation: () => void
}

const resolveCurrentModule = (
  pathname: string,
  modules: readonly ResolvedPortalModule[],
): ResolvedPortalModule | undefined =>
  [...modules]
    .sort((left, right) => right.href.length - left.href.length)
    .find((portalModule) =>
      portalModule.href === '/dashboard'
        ? pathname === '/dashboard'
        : pathname === portalModule.href || pathname.startsWith(`${portalModule.href}/`),
    )

export function PortalHeader({
  environment,
  locale,
  menuButtonRef,
  modules,
  onLocaleToggle,
  onOpenNavigation,
}: PortalHeaderProps) {
  const pathname = usePathname()
  const messages = getPortalMessages(locale)
  const currentModule = resolveCurrentModule(pathname, modules)
  const title = currentModule ? messages.modules[currentModule.labelKey] : messages.shell.brandProduct
  const group = currentModule ? messages.navGroups[currentModule.navGroup] : messages.navGroups.workspace

  return (
    <header className="portal-header">
      <button
        aria-label={messages.shell.openNavigation}
        className="portal-header__menu"
        onClick={onOpenNavigation}
        ref={menuButtonRef}
        type="button"
      >
        <IconMenu2 aria-hidden="true" size={19} stroke={1.8} />
      </button>

      <div className="portal-header__heading">
        <p>{group} / IVYBM</p>
        <h1>{title}</h1>
      </div>

      <div className="portal-header__actions">
        <StatusBadge
          label={
            environment === 'production'
              ? messages.shell.productionEnvironment
              : messages.shell.localEnvironment
          }
          tone={environment === 'production' ? 'success' : 'info'}
        />
        <button
          aria-label={messages.shell.noNotifications}
          className="portal-header__icon-button"
          title={messages.shell.noNotifications}
          type="button"
        >
          <IconBell aria-hidden="true" size={17} stroke={1.8} />
        </button>
        <button
          aria-label={messages.shell.changeLanguage}
          className="portal-header__icon-button"
          onClick={onLocaleToggle}
          title={messages.shell.changeLanguage}
          type="button"
        >
          <IconLanguage aria-hidden="true" size={17} stroke={1.8} />
        </button>
      </div>
    </header>
  )
}
