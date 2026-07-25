import type { JobHandler } from '@/modules/jobs/contracts'

import { dispatchPlatformEvent } from './dispatch'
import type {
  ConversationMessagePort,
  MessageStatusPort,
  PlatformEventDeliveryResult,
} from './ports'
import {
  isRecognizedPlatformEventKey,
  sanitizeExternalAttachmentURL,
  type MessagingPlatform,
  type NormalizedAttachment,
  type NormalizedInboundMessage,
  type NormalizedMessageStatus,
  type NormalizedPlatformEvent,
} from './types'

export const PLATFORM_EVENT_JOB_TYPE = 'platform.event.dispatch'

export type PlatformEventJobPayload = {
  event: NormalizedPlatformEvent
  eventDigest: string
  rawPayloadDigest: string
}

export class PlatformEventJobPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformEventJobPayloadError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const requiredString = (value: unknown, field: string, maxLength = 5_000): string => {
  if (typeof value !== 'string') {
    throw new PlatformEventJobPayloadError(`Platform event ${field} is invalid`)
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new PlatformEventJobPayloadError(`Platform event ${field} is invalid`)
  }
  return normalized
}

const optionalString = (value: unknown, field: string, maxLength = 5_000): string | undefined => {
  if (value === undefined) return undefined
  return requiredString(value, field, maxLength)
}

type ParsedBase = {
  accountExternalId: string
  externalEventId: string
  idempotencyKey: string
  occurredAt: string
  platform: MessagingPlatform
}

const parseBase = (value: Record<string, unknown>): ParsedBase => {
  const platform = requiredString(value.platform, 'platform', 30)
  if (platform !== 'facebook-messenger' && platform !== 'instagram' && platform !== 'tiktok') {
    throw new PlatformEventJobPayloadError('Platform event platform is unsupported')
  }
  const externalEventId = requiredString(value.externalEventId, 'externalEventId', 180)
  const accountExternalId = requiredString(value.accountExternalId, 'accountExternalId', 240)
  const idempotencyKey = requiredString(value.idempotencyKey, 'idempotencyKey', 200)
  if (!isRecognizedPlatformEventKey(platform, accountExternalId, externalEventId, idempotencyKey)) {
    throw new PlatformEventJobPayloadError('Platform event idempotency key is invalid')
  }
  const occurredAt = requiredString(value.occurredAt, 'occurredAt', 64)
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new PlatformEventJobPayloadError('Platform event occurredAt is invalid')
  }
  return {
    accountExternalId,
    externalEventId,
    idempotencyKey,
    occurredAt,
    platform,
  }
}

const parseAttachments = (value: unknown): NormalizedAttachment[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 10) {
    throw new PlatformEventJobPayloadError('Platform inbound attachments are invalid')
  }
  return value.map((attachment, index) => {
    if (!isRecord(attachment)) {
      throw new PlatformEventJobPayloadError(`Platform inbound attachment ${index} is invalid`)
    }
    const sha256 = optionalString(attachment.sha256, `attachments.${index}.sha256`, 64)
    if (sha256 && !/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new PlatformEventJobPayloadError(`Platform inbound attachment ${index} hash is invalid`)
    }
    const caption = optionalString(attachment.caption, `attachments.${index}.caption`, 5_000)
    const externalId = optionalString(attachment.externalId, `attachments.${index}.externalId`, 240)
    const fileName = optionalString(attachment.fileName, `attachments.${index}.fileName`, 255)
    const mimeType = optionalString(attachment.mimeType, `attachments.${index}.mimeType`, 255)
    const rawURL = optionalString(attachment.url, `attachments.${index}.url`, 2_048)
    const url = rawURL ? sanitizeExternalAttachmentURL(rawURL) : undefined
    return {
      ...(caption ? { caption } : {}),
      ...(externalId ? { externalId } : {}),
      ...(fileName ? { fileName } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(sha256 ? { sha256 } : {}),
      type: requiredString(attachment.type, `attachments.${index}.type`, 100),
      ...(url ? { url } : {}),
    }
  })
}

const parseInboundMessage = (
  value: Record<string, unknown>,
  base: ParsedBase,
  recipientExternalId: string,
): NormalizedInboundMessage => {
  if (!isRecord(value.content)) throw new PlatformEventJobPayloadError('Platform inbound content is invalid')
  const messageType = requiredString(value.content.messageType, 'content.messageType', 100)
  const text = optionalString(value.content.text, 'content.text', 5_000)
  const attachments = parseAttachments(value.content.attachments)
  if (!text && (!attachments || attachments.length === 0)) {
    throw new PlatformEventJobPayloadError('Platform inbound content is empty')
  }
  const contactName = optionalString(value.contactName, 'contactName', 240)
  return {
    ...base,
    ...(contactName ? { contactName } : {}),
    content: {
      ...(attachments ? { attachments } : {}),
      messageType,
      ...(text ? { text } : {}),
    },
    kind: 'inbound-message',
    recipientExternalId,
    senderExternalId: requiredString(value.senderExternalId, 'senderExternalId', 240),
  }
}

const parseMessageStatus = (
  value: Record<string, unknown>,
  base: ParsedBase,
  recipientExternalId: string,
): NormalizedMessageStatus => {
  const status = requiredString(value.status, 'status', 20)
  if (!['delivered', 'failed', 'read', 'sent'].includes(status)) {
    throw new PlatformEventJobPayloadError('Platform message status is invalid')
  }
  const errors = value.errors === undefined
    ? undefined
    : (() => {
        if (!Array.isArray(value.errors) || value.errors.length > 10) {
          throw new PlatformEventJobPayloadError('Platform message-status errors are invalid')
        }
        return value.errors.map((error, index) => {
          if (!isRecord(error)) {
            throw new PlatformEventJobPayloadError(`Platform message-status error ${index} is invalid`)
          }
          const code = optionalString(error.code, `errors.${index}.code`, 240)
          const title = optionalString(error.title, `errors.${index}.title`, 240)
          return {
            ...(code ? { code } : {}),
            message: requiredString(error.message, `errors.${index}.message`, 1_000),
            ...(title ? { title } : {}),
          }
        })
      })()
  return {
    ...base,
    ...(errors ? { errors } : {}),
    kind: 'message-status',
    messageExternalId: requiredString(value.messageExternalId, 'messageExternalId', 240),
    recipientExternalId,
    status: status as NormalizedMessageStatus['status'],
  }
}

const parseEvent = (value: unknown): NormalizedPlatformEvent => {
  if (!isRecord(value)) throw new PlatformEventJobPayloadError('Platform event is invalid')
  const base = parseBase(value)
  const kind = requiredString(value.kind, 'kind', 40)
  const recipientExternalId = requiredString(value.recipientExternalId, 'recipientExternalId', 240)
  if (
    (base.platform === 'facebook-messenger' || base.platform === 'instagram') &&
    recipientExternalId !== base.accountExternalId
  ) {
    throw new PlatformEventJobPayloadError('Meta recipient does not match the subscribed account')
  }
  if (kind === 'inbound-message') return parseInboundMessage(value, base, recipientExternalId)
  if (kind === 'message-status') return parseMessageStatus(value, base, recipientExternalId)
  throw new PlatformEventJobPayloadError('Platform event kind is unsupported')
}

export const parsePlatformEventJobPayload = (value: Record<string, unknown>): PlatformEventJobPayload => {
  const eventDigest = requiredString(value.eventDigest, 'eventDigest', 64)
  const rawPayloadDigest = requiredString(value.rawPayloadDigest, 'rawPayloadDigest', 64)
  if (!/^[a-f0-9]{64}$/i.test(eventDigest) || !/^[a-f0-9]{64}$/i.test(rawPayloadDigest)) {
    throw new PlatformEventJobPayloadError('Platform event digests are invalid')
  }
  return { event: parseEvent(value.event), eventDigest, rawPayloadDigest }
}

const unsupportedMessageStatusPort: MessageStatusPort = {
  async writeMessageStatus(status): Promise<PlatformEventDeliveryResult> {
    throw new PlatformEventJobPayloadError(
      `Platform message-status delivery is not configured for ${status.platform}`,
    )
  },
}

export const createPlatformEventJobHandler = ({
  conversations,
  messageStatuses = unsupportedMessageStatusPort,
}: {
  conversations: ConversationMessagePort
  messageStatuses?: MessageStatusPort
}): JobHandler => async (job, execution) => {
  const { event } = parsePlatformEventJobPayload(job.payload)
  execution.assertLease()
  await dispatchPlatformEvent(event, { conversations, messageStatuses })
  execution.assertLease()
}
