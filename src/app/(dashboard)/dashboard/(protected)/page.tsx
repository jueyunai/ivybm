import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { getPortalFeatureState } from '@/admin-portal/core/modules/getPortalFeatureState'
import {
  getPortalOverview,
  parsePortalOverviewQuery,
  type PortalOverviewSummary,
} from '@/admin-portal/modules/overview/getPortalOverview'
import { OVERVIEW_MODULE } from '@/admin-portal/modules/overview/manifest'
import { OverviewPage } from '@/admin-portal/modules/overview/OverviewPage'
import type { User } from '@/payload-types'
import config from '@/payload.config'

type SearchParams = Record<string, string | string[] | undefined>

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await requirePortalUser()
  const query = parsePortalOverviewQuery(await searchParams)
  const featureState = getPortalFeatureState({ env: process.env, module: OVERVIEW_MODULE })
  const pageState = featureState.enabled
    ? 'available'
    : featureState.reason === 'portal-disabled'
      ? 'portal-disabled'
      : 'module-disabled'
  if (pageState !== 'available') {
    return <OverviewPage pageState={pageState} query={query} summary={null} user={user} />
  }
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

  return <OverviewPage pageState={pageState} query={query} readError={readError} summary={summary} user={user} />
}
