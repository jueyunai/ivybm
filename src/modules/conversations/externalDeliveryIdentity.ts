import { createHash } from 'node:crypto'

import type { IngestExternalMessageInput } from './contracts'

type ExternalConversationChannel = IngestExternalMessageInput['channel']

const platformForChannel = (channel: ExternalConversationChannel): string => {
  if (channel === 'facebook') return 'facebook-messenger'
  return channel
}

/**
 * Derive durable command identities inside the authoritative conversation service.
 * Connector-supplied event keys are intentionally not accepted here: a retry must
 * remain the same delivery even if an upstream queue or connector changes its
 * transport idempotency key. The formats deliberately match the already-released
 * Meta connector, so an upgrade can resume an existing external thread instead of
 * silently creating a replacement conversation.
 */
export const externalMessageIdentifierMaxLength = (channel: ExternalConversationChannel): number =>
  200 - `${platformForChannel(channel)}:`.length

export const externalMessageCommandKey = (
  channel: ExternalConversationChannel,
  externalMessageId: string,
): string => `${platformForChannel(channel)}:${externalMessageId}`

export const externalMessagePersistenceKey = (
  channel: ExternalConversationChannel,
  externalMessageId: string,
): string => `platform-message:${externalMessageCommandKey(channel, externalMessageId)}`

export const externalSessionCommandKey = (
  channel: ExternalConversationChannel,
  externalAccountId: string,
  externalSenderId: string,
): string => {
  const platform = platformForChannel(channel)
  const fingerprint = createHash('sha256')
    .update(`${platform}\u0000${externalAccountId}\u0000${externalSenderId}`)
    .digest('hex')

  return `platform-session:${platform}:${fingerprint}`
}
