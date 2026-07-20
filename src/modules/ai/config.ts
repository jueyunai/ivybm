import { AI_REASONING_EFFORTS, type AiReasoning, type AiReasoningEffort } from './gateway'

type Environment = Readonly<Record<string, string | undefined>>

export type AIConfiguration = {
  apiKey: string
  baseURL: string
  embedding: string
  reasoning?: AiReasoning
  text: string
}

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiConfigurationError'
  }
}

const requiredValue = (environment: Environment, key: string): string => {
  const value = environment[key]?.trim()
  if (!value) throw new AiConfigurationError(`AI deployment variable is required: ${key}`)
  return value
}

const isReasoningEffort = (value: string): value is AiReasoningEffort =>
  AI_REASONING_EFFORTS.some((effort) => effort === value)

/**
 * Parse server-only AI configuration once per gateway construction. Keeping this
 * separate from request data prevents visitors from choosing models or reasoning.
 */
export const readAIConfiguration = (environment: Environment = process.env): AIConfiguration => {
  const enabled = (environment.AI_REASONING_ENABLED ?? 'false').trim()
  if (enabled !== 'true' && enabled !== 'false') {
    throw new AiConfigurationError('AI_REASONING_ENABLED must be true or false')
  }

  const requestedEffort = environment.AI_REASONING_EFFORT?.trim()
  const effort = requestedEffort || 'medium'
  if (!isReasoningEffort(effort)) {
    throw new AiConfigurationError('AI_REASONING_EFFORT is not supported')
  }

  return {
    apiKey: requiredValue(environment, 'AI_PROVIDER_API_KEY'),
    baseURL: requiredValue(environment, 'AI_PROVIDER_BASE_URL'),
    embedding: requiredValue(environment, 'AI_EMBEDDING_MODEL'),
    reasoning: enabled === 'true' ? { effort } : undefined,
    text: requiredValue(environment, 'AI_TEXT_MODEL'),
  }
}
