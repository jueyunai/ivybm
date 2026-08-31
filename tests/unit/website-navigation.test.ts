import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SiteFooter } from '@/components/website/SiteFooter'
import { SiteHeader } from '@/components/website/SiteHeader'
import type { SiteSetting } from '@/payload-types'

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/products',
  useRouter: () => ({ push: vi.fn() }),
}))

afterEach(cleanup)

describe('SiteHeader navigation and CTA', () => {
  it('renders navigation tabs in the fixed order: Products -> Capabilities -> Projects -> For Professionals -> Knowledge -> News -> About', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const links = Array.from(nav.querySelectorAll('.nav-links a')).map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent,
    }))

    expect(links).toEqual([
      { href: '/en/products', text: 'Products' },
      { href: '/en/capabilities', text: 'Capabilities' },
      { href: '/en/projects', text: 'Projects' },
      { href: '/en/for-professionals', text: 'For Professionals' },
      { href: '/en/knowledge', text: 'Knowledge' },
      { href: '/en/news', text: 'News' },
      { href: '/en/about', text: 'About Us' },
    ])
  })

  it('renders Upload Drawing CTA button linking to /contact', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const cta = screen.getByRole('link', { name: /Upload Drawing/i })
    expect(cta.getAttribute('href')).toBe('/en/contact')
  })

  it('renders Arabic localized navigation in fixed order and Upload Drawing CTA', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'ar',
        siteName: 'IVYBM',
      }),
    )

    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })
    const links = Array.from(nav.querySelectorAll('.nav-links a')).map((a) => a.getAttribute('href'))

    expect(links).toEqual([
      '/ar/products',
      '/ar/capabilities',
      '/ar/projects',
      '/ar/for-professionals',
      '/ar/knowledge',
      '/ar/news',
      '/ar/about',
    ])

    const cta = screen.getByRole('link', { name: /رفع المخططات/i })
    expect(cta.getAttribute('href')).toBe('/ar/contact')
  })
})

describe('SiteFooter navigation', () => {
  it('renders navigation links and legal links', () => {
    const mockSettings = {
      contact: { address: 'Foshan, China', email: 'info@ivybm.com', phone: '+86 757 0000 0000' },
      siteDescription: 'Leading architectural facade panel manufacturer',
      siteName: 'IVYBM',
    } as unknown as SiteSetting

    render(
      React.createElement(SiteFooter, {
        locale: 'en',
        settings: mockSettings,
      }),
    )

    expect(screen.getByText('Quick Links')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Data Deletion' })).toBeDefined()
  })
})
