'use client'

import {
  IconMenu2,
  IconMessageCircle,
  IconSend,
  IconX,
} from '@tabler/icons-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import React, { useState } from 'react'

import {
  getWebsiteCopy,
  localePath,
  type Locale,
  replacePathLocale,
} from '@/lib/i18n'

const navItems = [
  ['home', '/'],
  ['about', '/about'],
  ['products', '/products'],
  ['projects', '/projects'],
  ['news', '/news'],
  ['contact', '/contact'],
] as const

export function SiteHeader({
  locale,
  siteName,
  whatsapp,
}: {
  locale: Locale
  siteName: string
  whatsapp?: null | string
}) {
  const copy = getWebsiteCopy(locale)
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const whatsappHref = whatsapp
    ? whatsapp.startsWith('http')
      ? whatsapp
      : `https://wa.me/${whatsapp.replace(/\D/g, '')}`
    : undefined

  return (
    <header className="site-header">
      <nav aria-label={copy.accessibility.mainNavigation} className="nav-shell">
        <Link aria-label={siteName} className="brand" href={localePath(locale)}>
          <span className="brand-mark">IVY</span>
          <span>{siteName}</span>
        </Link>

        <div className="nav-links" data-open={menuOpen}>
          {navItems.map(([key, route]) => {
            const href = localePath(locale, route)
            const active = route === '/' ? pathname === href : pathname.startsWith(href)

            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={active ? 'active' : undefined}
                href={href}
                key={key}
                onClick={() => setMenuOpen(false)}
              >
                {copy.navigation[key]}
              </Link>
            )
          })}
        </div>

        <div className="nav-actions">
          <select
            aria-label={copy.accessibility.language}
            className="language-select"
            onChange={(event) => router.push(replacePathLocale(pathname, event.target.value as Locale))}
            value={locale}
          >
            <option value="en">EN</option>
            <option value="ar">AR</option>
          </select>
          {whatsappHref ? (
            <a
              aria-label={copy.accessibility.whatsapp}
              className="icon-button"
              href={whatsappHref}
              rel="noreferrer"
              target="_blank"
            >
              <IconMessageCircle aria-hidden size={20} stroke={1.8} />
            </a>
          ) : null}
          <Link className="button nav-quote" href={localePath(locale, '/contact')}>
            <IconSend aria-hidden size={19} stroke={1.8} />
            {copy.actions.quote}
          </Link>
          <button
            aria-expanded={menuOpen}
            aria-label={copy.accessibility.menu}
            className="icon-button menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            {menuOpen ? <IconX aria-hidden size={21} /> : <IconMenu2 aria-hidden size={21} />}
          </button>
        </div>
      </nav>
      <nav aria-label={copy.accessibility.mobileNavigation} className="mobile-navigation" data-open={menuOpen}>
        {navItems.map(([key, route]) => (
          <Link href={localePath(locale, route)} key={key} onClick={() => setMenuOpen(false)}>
            {copy.navigation[key]}
          </Link>
        ))}
      </nav>
    </header>
  )
}
