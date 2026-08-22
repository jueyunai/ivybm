'use client'

import { useState } from 'react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { Button, StatusBadge, Surface } from '@/admin-portal/core/ui'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'

import type { PortalSiteSettingsEditor } from './getPortalSettingsSummary'

type SiteLocale = 'ar' | 'en'

type FormState = PortalSiteSettingsEditor['locales'] & {
  contact: PortalSiteSettingsEditor['contact']
}

const cloneSettings = (settings: PortalSiteSettingsEditor): FormState => ({
  ar: { ...settings.locales.ar },
  contact: { ...settings.contact },
  en: { ...settings.locales.en },
})

export function SiteSettingsEditor({
  initialSettings,
}: {
  initialSettings: PortalSiteSettingsEditor
}) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale)
  const [activeLocale, setActiveLocale] = useState<SiteLocale>('en')
  const [form, setForm] = useState(() => cloneSettings(initialSettings))
  const [updatedAt, setUpdatedAt] = useState(initialSettings.updatedAt)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<'error' | 'saved' | null>(null)

  const updateLocale = (field: 'siteDescription' | 'siteName', value: string) => {
    setForm((current) => ({
      ...current,
      [activeLocale]: { ...current[activeLocale], [field]: value },
    }))
  }

  const save = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const response = await fetch('/api/portal/settings/site', {
        body: JSON.stringify({ ...form, updatedAt }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `portal-settings-site:${crypto.randomUUID()}`,
        },
        method: 'PATCH',
      })
      const body = (await response.json()) as {
        error?: { message?: string }
        result?: { updatedAt?: string }
      }
      if (!response.ok) throw new Error(body.error?.message ?? 'save failed')
      if (body.result?.updatedAt) setUpdatedAt(body.result.updatedAt)
      setFeedback('saved')
      setEditing(false)
    } catch {
      setFeedback('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Surface as="section" className="portal-settings__section portal-settings__section--wide">
      <div className="portal-settings__section-heading">
        <div>
          <h3>{messages.settings.siteDetailsTitle}</h3>
          <p>{messages.settings.siteDetailsDescription}</p>
        </div>
        {!editing ? (
          <Button onClick={() => setEditing(true)} size="compact" variant="secondary">
            {messages.settings.editSiteDetails}
          </Button>
        ) : null}
      </div>

      {feedback === 'saved' ? (
        <StatusBadge label={messages.settings.siteDetailsSaved} tone="success" />
      ) : feedback === 'error' ? (
        <StatusBadge label={messages.settings.siteDetailsError} tone="danger" />
      ) : null}

      {editing ? (
        <form
          className="portal-settings__editor"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div aria-label={messages.settings.siteLocaleLabel} className="portal-segmented">
            <Button
              aria-pressed={activeLocale === 'en'}
              onClick={() => setActiveLocale('en')}
              size="compact"
              type="button"
              variant={activeLocale === 'en' ? 'primary' : 'ghost'}
            >
              {messages.settings.siteLocaleEnglish}
            </Button>
            <Button
              aria-pressed={activeLocale === 'ar'}
              onClick={() => setActiveLocale('ar')}
              size="compact"
              type="button"
              variant={activeLocale === 'ar' ? 'primary' : 'ghost'}
            >
              {messages.settings.siteLocaleArabic}
            </Button>
          </div>
          <label className="portal-field">
            <span className="portal-field__label">{messages.settings.siteName}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.settings.siteName}
                maxLength={200}
                onChange={(event) => updateLocale('siteName', event.target.value)}
                required
                value={form[activeLocale].siteName}
              />
            </span>
          </label>
          <label className="portal-field">
            <span className="portal-field__label">{messages.settings.siteDescription}</span>
            <span className="portal-field__control portal-field__control--textarea">
              <textarea
                aria-label={messages.settings.siteDescription}
                maxLength={2_000}
                onChange={(event) => updateLocale('siteDescription', event.target.value)}
                value={form[activeLocale].siteDescription ?? ''}
              />
            </span>
          </label>
          <label className="portal-field">
            <span className="portal-field__label">{messages.settings.contactEmail}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.settings.contactEmail}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contact: { ...current.contact, email: event.target.value },
                  }))
                }
                type="email"
                value={form.contact.email ?? ''}
              />
            </span>
          </label>
          <label className="portal-field">
            <span className="portal-field__label">{messages.settings.contactPhone}</span>
            <span className="portal-field__control">
              <input
                aria-label={messages.settings.contactPhone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contact: { ...current.contact, phone: event.target.value },
                  }))
                }
                value={form.contact.phone ?? ''}
              />
            </span>
          </label>
          <div className="portal-settings__editor-actions">
            <Button onClick={() => setEditing(false)} size="compact" type="button" variant="ghost">
              {messages.settings.cancelSiteDetails}
            </Button>
            <Button disabled={saving} size="compact" type="submit" variant="primary">
              {saving ? messages.settings.savingSiteDetails : messages.settings.saveSiteDetails}
            </Button>
          </div>
        </form>
      ) : null}
    </Surface>
  )
}
