import { randomUUID } from 'node:crypto'
import { IconClock, IconMail, IconMapPin } from '@tabler/icons-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { InquiryForm } from '@/components/inquiry/InquiryForm'
import { PageHero } from '@/components/website/PageHero'
import { getWebsiteCopy, isPublicLocale, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import { getPageBySlug, getSiteSettings } from '@/lib/website-data'

const loadContact = async (locale: Locale) => {
  const [page, home, settings] = await Promise.all([getPageBySlug(locale, 'contact'), getPageBySlug(locale, 'home'), getSiteSettings(locale)])
  return { home, page, settings }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { home, page, settings } = await loadContact(value)
  const copy = getWebsiteCopy(value)
  return buildPageMetadata({ description: page?.summary || copy.pages.contactSubtitle, locale: value, media: page?.heroImage || home?.heroImage, path: '/contact', seo: page?.seo || settings.defaultSeo, siteName: settings.siteName, title: page?.title || copy.navigation.contact })
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()
  const { home, page, settings } = await loadContact(value)
  if (!page) notFound()
  const copy = getWebsiteCopy(value)
  const cards = [
    { Icon: IconMapPin, title: copy.contact.location, value: settings.contact?.address },
    { Icon: IconMail, title: copy.contact.emailCard, value: settings.contact?.email },
    { Icon: IconClock, title: copy.contact.workingHours, value: copy.contact.workingHoursValue },
  ].filter((card) => Boolean(card.value))
  return <><PageHero image={page.heroImage || home?.heroImage} subtitle={page.summary || copy.contact.subtitle} title={page.title} /><section className="section alt"><div className="container contact-wrap"><div className="grid">{cards.map(({ Icon, title, value }) => <article className="info-card" key={title}><Icon aria-hidden size={28} stroke={1.7} /><h3>{title}</h3><p className="muted pre-line">{value}</p></article>)}</div><InquiryForm initialIdempotencyKey={randomUUID()} locale={value} /></div></section></>
}
