import fs from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

describe('SiteHeader navigation, brand logo, and CTA', () => {
  it('renders brand logo referencing /brand/ivybm-logo-trimmed.png with proper attributes in Header', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const logo = screen.getByRole('img', { name: 'IVYBM' })
    expect(logo).toBeDefined()
    expect(logo.getAttribute('src')).toContain('ivybm-logo-trimmed.png')
  })

  it('allows brand images in next.config.ts localPatterns', () => {
    const nextConfig = fs.readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')
    expect(nextConfig).toContain("pathname: '/brand/**'")
  })

  it('renders utility topbar strip above navigation in English', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    expect(screen.getByText('Architectural aluminum for complex facade projects')).toBeDefined()
    expect(screen.getByText('Engineering · Fabrication · QC · Global Delivery')).toBeDefined()
  })

  it('renders navigation tabs in the fixed order: Products -> Capabilities -> Projects -> For Professionals -> Knowledge -> News -> About (About instead of About Us)', () => {
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
      { href: '/en/about', text: 'About' },
    ])
  })

  it('renders Upload Drawing CTA button linking to /contact and never compressed', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const cta = within(nav).getByRole('link', { name: /Upload Drawing/i })
    expect(cta.getAttribute('href')).toBe('/en/contact')
    expect(cta.classList.contains('nav-quote')).toBe(true)
  })

  it('renders Arabic localized navigation in fixed order with من نحن and Upload Drawing CTA', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'ar',
        siteName: 'IVYBM',
      }),
    )

    expect(screen.getByText('ألمنيوم معماري لمشاريع الواجهات المعقدة')).toBeDefined()
    expect(screen.getByText('الهندسة · التصنيع · ضبط الجودة · التسليم الدولي')).toBeDefined()

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

    expect(within(nav).getByRole('link', { name: 'من نحن' })).toBeDefined()
    const cta = within(nav).getByRole('link', { name: /رفع المخططات/i })
    expect(cta.getAttribute('href')).toBe('/ar/contact')
  })

  it('toggles mobile navigation drawer on menu button click', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const mobileNav = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(mobileNav.getAttribute('data-open')).toBe('false')

    const menuButton = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(menuButton)
    expect(mobileNav.getAttribute('data-open')).toBe('true')

    fireEvent.click(menuButton)
    expect(mobileNav.getAttribute('data-open')).toBe('false')
  })

  it('ensures mobile-navigation is positioned relative to header bottom instead of hardcoded 82px fixed top', () => {
    const cssPath = path.resolve(process.cwd(), 'src/app/(frontend)/website.css')
    const cssContent = fs.readFileSync(cssPath, 'utf8')

    // Verify mobile-navigation uses dynamic positioning relative to header
    expect(cssContent).toMatch(/\.mobile-navigation\s*\{[^}]*position:\s*absolute/u)
    expect(cssContent).toMatch(/\.mobile-navigation\s*\{[^}]*top:\s*calc\(100%/u)
    expect(cssContent).not.toMatch(/\.mobile-navigation\s*\{[^}]*top:\s*82px/u)
  })
})

describe('SiteFooter brand logo and navigation', () => {
  it('renders brand logo referencing /brand/ivybm-logo-trimmed.png in Footer', () => {
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

    const logo = screen.getByRole('img', { name: 'IVYBM' })
    expect(logo).toBeDefined()
    expect(logo.getAttribute('src')).toContain('ivybm-logo-trimmed.png')
    expect(screen.getByText('Quick Links')).toBeDefined()
    expect(screen.getByRole('link', { name: 'About' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Data Deletion' })).toBeDefined()
  })
})
