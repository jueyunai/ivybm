import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { getPortalFeatureState } from '@/admin-portal/core/modules/getPortalFeatureState'
import { ConversationWorkspace } from '@/admin-portal/modules/conversations/ConversationWorkspace'
import { CONVERSATIONS_MODULE } from '@/admin-portal/modules/conversations/manifest'

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requirePortalUser({ returnTo: '/dashboard/conversations' })
  const featureState = getPortalFeatureState({
    env: process.env,
    module: CONVERSATIONS_MODULE,
  })

  const conversation = (await searchParams).conversation
  const initialConversationId = Array.isArray(conversation) ? conversation[0] : conversation

  return (
    <ConversationWorkspace
      enabled={featureState.enabled}
      initialConversationId={initialConversationId}
      role={user.role}
    />
  )
}
