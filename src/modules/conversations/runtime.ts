import { getPayload, type Payload, type PayloadRequest } from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'
import { PayloadConversationLeadSink } from '@/modules/leads/conversationLeadSink'

import { PayloadConversationRepository } from './payloadRepository'
import { createPayloadConversationResponder } from './payloadResponder'
import { createConversationService } from './service'

let payloadPromise: Promise<Payload> | undefined

export const getChatPayload = (): Promise<Payload> => {
  payloadPromise ??= getPayload({ config, disableOnInit: true, key: 'chat-service' })
  return payloadPromise
}

type ChatRuntimeOptions = {
  actor?: User
  req?: PayloadRequest
  sessionTokenHash?: string
}

export const createPayloadChatService = async (options: ChatRuntimeOptions = {}) => {
  const payload = await getChatPayload()
  return createConversationService({
    leadSink: new PayloadConversationLeadSink(),
    repository: new PayloadConversationRepository({
      actor: options.actor,
      payload,
      readReq: options.req,
      sessionTokenHash: options.sessionTokenHash,
    }),
    responder: createPayloadConversationResponder(payload),
  })
}
