import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import {
  getPortalOverview,
  type PortalOverviewSummary,
} from '@/admin-portal/modules/overview/getPortalOverview'
import { OverviewPage } from '@/admin-portal/modules/overview/OverviewPage'
import type { User } from '@/payload-types'
import config from '@/payload.config'

export default async function DashboardPage() {
  const user = await requirePortalUser()
  const payload = await getPayload({ config })
  let readError = false
  let summary: PortalOverviewSummary | null = null

  try {
    const actor = { ...user, collection: 'users' } as User
    const req = await createLocalReq({ user: actor }, payload)
    summary = await getPortalOverview({ payload, req })
  } catch (error) {
    readError = true
    console.error('[admin-portal] overview read failed', {
      error,
      module: 'overview',
      query: 'portal-overview',
    })
  }

  return <OverviewPage readError={readError} summary={summary} user={user} />
}
