'use client'

import { Link, useAuth, useConfig, useNav, useTranslation } from '@payloadcms/ui'
import { IconX } from '@tabler/icons-react'
import { NavWrapper } from '@payloadcms/next/client'
import { usePathname } from 'next/navigation'

import { getAdminCopy, getAdminLocale } from '../i18n'
import { getOperationsNavSections } from '../navigation/getOperationsNavSections'

const isActiveHref = (pathname: string | null, href: string): boolean => {
  if (!pathname) return false
  if (href === '/admin') return pathname === href

  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function OperationsNav() {
  const pathname = usePathname()
  const { permissions, user } = useAuth()
  const { config } = useConfig()
  const { setNavOpen } = useNav()
  const { i18n } = useTranslation()
  const language = getAdminLocale(i18n.language)
  const copy = getAdminCopy(language)
  const sections = getOperationsNavSections({ config, copy, language, permissions })
  const userLabel = typeof user?.email === 'string' ? user.email : copy.navHeading

  return (
    <NavWrapper baseClass="nav">
      <nav aria-label={copy.navHeading} className="ops-admin-nav" data-testid="operations-nav">
        <button
          aria-label={copy.closeNavigation}
          className="ops-admin-nav__close"
          data-testid="operations-nav-close"
          onClick={() => setNavOpen(false)}
          title={copy.closeNavigation}
          type="button"
        >
          <IconX aria-hidden="true" />
        </button>
        <header className="ops-admin-nav__brand">
          <span aria-hidden="true" className="ops-admin-nav__mark">
            IV
          </span>
          <span className="ops-admin-nav__brand-copy">
            <strong>IVYBM</strong>
            <small>{copy.brandKicker}</small>
          </span>
        </header>

        <div className="ops-admin-nav__sections">
          {sections.map((section) => (
            <section
              aria-labelledby={`ops-nav-heading-${section.id}`}
              className="ops-admin-nav__section"
              data-testid={`ops-nav-section-${section.id}`}
              key={section.id}
            >
              <h2 id={`ops-nav-heading-${section.id}`}>{section.label}</h2>
              <ul>
                {section.items.map((item) => {
                  const active = isActiveHref(pathname, item.href)

                  return (
                    <li key={item.id}>
                      <Link
                        aria-current={active ? 'page' : undefined}
                        className={`ops-admin-nav__link${active ? ' is-active' : ''}`}
                        href={item.href}
                        prefetch
                      >
                        <span aria-hidden="true" className="ops-admin-nav__link-mark" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>

        <footer className="ops-admin-nav__footer">
          <p title={userLabel}>{userLabel}</p>
          <div>
            <Link href="/admin/account">{copy.account}</Link>
            <Link href="/admin/logout">{copy.signOut}</Link>
          </div>
        </footer>
      </nav>
    </NavWrapper>
  )
}
