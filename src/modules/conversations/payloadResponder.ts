import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { AiGatewayError, AiProviderError, type AiGateway } from '@/modules/ai/gateway'
import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'
import { retrieveKnowledgeForQuery } from '@/modules/knowledge/retrieve'

import { ChatServiceError } from './contracts'
import { createKnowledgeConversationResponder } from './responder'
import type { ConversationResponder } from './service'

/** Build one reusable knowledge-backed responder for an initialized Payload runtime. */
export const createPayloadConversationResponder = (payload: Payload): ConversationResponder => {
  let gatewayPromise: Promise<AiGateway> | undefined
  const getGateway = () => {
    if (!gatewayPromise) {
      gatewayPromise = resolveAiGateway({
        payload,
        routes: [
          { operation: 'text', usageKey: AI_USAGE_KEYS.chatReply },
          { operation: 'embedding', usageKey: AI_USAGE_KEYS.knowledgeEmbedding },
        ],
      }).catch((error) => {
        // Do not cache a rejected configuration/database lookup for the entire
        // process lifetime. A later command must be able to resolve it again.
        gatewayPromise = undefined
        throw new ChatServiceError('ai_unavailable', 'AI service is not configured', {
          cause: error,
          retryable: true,
        })
      })
    }
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

  return {
    async generateReply(input) {
      try {
        return await responder.generateReply(input)
      } catch (error) {
        const providerError =
          error instanceof AiGatewayError || error instanceof AiProviderError ? error : undefined
        const serviceError = error instanceof ChatServiceError ? error : undefined
        payload.logger.error({
          channel: input.session.channel,
          conversationId: String(input.session.id),
          errorCode: providerError?.code ?? serviceError?.code ?? 'unknown',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          event: 'conversation.ai.reply.failed',
          providerStatus: providerError?.status,
          requestId: input.session.requestId,
          retryable: providerError?.retryable ?? serviceError?.retryable ?? true,
        })
        throw error
      }
    },
  }
}
