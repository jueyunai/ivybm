import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import {
  loadPlatformAccountsPageData,
  loadPlatformReadinessPageData,
  PlatformReadinessReadError,
  type PlatformAccountsPageData,
  type PlatformReadinessPageData,
} from '@/admin-portal/modules/platforms/getPlatformReadiness'
import { PlatformReadinessPage } from '@/admin-portal/modules/platforms/PlatformReadinessPage'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export default async function PlatformsPage() {
  const user = await requirePortalUser({ returnTo: '/dashboard/platforms' })
  let accountsData: PlatformAccountsPageData = { accounts: [], state: 'read-failed' }
  let readinessData: PlatformReadinessPageData = { state: 'available', summary: null }

  try {
    const payload = await getPayload({ config })
    const req = await createLocalReq({ user: { ...user, collection: 'users' } as User }, payload)
    accountsData = await loadPlatformAccountsPageData({
      env: process.env,
      payload,
      req,
      role: user.role,
    })
    readinessData = await loadPlatformReadinessPageData({
      env: process.env,
      payload,
      req,
      role: user.role,
    })
  } catch (error) {
    console.error('portal_platform_readiness_failed', {
      code: error instanceof PlatformReadinessReadError ? error.code : 'unknown',
    })
    return <PlatformReadinessPage accounts={[]} pageState="read-failed" summary={null} />
  }

  return (
    <PlatformReadinessPage
      accounts={accountsData.accounts}
      pageState={accountsData.state}
      summary={readinessData.summary}
    />
  )
}
