import React from 'react'

import type { Media } from '@/payload-types'

import { WebsiteImage } from './WebsiteImage'

export function PageHero({
  image,
  subtitle,
  title,
}: {
  image?: Media | number | null
  subtitle?: null | string
  title: string
}) {
  return (
    <section className="page-hero">
      <div aria-hidden className="page-hero-media">
        <WebsiteImage fill media={image} priority sizes="100vw" type="large" />
      </div>
      <div className="page-hero-overlay" />
      <div className="container page-hero-content">
        <div className="eyebrow">IVYBM</div>
        <h1>{title}</h1>
        {subtitle ? <p className="lead">{subtitle}</p> : null}
      </div>
    </section>
  )
}
