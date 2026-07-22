import { createHash } from 'node:crypto'

import type { Payload } from 'payload'

import { createVisitorToken, hashVisitorToken } from '@/modules/conversations/auth'
import { PayloadConversationRepository } from '@/modules/conversations/payloadRepository'
import { createConversationService } from '@/modules/conversations/service'
import { PayloadConversationLeadSink } from '@/modules/leads/conversationLeadSink'

import type { ConversationMessagePort, PlatformEventDeliveryResult } from './ports'
import type { MessagingPlatform, NormalizedInboundMessage } from './types'

// The durable Job lease is 120s. Keeping the nested ConversationCommand lease shorter
// guarantees that a worker reclaim can recover after a process dies mid-delivery.
export const PLATFORM_CONVERSATION_COMMAND_LEASE_MS = 60_000

const metaConversationChannelFor = (platform: MessagingPlatform): 'facebook' | 'instagram' => {
  if (platform === 'facebook-messenger') return 'facebook'
  if (platform === 'instagram') return 'instagram'
  // TikTok remains an explicit Task 13 external-schema / account-authorization block.
  // Do not guess a channel or persist an invented schema value.
  throw new Error(`Meta conversation delivery is not configured for ${platform}`)
}

const platformSessionKey = (message: NormalizedInboundMessage): string => {
  const fingerprint = createHash('sha256')
    .update(`${message.platform}\u0000${message.accountExternalId}\u0000${message.senderExternalId}`)
    .digest('hex')
  return `platform-session:${message.platform}:${fingerprint}`
}

const inboundText = (message: NormalizedInboundMessage): string => {
  const text = typeof message.content.text === 'string' ? message.content.text.trim() : undefined
  if (text) {
    if (text.length > 5_000) throw new Error('Platform inbound message text is too long')
    return text
  }
  const attachmentTypes = Array.isArray(message.content.attachments)
    ? message.content.attachments.slice(0, 10).flatMap((attachment) =>
        attachment && typeof attachment.type === 'string' && attachment.type.trim()
          ? [attachment.type.trim()]
          : [],
      )
    : []
  if (attachmentTypes.length > 0) return `[Attachment: ${attachmentTypes.join(', ')}]`
  const messageType = typeof message.content.messageType === 'string'
    ? message.content.messageType.trim()
    : ''
  if (!messageType) throw new Error('Platform inbound message content is invalid')
  return `[${messageType} message]`
}

export class PayloadMetaConversationPort implements ConversationMessagePort {
  private readonly commandLeaseMs: number
  private readonly payload: Payload

  constructor({
    commandLeaseMs = PLATFORM_CONVERSATION_COMMAND_LEASE_MS,
    payload,
  }: {
    commandLeaseMs?: number
    payload: Payload
  }) {
    this.commandLeaseMs = commandLeaseMs
    this.payload = payload
  }

  async writeInboundMessage(message: NormalizedInboundMessage): Promise<PlatformEventDeliveryResult> {
    const channel = metaConversationChannelFor(message.platform)
    const externalThreadId = `${message.accountExternalId}:${message.senderExternalId}`
    const service = createConversationService({
      leadSink: new PayloadConversationLeadSink(),
      repository: new PayloadConversationRepository({
        commandLeaseMs: this.commandLeaseMs,
        payload: this.payload,
        sessionTokenHash: hashVisitorToken(createVisitorToken()),
      }),
      // Until an account has approved outbound messaging, the only truthful outcome is
      // a durable operator handoff. Do not persist an AI reply that was never delivered.
      responder: {
        generateReply: async () => ({
          handoff: { reason: 'platform_outbound_not_configured', source: 'ai_policy' as const },
        }),
      },
    })
    const delivery = await service.ingestExternalMessage({
      channel,
      externalMessageId: message.externalEventId,
      externalThreadId,
      idempotencyKey: message.idempotencyKey,
      locale: 'en',
      sessionIdempotencyKey: platformSessionKey(message),
      text: inboundText(message),
    })
    return { idempotencyKey: message.idempotencyKey, status: delivery.status }
  }
}
