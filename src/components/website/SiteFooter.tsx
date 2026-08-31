import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

import { localePath, type Locale } from '@/lib/i18n'
import { getWebsiteV17Copy } from '@/lib/website-i18n'
import type { SiteSetting } from '@/payload-types'

const navItems = [
  ['products', '/products'],
  ['capabilities', '/capabilities'],
  ['projects', '/projects'],
  ['forProfessionals', '/for-professionals'],
  ['knowledge', '/knowledge'],
  ['news', '/news'],
  ['about', '/about'],
] as const

const legalItems = [
  ['privacy', '/privacy'],
  ['terms', '/terms'],
  ['dataDeletion', '/data-deletion'],
] as const

export function SiteFooter({ locale, settings }: { locale: Locale; settings: SiteSetting }) {
  const copy = getWebsiteV17Copy(locale)
  const contactLines = [settings.contact?.email, settings.contact?.phone, settings.contact?.address]
    .filter(Boolean)
    .join('\n')

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link aria-label={settings.siteName} className="brand" href={localePath(locale)}>
            <Image
              alt={settings.siteName}
              className="brand-logo footer-brand-logo"
              height={48}
              src="/brand/ivybm-logo-trimmed.png"
              width={150}
            />
          </Link>
          {settings.siteDescription ? <p>{settings.siteDescription}</p> : null}
        </div>
        <div>
          <h3>{copy.footer.quickLinks}</h3>
          <div className="footer-links">
            {navItems.map(([key, route]) => (
              <Link href={localePath(locale, route)} key={key}>
                {copy.navigation[key as keyof typeof copy.navigation]}
              </Link>
            ))}
          </div>
          <div className="footer-links footer-links--legal">
            {legalItems.map(([key, route]) => (
              <Link href={localePath(locale, route)} key={key}>
                {copy.legal[key as keyof typeof copy.legal]}
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
