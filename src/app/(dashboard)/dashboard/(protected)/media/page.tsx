import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import {
  loadMediaPageData,
  MediaPageReadError,
  parseMediaQuery,
  type MediaPageData,
} from '@/admin-portal/modules/media/getMediaPage'
import { MediaWorkspace } from '@/admin-portal/modules/media/MediaWorkspace'
import type { User } from '@/payload-types'
import config from '@/payload.config'

type SearchParams = Record<string, string | string[] | undefined>

export default async function MediaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePortalUser({ returnTo: '/dashboard/media' })
  const query = parseMediaQuery(await searchParams)
  let data: MediaPageData = { state: 'available', summary: null }

  try {
    const payload = await getPayload({ config })
    const actor = { ...user, collection: 'users' } as User
    const req = await createLocalReq({ user: actor }, payload)
    data = await loadMediaPageData({
      env: process.env,
      payload,
      query,
      req,
      role: user.role,
    })
  } catch (error) {
    console.error('[admin-portal] media read failed', {
      code: error instanceof MediaPageReadError ? error.code : 'portal-media-unknown-failure',
      error: error instanceof Error ? error.name : 'UnknownError',
      module: 'media',
      query: 'media-page',
    })
    return <MediaWorkspace pageState="read-failed" summary={null} />
  }

  return <MediaWorkspace pageState={data.state} summary={data.summary} />
}
