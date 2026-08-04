'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  IconAlertTriangle,
  IconBrain,
  IconChevronLeft,
  IconChevronRight,
  IconHome,
  IconMessageCircle,
  IconPhoto,
  IconPlugConnected,
  IconSettings,
  IconSparkles,
  IconTargetArrow,
  IconTemplate,
  IconX,
  type Icon as TablerIcon,
} from '@tabler/icons-react'

import type { PortalUser } from '@/admin-portal/core/auth/types'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import type { PortalLocale } from '@/admin-portal/core/i18n/types'
import type {
  PortalModuleId,
  PortalNavGroup,
  ResolvedPortalModule,
} from '@/admin-portal/core/modules/types'

import { PortalAccountMenu } from './PortalAccountMenu'

const GROUP_ORDER: readonly PortalNavGroup[] = [
  'workspace',
  'content',
  'intelligence',
  'operations',
  'system',
]

const MODULE_ICONS: Record<PortalModuleId, TablerIcon> = {
  conversations: IconMessageCircle,
  'content-studio': IconSparkles,
  knowledge: IconBrain,
  leads: IconTargetArrow,
  media: IconPhoto,
  operations: IconAlertTriangle,
  overview: IconHome,
  platforms: IconPlugConnected,
  settings: IconSettings,
  'website-content': IconTemplate,
}

const isActiveHref = (pathname: string, href: string): boolean =>
  href === '/dashboard' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

export interface PortalSidebarProps {
  collapsed: boolean
  locale: PortalLocale
  mobile?: boolean
  modules: readonly ResolvedPortalModule[]
  onClose?: () => void
  onCollapseToggle?: () => void
  onLocaleToggle?: () => void
  user: PortalUser
}

export function PortalSidebar({
  collapsed,
  locale,
  mobile = false,
  modules,
  onClose,
  onCollapseToggle,
  onLocaleToggle,
  user,
}: PortalSidebarProps) {
  const pathname = usePathname()
  const messages = getPortalMessages(locale)

  return (
    <aside
      className={`portal-sidebar${collapsed ? ' is-collapsed' : ''}${mobile ? ' is-mobile' : ''}`}
    >
      <header className="portal-sidebar__brand">
        <span aria-hidden="true" className="portal-sidebar__mark">
          IV
        </span>
        {!collapsed ? (
          <span className="portal-sidebar__brand-copy">
            <strong>{messages.shell.brandName}</strong>
            <small>{messages.shell.brandProduct}</small>
          </span>
        ) : null}
        {mobile ? (
          <button
            aria-label={messages.shell.closeNavigation}
            className="portal-sidebar__utility"
            onClick={onClose}
            type="button"
          >
            <IconX aria-hidden="true" size={18} stroke={1.8} />
          </button>
        ) : null}
      </header>

      <nav aria-label={messages.shell.navigationLabel} className="portal-sidebar__navigation">
        {GROUP_ORDER.map((group) => {
          const groupModules = modules.filter((portalModule) => portalModule.navGroup === group)
          if (groupModules.length === 0) return null

          return (
            <section className="portal-sidebar__group" key={group}>
              {!collapsed ? (
                <h2 className="portal-sidebar__group-label">{messages.navGroups[group]}</h2>
              ) : null}
              <ul className="portal-sidebar__list">
                {groupModules.map((portalModule) => {
                  const Icon = MODULE_ICONS[portalModule.id] ?? IconTemplate
                  const label = messages.modules[portalModule.labelKey]
                  const active = isActiveHref(pathname, portalModule.href)
                  const content = (
                    <>
                      <span aria-hidden="true" className="portal-sidebar__active-mark" />
                      <Icon aria-hidden="true" size={18} stroke={1.8} />
                      {!collapsed ? <span>{label}</span> : null}
                    </>
                  )

                  return (
                    <li key={portalModule.id}>
                      {portalModule.canNavigate ? (
                        <Link
                          aria-current={active ? 'page' : undefined}
                          aria-label={collapsed ? label : undefined}
                          className={`portal-sidebar__link${active ? ' is-active' : ''}`}
                          href={portalModule.href}
                          onClick={onClose}
                          title={collapsed ? label : undefined}
                        >
                          {content}
                        </Link>
                      ) : (
                        <span
                          aria-disabled="true"
                          aria-label={collapsed ? label : undefined}
                          className="portal-sidebar__link is-disabled"
                          title={`${label} · ${messages.states[portalModule.featureState.reason]}`}
                        >
                          {content}
                          {!collapsed ? <span className="portal-sidebar__lock-dot" /> : null}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </nav>

      <div className="portal-sidebar__footer">
        <PortalAccountMenu
          collapsed={collapsed}
          locale={locale}
          onLocaleToggle={onLocaleToggle}
          user={user}
        />
        {!mobile ? (
          <button
            aria-label={
              collapsed ? messages.shell.expandNavigation : messages.shell.collapseNavigation
            }
            className="portal-sidebar__collapse"
            onClick={onCollapseToggle}
            type="button"
          >
            {collapsed ? (
              <IconChevronRight aria-hidden="true" size={17} stroke={1.8} />
            ) : (
              <>
                <IconChevronLeft aria-hidden="true" size={17} stroke={1.8} />
                <span>{messages.shell.collapseNavigation}</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </aside>
  )
}
