'use client'

import { IconBuildingSkyscraper, IconChevronLeft, IconChevronRight, IconUpload } from '@tabler/icons-react'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'

import { localePath, type Locale } from '@/lib/i18n'
import { getWebsiteV17Copy } from '@/lib/website-i18n'
import type { Media } from '@/payload-types'

import { WebsiteImage } from './WebsiteImage'

export function HeroCarousel({
  images,
  locale,
  subtitle,
  title,
}: {
  images: (Media | number | null | undefined)[]
  locale: Locale
  subtitle?: null | string
  title?: null | string
}) {
  const copy = getWebsiteV17Copy(locale)
  const usableImages = images.filter((image): image is Media => Boolean(image && typeof image === 'object'))
  const slides = usableImages.length ? usableImages : []
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const timer = window.setInterval(
      () => setActiveIndex((current) => (current + 1) % slides.length),
      5000,
    )

    return () => window.clearInterval(timer)
  }, [slides.length])

  const show = (next: number) => {
    if (!slides.length) return
    setActiveIndex((next + slides.length) % slides.length)
  }

  return (
    <section className="hero">
      <div className="hero-media" aria-hidden>
        {slides.map((image, index) => (
          <div
            className="hero-slide"
            data-active={index === activeIndex}
            data-slide-id={`${image.id}-${index}`}
            data-testid="hero-slide"
            key={`${image.id}-${index}`}
          >
            <WebsiteImage fill media={image} priority={index === 0} sizes="100vw" type="large" />
          </div>
        ))}
      </div>
      <div className="hero-overlay" />
      <div className="hero-content container">
        <div className="eyebrow">{copy.home.heroKicker}</div>
        <h1>{title || copy.home.heroTitle}</h1>
        <p className="lead">{subtitle || copy.home.heroSubtitle}</p>
        <div className="hero-actions">
          <Link className="button" href={localePath(locale, '/contact')}>
            <IconUpload aria-hidden size={19} />
            {copy.actions.uploadDrawing}
          </Link>
          <Link className="button secondary" href={localePath(locale, '/projects')}>
            <IconBuildingSkyscraper aria-hidden size={19} />
            {copy.actions.allProjects}
          </Link>
        </div>
      </div>
      <div className="hero-controls container">
        <p>{copy.home.heroCaption}</p>
        <div className="slide-buttons">
          <button aria-label={copy.accessibility.previousSlide} className="icon-button" onClick={() => show(activeIndex - 1)} type="button">
            <IconChevronLeft aria-hidden size={20} />
          </button>
          <button aria-label={copy.accessibility.nextSlide} className="icon-button" onClick={() => show(activeIndex + 1)} type="button">
            <IconChevronRight aria-hidden size={20} />
          </button>
        </div>
      </div>
    </section>
  )
}
