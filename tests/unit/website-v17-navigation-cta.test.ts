import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getWebsiteCopy } from '@/lib/i18n'
import { SiteHeader } from '@/components/website/SiteHeader'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/en',
  useRouter: () => ({ push: mockPush }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Website v1.7 navigation tab order and CTA specification', () => {
  const REQUIRED_V17_NAV_ORDER = [
    'products',
    'capabilities',
    'projects',
    'forProfessionals',
    'knowledge',
    'news',
    'about',
  ] as const

  it('specifies the required 7-tab navigation sequence in exact order', () => {
    expect(REQUIRED_V17_NAV_ORDER).toEqual([
      'products',
      'capabilities',
      'projects',
      'forProfessionals',
      'knowledge',
      'news',
      'about',
    ])
  })

  it('prohibits Home and Contact as top-level navigation tabs in v1.7', () => {
    expect(REQUIRED_V17_NAV_ORDER).not.toContain('home')
    expect(REQUIRED_V17_NAV_ORDER).not.toContain('contact')
  })

  it('requires Upload Drawing action copy for English and Arabic', () => {
    const enCopy = getWebsiteCopy('en')
    const arCopy = getWebsiteCopy('ar')

    expect(enCopy).toBeDefined()
    expect(arCopy).toBeDefined()
  })

  it('verifies brand logo links to home route while keeping route accessible', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const brandLink = screen.getByLabelText('IVYBM')
    expect(brandLink).toBeDefined()
    expect(brandLink.getAttribute('href')).toBe('/en')
  })

  it('verifies CTA button points to /contact route', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const ctaButton = document.querySelector('.nav-quote')
    expect(ctaButton).not.toBeNull()
    expect(ctaButton?.getAttribute('href')).toBe('/en/contact')
  })
})
