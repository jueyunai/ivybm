import type { Payload } from 'payload'

import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'

import { KnowledgeCommandError } from './knowledgeCommands'

type ResolveGateway = typeof resolveAiGateway

export interface KnowledgeAiDebugResult {
  durationMs: number
  text: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

export async function runKnowledgeAiDebug({
  input,
  payload,
  resolveGateway = resolveAiGateway,
}: {
  input: unknown
  payload: Payload
  resolveGateway?: ResolveGateway
}): Promise<KnowledgeAiDebugResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KnowledgeCommandError('knowledge-ai-invalid-input', 'A JSON object is required', 400)
  }
  const prompt =
    typeof (input as { prompt?: unknown }).prompt === 'string'
      ? (input as { prompt: string }).prompt.trim()
      : ''
  if (!prompt || prompt.length > 4000) {
    throw new KnowledgeCommandError(
      'knowledge-ai-invalid-prompt',
      'AI debug prompt must contain 1 to 4000 characters',
      400,
    )
  }

  const startedAt = Date.now()
  const gateway = await resolveGateway({
    payload,
    routes: [{ operation: 'text', usageKey: AI_USAGE_KEYS.chatReply }],
  })
  const result = await gateway.generateText({ input: prompt, maxOutputTokens: 800 })
  return {
    durationMs: Date.now() - startedAt,
    text: result.text,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens,
    },
  }
}
