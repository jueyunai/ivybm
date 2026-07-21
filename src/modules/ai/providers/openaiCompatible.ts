import {
  AiProviderError,
  type AiProvider,
  type AiTokenUsage,
  type ProviderEmbedInput,
  type ProviderEmbedResult,
  type ProviderGenerateTextInput,
  type ProviderGenerateTextResult,
} from '../gateway'

type ProviderOptions = {
  apiKey: string
  baseURL: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
  name?: string
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0)
const usageNumber = (value: unknown): number => (typeof value === 'number' ? value : Number.NaN)

const responseUsage = (value: unknown): AiTokenUsage => {
  const usage = isRecord(value) ? value : {}
  return {
    inputTokens: usageNumber(usage.input_tokens),
    outputTokens: usageNumber(usage.output_tokens),
    totalTokens: usageNumber(usage.total_tokens),
  }
}

const embeddingUsage = (value: unknown): AiTokenUsage => {
  const usage = isRecord(value) ? value : {}
  return {
    inputTokens: usageNumber(usage.prompt_tokens),
    totalTokens: usageNumber(usage.total_tokens),
  }
}

const extractResponseText = (body: UnknownRecord): string => {
  if (!Array.isArray(body.output)) return ''

  return body.output
    .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
    .filter((part) => isRecord(part) && part.type === 'output_text')
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

const codeForStatus = (status: number) => {
  if (status === 401 || status === 403) return 'authentication' as const
  if (status === 429) return 'rate_limit' as const
  if (status >= 500) return 'provider_unavailable' as const
  if (status >= 400) return 'invalid_request' as const
  return 'provider_error' as const
}

const requestJSON = async (
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<{ body: UnknownRecord; requestId?: string }> => {
  let response: Response
  try {
    response = await fetchImplementation(url, init)
  } catch (error) {
    throw new AiProviderError('provider_unavailable', 'AI provider is unavailable', {
      cause: error,
      retryable: true,
    })
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new AiProviderError('invalid_response', 'AI provider returned invalid JSON', {
      cause: error,
      retryable: false,
      status: response.status,
    })
  }

  if (!response.ok) {
    const code = codeForStatus(response.status)
    throw new AiProviderError(code, 'AI provider rejected the request', {
      retryable: code === 'rate_limit' || code === 'provider_unavailable',
      status: response.status,
    })
  }
  if (!isRecord(body)) {
    throw new AiProviderError('invalid_response', 'AI provider returned an invalid response')
  }

  return { body, requestId: response.headers.get('x-request-id') ?? undefined }
}

export type OpenAICompatibleProviderOptions = ProviderOptions

export const createOpenAICompatibleProvider = (options: ProviderOptions): AiProvider => {
  if (!options.apiKey) throw new Error('AI provider API key is required')

  const fetchImplementation = options.fetch ?? globalThis.fetch
  const parsedBaseURL = new URL(options.baseURL)
  if (parsedBaseURL.protocol !== 'https:' && parsedBaseURL.protocol !== 'http:') {
    throw new Error('AI provider base URL must use HTTP or HTTPS')
  }
  const baseURL = parsedBaseURL.toString().replace(/\/+$/, '')
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    'Content-Type': 'application/json',
    ...options.headers,
  }

  return {
    name: options.name ?? 'openai-compatible',
    generateText: async (input: ProviderGenerateTextInput): Promise<ProviderGenerateTextResult> => {
      const { body, requestId } = await requestJSON(fetchImplementation, `${baseURL}/responses`, {
        body: JSON.stringify({
          input: input.input,
          instructions: input.instructions,
          max_output_tokens: input.maxOutputTokens,
          model: input.model,
          ...(input.reasoning ? { reasoning: input.reasoning } : {}),
          store: false,
          temperature: input.temperature,
          top_p: input.topP,
        }),
        headers,
        method: 'POST',
        signal: input.signal,
      })
      const text = extractResponseText(body)
      if (!text) {
        throw new AiProviderError('invalid_response', 'AI provider returned no output text')
      }

      return {
        model: typeof body.model === 'string' ? body.model : input.model,
        requestId,
        text,
        usage: responseUsage(body.usage),
      }
    },
    embed: async (input: ProviderEmbedInput): Promise<ProviderEmbedResult> => {
      const { body, requestId } = await requestJSON(fetchImplementation, `${baseURL}/embeddings`, {
        body: JSON.stringify({
          dimensions: input.dimensions,
          encoding_format: 'float',
          input: input.input,
          model: input.model,
        }),
        headers,
        method: 'POST',
        signal: input.signal,
      })
      if (!Array.isArray(body.data)) {
        throw new AiProviderError('invalid_response', 'AI provider returned no embeddings')
      }

      const embeddings = body.data
        .filter(isRecord)
        .sort((left, right) => asNumber(left.index) - asNumber(right.index))
        .map((item) =>
          Array.isArray(item.embedding)
            ? item.embedding.filter((value): value is number => typeof value === 'number')
            : [],
        )

      return {
        embeddings,
        model: typeof body.model === 'string' ? body.model : input.model,
        requestId,
        usage: embeddingUsage(body.usage),
      }
    },
  }
}
