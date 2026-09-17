import fs from 'node:fs'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SiteFooter } from '@/components/website/SiteFooter'
import { SiteHeader } from '@/components/website/SiteHeader'
import type { SiteSetting } from '@/payload-types'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/products',
  useRouter: () => ({ push: pushMock }),
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
    const frame = logo.closest('.brand-logo-frame')
    expect(frame).not.toBeNull()
  })

  it('ensures mobile CSS does not hide the brand logo or logo frame on narrow screens', () => {
    const cssPath = path.resolve(process.cwd(), 'src/app/(frontend)/website.css')
    const cssContent = fs.readFileSync(cssPath, 'utf8')

    // Ensure the legacy rule that hides the last-child span in .brand is removed
    expect(cssContent).not.toMatch(/\.brand\s*>\s*span:last-child/u)
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

  it('toggles mobile navigation drawer on menu button click with accessible controls, CTAs, and body scroll lock', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
        whatsapp: '+8618520040515',
      }),
    )

    const mobileNav = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(mobileNav.getAttribute('data-open')).toBe('false')
    expect(mobileNav.getAttribute('id')).toBe('mobile-navigation-drawer')

    const menuButton = screen.getByRole('button', { name: 'Menu' })
    expect(menuButton.getAttribute('aria-controls')).toBe('mobile-navigation-drawer')
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(menuButton)
    expect(mobileNav.getAttribute('data-open')).toBe('true')
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')

    // Verify CTAs in mobile navigation
    const drawer = screen.getByRole('navigation', { name: 'Mobile navigation' })
    const drawerUploadCta = within(drawer).getByRole('link', { name: /Upload Drawing/i })
    expect(drawerUploadCta.getAttribute('href')).toBe('/en/contact')
    const whatsappCta = within(drawer).getByRole('link', { name: /WhatsApp/i })
    expect(whatsappCta.getAttribute('href')).toBe('https://wa.me/8618520040515')

    // Verify backdrop exists and clicking it closes the menu
    const backdrop = document.querySelector('.mobile-nav-backdrop')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(mobileNav.getAttribute('data-open')).toBe('false')
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.style.overflow).toBe('')
  })

  it('closes mobile menu on Escape key and restores focus to menu button', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const menuButton = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(menuButton)
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(mobileNav.getAttribute('data-open')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mobileNav.getAttribute('data-open')).toBe('false')
    expect(document.activeElement).toBe(menuButton)
  })

  it('maintains mutual exclusion between language dropdown and mobile navigation drawer', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const menuButton = screen.getByRole('button', { name: 'Menu' })
    const langButton = screen.getByRole('button', { name: 'Language' })
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile navigation' })

    // Open mobile menu
    fireEvent.click(menuButton)
    expect(mobileNav.getAttribute('data-open')).toBe('true')
    expect(langButton.getAttribute('aria-expanded')).toBe('false')

    // Opening language menu closes mobile menu
    fireEvent.click(langButton)
    expect(mobileNav.getAttribute('data-open')).toBe('false')
    expect(langButton.getAttribute('aria-expanded')).toBe('true')

    // Opening mobile menu closes language menu
    fireEvent.click(menuButton)
    expect(mobileNav.getAttribute('data-open')).toBe('true')
    expect(langButton.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes mobile navigation drawer when viewport expands beyond 1100px mobile breakpoint', () => {
    let mediaListener: ((e: MediaQueryListEvent) => void) | undefined
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') mediaListener = handler
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    try {
      render(
        React.createElement(SiteHeader, {
          locale: 'en',
          siteName: 'IVYBM',
        }),
      )

      const menuButton = screen.getByRole('button', { name: 'Menu' })
      const mobileNav = screen.getByRole('navigation', { name: 'Mobile navigation' })

      fireEvent.click(menuButton)
      expect(mobileNav.getAttribute('data-open')).toBe('true')
      expect(document.body.style.overflow).toBe('hidden')

      // Viewport expands beyond 1100px (e.g. tablet rotated to landscape)
      expect(mediaListener).toBeDefined()
      act(() => {
        mediaListener!({ matches: false } as MediaQueryListEvent)
      })

      expect(mobileNav.getAttribute('data-open')).toBe('false')
      expect(document.body.style.overflow).toBe('')
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('ensures mobile-navigation is positioned relative to header bottom instead of hardcoded 82px fixed top', () => {
    const cssPath = path.resolve(process.cwd(), 'src/app/(frontend)/website.css')
    const cssContent = fs.readFileSync(cssPath, 'utf8')

    // Verify mobile-navigation uses dynamic positioning relative to header
    expect(cssContent).toMatch(/\.mobile-navigation\s*\{[^}]*position:\s*absolute/u)
    expect(cssContent).toMatch(/\.mobile-navigation\s*\{[^}]*top:\s*calc\(100%/u)
    expect(cssContent).not.toMatch(/\.mobile-navigation\s*\{[^}]*top:\s*82px/u)
    expect(cssContent).toMatch(/\.site-header\[data-menu-open='true'\]\s*\{[^}]*z-index:\s*70/u)
    expect(cssContent).toMatch(/\.site-header\[data-menu-open='true'\]\s*\{[^}]*backdrop-filter:\s*none/u)
    expect(cssContent).toMatch(/\.mobile-nav-backdrop\s*\{[^}]*touch-action:\s*none/u)
  })

  it('renders custom language menu button with accessible attributes and label', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const langBtn = screen.getByRole('button', { name: 'Language' })
    expect(langBtn).toBeDefined()
    expect(langBtn.getAttribute('aria-haspopup')).toBe('listbox')
    expect(langBtn.getAttribute('aria-expanded')).toBe('false')
    expect(langBtn.textContent).toContain('EN')
  })

  it('toggles custom language dropdown listbox and switches locale on selection with EN/AR visible items', () => {
    pushMock.mockClear()
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const langBtn = screen.getByRole('button', { name: 'Language' })
    fireEvent.click(langBtn)

    expect(langBtn.getAttribute('aria-expanded')).toBe('true')
    const listbox = screen.getByRole('listbox', { name: 'Language' })
    expect(listbox).toBeDefined()

    const options = screen.getAllByRole('option')
    expect(options.length).toBe(2)
    expect(options[0].textContent).toContain('EN')
    expect(options[0].getAttribute('aria-label')).toBe('English')
    expect(options[0].getAttribute('aria-selected')).toBe('true')

    expect(options[1].textContent).toContain('AR')
    expect(options[1].getAttribute('aria-label')).toBe('العربية')
    expect(options[1].getAttribute('aria-selected')).toBe('false')

    // Click Arabic option
    fireEvent.click(options[1])
    expect(pushMock).toHaveBeenCalledWith('/ar/products')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('supports keyboard navigation on language menu (ArrowDown, Enter, Escape)', () => {
    pushMock.mockClear()
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const langBtn = screen.getByRole('button', { name: 'Language' })

    // Open with Enter key
    fireEvent.keyDown(langBtn, { key: 'Enter' })
    expect(langBtn.getAttribute('aria-expanded')).toBe('true')

    const options = screen.getAllByRole('option')

    // Navigate to Arabic option with ArrowDown and select with Enter
    fireEvent.keyDown(options[0], { key: 'ArrowDown' })
    fireEvent.keyDown(options[1], { key: 'Enter' })
    expect(pushMock).toHaveBeenCalledWith('/ar/products')

    // Re-open and close with Escape
    fireEvent.click(langBtn)
    expect(screen.getByRole('listbox')).toBeDefined()
    const openOptions = screen.getAllByRole('option')
    fireEvent.keyDown(openOptions[0], { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes custom language menu when clicking outside', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'en',
        siteName: 'IVYBM',
      }),
    )

    const langBtn = screen.getByRole('button', { name: 'Language' })
    fireEvent.click(langBtn)
    expect(screen.getByRole('listbox')).toBeDefined()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders Arabic custom language menu with Arabic accessibility label and selection indicator', () => {
    render(
      React.createElement(SiteHeader, {
        locale: 'ar',
        siteName: 'IVYBM',
      }),
    )

    const langBtn = screen.getByRole('button', { name: 'اللغة' })
    expect(langBtn).toBeDefined()
    expect(langBtn.textContent).toContain('AR')

    fireEvent.click(langBtn)
    const options = screen.getAllByRole('option')
    expect(options[1].getAttribute('aria-selected')).toBe('true')
  })

  it('ensures custom language dropdown in website.css has standard 40px height, dark panel background, and RTL left alignment', () => {
    const cssPath = path.resolve(process.cwd(), 'src/app/(frontend)/website.css')
    const cssContent = fs.readFileSync(cssPath, 'utf8')

    expect(cssContent).toMatch(/\.language-dropdown-toggle\s*\{[^}]*height:\s*40px/u)
    expect(cssContent).toMatch(/\.language-dropdown-toggle:focus-visible\s*\{[^}]*outline:\s*2px/u)
    expect(cssContent).toMatch(/\.language-dropdown-menu\s*\{[^}]*background:\s*#0f1c2d/u)
    expect(cssContent).toMatch(/html\[dir='rtl'\]\s+\.language-dropdown-menu\s*\{[^}]*left:\s*0/u)
    expect(cssContent).toMatch(/\.language-dropdown-item\.selected\s*\{[^}]*background:/u)
  })
})

describe('SiteFooter brand logo, line-height typography and navigation', () => {
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

  it('ensures footer text and contact info have readable line-height and paragraph spacing', () => {
    const cssPath = path.resolve(process.cwd(), 'src/app/(frontend)/website.css')
    const cssContent = fs.readFileSync(cssPath, 'utf8')

    expect(cssContent).toMatch(/\.footer-grid\s+p\s*\{[^}]*line-height:\s*1\.65/u)
    expect(cssContent).toMatch(/\.footer-grid\s+p\.pre-line\s*\{[^}]*line-height:\s*1\.7/u)
    expect(cssContent).toMatch(/\.form-actions\s*\{[^}]*justify-content:\s*flex-end/u)
  })
})
