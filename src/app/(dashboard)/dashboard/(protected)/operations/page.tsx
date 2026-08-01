import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import {
  loadSafeJobPageData,
  parseSafeJobQuery,
  SafeJobPageReadError,
  type SafeJobPageData,
} from '@/admin-portal/modules/operations/getSafeJobPage'
import { OperationsWorkspace } from '@/admin-portal/modules/operations/OperationsWorkspace'
import type { User } from '@/payload-types'
import config from '@/payload.config'

type SearchParams = Record<string, string | string[] | undefined>

export default async function OperationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePortalUser({ returnTo: '/dashboard/operations' })
  let data: SafeJobPageData = { state: 'available', summary: null }

  try {
    const payload = await getPayload({ config })
    data = await loadSafeJobPageData({
      env: process.env,
      payload,
      query: parseSafeJobQuery(await searchParams),
      req: await createLocalReq({ user: { ...user, collection: 'users' } as User }, payload),
      role: user.role,
    })
  } catch (error) {
    console.error('portal_operations_read_failed', {
      code: error instanceof SafeJobPageReadError ? error.code : 'unknown',
    })
    return <OperationsWorkspace pageState="read-failed" summary={null} />
  }

  return <OperationsWorkspace pageState={data.state} summary={data.summary} />
}
