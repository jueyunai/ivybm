import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { generateLegalMetadata, LegalPage } from '@/components/website/LegalPage'
import { isPublicLocale } from '@/lib/i18n'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return isPublicLocale(locale) ? generateLegalMetadata(locale, 'terms') : {}
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isPublicLocale(locale)) notFound()
  return <LegalPage locale={locale} type="terms" />
}
