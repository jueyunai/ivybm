import Link from 'next/link'
import React from 'react'

import { getWebsiteCopy, localePath, type Locale } from '@/lib/i18n'
import type { SiteSetting } from '@/payload-types'

const navItems = [
  ['home', '/'],
  ['about', '/about'],
  ['products', '/products'],
  ['projects', '/projects'],
  ['news', '/news'],
  ['contact', '/contact'],
] as const

export function SiteFooter({ locale, settings }: { locale: Locale; settings: SiteSetting }) {
  const copy = getWebsiteCopy(locale)
  const contactLines = [settings.contact?.email, settings.contact?.phone, settings.contact?.address]
    .filter(Boolean)
    .join('\n')

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link className="brand" href={localePath(locale)}>
            <span className="brand-mark">IVY</span>
            <span>{settings.siteName}</span>
          </Link>
          {settings.siteDescription ? <p>{settings.siteDescription}</p> : null}
        </div>
        <div>
          <h3>{copy.footer.quickLinks}</h3>
          <div className="footer-links">
            {navItems.map(([key, route]) => (
              <Link href={localePath(locale, route)} key={key}>
                {copy.navigation[key]}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <h3>{copy.footer.contact}</h3>
          {contactLines ? <p className="pre-line">{contactLines}</p> : null}
        </div>
      </div>
      <div className="container copyright">
        © {new Date().getFullYear()} {settings.siteName}. {copy.footer.rights}
      </div>
    </footer>
  )
}
