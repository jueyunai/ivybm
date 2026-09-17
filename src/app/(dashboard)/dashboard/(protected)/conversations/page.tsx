import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { getPortalFeatureState } from '@/admin-portal/core/modules/getPortalFeatureState'
import { ConversationWorkspace } from '@/admin-portal/modules/conversations/ConversationWorkspace'
import { CONVERSATIONS_MODULE } from '@/admin-portal/modules/conversations/manifest'

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const rawConversation = params.conversation
  const rawParam = Array.isArray(rawConversation) ? rawConversation[0] : rawConversation
  const conversationParam =
    typeof rawParam === 'string' && rawParam.trim() ? rawParam.trim() : undefined
  const returnTo = conversationParam
    ? `/dashboard/conversations?conversation=${encodeURIComponent(conversationParam)}`
    : '/dashboard/conversations'

  const user = await requirePortalUser({ returnTo })
  const featureState = getPortalFeatureState({
    env: process.env,
    module: CONVERSATIONS_MODULE,
  })

  return (
    <ConversationWorkspace
      enabled={featureState.enabled}
      initialConversationId={conversationParam}
      role={user.role}
    />
  )
}
