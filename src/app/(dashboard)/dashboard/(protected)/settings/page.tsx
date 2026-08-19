import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { getPortalFeatureState } from '@/admin-portal/core/modules/getPortalFeatureState'
import { resolvePortalAvailability } from '@/admin-portal/core/modules/resolvePortalAvailability'
import {
  getPortalSettingsSummary,
  getPortalSiteSettingsEditor,
  type PortalSettingsSummary,
  type PortalSiteSettingsEditor,
} from '@/admin-portal/modules/settings/getPortalSettingsSummary'
import { SettingsHub } from '@/admin-portal/modules/settings/SettingsHub'
import { SETTINGS_MODULE } from '@/admin-portal/modules/settings/manifest'
import type { User } from '@/payload-types'
import config from '@/payload.config'
import {
  getPortalAiSettings,
  portalAiSettingsAdminOnly,
  type PortalAiSettingsSummary,
} from '@/admin-portal/modules/settings/getPortalAiSettings'

export default async function PortalSettingsPage() {
  const user = await requirePortalUser()
  const availability = resolvePortalAvailability({ env: process.env, role: user.role })
  const featureState = getPortalFeatureState({ env: process.env, module: SETTINGS_MODULE })
  const pageState = featureState.enabled
    ? 'available'
    : featureState.reason === 'portal-disabled'
      ? 'portal-disabled'
      : 'module-disabled'
  if (pageState !== 'available') {
    return (
      <SettingsHub
        aiSettings={portalAiSettingsAdminOnly()}
        modules={availability.modules}
        pageState={pageState}
        summary={null}
        user={user}
      />
    )
  }
  let readError = false
  let aiReadError = false
  let summary: PortalSettingsSummary | null = null
  let siteSettings: PortalSiteSettingsEditor | null = null
  let aiSettings: PortalAiSettingsSummary = portalAiSettingsAdminOnly()

  try {
    const payload = await getPayload({ config })
    const req = await createLocalReq({ user: { ...user, collection: 'users' } as User }, payload)
    summary = await getPortalSettingsSummary({ payload, req, user })
    if (summary.canUpdate) {
      siteSettings = await getPortalSiteSettingsEditor({ payload, req })
    }
    if (user.role === 'admin') {
      try {
        aiSettings = await getPortalAiSettings({ payload, req })
      } catch (error) {
        aiReadError = true
        console.error('Portal settings read_failed', {
          error: error instanceof Error ? error.name : 'UnknownError',
          module: 'settings',
          query: 'ai-settings-summary',
        })
      }
    }
  } catch (error) {
    readError = true
    aiReadError = user.role === 'admin'
    console.error('Portal settings read_failed', {
      error: error instanceof Error ? error.name : 'UnknownError',
      module: 'settings',
      query: 'site-settings-summary',
    })
  }

  return (
    <SettingsHub
      aiSettings={aiSettings}
      aiReadError={aiReadError}
      modules={availability.modules}
      pageState={pageState}
      readError={readError}
      summary={summary}
      siteSettings={siteSettings}
      user={user}
    />
  )
}
