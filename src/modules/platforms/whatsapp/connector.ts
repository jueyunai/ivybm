import type { PlatformConnector } from '../ports'
import {
  type NormalizedAttachment,
  type NormalizedMessageStatus,
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

const secondsValue = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}

const contactNames = (contacts: unknown): Map<string, string> => {
  const names = new Map<string, string>()
  if (!Array.isArray(contacts)) return names

  for (const contact of contacts) {
    if (!isRecord(contact)) continue
    const id = stringValue(contact.wa_id)
    const name = isRecord(contact.profile) ? stringValue(contact.profile.name) : undefined
    if (id && name) names.set(id, name)
  }
  return names
}

const mediaAttachment = (message: UnknownRecord, type: string): NormalizedAttachment[] => {
  const media = isRecord(message[type]) ? message[type] : undefined
  if (!media) return []

  return [
    {
      type,
      ...(stringValue(media.caption) ? { caption: stringValue(media.caption) } : {}),
      ...(stringValue(media.filename) ? { fileName: stringValue(media.filename) } : {}),
      ...(stringValue(media.id) ? { externalId: stringValue(media.id) } : {}),
      ...(stringValue(media.mime_type) ? { mimeType: stringValue(media.mime_type) } : {}),
      ...(stringValue(media.sha256) ? { sha256: stringValue(media.sha256) } : {}),
    },
  ]
}

const messageContent = (message: UnknownRecord, type: string): NormalizedMessageContent => {
  if (type === 'text' && isRecord(message.text)) {
    const text = stringValue(message.text.body)
    return { messageType: type, ...(text ? { text } : {}) }
  }
  if (type === 'button' && isRecord(message.button)) {
    const text = stringValue(message.button.text)
    return {
      messageType: type,
      ...(text ? { text } : {}),
    }
  }
  if (type === 'interactive' && isRecord(message.interactive)) {
    const reply = isRecord(message.interactive.button_reply)
      ? message.interactive.button_reply
      : isRecord(message.interactive.list_reply)
        ? message.interactive.list_reply
        : undefined
    const text = reply ? stringValue(reply.title) : undefined
    return { messageType: type, ...(text ? { text } : {}) }
  }

  const attachments = mediaAttachment(message, type)
  return {
    ...(attachments.length > 0 ? { attachments } : {}),
    messageType: type,
    ...(attachments[0]?.caption ? { text: attachments[0].caption } : {}),
  }
}

const statusErrors = (value: unknown): NormalizedMessageStatus['errors'] => {
  if (!Array.isArray(value)) return undefined
  const errors = value.flatMap((error) => {
    if (!isRecord(error)) return []
    const message = stringValue(error.message) ?? stringValue(error.title)
    if (!message) return []
    return [
      {
        ...(error.code !== undefined ? { code: String(error.code) } : {}),
        message,
        ...(stringValue(error.title) ? { title: stringValue(error.title) } : {}),
      },
    ]
  })
  return errors.length > 0 ? errors : undefined
}

const messageStatus = (value: unknown): NormalizedMessageStatus['status'] | undefined => {
  if (value === 'sent' || value === 'delivered' || value === 'read' || value === 'failed') {
    return value
  }
  return undefined
}

export const createWhatsAppConnector = (): PlatformConnector => ({
  platformFamily: 'meta',
  normalize: (payload: unknown): NormalizedPlatformEvent[] => {
    if (!isRecord(payload) || payload.object !== 'whatsapp_business_account') {
      throw new Error('Unsupported WhatsApp webhook object')
    }
    if (!Array.isArray(payload.entry)) throw new Error('WhatsApp webhook entry must be an array')

    const events: NormalizedPlatformEvent[] = []
    for (const entry of payload.entry) {
      if (!isRecord(entry) || !Array.isArray(entry.changes)) continue

      for (const change of entry.changes) {
        if (!isRecord(change) || change.field !== 'messages' || !isRecord(change.value)) continue
        const value = change.value
        if (value.messaging_product !== 'whatsapp') {
          throw new Error('WhatsApp webhook messaging_product is invalid')
        }
        const accountExternalId = isRecord(value.metadata)
          ? stringValue(value.metadata.phone_number_id)
          : undefined
        const hasEvents = Array.isArray(value.messages) || Array.isArray(value.statuses)
        if (!accountExternalId && hasEvents) {
          throw new Error('WhatsApp webhook metadata is missing phone_number_id')
        }
        if (!accountExternalId) continue

        const names = contactNames(value.contacts)
        if (Array.isArray(value.messages)) {
          for (const message of value.messages) {
            if (!isRecord(message)) continue
            const senderExternalId = stringValue(message.from)
            const externalEventId = stringValue(message.id)
            const timestamp = secondsValue(message.timestamp)
            const type = stringValue(message.type)
            if (!senderExternalId || !externalEventId || !timestamp || !type) {
              throw new Error(
                'WhatsApp message is missing required identifiers, type, or timestamp',
              )
            }

            events.push({
              accountExternalId,
              ...(names.get(senderExternalId) ? { contactName: names.get(senderExternalId) } : {}),
              content: messageContent(message, type),
              externalEventId,
              idempotencyKey: platformEventKey('whatsapp', externalEventId),
              kind: 'inbound-message',
              occurredAt: platformTimestamp(timestamp, 'seconds'),
              platform: 'whatsapp',
              recipientExternalId: accountExternalId,
              senderExternalId,
            })
          }
        }

        if (Array.isArray(value.statuses)) {
          for (const item of value.statuses) {
            if (!isRecord(item)) continue
            const messageExternalId = stringValue(item.id)
            const recipientExternalId = stringValue(item.recipient_id)
            const status = messageStatus(item.status)
            const timestamp = secondsValue(item.timestamp)
            if (!messageExternalId || !recipientExternalId || !status || !timestamp) {
              throw new Error(
                'WhatsApp status is missing required identifiers, status, or timestamp',
              )
            }
            const externalEventId = `${messageExternalId}:${status}:${String(item.timestamp)}`
            const errors = statusErrors(item.errors)

            events.push({
              accountExternalId,
              ...(errors ? { errors } : {}),
              externalEventId,
              idempotencyKey: platformEventKey('whatsapp', externalEventId),
              kind: 'message-status',
              messageExternalId,
              occurredAt: platformTimestamp(timestamp, 'seconds'),
              platform: 'whatsapp',
              recipientExternalId,
              status,
            })
          }
        }
      }
    }

    return events
  },
})
