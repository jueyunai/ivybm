import {
  FeishuConfigurationError,
  type FeishuClientPort,
  type FeishuMappingConfig,
  type HandoffForFeishu,
  type LeadForFeishu,
} from './contracts'

export const formatHandoffNotification = (handoff: HandoffForFeishu): string =>
  [
    'AI 客服需要人工接管',
    `会话：${handoff.conversationPublicId}`,
    `来源：${handoff.source}`,
    `原因：${handoff.reason}`,
    `请求时间：${handoff.requestedAt}`,
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
    `国家/地区：${lead.country}`,
    `需求：${lead.interest || '待确认'}`,
    `联系方式：${lead.email}${lead.phone ? ` / ${lead.phone}` : ''}`,
  ].join('\n')

export const formatNewLeadNotification = (lead: LeadForFeishu): string =>
  [
    '收到新客户线索',
    `客户：${lead.company || lead.name}`,
    `国家/地区：${lead.country}`,
    `来源：${typeof lead.source === 'object' ? lead.source.label || lead.source.key || lead.source.id : lead.source}`,
    `联系方式：${lead.email}${lead.phone ? ` / ${lead.phone}` : ''}`,
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
  idempotencyPrefix,
  lead,
  mapping,
  signal,
  text,
}: {
  client: FeishuClientPort
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
        idempotencyKey: `${idempotencyPrefix}-${lead.id}-${recipient.receiveIdType}-${recipient.receiveId}`,
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
  lead,
  mapping,
  signal,
}: {
  client: FeishuClientPort
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
}): Promise<Array<{ messageId: string }>> =>
  notifyLead({
    client,
    idempotencyPrefix: 'lead-new',
    lead,
    mapping,
    signal,
    text: formatNewLeadNotification(lead),
  })

export const notifyHighIntentLead = async ({
  client,
  lead,
  mapping,
  signal,
}: {
  client: FeishuClientPort
  lead: LeadForFeishu
  mapping: FeishuMappingConfig
  signal?: AbortSignal
}): Promise<Array<{ messageId: string }>> => {
  return notifyLead({
    client,
    idempotencyPrefix: 'lead-high-intent',
    lead,
    mapping,
    signal,
    text: formatHighIntentLeadNotification(lead),
  })
}
