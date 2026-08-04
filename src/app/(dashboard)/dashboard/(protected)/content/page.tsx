import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { ContentHub } from '@/admin-portal/modules/website-content/ContentHub'
import {
  ContentSummaryReadError,
  loadWebsiteContentPageData,
  parseContentQuery,
  type WebsiteContentPageData,
} from '@/admin-portal/modules/website-content/getContentSummary'
import type { User } from '@/payload-types'
import config from '@/payload.config'

type SearchParams = Record<string, string | string[] | undefined>

export default async function WebsiteContentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await requirePortalUser({ returnTo: '/dashboard/content' })
  const query = parseContentQuery(await searchParams)
  let data: WebsiteContentPageData = { state: 'available', summary: null }

  try {
    const payload = await getPayload({ config })
    const actor = { ...user, collection: 'users' } as User
    const req = await createLocalReq({ user: actor }, payload)
    data = await loadWebsiteContentPageData({
      env: process.env,
      payload,
      query,
      req,
      role: user.role,
    })
  } catch (error) {
    console.error('[admin-portal] website content read failed', {
      code:
        error instanceof ContentSummaryReadError
          ? error.code
          : 'portal-content-summary-unknown-failure',
      error: error instanceof Error ? error.name : 'UnknownError',
      module: 'website-content',
      query: 'content-summary',
    })
    return <ContentHub pageState="read-failed" summary={null} />
  }

  return <ContentHub pageState={data.state} summary={data.summary} />
}
