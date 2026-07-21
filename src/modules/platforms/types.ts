export type PlatformFamily = 'linkedin' | 'meta' | 'tiktok'

export type MessagingPlatform = 'facebook-messenger' | 'instagram' | 'tiktok'

export type PublishingPlatform = 'facebook' | 'instagram' | 'linkedin'

export type PlatformAvailability = 'available' | 'blocked' | 'conditional'

export type PublishingMode = 'assisted' | 'automatic'

export type NormalizedAttachment = {
  caption?: string
  externalId?: string
  fileName?: string
  mimeType?: string
  sha256?: string
  type: string
  url?: string
}

export type NormalizedMessageContent = {
  attachments?: NormalizedAttachment[]
  messageType: string
  text?: string
}

type NormalizedEventBase = {
  accountExternalId: string
  externalEventId: string
  idempotencyKey: string
  occurredAt: string
  platform: MessagingPlatform
}

export type NormalizedInboundMessage = NormalizedEventBase & {
  contactName?: string
  content: NormalizedMessageContent
  kind: 'inbound-message'
  recipientExternalId: string
  senderExternalId: string
}

export type NormalizedMessageStatus = NormalizedEventBase & {
  errors?: Array<{ code?: string; message: string; title?: string }>
  kind: 'message-status'
  messageExternalId: string
  recipientExternalId: string
  status: 'delivered' | 'failed' | 'read' | 'sent'
}

export type NormalizedPlatformEvent = NormalizedInboundMessage | NormalizedMessageStatus

export type PublicationAsset = {
  fileName: string
  id: string
  mimeType: string
  sourceUrl?: string
}

export type PlatformCapability = {
  availability: PlatformAvailability
  modes: PublishingMode[]
  platform: PublishingPlatform
  reason?: string
}

export type PlatformPublishRequest = {
  assets: PublicationAsset[]
  idempotencyKey: string
  platform: PublishingPlatform
  scheduledFor?: string
  text: string
}

export type PlatformPublishAcceptance = {
  idempotencyKey: string
  platform: PublishingPlatform
  status: 'accepted' | 'blocked'
}

export type PlatformPublicationStatus = {
  errorCode?: string
  externalPublicationId?: string
  platform: PublishingPlatform
  status: 'failed' | 'pending' | 'published' | 'publishing'
}

export type AssistedPublicationExport = {
  assets: PublicationAsset[]
  checklist: string[]
  copyText: string
  mode: 'assisted'
  platform: 'linkedin'
}

export const platformEventKey = (platform: MessagingPlatform, externalEventId: string): string => {
  if (!externalEventId.trim()) throw new Error('Platform external event ID is required')
  return `${platform}:${externalEventId}`
}

export const platformTimestamp = (value: number, unit: 'milliseconds' | 'seconds'): string => {
  const timestamp = unit === 'seconds' ? value * 1_000 : value
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('Platform event timestamp is invalid')
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) throw new Error('Platform event timestamp is invalid')
  return date.toISOString()
}
