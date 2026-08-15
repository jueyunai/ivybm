import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import type { AiGateway } from '@/modules/ai/gateway'
import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'
import { retrieveKnowledgeForQuery } from '@/modules/knowledge/retrieve'

import { ChatServiceError } from './contracts'
import { createKnowledgeConversationResponder } from './responder'
import type { ConversationResponder } from './service'

/** Build one reusable knowledge-backed responder for an initialized Payload runtime. */
export const createPayloadConversationResponder = (payload: Payload): ConversationResponder => {
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

  return createKnowledgeConversationResponder({
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
}
