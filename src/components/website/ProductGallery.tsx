'use client'

import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import React, { useState } from 'react'

import { normalizeProductGallery } from '@/lib/product-gallery'
import type { Locale } from '@/lib/i18n'
import type { Media } from '@/payload-types'

import { WebsiteImage } from './WebsiteImage'

export { normalizeProductGallery }

const galleryCopy = {
  ar: {
    imagePosition: (current: number, total: number) => `الصورة ${current} من ${total}`,
    next: 'الصورة التالية',
    previous: 'الصورة السابقة',
    region: (productTitle: string) => `صور ${productTitle}`,
    view: (current: number, total: number, alt: string) =>
      `عرض الصورة ${current} من ${total}: ${alt}`,
  },
  en: {
    imagePosition: (current: number, total: number) => `Image ${current} of ${total}`,
    next: 'Next image',
    previous: 'Previous image',
    region: (productTitle: string) => `${productTitle} images`,
    view: (current: number, total: number, alt: string) =>
      `View image ${current} of ${total}: ${alt}`,
  },
} as const

export function ProductGallery({
  images,
  locale,
  productTitle,
}: {
  images: Media[]
  locale: Locale
  productTitle: string
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const copy = galleryCopy[locale]
  const total = images.length
  const activeIndex = Math.min(selectedIndex, Math.max(0, total - 1))
  const activeImage = images[activeIndex]
  const hasMultipleImages = total > 1
  const isRTL = locale === 'ar'

  if (!activeImage) return null

  const selectPrevious = () => setSelectedIndex((current) => (current - 1 + total) % total)
  const selectNext = () => setSelectedIndex((current) => (current + 1) % total)

  return (
    <section
      aria-label={copy.region(productTitle)}
      className="product-gallery"
      data-testid="product-gallery"
      onKeyDown={(event) => {
        if (!hasMultipleImages) return
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          if (isRTL) selectNext()
          else selectPrevious()
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          if (isRTL) selectPrevious()
          else selectNext()
        }
      }}
      role="region"
      tabIndex={hasMultipleImages ? 0 : undefined}
    >
      <div className="product-gallery-stage">
        <WebsiteImage
          className="product-gallery-main-image"
          media={activeImage}
          priority
          sizes="(max-width: 920px) 100vw, 50vw"
          type="large"
        />
        {hasMultipleImages ? (
          <>
            <button
              aria-label={copy.previous}
              className="product-gallery-control product-gallery-previous"
              onClick={selectPrevious}
              type="button"
            >
              {isRTL ? <IconChevronRight aria-hidden /> : <IconChevronLeft aria-hidden />}
            </button>
            <button
              aria-label={copy.next}
              className="product-gallery-control product-gallery-next"
              onClick={selectNext}
              type="button"
            >
              {isRTL ? <IconChevronLeft aria-hidden /> : <IconChevronRight aria-hidden />}
            </button>
          </>
        ) : null}
      </div>

      {hasMultipleImages ? (
        <>
          <p aria-live="polite" className="product-gallery-position">
            {copy.imagePosition(activeIndex + 1, total)}
          </p>
          <div className="product-gallery-thumbnails">
            {images.map((image, index) => (
              <button
                aria-label={copy.view(index + 1, total, image.alt)}
                aria-pressed={index === activeIndex}
                className="product-gallery-thumbnail"
                key={image.id ?? image.url ?? index}
                onClick={() => setSelectedIndex(index)}
                type="button"
              >
                <span aria-hidden="true" className="product-gallery-thumbnail-visual">
                  <WebsiteImage media={image} sizes="88px" type="thumbnail" />
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
