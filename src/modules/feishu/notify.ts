import {
  FeishuConfigurationError,
  type FeishuClientPort,
  type FeishuMappingConfig,
  type HandoffForFeishu,
  type LeadForFeishu,
} from './contracts'
import { formatLeadContact } from './leadContact'

const formatChannel = (channel: HandoffForFeishu['channel']): string => {
  switch (channel) {
    case 'website':
      return '官方网站 (Website)'
    case 'whatsapp':
      return 'WhatsApp'
    case 'facebook':
      return 'Facebook Messenger'
    case 'instagram':
      return 'Instagram'
    case 'tiktok':
      return 'TikTok'
    default:
      return String(channel)
  }
}

const KNOWN_REASONS: Record<string, string> = {
  ai_service_unavailable: 'AI 服务暂不可用',
  high_intent: '高意向工程咨询',
  high_risk_topic: '涉及敏感话题',
  qualification_complete: '需求收集完成',
  qualification_incomplete: '需求收集未完成',
  reviewed_knowledge_unavailable: '知识库暂不可用',
  visitor: '访客主动申请',
  visitor_request: '访客主动申请',
}

const formatReason = (reason: string): string => {
  const trimmed = reason.trim()
  if (KNOWN_REASONS[trimmed]) {
    return `${KNOWN_REASONS[trimmed]} (${trimmed})`
  }
  const compressed = trimmed.replace(/\s+/g, ' ')
  return Array.from(compressed).slice(0, 120).join('')
}

const formatProductInterest = (
  interest?: string | null,
  quantitySquareMeters?: number | null,
): string => {
  const cleanInterest = interest?.trim()
  const hasQuantity = typeof quantitySquareMeters === 'number' && Number.isFinite(quantitySquareMeters)
  const quantityText = hasQuantity ? `${quantitySquareMeters.toLocaleString('en-US')} m²` : null

  if (cleanInterest && quantityText) {
    return `${cleanInterest} / ${quantityText}`
  }
  if (cleanInterest) {
    return cleanInterest
  }
  if (quantityText) {
    return quantityText
  }
  return '详见最新留言'
}

const formatContact = (email?: string | null, phone?: string | null): string => {
  const cleanEmail = email?.trim()
  const cleanPhone = phone?.trim()
  if (cleanEmail && cleanPhone) {
    return `${cleanEmail} / ${cleanPhone}`
  }
  if (cleanEmail) {
    return cleanEmail
  }
  if (cleanPhone) {
    return cleanPhone
  }
  return '暂未留资（客户可继续输入）'
}

const formatRequestedAt = (requestedAt: string): string => {
  const date = new Date(requestedAt)
  if (Number.isNaN(date.getTime())) return requestedAt
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = date.getUTCFullYear()
  const m = pad(date.getUTCMonth() + 1)
  const d = pad(date.getUTCDate())
  const h = pad(date.getUTCHours())
  const min = pad(date.getUTCMinutes())
  return `${y}-${m}-${d} ${h}:${min} (UTC)`
}

const formatLatestVisitorMessage = (message?: string | null): string => {
  if (!message?.trim()) {
    return '（暂无留言）'
  }
  const compressed = message.replace(/\s+/g, ' ').trim()
  const truncated = Array.from(compressed).slice(0, 150).join('')
  return `“${truncated}”`
}

export const formatHandoffNotification = (handoff: HandoffForFeishu): string =>
  [
    '🔔【AI 客服需要人工接管】',
    `• 渠道来源：${formatChannel(handoff.channel)}`,
    `• 接管原因：${formatReason(handoff.reason)}`,
    `• 客户国家：${handoff.country?.trim() || '待确认'}`,
    `• 关注产品：${formatProductInterest(handoff.productInterest, handoff.quantitySquareMeters)}`,
    `• 联系方式：${formatContact(handoff.email, handoff.phone)}`,
    `• 请求时间：${formatRequestedAt(handoff.requestedAt)}`,
    '-----------------------------------------',
    '💬 最新客户留言：',
    formatLatestVisitorMessage(handoff.latestVisitorMessage),
    '-----------------------------------------',
    '🔗 工作台一键接管：',
    handoff.portalUrl,
  ].join('\n')

export const notifyHandoff = async ({
  client,
  handoff,
  mapping,
  signal,
}: {
  client: FeishuClientPort
  handoff: HandoffForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
}): Promise<Array<{ messageId: string }>> => {
  const recipients = mapping.notificationRecipients.filter((item) => item.enabled !== false)
  if (recipients.length === 0) {
    throw new FeishuConfigurationError('An active Feishu mapping requires a notification recipient')
  }

  const text = formatHandoffNotification(handoff)
  return Promise.all(
    recipients.map((recipient) =>
      client.sendText({
        idempotencyKey: `${handoff.domainEventId}:${recipient.receiveIdType}:${recipient.receiveId}`,
        receiveId: recipient.receiveId,
        receiveIdType: recipient.receiveIdType,
        signal,
        text,
      }),
    ),
  )
}

export const formatHighIntentLeadNotification = (lead: LeadForFeishu): string =>
  [
    '发现高意向客户',
    `客户：${lead.company || lead.name}`,
    `国家/地区：${lead.country || '待确认'}`,
    `需求：${lead.interest || '待确认'}`,
    `联系方式：${formatLeadContact(lead)}`,
  ].join('\n')

export const formatNewLeadNotification = (lead: LeadForFeishu): string =>
  [
    '收到新客户线索',
    `客户：${lead.company || lead.name}`,
    `国家/地区：${lead.country || '待确认'}`,
    `来源：${typeof lead.source === 'object' ? lead.source.label || lead.source.key || lead.source.id : lead.source}`,
    `联系方式：${formatLeadContact(lead)}`,
  ].join('\n')

export const formatFollowUpDueNotification = (lead: LeadForFeishu, dueAt: string): string =>
  [
    '客户跟进已到期',
    `客户：${lead.company || lead.name}`,
    `到期时间：${dueAt}`,
    `联系方式：${formatLeadContact(lead)}`,
  ].join('\n')

export const formatLeadSyncFailureNotification = (
  lead: LeadForFeishu,
  sourceJobId: number,
): string =>
  [
    '飞书 CRM 线索同步最终失败',
    `客户：${lead.company || lead.name}`,
    `本地 Lead ID：${lead.id}`,
    `Job ID：${sourceJobId}`,
    '请管理员在 Payload Jobs 中检查并人工重试。',
  ].join('\n')

const assignedUserID = (lead: LeadForFeishu): number | string | undefined => {
  const assigned = lead.assignedTo
  if (typeof assigned === 'number' || typeof assigned === 'string') return assigned
  return assigned?.id
}

const leadRecipients = (lead: LeadForFeishu, mapping: FeishuMappingConfig) => {
  const userId = assignedUserID(lead)
  const member = mapping.memberMappings.find(
    (item) =>
      item.enabled !== false && userId !== undefined && String(item.userId) === String(userId),
  )
  if (member) {
    return [{ enabled: true, receiveId: member.openId, receiveIdType: 'open_id' as const }]
  }
  return mapping.notificationRecipients.filter((item) => item.enabled !== false)
}

const notifyLead = async ({
  client,
  eventRevision,
  idempotencyPrefix,
  lead,
  mapping,
  signal,
  text,
}: {
  client: FeishuClientPort
  eventRevision?: string
  idempotencyPrefix: string
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
  text: string
}): Promise<Array<{ messageId: string }>> => {
  const recipients = leadRecipients(lead, mapping)
  if (recipients.length === 0) {
    throw new FeishuConfigurationError('An active Feishu mapping requires a notification recipient')
  }
  return Promise.all(
    recipients.map((recipient) =>
      client.sendText({
        idempotencyKey: `${idempotencyPrefix}${eventRevision ? `-${eventRevision}` : ''}-${lead.id}-${recipient.receiveIdType}-${recipient.receiveId}`,
        receiveId: recipient.receiveId,
        receiveIdType: recipient.receiveIdType,
        signal,
        text,
      }),
    ),
  )
}

export const notifyNewLead = async ({
  client,
  eventRevision,
  lead,
  mapping,
  signal,
}: {
  client: FeishuClientPort
  eventRevision?: string
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
}): Promise<Array<{ messageId: string }>> =>
  notifyLead({
    client,
    eventRevision,
    idempotencyPrefix: 'lead-new',
    lead,
    mapping,
    signal,
    text: formatNewLeadNotification(lead),
  })

export const notifyHighIntentLead = async ({
  client,
  eventRevision,
  lead,
  mapping,
  signal,
}: {
  client: FeishuClientPort
  eventRevision?: string
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
}): Promise<Array<{ messageId: string }>> => {
  return notifyLead({
    client,
    eventRevision,
    idempotencyPrefix: 'lead-high-intent',
    lead,
    mapping,
    signal,
    text: formatHighIntentLeadNotification(lead),
  })
}

export const notifyFollowUpDue = async ({
  client,
  dueAt,
  lead,
  mapping,
  signal,
}: {
  client: FeishuClientPort
  dueAt: string
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
}): Promise<Array<{ messageId: string }>> =>
  notifyLead({
    client,
    idempotencyPrefix: `lead-followup-due-${dueAt}`,
    lead,
    mapping,
    signal,
    text: formatFollowUpDueNotification(lead, dueAt),
  })

export const notifyLeadSyncFailure = async ({
  client,
  failureCycle,
  lead,
  mapping,
  signal,
  sourceJobId,
}: {
  client: FeishuClientPort
  failureCycle: number
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
  sourceJobId: number
}): Promise<Array<{ messageId: string }>> =>
  notifyLead({
    client,
    idempotencyPrefix: `lead-sync-dead-job-${sourceJobId}-cycle-${failureCycle}`,
    lead,
    mapping,
    signal,
    text: formatLeadSyncFailureNotification(lead, sourceJobId),
  })
