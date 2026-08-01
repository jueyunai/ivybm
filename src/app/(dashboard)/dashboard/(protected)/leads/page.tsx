import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { LeadsHub } from '@/admin-portal/modules/leads/LeadsHub'
import { LeadsPageReadError, loadLeadsPageData, parseLeadQuery, type LeadsPageData } from '@/admin-portal/modules/leads/getLeadsPage'
import type { User } from '@/payload-types'
import config from '@/payload.config'

type SearchParams = Record<string, string | string[] | undefined>

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePortalUser({ returnTo: '/dashboard/leads' })
  let data: LeadsPageData = { state: 'available', summary: null }
  try {
    const payload = await getPayload({ config })
    const req = await createLocalReq({ user: { ...user, collection: 'users' } as User }, payload)
    data = await loadLeadsPageData({ env: process.env, payload, query: parseLeadQuery(await searchParams), req, role: user.role })
  } catch (error) {
    console.error('portal_leads_read_failed', { error: error instanceof LeadsPageReadError ? error.code : 'unknown' })
    return <LeadsHub pageState="read-failed" role={user.role} summary={null} />
  }
  return <LeadsHub pageState={data.state} role={user.role} summary={data.summary} />
}
