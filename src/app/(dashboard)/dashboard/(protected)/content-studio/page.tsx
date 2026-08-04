import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { ContentStudio } from '@/admin-portal/modules/content-studio/ContentStudio'
import { ContentStudioPageReadError, loadContentStudioPageData, parseContentStudioQuery, type ContentStudioPageData } from '@/admin-portal/modules/content-studio/getContentStudioPage'
import type { User } from '@/payload-types'
import config from '@/payload.config'

type SearchParams = Record<string, string | string[] | undefined>

export default async function ContentStudioPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePortalUser({ returnTo: '/dashboard/content-studio' })
  const query = parseContentStudioQuery(await searchParams)
  let data: ContentStudioPageData = { state: 'available', summary: null }
  try {
    const payload = await getPayload({ config })
    const actor = { ...user, collection: 'users' } as User
    data = await loadContentStudioPageData({ env: process.env, payload, query, req: await createLocalReq({ user: actor }, payload), role: user.role })
  } catch (error) {
    console.error('portal_content_studio_read_failed', { error: error instanceof ContentStudioPageReadError ? error.code : 'unknown' })
    return <ContentStudio pageState="read-failed" summary={null} />
  }
  return <ContentStudio pageState={data.state} summary={data.summary} />
}
