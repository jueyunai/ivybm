import type { LeadForFeishu } from './contracts'

const platformLabel = (platform: NonNullable<LeadForFeishu['messagingPlatform']>): string =>
  platform === 'facebook-messenger'
    ? 'Facebook Messenger'
    : platform === 'instagram'
      ? 'Instagram'
      : 'TikTok'

export const formatMessagingContactIdentity = (lead: LeadForFeishu): string => {
  const platform = lead.messagingPlatform
  const account = lead.messagingAccountExternalId?.trim()
  const sender = lead.messagingSenderExternalId?.trim()
  const thread = lead.messagingThreadExternalId?.trim()
  if (!platform || !account || !sender || !thread) return ''
  return `${platformLabel(platform)} · Account ${account} · Sender ${sender} · Thread ${thread}`
}

export const formatLeadContact = (lead: LeadForFeishu): string =>
  [lead.email?.trim(), lead.phone?.trim(), formatMessagingContactIdentity(lead)]
    .filter((value): value is string => Boolean(value))
    .join(' / ') || '待确认'
