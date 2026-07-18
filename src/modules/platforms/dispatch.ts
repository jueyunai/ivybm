import type { ConversationMessagePort, MessageStatusPort } from './ports'
import type { NormalizedPlatformEvent } from './types'

type PlatformEventDestinations = {
  conversations: ConversationMessagePort
  messageStatuses: MessageStatusPort
}

export const dispatchPlatformEvent = async (
  event: NormalizedPlatformEvent,
  destinations: PlatformEventDestinations,
): Promise<void> => {
  if (event.kind === 'inbound-message') {
    await destinations.conversations.writeInboundMessage(event)
    return
  }

  await destinations.messageStatuses.writeMessageStatus(event)
}
