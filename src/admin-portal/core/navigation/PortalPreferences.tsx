'use client'

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { PortalLocale } from '../i18n/types'

export type PortalTheme = 'dark' | 'light' | 'system'

interface PortalPreferences {
  locale: PortalLocale
  reducedMotion: boolean
  theme: PortalTheme
}

interface PortalPreferencesContextValue extends PortalPreferences {
  setLocale: (locale: PortalLocale) => void
  setReducedMotion: (reducedMotion: boolean) => void
  setTheme: (theme: PortalTheme) => void
}

const STORAGE_KEY = 'ivybm.portal.preferences'
const DEFAULT_PREFERENCES: PortalPreferences = {
  locale: 'zh',
  reducedMotion: false,
  theme: 'light',
}

const PortalPreferencesContext = createContext<PortalPreferencesContextValue | null>(null)

const readStoredPreferences = (): PortalPreferences => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<PortalPreferences>
    return {
      locale: parsed.locale === 'en' ? 'en' : 'zh',
      reducedMotion: parsed.reducedMotion === true,
      theme: ['dark', 'light', 'system'].includes(parsed.theme ?? '')
        ? (parsed.theme as PortalTheme)
        : 'light',
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

const applyPreferences = (preferences: PortalPreferences): void => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  document.documentElement.lang = preferences.locale === 'en' ? 'en' : 'zh-CN'
  document.documentElement.toggleAttribute('data-portal-reduced-motion', preferences.reducedMotion)

  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolvedTheme =
    preferences.theme === 'system' ? (prefersDark ? 'dark' : 'light') : preferences.theme
  document.documentElement.dataset.portalTheme = resolvedTheme
  document.querySelector<HTMLElement>('.portal-shell')?.setAttribute('data-theme', resolvedTheme)
}

export function PortalPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<PortalPreferences>(DEFAULT_PREFERENCES)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPreferences(readStoredPreferences())
      setHydrated(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!hydrated) return

    applyPreferences(preferences)

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null
    const applyTheme = () => {
      const resolvedTheme =
        preferences.theme === 'system' && media
          ? media.matches
            ? 'dark'
            : 'light'
          : preferences.theme === 'system'
            ? 'light'
            : preferences.theme
      document.documentElement.dataset.portalTheme = resolvedTheme
      document.querySelector<HTMLElement>('.portal-shell')?.setAttribute('data-theme', resolvedTheme)
    }

    applyTheme()
    if (preferences.theme === 'system') media?.addEventListener('change', applyTheme)

    return () => media?.removeEventListener('change', applyTheme)
  }, [hydrated, preferences])

  const value = useMemo<PortalPreferencesContextValue>(
    () => ({
      ...preferences,
      setLocale: (locale) => {
        const next = { ...preferences, locale }
        applyPreferences(next)
        setPreferences(next)
      },
      setReducedMotion: (reducedMotion) => {
        const next = { ...preferences, reducedMotion }
        applyPreferences(next)
        setPreferences(next)
      },
      setTheme: (theme) => {
        const next = { ...preferences, theme }
        applyPreferences(next)
        setPreferences(next)
      },
    }),
    [preferences],
  )

  return (
    <PortalPreferencesContext.Provider value={value}>
      {children}
    </PortalPreferencesContext.Provider>
  )
}

export const usePortalPreferences = (): PortalPreferencesContextValue => {
  const context = useContext(PortalPreferencesContext)
  if (!context) throw new Error('Portal preferences must be used within PortalPreferencesProvider')
  return context
}
