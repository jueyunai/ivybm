import { AI_REASONING_EFFORTS, type AiReasoning, type AiReasoningEffort } from './gateway'

type Environment = Readonly<Record<string, string | undefined>>

export type AiConfigurationOperation = 'text' | 'embedding' | 'image'

export type AiOperationConfiguration = {
  apiKey: string
  baseURL: string
  dimensions?: number
  model: string
  reasoning?: AiReasoning
  timeoutMs: number
}

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

const optionalValue = (environment: Environment, key: string): string | undefined => {
  const value = environment[key]?.trim()
  return value || undefined
}

const isReasoningEffort = (value: string): value is AiReasoningEffort =>
  AI_REASONING_EFFORTS.some((effort) => effort === value)

const operationModelKey = (operation: AiConfigurationOperation): string => {
  if (operation === 'text') return 'AI_TEXT_MODEL'
  if (operation === 'image') return 'AI_IMAGE_MODEL'
  return 'AI_EMBEDDING_MODEL'
}

const embeddingDimensions = (environment: Environment): number => {
  const value = Number(requiredValue(environment, 'AI_EMBEDDING_DIMENSIONS'))
  if (!Number.isInteger(value) || value < 1 || value > 16_384) {
    throw new AiConfigurationError('AI_EMBEDDING_DIMENSIONS must be an integer between 1 and 16384')
  }
  return value
}

const operationTimeout = (
  operation: AiConfigurationOperation,
  environment: Environment,
): number => {
  const fallback = operation === 'text' ? 30_000 : operation === 'image' ? 60_000 : 15_000
  const key =
    operation === 'text'
      ? 'AI_TEXT_TIMEOUT_MS'
      : operation === 'image'
        ? 'AI_IMAGE_TIMEOUT_MS'
        : 'AI_EMBEDDING_TIMEOUT_MS'
  const value = Number(environment[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const parseTextReasoning = (environment: Environment): AiReasoning | undefined => {
  const enabled = (environment.AI_REASONING_ENABLED ?? 'false').trim()
  if (enabled !== 'true' && enabled !== 'false') {
    throw new AiConfigurationError('AI_REASONING_ENABLED must be true or false')
  }

  const requestedEffort = environment.AI_REASONING_EFFORT?.trim()
  const effort = requestedEffort || 'medium'
  if (!isReasoningEffort(effort)) {
    throw new AiConfigurationError('AI_REASONING_EFFORT is not supported')
  }

  return enabled === 'true' ? { effort } : undefined
}

/**
 * Resolve one optional environment fallback operation. All values for an
 * operation must be absent or present, so a partial legacy configuration
 * cannot result in a request being sent to an unintended endpoint.
 */
export const readAIConfigurationOperation = (
  operation: AiConfigurationOperation,
  environment: Environment = process.env,
): AiOperationConfiguration | undefined => {
  const keys = [
    'AI_PROVIDER_API_KEY',
    'AI_PROVIDER_BASE_URL',
    operationModelKey(operation),
    ...(operation === 'embedding' ? ['AI_EMBEDDING_DIMENSIONS'] : []),
  ] as const
  const values = keys.map((key) => optionalValue(environment, key))

  if (values.every((value) => value === undefined)) {
    return undefined
  }

  for (const key of keys) {
    requiredValue(environment, key)
  }

  return {
    apiKey: requiredValue(environment, 'AI_PROVIDER_API_KEY'),
    baseURL: requiredValue(environment, 'AI_PROVIDER_BASE_URL'),
    ...(operation === 'embedding' ? { dimensions: embeddingDimensions(environment) } : {}),
    model: requiredValue(environment, operationModelKey(operation)),
    ...(operation === 'text' ? { reasoning: parseTextReasoning(environment) } : {}),
    timeoutMs: operationTimeout(operation, environment),
  }
}

/**
 * Parse server-only AI configuration once per gateway construction. Keeping this
 * separate from request data prevents visitors from choosing models or reasoning.
 */
export const readAIConfiguration = (environment: Environment = process.env): AIConfiguration => {
  const text = readAIConfigurationOperation('text', environment)
  const embedding = readAIConfigurationOperation('embedding', environment)
  if (!text) requiredValue(environment, 'AI_TEXT_MODEL')
  if (!embedding) requiredValue(environment, 'AI_EMBEDDING_MODEL')

  return {
    apiKey: text!.apiKey,
    baseURL: text!.baseURL,
    embedding: embedding!.model,
    reasoning: text!.reasoning,
    text: text!.model,
  }
}
