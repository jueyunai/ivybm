'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import React from 'react'

import { isPublicLocale, localePath } from '@/lib/i18n'

export default function PublicNotFound() {
  const params = useParams<{ locale?: string }>()
  const locale = params.locale && isPublicLocale(params.locale) ? params.locale : 'en'
  const copy = locale === 'ar'
    ? {
        description: 'المحتوى المطلوب غير متاح أو لم يتم نشره بعد.',
        home: 'العودة إلى الرئيسية',
        title: 'الصفحة غير موجودة',
      }
    : {
        description: 'The requested public content is unavailable or has not been published.',
        home: 'Return home',
        title: 'Page not found',
      }

  return (
    <section className="section not-found">
      <div className="container">
        <div className="section-kicker">404</div>
        <h1>{copy.title}</h1>
        <p className="muted">{copy.description}</p>
        <Link className="button" href={localePath(locale)}>{copy.home}</Link>
      </div>
    </section>
  )
}
