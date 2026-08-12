import { createHash } from 'node:crypto'

import type { PlatformMessagingAccountAuthorizer } from './payloadMessagingAccountAuthorizer'
import type { MessagingPlatform, NormalizedInboundMessage } from './types'

type MetaMessagingPlatform = Extract<MessagingPlatform, 'facebook-messenger' | 'instagram'>

declare const authorizedInboundMessageBrand: unique symbol
const authorizedInboundMessages = new WeakSet<object>()
const installationNamespaces = new WeakMap<object, string>()

/**
 * Process-local proof that a worker re-authorized the normalized event against
 * PlatformAccounts. It cannot be serialized into a Job payload or constructed
 * structurally outside this module.
 */
export type AuthorizedInboundMessage = NormalizedInboundMessage & {
  readonly [authorizedInboundMessageBrand]: true
}

export type VerifiedSocialContactSource = {
  readonly accountExternalId: string
  readonly identityKey: string
  readonly kind: 'verified-social-session'
  readonly platform: MetaMessagingPlatform
  readonly senderExternalId: string
}

const boundedIdentifier = (value: string, label: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`${label} is invalid`)
  }
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized !== value ||
    !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) {
    throw new Error(`${label} is invalid`)
  }
  return normalized
}

/**
 * Re-authorizes the normalized event against the current PlatformAccount state.
 * Webhook signature verification happens before enqueue; this second check is
 * required because account access may change while an event is waiting in a Job.
 */
export const reauthorizeInboundMessage = async ({
  authorizer,
  installationNamespace,
  message,
}: {
  authorizer: PlatformMessagingAccountAuthorizer
  installationNamespace: string
  message: NormalizedInboundMessage
}): Promise<AuthorizedInboundMessage> => {
  if (message.platform !== 'facebook-messenger' && message.platform !== 'instagram') {
    throw new Error('Verified social contact source is supported only for Meta messaging')
  }
  const accountExternalId = boundedIdentifier(message.accountExternalId, 'Social account ID')
  boundedIdentifier(message.senderExternalId, 'Social sender ID')
  const recipientExternalId = boundedIdentifier(
    message.recipientExternalId,
    'Social message recipient ID',
  )
  if (recipientExternalId !== accountExternalId) {
    throw new Error('Social message recipient does not match the authorized account')
  }
  const namespace = boundedIdentifier(installationNamespace, 'Installation namespace')

  await authorizer.assertCanReceive({
    accountExternalId,
    platform: message.platform,
  })

  const authorized = Object.freeze({ ...message }) as AuthorizedInboundMessage
  authorizedInboundMessages.add(authorized)
  installationNamespaces.set(authorized, namespace)
  return authorized
}

export const verifiedSocialContactSource = (
  message: AuthorizedInboundMessage,
): VerifiedSocialContactSource => {
  if (!authorizedInboundMessages.has(message)) {
    throw new Error('Social message has not been authorized')
  }
  if (message.platform !== 'facebook-messenger' && message.platform !== 'instagram') {
    throw new Error('Verified social contact source is supported only for Meta messaging')
  }
  const accountExternalId = boundedIdentifier(message.accountExternalId, 'Social account ID')
  const senderExternalId = boundedIdentifier(message.senderExternalId, 'Social sender ID')
  if (message.recipientExternalId.trim() !== accountExternalId) {
    throw new Error('Social message recipient does not match the authorized account')
  }
  const installationNamespace = boundedIdentifier(
    installationNamespaces.get(message) ?? '',
    'Installation namespace',
  )
  const identityKey = createHash('sha256')
    .update(
      `${installationNamespace}\u0000${message.platform}\u0000${accountExternalId}\u0000${senderExternalId}`,
    )
    .digest('hex')

  return {
    accountExternalId,
    identityKey: `social-contact:v2:${message.platform}:${identityKey}`,
    kind: 'verified-social-session',
    platform: message.platform,
    senderExternalId,
  }
}
