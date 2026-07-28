'use client'

import { IconArrowsMaximize, IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { normalizeProductGallery } from '@/lib/product-gallery'
import type { Locale } from '@/lib/i18n'
import type { Media } from '@/payload-types'

import { WebsiteImage } from './WebsiteImage'

export { normalizeProductGallery }

const galleryCopy = {
  ar: {
    close: 'إغلاق عرض الصور بالحجم الكامل',
    dialog: (productTitle: string) => `صور ${productTitle} بالحجم الكامل`,
    open: (alt: string) => `فتح الصورة بالحجم الكامل: ${alt}`,
    openShort: 'عرض بالحجم الكامل',
    imagePosition: (current: number, total: number) => `الصورة ${current} من ${total}`,
    next: 'الصورة التالية',
    previous: 'الصورة السابقة',
    region: (productTitle: string) => `صور ${productTitle}`,
    view: (current: number, total: number, alt: string) =>
      `عرض الصورة ${current} من ${total}: ${alt}`,
  },
  en: {
    close: 'Close full-size image viewer',
    dialog: (productTitle: string) => `${productTitle} full-size images`,
    open: (alt: string) => `Open full-size image: ${alt}`,
    openShort: 'View full size',
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
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const copy = galleryCopy[locale]
  const total = images.length
  const activeIndex = Math.min(selectedIndex, Math.max(0, total - 1))
  const activeImage = images[activeIndex]
  const hasMultipleImages = total > 1
  const isRTL = locale === 'ar'
  const imageAlt = (image: Media, index: number) =>
    locale === 'ar' ? `${productTitle} — ${copy.imagePosition(index + 1, total)}` : image.alt

  const selectPrevious = useCallback(
    () => setSelectedIndex((current) => (current - 1 + total) % total),
    [total],
  )
  const selectNext = useCallback(
    () => setSelectedIndex((current) => (current + 1) % total),
    [total],
  )

  useEffect(() => {
    if (!isLightboxOpen) return

    const previousOverflow = document.body.style.overflow
    const trigger = openButtonRef.current
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsLightboxOpen(false)
      }
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
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      trigger?.focus()
    }
  }, [hasMultipleImages, isLightboxOpen, isRTL, selectNext, selectPrevious])

  if (!activeImage) return null

  const trapLightboxFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <section
      aria-label={copy.region(productTitle)}
      className="product-gallery"
      data-testid="product-gallery"
      onKeyDown={(event) => {
        if (!hasMultipleImages || isLightboxOpen) return
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
        <button
          aria-label={copy.open(imageAlt(activeImage, activeIndex))}
          className="product-gallery-open"
          onClick={() => setIsLightboxOpen(true)}
          ref={openButtonRef}
          type="button"
        >
          <WebsiteImage
            alt={imageAlt(activeImage, activeIndex)}
            className="product-gallery-main-image"
            fill
            media={activeImage}
            priority
            sizes="(max-width: 920px) 100vw, 50vw"
            type="original"
          />
          <span className="product-gallery-open-label">
            <IconArrowsMaximize aria-hidden size={18} />
            {copy.openShort}
          </span>
        </button>
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
                aria-label={copy.view(index + 1, total, imageAlt(image, index))}
                aria-pressed={index === activeIndex}
                className="product-gallery-thumbnail"
                key={image.id ?? image.url ?? index}
                onClick={() => setSelectedIndex(index)}
                type="button"
              >
                <span aria-hidden="true" className="product-gallery-thumbnail-visual">
                  <WebsiteImage
                    alt={imageAlt(image, index)}
                    media={image}
                    sizes="88px"
                    type="original"
                  />
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {isLightboxOpen ? (
        <div
          className="product-gallery-lightbox"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsLightboxOpen(false)
          }}
        >
          <div
            aria-label={copy.dialog(productTitle)}
            aria-modal="true"
            className="product-gallery-lightbox-dialog"
            onKeyDown={trapLightboxFocus}
            role="dialog"
          >
            <div className="product-gallery-lightbox-toolbar">
              <p aria-live="polite">{copy.imagePosition(activeIndex + 1, total)}</p>
              <button
                aria-label={copy.close}
                className="product-gallery-lightbox-close"
                onClick={() => setIsLightboxOpen(false)}
                ref={closeButtonRef}
                type="button"
              >
                <IconX aria-hidden size={24} />
              </button>
            </div>
            <div className="product-gallery-lightbox-stage">
              <WebsiteImage
                alt={imageAlt(activeImage, activeIndex)}
                className="product-gallery-lightbox-image"
                fill
                media={activeImage}
                sizes="100vw"
                type="original"
              />
              {hasMultipleImages ? (
                <>
                  <button
                    aria-label={copy.previous}
                    className="product-gallery-control product-gallery-lightbox-previous"
                    onClick={selectPrevious}
                    type="button"
                  >
                    {isRTL ? <IconChevronRight aria-hidden /> : <IconChevronLeft aria-hidden />}
                  </button>
                  <button
                    aria-label={copy.next}
                    className="product-gallery-control product-gallery-lightbox-next"
                    onClick={selectNext}
                    type="button"
                  >
                    {isRTL ? <IconChevronLeft aria-hidden /> : <IconChevronRight aria-hidden />}
                  </button>
                </>
              ) : null}
            </div>
            {hasMultipleImages ? (
              <div className="product-gallery-lightbox-thumbnails">
                {images.map((image, index) => (
                  <button
                    aria-label={copy.view(index + 1, total, imageAlt(image, index))}
                    aria-pressed={index === activeIndex}
                    className="product-gallery-thumbnail"
                    key={`lightbox-${image.id ?? image.url ?? index}`}
                    onClick={() => setSelectedIndex(index)}
                    type="button"
                  >
                    <span aria-hidden="true" className="product-gallery-thumbnail-visual">
                      <WebsiteImage
                        alt={imageAlt(image, index)}
                        media={image}
                        sizes="88px"
                        type="original"
                      />
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
