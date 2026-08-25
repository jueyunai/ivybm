import type { Payload } from 'payload'

import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'
import { previewKnowledgeAnswer, type KnowledgePreviewResult } from '@/modules/knowledge/preview'

import { KnowledgeCommandError } from './knowledgeCommands'

type ResolveGateway = typeof resolveAiGateway
type PreviewKnowledge = (options: {
  locale: 'ar' | 'en'
  payload: Payload
  query: string
}) => Promise<KnowledgePreviewResult>

export interface KnowledgeAiDebugCitation {
  documentId: number | string
  title: string
  url?: string
  version: string
}

export interface KnowledgeAiDebugResult {
  citations?: KnowledgeAiDebugCitation[]
  durationMs: number
  model?: string
  outcome?: 'answer' | 'handoff'
  promptVersion?: number
  reason?: string
  text: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

export async function runKnowledgeAiDebug({
  input,
  onProviderDispatch,
  payload,
  previewKnowledge = previewKnowledgeAnswer,
  resolveGateway = resolveAiGateway,
}: {
  input: unknown
  onProviderDispatch?: () => void
  payload: Payload
  previewKnowledge?: PreviewKnowledge
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
  const locale = (input as { locale?: unknown }).locale === 'ar' ? ('ar' as const) : ('en' as const)

  const startedAt = Date.now()

  try {
    const preview = await previewKnowledge({
      locale,
      payload,
      query: prompt,
    })
    onProviderDispatch?.()
    if (preview.outcome === 'answer') {
      return {
        citations: preview.citations,
        durationMs: Date.now() - startedAt,
        model: preview.model,
        outcome: 'answer',
        promptVersion: preview.promptVersion,
        text: preview.content,
        usage: {
          inputTokens: preview.tokenUsage.inputTokens,
          outputTokens: preview.tokenUsage.outputTokens ?? 0,
          totalTokens: preview.tokenUsage.totalTokens,
        },
      }
    }
    return {
      durationMs: Date.now() - startedAt,
      outcome: 'handoff',
      reason: preview.reason,
      text: preview.reason,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    }
  } catch {
    const gateway = await resolveGateway({
      payload,
      routes: [{ operation: 'text', usageKey: AI_USAGE_KEYS.chatReply }],
    })
    const result = await gateway.generateText({
      input: prompt,
      maxOutputTokens: 800,
      onDispatch: onProviderDispatch,
    })
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
}
