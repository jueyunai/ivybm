import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'
import type { AiGateway } from '@/modules/ai/gateway'
import type { ChatLocale, ChatSession } from '@/modules/conversations/contracts'
import { createKnowledgeConversationResponder } from '@/modules/conversations/responder'

import { retrieveKnowledgeForQuery } from './retrieve'

export type KnowledgePreviewResult =
  | {
      citations: Array<{ documentId: number | string; title: string; url?: string; version: string }>
      content: string
      estimatedCostUSD?: number | null
      model: string
      outcome: 'answer'
      promptVersion: number
      tokenUsage: { inputTokens: number; outputTokens?: number; totalTokens: number }
    }
  | {
      outcome: 'handoff'
      reason: string
    }

const previewSession = (locale: ChatLocale): ChatSession => ({
  allowedActions: [],
  channel: 'website',
  handoffStatus: 'ai_active',
  id: 'knowledge-preview',
  locale,
  messages: [],
  requestId: 'knowledge-preview',
  revision: 1,
})

export const previewKnowledgeAnswer = async ({
  locale,
  payload,
  query,
}: {
  locale: ChatLocale
  payload: Payload
  query: string
}): Promise<KnowledgePreviewResult> => {
  let gatewayPromise: Promise<AiGateway> | undefined
  const getGateway = () => {
    gatewayPromise ??= resolveAiGateway({
      payload,
      routes: [
        { operation: 'text', usageKey: AI_USAGE_KEYS.chatReply },
        { operation: 'embedding', usageKey: AI_USAGE_KEYS.knowledgeEmbedding },
      ],
    })
    return gatewayPromise
  }
  const responder = createKnowledgeConversationResponder({
    generateText: async (input) => (await getGateway()).generateText(input),
    getPrompt: async (promptLocale) => {
      const result = await payload.find({
        collection: 'prompt-templates',
        limit: 1,
        overrideAccess: true,
        sort: '-version',
        where: {
          and: [
            { purpose: { equals: 'customer-chat' } },
            { status: { equals: 'active' } },
            { or: [{ locale: { equals: promptLocale } }, { locale: { equals: 'all' } }] },
          ],
        },
      })
      const prompt = result.docs[0]
      return prompt ? { template: prompt.template, version: prompt.version } : null
    },
    retrieve: async ({ locale: retrievalLocale, query: retrievalQuery }) =>
      retrieveKnowledgeForQuery({
        customerVisible: true,
        gateway: await getGateway(),
        locale: retrievalLocale,
        minScore: 0.2,
        pool: (payload.db as unknown as PostgresAdapter).pool,
        query: retrievalQuery,
      }),
  })
  const result = await responder.generateReply({
    message: query,
    session: previewSession(locale),
  })

  if ('handoff' in result) {
    return { outcome: 'handoff', reason: result.handoff.reason }
  }

  return {
    citations: result.citations ?? [],
    content: result.content,
    estimatedCostUSD: result.estimatedCostUSD,
    model: result.model,
    outcome: 'answer',
    promptVersion: result.promptVersion,
    tokenUsage: result.tokenUsage,
  }
}
