'use client'

import {
  IconCheck,
  IconChevronDown,
  IconMenu2,
  IconMessageCircle,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'

import {
  localePath,
  type Locale,
  replacePathLocale,
} from '@/lib/i18n'
import { getWebsiteV17Copy } from '@/lib/website-i18n'

const navItems = [
  ['products', '/products'],
  ['capabilities', '/capabilities'],
  ['projects', '/projects'],
  ['forProfessionals', '/for-professionals'],
  ['knowledge', '/knowledge'],
  ['news', '/news'],
  ['about', '/about'],
] as const

const languageOptions: { code: Locale; label: string; name: string }[] = [
  { code: 'en', label: 'English', name: 'EN' },
  { code: 'ar', label: 'العربية', name: 'AR' },
]

export function SiteHeader({
  locale,
  siteName,
  whatsapp,
}: {
  locale: Locale
  siteName: string
  whatsapp?: null | string
}) {
  const copy = getWebsiteV17Copy(locale)
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const langDropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])

  const whatsappHref = whatsapp
    ? whatsapp.startsWith('http')
      ? whatsapp
      : `https://wa.me/${whatsapp.replace(/\D/g, '')}`
    : undefined

  // Close dropdown on click outside
  useEffect(() => {
    if (!langOpen) return
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(event.target as Node)) {
        setLangOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [langOpen])

  const handleSelectLocale = (targetLocale: Locale) => {
    setLangOpen(false)
    if (targetLocale !== locale) {
      router.push(replacePathLocale(pathname, targetLocale))
    }
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setLangOpen(true)
      const activeIdx = languageOptions.findIndex((opt) => opt.code === locale)
      const targetIdx = activeIdx >= 0 ? activeIdx : 0
      setTimeout(() => {
        itemRefs.current[targetIdx]?.focus()
      }, 10)
    } else if (event.key === 'Escape' && langOpen) {
      event.preventDefault()
      setLangOpen(false)
    }
  }

  const handleItemKeyDown = (
    event: React.KeyboardEvent<HTMLLIElement>,
    index: number,
    optCode: Locale,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = (index + 1) % languageOptions.length
      itemRefs.current[nextIndex]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIndex = (index - 1 + languageOptions.length) % languageOptions.length
      itemRefs.current[prevIndex]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelectLocale(optCode)
      triggerRef.current?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setLangOpen(false)
      triggerRef.current?.focus()
    } else if (event.key === 'Tab') {
      setLangOpen(false)
    }
  }

  const currentOption = languageOptions.find((opt) => opt.code === locale) || languageOptions[0]

  return (
    <header className="site-header">
      {/* Utility Topbar Strip */}
      <div className="utility-strip" data-testid="utility-strip">
        <div className="container utility-strip-inner">
          <span>{copy.home.utilityLeft}</span>
          <span className="utility-strip-badge">{copy.home.utilityRight}</span>
        </div>
      </div>

      <nav aria-label={copy.accessibility.mainNavigation} className="nav-shell">
        <Link aria-label={siteName} className="brand" href={localePath(locale)}>
          <span className="brand-logo-frame">
            <Image
              alt={siteName}
              className="brand-logo header-brand-logo"
              height={32}
              priority
              src="/brand/ivybm-logo-trimmed.png"
              width={104}
            />
          </span>
        </Link>

        <div className="nav-links" data-open={menuOpen}>
          {navItems.map(([key, route]) => {
            const href = localePath(locale, route)
            const active = pathname === href || pathname.startsWith(`${href}/`)

            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={active ? 'active' : undefined}
                href={href}
                key={key}
                onClick={() => setMenuOpen(false)}
              >
                {copy.navigation[key as keyof typeof copy.navigation]}
              </Link>
            )
          })}
        </div>

        <div className="nav-actions">
          <div className="language-dropdown" ref={langDropdownRef}>
            <button
              aria-controls="language-menu-list"
              aria-expanded={langOpen}
              aria-haspopup="listbox"
              aria-label={copy.accessibility.language}
              className="language-dropdown-toggle language-select"
              id="language-menu-button"
              onClick={() => setLangOpen((prev) => !prev)}
              onKeyDown={handleTriggerKeyDown}
              ref={triggerRef}
              type="button"
            >
              <span className="language-dropdown-label">{currentOption.name}</span>
              <IconChevronDown
                aria-hidden
                className={`language-dropdown-chevron ${langOpen ? 'open' : ''}`}
                size={14}
                stroke={2.2}
              />
            </button>
            {langOpen ? (
              <ul
                aria-label={copy.accessibility.language}
                aria-labelledby="language-menu-button"
                className="language-dropdown-menu"
                id="language-menu-list"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setLangOpen(false);
                    triggerRef.current?.focus();
                  } else if (e.key === "Tab") {
                    setLangOpen(false);
                  }
                }}
                role="listbox"
                tabIndex={-1}
              >
                {languageOptions.map((opt, index) => {
                  const isSelected = locale === opt.code
                  return (
                    <li
                      aria-label={opt.label}
                      aria-selected={isSelected}
                      className={`language-dropdown-item ${isSelected ? 'selected' : ''}`}
                      key={opt.code}
                      onClick={() => handleSelectLocale(opt.code)}
                      onKeyDown={(e) => handleItemKeyDown(e, index, opt.code)}
                      ref={(el) => {
                        itemRefs.current[index] = el
                      }}
                      role="option"
                      tabIndex={0}
                    >
                      <span className="language-item-name">{opt.name}</span>
                      {isSelected ? (
                        <IconCheck aria-hidden className="language-item-check" size={15} stroke={2.5} />
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>

          {whatsappHref ? (
            <a
              aria-label={copy.accessibility.whatsapp}
              className="icon-button"
              href={whatsappHref}
              rel="noreferrer"
              target="_blank"
            >
              <IconMessageCircle aria-hidden size={20} stroke={1.8} />
            </a>
          ) : null}
          <Link className="button nav-quote" href={localePath(locale, '/contact')}>
            <IconUpload aria-hidden size={19} stroke={1.8} />
            {copy.actions.uploadDrawing}
          </Link>
          <button
            aria-expanded={menuOpen}
            aria-label={copy.accessibility.menu}
            className="icon-button menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            {menuOpen ? <IconX aria-hidden size={21} /> : <IconMenu2 aria-hidden size={21} />}
          </button>
        </div>
      </nav>
      <nav aria-label={copy.accessibility.mobileNavigation} className="mobile-navigation" data-open={menuOpen}>
        {navItems.map(([key, route]) => (
          <Link href={localePath(locale, route)} key={key} onClick={() => setMenuOpen(false)}>
            {copy.navigation[key as keyof typeof copy.navigation]}
          </Link>
        ))}
      </nav>
    </header>
  )
}
