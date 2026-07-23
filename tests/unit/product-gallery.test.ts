import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { normalizeProductGallery, ProductGallery } from '@/components/website/ProductGallery'
import type { Media } from '@/payload-types'

const image = (id: number, alt: string, url = `/media/${id}.jpg`): Media =>
  ({
    alt,
    createdAt: '2026-07-23T00:00:00.000Z',
    filename: `${id}.jpg`,
    filesize: 1000,
    height: 900,
    id,
    isPublic: true,
    mimeType: 'image/jpeg',
    source: 'Customer-owned product media',
    updatedAt: '2026-07-23T00:00:00.000Z',
    url,
    width: 1200,
  }) as Media

afterEach(cleanup)

describe('normalizeProductGallery', () => {
  it('keeps the cover first and removes duplicate, unresolved, and non-image media', () => {
    const cover = image(1, 'Cover')
    const detail = image(2, 'Detail')
    const pdf = { ...image(3, 'PDF'), mimeType: 'application/pdf' }

    expect(normalizeProductGallery(cover, [detail, cover, 42, pdf])).toEqual([cover, detail])
  })

  it('falls back to one image when no gallery is configured', () => {
    const cover = image(1, 'Cover')

    expect(normalizeProductGallery(cover, undefined)).toEqual([cover])
  })
})

describe('ProductGallery', () => {
  it('switches the selected image and exposes a concise position status', () => {
    render(
      React.createElement(ProductGallery, {
        images: [image(1, 'Front view'), image(2, 'Side view')],
        locale: 'en',
        productTitle: 'Solid Aluminum Panel',
      }),
    )

    expect(screen.getByRole('img', { name: 'Front view' })).not.toBeNull()
    expect(screen.getByText('Image 1 of 2')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'View image 2 of 2: Side view' }))

    expect(screen.getByRole('img', { name: 'Side view' })).not.toBeNull()
    expect(screen.getByText('Image 2 of 2')).not.toBeNull()
  })

  it('uses visual arrow direction for Arabic keyboard navigation', () => {
    render(
      React.createElement(ProductGallery, {
        images: [image(1, 'الأولى'), image(2, 'الثانية')],
        locale: 'ar',
        productTitle: 'ألواح ألمنيوم',
      }),
    )

    fireEvent.keyDown(screen.getByRole('region', { name: 'صور ألواح ألمنيوم' }), {
      key: 'ArrowLeft',
    })

    expect(screen.getByRole('img', { name: 'الثانية' })).not.toBeNull()
    expect(screen.getByText('الصورة 2 من 2')).not.toBeNull()
  })

  it('does not render navigation controls for a single image', () => {
    render(
      React.createElement(ProductGallery, {
        images: [image(1, 'Only image')],
        locale: 'en',
        productTitle: 'Solid Aluminum Panel',
      }),
    )

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/Image 1 of 1/)).toBeNull()
  })
})
