import { createLocalReq, getPayload } from 'payload'

import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import {
  KnowledgePageReadError,
  loadKnowledgePageData,
  parseKnowledgeQuery,
  type KnowledgePageData,
} from '@/admin-portal/modules/knowledge/getKnowledgePage'
import { KnowledgeWorkspace } from '@/admin-portal/modules/knowledge/KnowledgeWorkspace'
import type { User } from '@/payload-types'
import config from '@/payload.config'

type SearchParams = Record<string, string | string[] | undefined>

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await requirePortalUser({ returnTo: '/dashboard/knowledge' })
  const query = parseKnowledgeQuery(await searchParams)
  let data: KnowledgePageData = { state: 'available', summary: null }

  try {
    const payload = await getPayload({ config })
    const actor = { ...user, collection: 'users' } as User
    const req = await createLocalReq({ user: actor }, payload)
    data = await loadKnowledgePageData({
      env: process.env,
      payload,
      query,
      req,
      role: user.role,
    })
  } catch (error) {
    console.error('[admin-portal] knowledge read failed', {
      code:
        error instanceof KnowledgePageReadError ? error.code : 'portal-knowledge-unknown-failure',
      error: error instanceof Error ? error.name : 'UnknownError',
      module: 'knowledge',
      query: 'knowledge-page',
    })
    return <KnowledgeWorkspace pageState="read-failed" summary={null} />
  }

  return <KnowledgeWorkspace pageState={data.state} summary={data.summary} />
}
