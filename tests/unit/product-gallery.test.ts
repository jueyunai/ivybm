import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    sizes: {
      large: {
        filename: `${id}-large.jpg`,
        filesize: 900,
        height: 800,
        mimeType: 'image/jpeg',
        url: `/media/${id}-large.jpg`,
        width: 1067,
      },
      thumbnail: {
        filename: `${id}-thumbnail.jpg`,
        filesize: 400,
        height: 300,
        mimeType: 'image/jpeg',
        url: `/media/${id}-thumbnail.jpg`,
        width: 400,
      },
    },
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
  it('uses uncropped original media for the main image and thumbnails', () => {
    const { container } = render(
      React.createElement(ProductGallery, {
        images: [image(1, 'Front view'), image(2, 'Side view')],
        locale: 'en',
        productTitle: 'Solid Aluminum Panel',
      }),
    )

    expect(container.querySelector('.product-gallery-main-image')?.getAttribute('src')).toContain(
      '%2Fmedia%2F1.jpg',
    )
    expect(container.querySelector('.product-gallery-thumbnail img')?.getAttribute('src')).toContain(
      '%2Fmedia%2F1.jpg',
    )
  })

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

    expect(screen.getByRole('img', { name: 'ألواح ألمنيوم — الصورة 2 من 2' })).not.toBeNull()
    expect(screen.getByText('الصورة 2 من 2')).not.toBeNull()
  })

  it('opens a full-size dialog, supports keyboard navigation, and restores focus', () => {
    render(
      React.createElement(ProductGallery, {
        images: [image(1, 'Front view'), image(2, 'Side view')],
        locale: 'en',
        productTitle: 'Solid Aluminum Panel',
      }),
    )

    const openButton = screen.getByRole('button', {
      name: 'Open full-size image: Front view',
    })
    fireEvent.click(openButton)

    const dialog = screen.getByRole('dialog', { name: 'Solid Aluminum Panel full-size images' })
    expect(dialog).not.toBeNull()
    expect(within(dialog).getByText('Image 1 of 2')).not.toBeNull()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Close full-size image viewer' }), {
      key: 'ArrowRight',
    })
    expect(within(dialog).getByRole('img', { name: 'Side view' })).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(openButton)
  })

  it('uses localized image labels in the Arabic gallery', () => {
    render(
      React.createElement(ProductGallery, {
        images: [image(1, 'English source alt')],
        locale: 'ar',
        productTitle: 'ألواح ألمنيوم',
      }),
    )

    expect(screen.getByRole('img', { name: 'ألواح ألمنيوم — الصورة 1 من 1' })).not.toBeNull()
    expect(screen.queryByRole('img', { name: 'English source alt' })).toBeNull()
  })

  it('does not render navigation controls for a single image', () => {
    render(
      React.createElement(ProductGallery, {
        images: [image(1, 'Only image')],
        locale: 'en',
        productTitle: 'Solid Aluminum Panel',
      }),
    )

    expect(screen.getByRole('button', { name: 'Open full-size image: Only image' })).not.toBeNull()
    expect(screen.queryByText(/Image 1 of 1/)).toBeNull()
  })
})
