import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { ChatWidget } from '@/components/chat/ChatWidget'
import { JsonLd } from '@/components/website/JsonLd'
import { SiteFooter } from '@/components/website/SiteFooter'
import { SiteHeader } from '@/components/website/SiteHeader'
import {
  getLocaleDirection,
  isPublicLocale,
  type Locale,
} from '@/lib/i18n'
import { buildOrganizationJsonLd, getSiteOrigin } from '@/lib/seo'
import { getSiteSettings } from '@/lib/website-data'

import '../website.css'

export const metadata: Metadata = {
  metadataBase: getSiteOrigin(),
}

export default async function WebsiteLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()

  const locale: Locale = value
  const settings = await getSiteSettings(locale)
  const socialLinks = settings.socialLinks?.map((item) => item.url).filter(Boolean) || []
  const organization = buildOrganizationJsonLd({
    description: settings.siteDescription,
    email: settings.contact?.email,
    locale,
    name: settings.siteName,
    phone: settings.contact?.phone,
    socialLinks,
  })

  return (
    <html data-scroll-behavior="smooth" dir={getLocaleDirection(locale)} lang={locale}>
      <body>
        <JsonLd data={organization} />
        <SiteHeader locale={locale} siteName={settings.siteName} whatsapp={settings.contact?.whatsapp} />
        <main>{children}</main>
        <SiteFooter locale={locale} settings={settings} />
        <ChatWidget locale={locale} />
      </body>
    </html>
  )
}
