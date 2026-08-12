import type { PlatformMessagingAccountAuthorizer } from './payloadMessagingAccountAuthorizer'
import type { PlatformEventDeliveryResult } from './ports'
import {
  reauthorizeInboundMessage,
  verifiedSocialContactSource,
  type AuthorizedInboundMessage,
  type VerifiedSocialContactSource,
} from './socialContactIdentity'
import type { NormalizedInboundMessage } from './types'

export type VerifiedSocialInboundDelivery = {
  readonly contactSource: VerifiedSocialContactSource
  readonly message: AuthorizedInboundMessage
}

/**
 * Task 13 boundary implemented by the future reviewed Conversation/Lead adapter.
 * The adapter must persistently deduplicate by message.idempotencyKey and store
 * contactSource as the real reply-capable contact channel; it must not invent an email.
 */
export interface VerifiedSocialConversationPort {
  writeVerifiedInboundMessage(
    delivery: VerifiedSocialInboundDelivery,
  ): Promise<PlatformEventDeliveryResult>
}

/**
 * Worker-side orchestration. Account authorization is deliberately performed
 * immediately before the Conversation/Lead write because webhook authorization
 * may be stale by the time an at-least-once Job executes.
 */
export const deliverVerifiedSocialInbound = async ({
  accountAuthorizer,
  destination,
  installationNamespace,
  message,
}: {
  accountAuthorizer: PlatformMessagingAccountAuthorizer
  destination: VerifiedSocialConversationPort
  installationNamespace: string
  message: NormalizedInboundMessage
}): Promise<PlatformEventDeliveryResult> => {
  const authorizedMessage = await reauthorizeInboundMessage({
    authorizer: accountAuthorizer,
    installationNamespace,
    message,
  })
  const contactSource = verifiedSocialContactSource(authorizedMessage)

  return await destination.writeVerifiedInboundMessage(
    Object.freeze({ contactSource, message: authorizedMessage }),
  )
}
