import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'
import { createAiGateway } from '@/modules/ai/gateway'
import { createOpenAICompatibleProvider } from '@/modules/ai/providers/openaiCompatible'
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

const requiredAIConfig = () => {
  const apiKey = process.env.AI_PROVIDER_API_KEY
  const baseURL = process.env.AI_PROVIDER_BASE_URL
  const embedding = process.env.AI_EMBEDDING_MODEL
  const text = process.env.AI_TEXT_MODEL
  if (!apiKey || !baseURL || !embedding || !text) {
    throw new ChatServiceError('ai_unavailable', 'AI service is not configured', {
      retryable: true,
    })
  }
  return { apiKey, baseURL, embedding, text }
}

type ChatRuntimeOptions = {
  actor?: User
  sessionTokenHash?: string
}

export const createPayloadChatService = async (options: ChatRuntimeOptions = {}) => {
  const payload = await getChatPayload()
  const getGateway = () => {
    const ai = requiredAIConfig()
    return createAiGateway({
      models: { embedding: ai.embedding, text: ai.text },
      provider: createOpenAICompatibleProvider({ apiKey: ai.apiKey, baseURL: ai.baseURL }),
      timeouts: {
        embedMs: Number(process.env.AI_EMBEDDING_TIMEOUT_MS) || 15_000,
        generateTextMs: Number(process.env.AI_TEXT_TIMEOUT_MS) || 30_000,
      },
    })
  }
  const responder = createKnowledgeConversationResponder({
    generateText: async (input) => getGateway().generateText(input),
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
        gateway: getGateway(),
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
