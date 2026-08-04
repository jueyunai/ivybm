import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import {
  loadPlatformReadinessPageData,
  PlatformReadinessReadError,
  type PlatformReadinessPageData,
} from '@/admin-portal/modules/platforms/getPlatformReadiness'
import { PlatformReadinessPage } from '@/admin-portal/modules/platforms/PlatformReadinessPage'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export default async function PlatformsPage() {
  const user = await requirePortalUser({ returnTo: '/dashboard/platforms' })
  let data: PlatformReadinessPageData = { state: 'available', summary: null }

  try {
    const payload = await getPayload({ config })
    data = await loadPlatformReadinessPageData({
      env: process.env,
      payload,
      req: await createLocalReq({ user: { ...user, collection: 'users' } as User }, payload),
      role: user.role,
    })
  } catch (error) {
    console.error('portal_platform_readiness_failed', {
      code: error instanceof PlatformReadinessReadError ? error.code : 'unknown',
    })
    return <PlatformReadinessPage pageState="read-failed" summary={null} />
  }

  return <PlatformReadinessPage pageState={data.state} summary={data.summary} />
}
