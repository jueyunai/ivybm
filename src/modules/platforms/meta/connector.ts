import type { PlatformConnector } from '../ports'
import {
  type MessagingPlatform,
  type NormalizedAttachment,
  type NormalizedMessageContent,
  type NormalizedPlatformEvent,
  platformEventKey,
  platformTimestamp,
  sanitizeExternalAttachmentURL,
} from '../types'

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const stringValue = (value: unknown, maxLength = 5_000): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

const numericValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const normalizeAttachments = (value: unknown): NormalizedAttachment[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error('Meta message attachments are invalid')
  }

  return value.map((attachment, index) => {
    if (!isRecord(attachment)) throw new Error(`Meta attachment ${index} is invalid`)
    const type = stringValue(attachment.type, 100)
    const attachmentPayload = isRecord(attachment.payload) ? attachment.payload : undefined
    if (!type || !attachmentPayload) throw new Error(`Meta attachment ${index} is invalid`)
    const rawURL = stringValue(attachmentPayload.url, 2_048)
    const url = rawURL ? sanitizeExternalAttachmentURL(rawURL) : undefined
    return { type, ...(url ? { url } : {}) }
  })
}

const normalizeContent = (message: UnknownRecord): NormalizedMessageContent => {
  const text = stringValue(message.text, 5_000)
  const attachments = normalizeAttachments(message.attachments)

  if (!text && attachments.length === 0) {
    throw new Error('Meta message content is empty')
  }

  return {
    ...(attachments.length > 0 ? { attachments } : {}),
    messageType: text ? 'text' : (attachments[0]?.type ?? 'unknown'),
    ...(text ? { text } : {}),
  }
}

const platformForObject = (object: unknown): MessagingPlatform => {
  if (object === 'page') return 'facebook-messenger'
  if (object === 'instagram') return 'instagram'
  throw new Error('Unsupported Meta webhook object')
}

export const createMetaConnector = (): PlatformConnector => ({
  platformFamily: 'meta',
  normalize: (payload: unknown): NormalizedPlatformEvent[] => {
    if (!isRecord(payload)) throw new Error('Meta webhook payload must be an object')
    const platform = platformForObject(payload.object)
    if (!Array.isArray(payload.entry)) throw new Error('Meta webhook entry must be an array')

    const events: NormalizedPlatformEvent[] = []
    for (const entry of payload.entry) {
      if (!isRecord(entry)) continue
      const accountExternalId = stringValue(entry.id, 240)
      if (!accountExternalId || !Array.isArray(entry.messaging)) continue

      for (const envelope of entry.messaging) {
        if (!isRecord(envelope) || !isRecord(envelope.message)) continue
        const message = envelope.message
        if (message.is_echo === true) continue

        const externalEventId = stringValue(message.mid, 180)
        const senderExternalId = isRecord(envelope.sender)
          ? stringValue(envelope.sender.id, 240)
          : undefined
        const recipientExternalId = isRecord(envelope.recipient)
          ? stringValue(envelope.recipient.id, 240)
          : undefined
        const timestamp = numericValue(envelope.timestamp)
        if (!externalEventId || !senderExternalId || !recipientExternalId || !timestamp) {
          throw new Error('Meta message event is missing required identifiers or timestamp')
        }
        if (recipientExternalId !== accountExternalId) {
          throw new Error('Meta message recipient does not match the webhook account')
        }

        events.push({
          accountExternalId,
          content: normalizeContent(message),
          externalEventId,
          idempotencyKey: platformEventKey(platform, externalEventId),
          kind: 'inbound-message',
          occurredAt: platformTimestamp(timestamp, 'milliseconds'),
          platform,
          recipientExternalId,
          senderExternalId,
        })
      }
    }

    return events
  },
})
