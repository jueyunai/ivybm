import { getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { resolvePortalAvailability } from '@/admin-portal/core/modules/resolvePortalAvailability'
import {
  getPortalSettingsSummary,
  type PortalSettingsSummary,
} from '@/admin-portal/modules/settings/getPortalSettingsSummary'
import { SettingsHub } from '@/admin-portal/modules/settings/SettingsHub'
import config from '@/payload.config'

export default async function PortalSettingsPage() {
  const user = await requirePortalUser()
  const availability = resolvePortalAvailability({ env: process.env, role: user.role })
  let readError = false
  let summary: PortalSettingsSummary | null = null

  try {
    summary = await getPortalSettingsSummary({ payload: await getPayload({ config }), user })
  } catch (error) {
    readError = true
    console.error('Portal settings read_failed', {
      error: error instanceof Error ? error.name : 'UnknownError',
      module: 'settings',
      query: 'site-settings-summary',
    })
  }

  return (
    <SettingsHub
      modules={availability.modules}
      readError={readError}
      summary={summary}
      user={user}
    />
  )
}
