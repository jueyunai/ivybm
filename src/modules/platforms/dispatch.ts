import type {
  ConversationMessagePort,
  MessageStatusPort,
  PlatformEventDeliveryResult,
} from './ports'
import type { NormalizedPlatformEvent } from './types'

type PlatformEventDestinations = {
  conversations: ConversationMessagePort
  messageStatuses: MessageStatusPort
}

export const dispatchPlatformEvent = async (
  event: NormalizedPlatformEvent,
  destinations: PlatformEventDestinations,
): Promise<PlatformEventDeliveryResult> => {
  if (event.kind === 'inbound-message') {
    return await destinations.conversations.writeInboundMessage(event)
  }

  return await destinations.messageStatuses.writeMessageStatus(event)
}
