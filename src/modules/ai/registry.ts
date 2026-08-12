import type { Payload } from 'payload'

import {
  AiConfigurationError,
  readAIConfigurationOperation,
  type AiConfigurationOperation,
} from './config'
import { decryptAiCredential, readAiConfigurationEncryptionKey } from './credentials'
import {
  AI_REASONING_EFFORTS,
  createAiGateway,
  type AiGateway,
  type AiGatewayEmbeddingOperationConfig,
  type AiGatewayImageOperationConfig,
  type AiGatewayTextOperationConfig,
  type AiProvider,
  type AiReasoningEffort,
  type AiUsageRecord,
} from './gateway'
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from './providers/openaiCompatible'

type Environment = Readonly<Record<string, string | undefined>>
type UnknownRecord = Record<string, unknown>

export const AI_USAGE_KEYS = {
  chatReply: 'chat.reply',
  contentImageGeneration: 'content.image-generation',
  knowledgeEmbedding: 'knowledge.embedding',
  knowledgeTranslation: 'knowledge.translation',
} as const

export type AiUsageRouteRequest = {
  operation: AiConfigurationOperation
  usageKey: string
}

type ProviderFactory = (options: OpenAICompatibleProviderOptions) => AiProvider

type ResolveAiGatewayOptions = {
  /**
   * Legacy environment routes remain useful for existing customer-chat and
   * indexing callers.  Ingestion can disable this fallback because a missing
   * CMS translation route must fail closed instead of silently using a
   * different deployment credential/model.
   */
  allowEnvironmentFallback?: boolean
  createProvider?: ProviderFactory
  environment?: Environment
  payload: Payload
  routes: readonly AiUsageRouteRequest[]
}

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const requiredRecord = (value: unknown, field: string): UnknownRecord => {
  if (!isRecord(value)) {
    throw new AiConfigurationError(`AI route ${field} is unavailable`)
  }

  return value
}

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AiConfigurationError(`AI route ${field} is invalid`)
  }

  return value.trim()
}

const optionalNumber = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  integer = false,
): number | undefined => {
  if (value === undefined || value === null) return undefined
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new AiConfigurationError(`AI route ${field} is invalid`)
  }

  return value
}

const validReasoningEffort = (value: unknown): value is AiReasoningEffort =>
  typeof value === 'string' && AI_REASONING_EFFORTS.some((effort) => effort === value)

const normalizeRuntimeBaseURL = (value: string, environment: Environment): string => {
  try {
    const url = new URL(value)
    const production =
      environment.NODE_ENV === 'production' || process.env.NODE_ENV === 'production'
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      (production && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid URL')
    }

    return url.toString().replace(/\/+$/, '')
  } catch {
    throw new AiConfigurationError('AI route provider endpoint is invalid')
  }
}

const embeddingSpaceIdentity = (baseURL: string): string => `openai-compatible:${baseURL}`

const routeConfigurationError = (usageKey: string, reason: string): AiConfigurationError =>
  new AiConfigurationError(`AI route ${usageKey} ${reason}`)

const resolveCmsRoute = (
  route: UnknownRecord,
  request: AiUsageRouteRequest,
  createProvider: ProviderFactory,
  environment: Environment,
  encryptionKey: { value?: Buffer },
):
  | AiGatewayTextOperationConfig
  | AiGatewayEmbeddingOperationConfig
  | AiGatewayImageOperationConfig => {
  if (route.enabled !== true) {
    throw routeConfigurationError(request.usageKey, 'is disabled')
  }
  if (route.operation !== request.operation) {
    throw routeConfigurationError(request.usageKey, 'has a mismatched operation')
  }

  const profile = requiredRecord(route.profile, 'profile')
  if (profile.enabled !== true) {
    throw routeConfigurationError(request.usageKey, 'references a disabled profile')
  }
  if (profile.capability !== request.operation) {
    throw routeConfigurationError(request.usageKey, 'references an incompatible profile')
  }

  const provider = requiredRecord(profile.provider, 'provider')
  if (provider.enabled !== true || provider.apiKeyConfigured !== true) {
    throw routeConfigurationError(request.usageKey, 'references an unavailable provider')
  }
  if (provider.protocol !== 'openai-compatible') {
    throw routeConfigurationError(request.usageKey, 'uses an unsupported provider protocol')
  }

  const encryptedCredential = requiredString(provider.apiKey, 'provider credential')
  let apiKey: string
  try {
    encryptionKey.value ??= readAiConfigurationEncryptionKey(environment)
    apiKey = decryptAiCredential(encryptedCredential, encryptionKey.value)
  } catch {
    throw routeConfigurationError(request.usageKey, 'credential is unavailable')
  }

  const model = requiredString(profile.model, 'model')
  const parameters = requiredRecord(profile.parameters, 'parameters')
  const timeoutMs = optionalNumber(parameters.timeoutMs, 'timeout', 1_000, 120_000, true)
  if (timeoutMs === undefined) {
    throw routeConfigurationError(request.usageKey, 'timeout is invalid')
  }
  const baseURL = normalizeRuntimeBaseURL(
    requiredString(provider.baseURL, 'provider endpoint'),
    environment,
  )
  const resolvedProvider = createProvider({
    apiKey,
    baseURL,
    name: requiredString(provider.name, 'provider name'),
  })

  if (request.operation === 'embedding') {
    if (parameters.maxOutputTokens !== undefined && parameters.maxOutputTokens !== null) {
      throw routeConfigurationError(request.usageKey, 'contains text-only token settings')
    }
    if (parameters.reasoningEnabled === true) {
      throw routeConfigurationError(request.usageKey, 'contains text-only reasoning settings')
    }
    if (
      (parameters.temperature !== undefined && parameters.temperature !== null) ||
      (parameters.topP !== undefined && parameters.topP !== null)
    ) {
      throw routeConfigurationError(request.usageKey, 'contains text-only sampling settings')
    }

    const dimensions = optionalNumber(
      parameters.dimensions,
      'embedding dimensions',
      1,
      16_384,
      true,
    )
    if (dimensions === undefined) {
      throw routeConfigurationError(request.usageKey, 'requires fixed embedding dimensions')
    }

    return {
      dimensions,
      embeddingSpaceIdentity: embeddingSpaceIdentity(baseURL),
      model,
      provider: resolvedProvider,
      timeoutMs,
    }
  }

  if (request.operation === 'image') {
    if (
      (parameters.maxOutputTokens !== undefined && parameters.maxOutputTokens !== null) ||
      (parameters.dimensions !== undefined && parameters.dimensions !== null) ||
      parameters.reasoningEnabled === true ||
      (parameters.temperature !== undefined && parameters.temperature !== null) ||
      (parameters.topP !== undefined && parameters.topP !== null)
    ) {
      throw routeConfigurationError(request.usageKey, 'contains incompatible model settings')
    }

    return { model, provider: resolvedProvider, timeoutMs }
  }

  if (parameters.dimensions !== undefined && parameters.dimensions !== null) {
    throw routeConfigurationError(request.usageKey, 'contains embedding-only dimensions')
  }

  const reasoningEnabled = parameters.reasoningEnabled === true
  let defaultReasoning: AiGatewayTextOperationConfig['defaultReasoning']
  if (reasoningEnabled) {
    const effort = parameters.reasoningEffort
    if (!validReasoningEffort(effort)) {
      throw routeConfigurationError(request.usageKey, 'reasoning effort is invalid')
    }
    defaultReasoning = { effort }
  }

  return {
    defaultReasoning,
    maxOutputTokens: optionalNumber(
      parameters.maxOutputTokens,
      'maximum output tokens',
      1,
      128_000,
      true,
    ),
    model,
    provider: resolvedProvider,
    temperature: optionalNumber(parameters.temperature, 'temperature', 0, 2),
    timeoutMs,
    topP: optionalNumber(parameters.topP, 'top-p', 0, 1),
  }
}

const resolveEnvironmentRoute = (
  operation: AiConfigurationOperation,
  createProvider: ProviderFactory,
  environment: Environment,
):
  | AiGatewayTextOperationConfig
  | AiGatewayEmbeddingOperationConfig
  | AiGatewayImageOperationConfig
  | undefined => {
  const fallback = readAIConfigurationOperation(operation, environment)
  if (!fallback) return undefined

  const baseURL = normalizeRuntimeBaseURL(fallback.baseURL, environment)
  const provider = createProvider({
    apiKey: fallback.apiKey,
    baseURL,
    name: `environment-${operation}`,
  })

  if (operation === 'text') {
    return {
      defaultReasoning: fallback.reasoning,
      model: fallback.model,
      provider,
      timeoutMs: fallback.timeoutMs,
    }
  }

  if (operation === 'image') {
    return { model: fallback.model, provider, timeoutMs: fallback.timeoutMs }
  }

  return {
    dimensions: fallback.dimensions,
    embeddingSpaceIdentity: embeddingSpaceIdentity(baseURL),
    model: fallback.model,
    provider,
    timeoutMs: fallback.timeoutMs,
  }
}

const persistAiUsage = async (payload: Payload, record: AiUsageRecord): Promise<void> => {
  await payload.create({
    collection: 'ai-usage-logs',
    context: { skipAudit: true },
    data: {
      durationMs: record.durationMs,
      estimatedCostUSD: record.cost.estimated ?? undefined,
      inputTokens: record.usage.inputTokens,
      model: record.model,
      operation: record.operation,
      outputTokens: record.usage.outputTokens ?? undefined,
      provider: record.provider,
      requestId: record.requestId,
      totalTokens: record.usage.totalTokens,
    },
    overrideAccess: true,
  })
}

/**
 * Loads the requested route records once and returns a request-scoped gateway.
 * An existing CMS route is authoritative: disabled or invalid CMS data fails
 * closed, while a missing route uses the legacy environment fallback for only
 * that operation.
 */
export const resolveAiGateway = async ({
  allowEnvironmentFallback = true,
  createProvider = createOpenAICompatibleProvider,
  environment = process.env,
  payload,
  routes,
}: ResolveAiGatewayOptions): Promise<AiGateway> => {
  const requestedByOperation = new Map<AiConfigurationOperation, AiUsageRouteRequest>()
  for (const route of routes) {
    const existing = requestedByOperation.get(route.operation)
    if (existing && existing.usageKey !== route.usageKey) {
      throw new AiConfigurationError(
        `Only one ${route.operation} AI route can be resolved per request`,
      )
    }
    requestedByOperation.set(route.operation, route)
  }

  const usageKeys = [...new Set(routes.map(({ usageKey }) => usageKey))]
  const result =
    usageKeys.length === 0
      ? { docs: [] }
      : await payload.find({
          collection: 'ai-usage-routes',
          depth: 2,
          limit: usageKeys.length,
          overrideAccess: true,
          pagination: false,
          where: { usageKey: { in: usageKeys } },
        })

  const cmsRoutes = new Map<string, UnknownRecord>()
  for (const document of result.docs) {
    if (!isRecord(document)) continue
    const usageKey = typeof document.usageKey === 'string' ? document.usageKey : undefined
    if (!usageKey || !usageKeys.includes(usageKey)) continue
    if (cmsRoutes.has(usageKey)) {
      throw routeConfigurationError(usageKey, 'is ambiguous')
    }
    cmsRoutes.set(usageKey, document)
  }

  const encryptionKey: { value?: Buffer } = {}
  const operations: {
    embedding?: AiGatewayEmbeddingOperationConfig
    image?: AiGatewayImageOperationConfig
    text?: AiGatewayTextOperationConfig
  } = {}

  for (const [operation, request] of requestedByOperation) {
    const cmsRoute = cmsRoutes.get(request.usageKey)
    const configuration = cmsRoute
      ? resolveCmsRoute(cmsRoute, request, createProvider, environment, encryptionKey)
      : allowEnvironmentFallback
        ? resolveEnvironmentRoute(operation, createProvider, environment)
        : undefined

    if (!configuration) {
      throw routeConfigurationError(request.usageKey, 'is unavailable')
    }
    if (operation === 'text') {
      operations.text = configuration as AiGatewayTextOperationConfig
    } else if (operation === 'embedding') {
      operations.embedding = configuration as AiGatewayEmbeddingOperationConfig
    } else {
      operations.image = configuration as AiGatewayImageOperationConfig
    }
  }

  return createAiGateway({
    onUsage: (record) => persistAiUsage(payload, record),
    onUsageError: () => {
      payload.logger.error('AI usage telemetry persistence failed')
    },
    operations,
  })
}
