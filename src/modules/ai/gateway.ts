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

export type ProviderGenerateTextInput = {
  input: string
  instructions?: string
  maxOutputTokens?: number
  model: string
  signal?: AbortSignal
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

type GatewayOptions = {
  models: { embedding: string; text: string }
  onUsage?: (record: AiUsageRecord) => Promise<void> | void
  onUsageError?: (error: unknown, record: AiUsageRecord) => Promise<void> | void
  pricing?: Record<string, ModelPricing>
  provider: AiProvider
  timeouts?: { embedMs?: number; generateTextMs?: number }
}

type GenerateTextInput = Omit<ProviderGenerateTextInput, 'model' | 'signal'> & { model?: string }
type EmbedInput = Omit<ProviderEmbedInput, 'model' | 'signal'> & { model?: string }

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
): Promise<T> => {
  const controller = new AbortController()

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new AiGatewayError('timeout', 'AI provider request timed out', { retryable: true }))
    }, timeoutMs)

    operation(controller.signal).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const validateUsage = (usage: AiTokenUsage): void => {
  if (
    !Number.isFinite(usage.inputTokens) ||
    !Number.isFinite(usage.totalTokens) ||
    (usage.outputTokens !== undefined && !Number.isFinite(usage.outputTokens))
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

export const createAiGateway = (options: GatewayOptions) => ({
  embed: async (input: EmbedInput) => {
    if (input.input.length === 0 || input.input.some((value) => !value.trim())) {
      throw new AiGatewayError('invalid_request', 'Embedding input must contain non-empty text')
    }
    const model = input.model ?? options.models.embedding
    const startedAt = Date.now()

    try {
      const result = await withTimeout(options.timeouts?.embedMs ?? 15_000, (signal) =>
        options.provider.embed({ ...input, input: input.input, model, signal }),
      )
      validateUsage(result.usage)
      validateEmbeddings(result.embeddings, input.input.length)
      const cost = estimateCost(result.usage, options.pricing?.[result.model])
      const record: AiUsageRecord = {
        cost,
        durationMs: Date.now() - startedAt,
        model: result.model,
        operation: 'embed',
        provider: options.provider.name,
        requestId: result.requestId,
        usage: result.usage,
      }
      await reportUsage(options, record)

      return { ...result, cost, provider: options.provider.name }
    } catch (error) {
      throw normalizeError(error)
    }
  },
  generateText: async (input: GenerateTextInput) => {
    if (!input.input.trim()) {
      throw new AiGatewayError('invalid_request', 'Text generation input is required')
    }
    const model = input.model ?? options.models.text
    const startedAt = Date.now()

    try {
      const result = await withTimeout(options.timeouts?.generateTextMs ?? 30_000, (signal) =>
        options.provider.generateText({ ...input, model, signal }),
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
        provider: options.provider.name,
        requestId: result.requestId,
        usage: result.usage,
      }
      await reportUsage(options, record)

      return { ...result, cost, provider: options.provider.name }
    } catch (error) {
      throw normalizeError(error)
    }
  },
})

export type AiGateway = ReturnType<typeof createAiGateway>
