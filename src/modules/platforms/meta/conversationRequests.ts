import type { MessagingPlatform } from '../types'

/**
 * Pure, credential-free builders and parsers for one Meta Send API text reply
 * (POST /me/messages with a Page access token), shared by facebook-messenger and instagram
 * channels of the phase-one conversation outbound contract.
 *
 * This module performs no fetch, no network, no config/env access and never
 * sees a Page access token: the outbound adapter attaches the credential at
 * transport time, outside of these pure helpers.
 *
 * NOTE: Meta documents no proven request idempotency key for the Send API and
 * no provider lookup that can confirm acceptance by an IVYBM deliveryKey, so
 * neither is invented here. An unknown send outcome must therefore be handled
 * by the upper PlatformConversationOutbound contract as `delivery_unknown`
 * with manual compensation — never by a blind retry that could double-send a
 * customer reply.
 */

export type MetaConversationReplyPlatform = Extract<
  MessagingPlatform,
  'facebook-messenger' | 'instagram'
>

export type MetaConversationReplyInput = {
  platform: MetaConversationReplyPlatform
  /** Recipient-scoped ID (PSID / IGSID): bounded decimal identifier. */
  recipientExternalId: string
  text: string
}

export type MetaConversationReplyRequest = {
  body: {
    message: { text: string }
    messaging_type: 'RESPONSE'
    recipient: { id: string }
  }
  method: 'POST'
  /** Page access tokens resolve `/me` to the authorized Facebook Page. */
  path: '/me/messages'
}

export type MetaConversationReplyAcceptance = {
  messageId: string
  recipientExternalId: string
}

export class MetaConversationReplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetaConversationReplyError'
  }
}

const META_REPLY_PLATFORMS: readonly MetaConversationReplyPlatform[] = [
  'facebook-messenger',
  'instagram',
]

const MAX_DECIMAL_ID_LENGTH = 64
const MAX_FACEBOOK_TEXT_CHARACTERS = 2_000
const MAX_INSTAGRAM_TEXT_BYTES = 1_000
const MAX_MESSAGE_ID_LENGTH = 512

const DECIMAL_ID_PATTERN = /^\d{1,64}$/
// C0, DEL and C1 control characters are never valid inside a provider message ID.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/
const WHITESPACE_PATTERN = /\s/u

const decimalId = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || !DECIMAL_ID_PATTERN.test(normalized)) {
    throw new MetaConversationReplyError(
      `${label} must be a decimal identifier of at most ${MAX_DECIMAL_ID_LENGTH} digits`,
    )
  }
  return normalized
}

/**
 * Build the exact Send API request for one text reply. The output contains no
 * Authorization header, token, delivery key, conversation state or intent ID.
 */
export const buildMetaConversationReplyRequest = (
  input: MetaConversationReplyInput,
): MetaConversationReplyRequest => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MetaConversationReplyError('Meta conversation reply input must be an object')
  }
  if (!META_REPLY_PLATFORMS.includes(input.platform)) {
    throw new MetaConversationReplyError(
      'Meta conversation reply platform must be facebook-messenger or instagram',
    )
  }

  const recipientExternalId = decimalId(input.recipientExternalId, 'Meta recipient external ID')

  if (typeof input.text !== 'string') {
    throw new MetaConversationReplyError('Meta conversation reply text must be a string')
  }
  const text = input.text.trim()
  if (!text) throw new MetaConversationReplyError('Meta conversation reply text must be non-empty')
  const exceedsPlatformLimit =
    input.platform === 'instagram'
      ? new TextEncoder().encode(text).byteLength > MAX_INSTAGRAM_TEXT_BYTES
      : Array.from(text).length > MAX_FACEBOOK_TEXT_CHARACTERS
  if (exceedsPlatformLimit) {
    const limitDescription =
      input.platform === 'instagram'
        ? `${MAX_INSTAGRAM_TEXT_BYTES} UTF-8 bytes`
        : `${MAX_FACEBOOK_TEXT_CHARACTERS} characters`
    throw new MetaConversationReplyError(
      `Meta conversation reply text must be at most ${limitDescription} for ${input.platform}`,
    )
  }

  return {
    body: {
      message: { text },
      messaging_type: 'RESPONSE',
      recipient: { id: recipientExternalId },
    },
    method: 'POST',
    path: '/me/messages',
  }
}

/**
 * Normalize a Send API success body ({recipient_id, message_id}) from an
 * already-decoded unknown value. Errors are sanitized: they describe the
 * validation failure but never echo the raw provider body, which may carry
 * provider-internal detail.
 */
export const parseMetaConversationReplyResponse = (
  value: unknown,
): MetaConversationReplyAcceptance => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MetaConversationReplyError('Meta conversation reply response must be an object')
  }

  const body = value as Record<string, unknown>
  const recipientExternalId = decimalId(body.recipient_id, 'Meta response recipient_id')

  if (typeof body.message_id !== 'string') {
    throw new MetaConversationReplyError('Meta response message_id must be a string')
  }
  const rawMessageId = body.message_id
  const messageId = rawMessageId.trim()
  if (rawMessageId !== messageId) {
    throw new MetaConversationReplyError(
      'Meta response message_id must not contain leading or trailing whitespace',
    )
  }
  if (!messageId || messageId.length > MAX_MESSAGE_ID_LENGTH) {
    throw new MetaConversationReplyError(
      `Meta response message_id must be a non-empty identifier of at most ${MAX_MESSAGE_ID_LENGTH} characters`,
    )
  }
  if (CONTROL_CHARACTER_PATTERN.test(messageId) || WHITESPACE_PATTERN.test(messageId)) {
    throw new MetaConversationReplyError(
      'Meta response message_id must not contain control characters or whitespace',
    )
  }

  return { messageId, recipientExternalId }
}
