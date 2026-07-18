import type { PlatformConnector } from '../ports'
import {
  type MessagingPlatform,
  type NormalizedAttachment,
  type NormalizedMessageContent,
  type NormalizedPlatformEvent,
  platformEventKey,
  platformTimestamp,
} from '../types'

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const numericValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const normalizeAttachments = (value: unknown): NormalizedAttachment[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((attachment) => {
    if (!isRecord(attachment)) return []
    const type = stringValue(attachment.type)
    const payload = isRecord(attachment.payload) ? attachment.payload : {}
    if (!type) return []

    return [
      {
        type,
        ...(stringValue(payload.url) ? { url: stringValue(payload.url) } : {}),
      },
    ]
  })
}

const normalizeContent = (message: UnknownRecord): NormalizedMessageContent => {
  const text = stringValue(message.text)
  const attachments = normalizeAttachments(message.attachments)

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
      const accountExternalId = stringValue(entry.id)
      if (!accountExternalId || !Array.isArray(entry.messaging)) continue

      for (const envelope of entry.messaging) {
        if (!isRecord(envelope) || !isRecord(envelope.message)) continue
        const message = envelope.message
        if (message.is_echo === true) continue

        const externalEventId = stringValue(message.mid)
        const senderExternalId = isRecord(envelope.sender)
          ? stringValue(envelope.sender.id)
          : undefined
        const recipientExternalId = isRecord(envelope.recipient)
          ? stringValue(envelope.recipient.id)
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
