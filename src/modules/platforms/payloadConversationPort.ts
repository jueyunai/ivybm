import type { Payload } from 'payload'

import { createVisitorToken, hashVisitorToken } from '@/modules/conversations/auth'
import { PayloadConversationRepository } from '@/modules/conversations/payloadRepository'
import {
  createConversationService,
  type ConversationResponder,
} from '@/modules/conversations/service'
import { PayloadConversationLeadSink } from '@/modules/leads/conversationLeadSink'

import type { ConversationMessagePort, PlatformEventDeliveryResult } from './ports'
import type { MessagingPlatform, NormalizedInboundMessage } from './types'

export const resolveInstagramOAuthAccountId = async (
  payload: Payload,
  messagingAccountExternalId: string,
): Promise<string> => {
  const accounts = await payload.find({
    collection: 'platform-accounts',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    pagination: false,
    select: { externalAccountId: true },
    where: {
      and: [
        { accountKind: { equals: 'instagram-professional' } },
        { messagingExternalAccountId: { equals: messagingAccountExternalId } },
      ],
    },
  })
  const externalAccountId = accounts.docs.length === 1
    ? accounts.docs[0]?.externalAccountId
    : undefined
  if (
    typeof externalAccountId !== 'string' ||
    !/^[1-9][0-9]{0,31}$/u.test(externalAccountId)
  ) {
    throw new Error('Instagram OAuth identity is unavailable for the messaging account')
  }
  return externalAccountId
}

// The durable Job lease is 120s. Keeping the nested ConversationCommand lease shorter
// guarantees that a worker reclaim can recover after a process dies mid-delivery.
export const PLATFORM_CONVERSATION_COMMAND_LEASE_MS = 60_000

const handoffOnlyResponder: ConversationResponder = {
  generateReply: async () => ({
    handoff: { reason: 'platform_outbound_not_configured', source: 'ai_policy' as const },
  }),
}

const conversationChannelFor = (
  platform: MessagingPlatform,
  allowTikTokNormalizedDelivery: boolean,
): 'facebook' | 'instagram' | 'tiktok' => {
  if (platform === 'facebook-messenger') return 'facebook'
  if (platform === 'instagram') return 'instagram'
  // This is only an internal, already-normalized delivery path. The TikTok raw
  // webhook connector stays disabled until its official schema and eligibility
  // are available. Requiring an explicit, code-reviewed opt-in prevents a future
  // route from accidentally making the currently blocked capability live.
  if (platform === 'tiktok') {
    if (!allowTikTokNormalizedDelivery) {
      throw new Error('TikTok normalized delivery is not enabled')
    }
    return 'tiktok'
  }
  throw new Error(`Platform conversation delivery is not configured for ${platform}`)
}

const inboundText = (message: NormalizedInboundMessage): string => {
  const text = typeof message.content.text === 'string' ? message.content.text.trim() : undefined
  if (text) {
    if (text.length > 5_000) throw new Error('Platform inbound message text is too long')
    return text
  }
  const attachmentTypes = Array.isArray(message.content.attachments)
    ? message.content.attachments
        .slice(0, 10)
        .flatMap((attachment) =>
          attachment && typeof attachment.type === 'string' && attachment.type.trim()
            ? [attachment.type.trim()]
            : [],
        )
    : []
  if (attachmentTypes.length > 0) return `[Attachment: ${attachmentTypes.join(', ')}]`
  const messageType =
    typeof message.content.messageType === 'string' ? message.content.messageType.trim() : ''
  if (!messageType) throw new Error('Platform inbound message content is invalid')
  return `[${messageType} message]`
}

export class PayloadPlatformConversationPort implements ConversationMessagePort {
  private readonly allowTikTokNormalizedDelivery: boolean
  private readonly commandLeaseMs: number
  private readonly payload: Payload
  private readonly responder: ConversationResponder

  constructor({
    allowTikTokNormalizedDelivery = false,
    commandLeaseMs = PLATFORM_CONVERSATION_COMMAND_LEASE_MS,
    payload,
    responder = handoffOnlyResponder,
  }: {
    allowTikTokNormalizedDelivery?: boolean
    commandLeaseMs?: number
    payload: Payload
    responder?: ConversationResponder
  }) {
    this.allowTikTokNormalizedDelivery = allowTikTokNormalizedDelivery
    this.commandLeaseMs = commandLeaseMs
    this.payload = payload
    this.responder = responder
  }

  async writeInboundMessage(
    message: NormalizedInboundMessage,
  ): Promise<PlatformEventDeliveryResult> {
    const channel = conversationChannelFor(message.platform, this.allowTikTokNormalizedDelivery)
    const externalThreadId = `${message.accountExternalId}:${message.senderExternalId}`
    const conversationAccountExternalId = message.platform === 'instagram'
      ? await resolveInstagramOAuthAccountId(this.payload, message.accountExternalId)
      : message.accountExternalId
    const text = inboundText(message)
    const service = createConversationService({
      allowTikTokNormalizedDelivery: this.allowTikTokNormalizedDelivery,
      leadSink: new PayloadConversationLeadSink(),
      repository: new PayloadConversationRepository({
        commandLeaseMs: this.commandLeaseMs,
        payload: this.payload,
        sessionTokenHash: hashVisitorToken(createVisitorToken()),
      }),
      responder: this.responder,
    })
    const delivery = await service.ingestExternalMessage({
      channel,
      externalAccountId: conversationAccountExternalId,
      externalMessageId: message.externalEventId,
      externalSenderId: message.senderExternalId,
      externalThreadId,
      locale: /\p{Script=Arabic}/u.test(text) ? 'ar' : 'en',
      text,
    })
    return { idempotencyKey: message.idempotencyKey, status: delivery.status }
  }
}
