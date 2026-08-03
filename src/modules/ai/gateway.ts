import { createHash } from 'node:crypto'

export type AiErrorCode =
  | 'authentication'
  | 'invalid_request'
  | 'invalid_response'
  | 'provider_error'
  | 'provider_unavailable'
  | 'rate_limit'
  | 'timeout'

type AiErrorOptions = {
  cause?: unknown
  retryable?: boolean
  status?: number
}

export class AiProviderError extends Error {
  readonly code: AiErrorCode
  readonly retryable: boolean
  readonly status?: number

  constructor(code: AiErrorCode, message: string, options: AiErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'AiProviderError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status
  }
}

export class AiGatewayError extends Error {
  readonly code: AiErrorCode
  readonly retryable: boolean
  readonly status?: number

  constructor(code: AiErrorCode, message: string, options: AiErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'AiGatewayError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status
  }
}

export type AiTokenUsage = {
  inputTokens: number
  outputTokens?: number
  totalTokens: number
}

/**
 * OpenAI Responses reasoning effort values. Individual compatible providers and
 * models can support a subset; the deployment selects the value, never a visitor.
 */
export const AI_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number]

export type AiReasoning = {
  effort: AiReasoningEffort
}

export type ProviderGenerateTextInput = {
  input: string
  instructions?: string
  maxOutputTokens?: number
  model: string
  reasoning?: AiReasoning
  signal?: AbortSignal
  temperature?: number
  topP?: number
}

export type ProviderGenerateTextResult = {
  model: string
  requestId?: string
  text: string
  usage: AiTokenUsage
}

export type ProviderEmbedInput = {
  dimensions?: number
  input: string[]
  model: string
  signal?: AbortSignal
}

export type ProviderEmbedResult = {
  embeddings: number[][]
  model: string
  requestId?: string
  usage: AiTokenUsage
}

export type AiProvider = {
  embed(input: ProviderEmbedInput): Promise<ProviderEmbedResult>
  generateText(input: ProviderGenerateTextInput): Promise<ProviderGenerateTextResult>
  name: string
}

type ModelPricing = {
  inputPerMillionTokens: number
  outputPerMillionTokens?: number
}

export type AiUsageRecord = {
  cost: { currency: 'USD'; estimated: number | null }
  durationMs: number
  model: string
  operation: 'embed' | 'generateText'
  provider: string
  requestId?: string
  usage: AiTokenUsage
}

export type AiGatewayEmbeddingOperationConfig = {
  dimensions?: number
  /** Stable provider endpoint/protocol identity; never include credentials. */
  embeddingSpaceIdentity?: string
  model: string
  provider: AiProvider
  timeoutMs?: number
}

export type AiGatewayTextOperationConfig = {
  defaultReasoning?: AiReasoning
  maxOutputTokens?: number
  model: string
  provider: AiProvider
  temperature?: number
  timeoutMs?: number
  topP?: number
}

type GatewayOptions = {
  defaultReasoning?: AiReasoning
  models?: Partial<{ embedding: string; text: string }>
  onUsage?: (record: AiUsageRecord) => Promise<void> | void
  onUsageError?: (error: unknown, record: AiUsageRecord) => Promise<void> | void
  operations?: Partial<{
    embedding: AiGatewayEmbeddingOperationConfig
    text: AiGatewayTextOperationConfig
  }>
  pricing?: Record<string, ModelPricing>
  provider?: AiProvider
  providers?: Partial<{ embedding: AiProvider; text: AiProvider }>
  timeouts?: { embedMs?: number; generateTextMs?: number }
}

type GenerateTextInput = Omit<ProviderGenerateTextInput, 'model' | 'signal'> & {
  model?: string
  onDispatch?: () => void
}
export type AiGatewayEmbedInput = Omit<ProviderEmbedInput, 'model'> & {
  model?: string
}

export type AiGatewayEmbedResult = ProviderEmbedResult & {
  cost: { currency: 'USD'; estimated: number | null }
  embeddingSpace: string
  provider: string
}

const estimateCost = (
  usage: AiTokenUsage,
  pricing: ModelPricing | undefined,
): { currency: 'USD'; estimated: number | null } => {
  if (!pricing) return { currency: 'USD', estimated: null }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillionTokens
  const outputCost = ((usage.outputTokens ?? 0) / 1_000_000) * (pricing.outputPerMillionTokens ?? 0)

  return { currency: 'USD', estimated: inputCost + outputCost }
}

const normalizeError = (error: unknown): AiGatewayError => {
  if (error instanceof AiGatewayError) return error
  if (error instanceof AiProviderError) {
    return new AiGatewayError(error.code, error.message, {
      cause: error,
      retryable: error.retryable,
      status: error.status,
    })
  }

  return new AiGatewayError('provider_error', 'AI provider request failed', {
    cause: error,
    retryable: false,
  })
}

const withTimeout = async <T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController()
  const signal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal

  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
      callback()
    }
    const onExternalAbort = (): void => {
      finish(() => {
        reject(
          externalSignal?.reason instanceof Error
            ? externalSignal.reason
            : new Error('AI provider request was aborted'),
        )
      })
    }
    const timer = setTimeout(() => {
      controller.abort()
      finish(() => {
        reject(new AiGatewayError('timeout', 'AI provider request timed out', { retryable: true }))
      })
    }, timeoutMs)
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    if (externalSignal?.aborted) {
      onExternalAbort()
      return
    }

    operation(signal).then(
      (value) => {
        finish(() => resolve(value))
      },
      (error: unknown) => {
        finish(() => reject(error))
      },
    )
  })
}

const validateUsage = (usage: AiTokenUsage): void => {
  const validTokenCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0

  if (
    !validTokenCount(usage.inputTokens) ||
    !validTokenCount(usage.totalTokens) ||
    (usage.outputTokens !== undefined && !validTokenCount(usage.outputTokens)) ||
    usage.totalTokens < usage.inputTokens + (usage.outputTokens ?? 0)
  ) {
    throw new AiGatewayError('invalid_response', 'AI provider returned invalid token usage')
  }
}

const validateEmbeddings = (embeddings: number[][], expected: number): void => {
  const dimensions = embeddings[0]?.length ?? 0
  if (
    expected === 0 ||
    embeddings.length !== expected ||
    embeddings.some(
      (embedding) =>
        embedding.length === 0 ||
        embedding.length !== dimensions ||
        embedding.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new AiGatewayError('invalid_response', 'AI provider returned invalid embeddings')
  }
}

const reportUsage = async (options: GatewayOptions, record: AiUsageRecord): Promise<void> => {
  try {
    await options.onUsage?.(record)
  } catch (error) {
    try {
      await options.onUsageError?.(error, record)
    } catch {
      // Usage telemetry must not change the result of an already successful model call.
    }
  }
}

const requireModel = (model: string | undefined): string => {
  if (!model?.trim()) {
    throw new AiGatewayError('provider_unavailable', 'AI provider is not configured', {
      retryable: true,
    })
  }

  return model
}

const requireProvider = (provider: AiProvider | undefined): AiProvider => {
  if (!provider) {
    throw new AiGatewayError('provider_unavailable', 'AI provider is not configured', {
      retryable: true,
    })
  }

  return provider
}

export const createEmbeddingSpaceFingerprint = (...parts: Array<number | string>): string =>
  createHash('sha256')
    .update(['ivybm-embedding-space-v1', ...parts].join('\0'))
    .digest('hex')

export const createAiGateway = (options: GatewayOptions) => ({
  embeddingConfigurationKey: (() => {
    const operation = options.operations?.embedding
    const model = operation?.model ?? options.models?.embedding
    const provider = operation?.provider ?? options.providers?.embedding ?? options.provider
    const dimensions = operation?.dimensions
    if (
      !model?.trim() ||
      !provider ||
      typeof dimensions !== 'number' ||
      !Number.isInteger(dimensions) ||
      dimensions <= 0
    ) {
      return undefined
    }
    return createEmbeddingSpaceFingerprint(
      operation?.embeddingSpaceIdentity ?? `provider-name:${provider.name}`,
      model,
      dimensions,
      model,
      dimensions,
    )
  })(),
  embed: async (input: AiGatewayEmbedInput): Promise<AiGatewayEmbedResult> => {
    if (input.input.length === 0 || input.input.some((value) => !value.trim())) {
      throw new AiGatewayError('invalid_request', 'Embedding input must contain non-empty text')
    }
    const operation = options.operations?.embedding
    const model = requireModel(input.model ?? operation?.model ?? options.models?.embedding)
    const provider = requireProvider(
      operation?.provider ?? options.providers?.embedding ?? options.provider,
    )
    const startedAt = Date.now()

    try {
      const configuredDimensions = operation?.dimensions ?? input.dimensions
      const result = await withTimeout(
        operation?.timeoutMs ?? options.timeouts?.embedMs ?? 15_000,
        (signal) =>
          provider.embed({
            ...input,
            dimensions: configuredDimensions,
            input: input.input,
            model,
            signal,
          }),
        input.signal,
      )
      validateUsage(result.usage)
      validateEmbeddings(result.embeddings, input.input.length)
      const dimensions = result.embeddings[0].length
      if (result.model !== model) {
        throw new AiGatewayError(
          'invalid_response',
          'AI provider returned a different embedding model than configured',
        )
      }
      if (configuredDimensions !== undefined && dimensions !== configuredDimensions) {
        throw new AiGatewayError(
          'invalid_response',
          'AI provider returned different embedding dimensions than configured',
        )
      }
      const embeddingSpace = createEmbeddingSpaceFingerprint(
        operation?.embeddingSpaceIdentity ?? `provider-name:${provider.name}`,
        model,
        configuredDimensions ?? 'provider-default',
        result.model,
        dimensions,
      )
      const cost = estimateCost(result.usage, options.pricing?.[result.model])
      const record: AiUsageRecord = {
        cost,
        durationMs: Date.now() - startedAt,
        model: result.model,
        operation: 'embed',
        provider: provider.name,
        requestId: result.requestId,
        usage: result.usage,
      }
      await reportUsage(options, record)

      return { ...result, cost, embeddingSpace, provider: provider.name }
    } catch (error) {
      throw normalizeError(error)
    }
  },
  generateText: async (input: GenerateTextInput) => {
    if (!input.input.trim()) {
      throw new AiGatewayError('invalid_request', 'Text generation input is required')
    }
    const operation = options.operations?.text
    const model = requireModel(input.model ?? operation?.model ?? options.models?.text)
    const reasoning = input.reasoning ?? operation?.defaultReasoning ?? options.defaultReasoning
    const provider = requireProvider(
      operation?.provider ?? options.providers?.text ?? options.provider,
    )
    const startedAt = Date.now()

    try {
      const { onDispatch, ...providerInput } = input
      const result = await withTimeout(
        operation?.timeoutMs ?? options.timeouts?.generateTextMs ?? 30_000,
        (signal) => {
          onDispatch?.()
          return provider.generateText({
            ...providerInput,
            maxOutputTokens: input.maxOutputTokens ?? operation?.maxOutputTokens,
            model,
            reasoning,
            signal,
            temperature: input.temperature ?? operation?.temperature,
            topP: input.topP ?? operation?.topP,
          })
        },
      )
      if (!result.text.trim()) {
        throw new AiGatewayError('invalid_response', 'AI provider returned empty text')
      }
      validateUsage(result.usage)
      const cost = estimateCost(result.usage, options.pricing?.[result.model])
      const record: AiUsageRecord = {
        cost,
        durationMs: Date.now() - startedAt,
        model: result.model,
        operation: 'generateText',
        provider: provider.name,
        requestId: result.requestId,
        usage: result.usage,
      }
      await reportUsage(options, record)

      return { ...result, cost, provider: provider.name }
    } catch (error) {
      throw normalizeError(error)
    }
  },
})

export type AiGateway = ReturnType<typeof createAiGateway>
