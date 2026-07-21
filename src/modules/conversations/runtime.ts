import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'
import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'
import type { AiGateway } from '@/modules/ai/gateway'
import { retrieveKnowledgeForQuery } from '@/modules/knowledge/retrieve'
import { PayloadConversationLeadSink } from '@/modules/leads/conversationLeadSink'

import { ChatServiceError } from './contracts'
import { PayloadConversationRepository } from './payloadRepository'
import { createKnowledgeConversationResponder } from './responder'
import { createConversationService } from './service'

let payloadPromise: Promise<Payload> | undefined

export const getChatPayload = (): Promise<Payload> => {
  payloadPromise ??= getPayload({ config, disableOnInit: true, key: 'chat-service' })
  return payloadPromise
}

type ChatRuntimeOptions = {
  actor?: User
  sessionTokenHash?: string
}

export const createPayloadChatService = async (options: ChatRuntimeOptions = {}) => {
  const payload = await getChatPayload()
  let gatewayPromise: Promise<AiGateway> | undefined
  const getGateway = () => {
    gatewayPromise ??= resolveAiGateway({
      payload,
      routes: [
        { operation: 'text', usageKey: AI_USAGE_KEYS.chatReply },
        { operation: 'embedding', usageKey: AI_USAGE_KEYS.knowledgeEmbedding },
      ],
    }).catch((error) => {
      throw new ChatServiceError('ai_unavailable', 'AI service is not configured', {
        cause: error,
        retryable: true,
      })
    })
    return gatewayPromise
  }
  const responder = createKnowledgeConversationResponder({
    generateText: async (input) => (await getGateway()).generateText(input),
    getPrompt: async (locale) => {
      const result = await payload.find({
        collection: 'prompt-templates',
        limit: 1,
        overrideAccess: true,
        sort: '-version',
        where: {
          and: [
            { purpose: { equals: 'customer-chat' } },
            { status: { equals: 'active' } },
            { or: [{ locale: { equals: locale } }, { locale: { equals: 'all' } }] },
          ],
        },
      })
      const prompt = result.docs[0]
      return prompt ? { template: prompt.template, version: prompt.version } : null
    },
    retrieve: async ({ locale, query }) =>
      retrieveKnowledgeForQuery({
        customerVisible: true,
        gateway: await getGateway(),
        locale,
        minScore: 0.2,
        pool: (payload.db as unknown as PostgresAdapter).pool,
        query,
      }),
  })
  return createConversationService({
    leadSink: new PayloadConversationLeadSink(),
    repository: new PayloadConversationRepository({
      actor: options.actor,
      payload,
      sessionTokenHash: options.sessionTokenHash,
    }),
    responder,
  })
}
