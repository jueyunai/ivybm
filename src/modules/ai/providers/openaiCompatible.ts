import {
  AiProviderError,
  AI_GENERATED_IMAGE_MAX_BYTES,
  type AiProvider,
  type AiImageMimeType,
  type AiTokenUsage,
  type ProviderEmbedInput,
  type ProviderEmbedResult,
  type ProviderGenerateTextInput,
  type ProviderGenerateTextResult,
  type ProviderGenerateImageInput,
  type ProviderGenerateImageResult,
} from '../gateway'

type ProviderOptions = {
  apiKey: string
  baseURL: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
  name?: string
  textGenerationContract?: OpenAICompatibleTextGenerationContract
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

const chatCompletionUsage = (value: unknown): AiTokenUsage => {
  const usage = isRecord(value) ? value : {}
  return {
    inputTokens: usageNumber(usage.prompt_tokens),
    outputTokens: usageNumber(usage.completion_tokens),
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

const extractChatCompletionText = (body: UnknownRecord): string => {
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0])
    ? body.choices[0]
    : undefined
  const message = choice && isRecord(choice.message) ? choice.message : undefined
  return message && typeof message.content === 'string' ? message.content : ''
}

const strictBase64Bytes = (value: unknown): Uint8Array => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil(AI_GENERATED_IMAGE_MAX_BYTES / 3) * 4 + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new AiProviderError('invalid_response', 'AI provider returned invalid image data')
  }
  const data = Buffer.from(value, 'base64')
  if (data.length === 0 || data.length > AI_GENERATED_IMAGE_MAX_BYTES) {
    throw new AiProviderError('invalid_response', 'AI provider returned invalid image data')
  }
  return new Uint8Array(data)
}

const imageMimeType = (data: Uint8Array): AiImageMimeType => {
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => data[i] === b)) {
    return 'image/png'
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return 'image/webp'
  }
  throw new AiProviderError('invalid_response', 'AI provider returned an unsupported image')
}

const extractImage = (
  body: UnknownRecord,
): ProviderGenerateImageResult['image'] & {
  revisedPrompt?: string
} => {
  if (!Array.isArray(body.data) || body.data.length !== 1) {
    throw new AiProviderError(
      'invalid_response',
      'AI provider must return exactly one inline image',
    )
  }
  const item = isRecord(body.data[0]) ? body.data[0] : undefined
  if (!item || typeof item.b64_json !== 'string') {
    throw new AiProviderError('invalid_response', 'AI provider returned no inline image')
  }
  const data = strictBase64Bytes(item.b64_json)
  return {
    data,
    mimeType: imageMimeType(data),
    revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
  }
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

export const OPENAI_COMPATIBLE_TEXT_GENERATION_CONTRACTS = [
  'responses',
  'chat-completions',
] as const
export type OpenAICompatibleTextGenerationContract =
  (typeof OPENAI_COMPATIBLE_TEXT_GENERATION_CONTRACTS)[number]
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
    ...options.headers,
  }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }
  const textGenerationContract = options.textGenerationContract ?? 'responses'

  return {
    name: options.name ?? 'openai-compatible',
    generateText: async (input: ProviderGenerateTextInput): Promise<ProviderGenerateTextResult> => {
      const chatCompletions = textGenerationContract === 'chat-completions'
      const { body, requestId } = await requestJSON(
        fetchImplementation,
        `${baseURL}/${chatCompletions ? 'chat/completions' : 'responses'}`,
        {
          body: JSON.stringify(
            chatCompletions
              ? {
                  max_tokens: input.maxOutputTokens,
                  messages: [
                    ...(input.instructions
                      ? [{ content: input.instructions, role: 'system' as const }]
                      : []),
                    { content: input.input, role: 'user' as const },
                  ],
                  model: input.model,
                  ...(input.reasoning ? { reasoning_effort: input.reasoning.effort } : {}),
                  temperature: input.temperature,
                  top_p: input.topP,
                }
              : {
                  input: input.input,
                  instructions: input.instructions,
                  max_output_tokens: input.maxOutputTokens,
                  model: input.model,
                  ...(input.reasoning ? { reasoning: input.reasoning } : {}),
                  store: false,
                  temperature: input.temperature,
                  top_p: input.topP,
                },
          ),
          headers: jsonHeaders,
          method: 'POST',
          signal: input.signal,
        },
      )
      const text = chatCompletions
        ? extractChatCompletionText(body)
        : extractResponseText(body)
      if (!text) {
        throw new AiProviderError('invalid_response', 'AI provider returned no output text')
      }

      return {
        model: typeof body.model === 'string' ? body.model : input.model,
        requestId,
        text,
        usage: chatCompletions ? chatCompletionUsage(body.usage) : responseUsage(body.usage),
      }
    },
    generateImage: async (
      input: ProviderGenerateImageInput,
    ): Promise<ProviderGenerateImageResult> => {
      const url = input.referenceImage ? `${baseURL}/images/edits` : `${baseURL}/images/generations`
      let init: RequestInit
      if (input.referenceImage) {
        const form = new FormData()
        const extension =
          input.referenceImage.mimeType === 'image/png'
            ? 'png'
            : input.referenceImage.mimeType === 'image/jpeg'
              ? 'jpg'
              : 'webp'
        form.set(
          'image',
          new Blob([input.referenceImage.data], { type: input.referenceImage.mimeType }),
          `reference.${extension}`,
        )
        form.set('model', input.model)
        form.set('n', '1')
        form.set('prompt', input.prompt)
        form.set('response_format', 'b64_json')
        if (input.size) form.set('size', input.size)
        init = { body: form, headers, method: 'POST', signal: input.signal }
      } else {
        init = {
          body: JSON.stringify({
            model: input.model,
            n: 1,
            prompt: input.prompt,
            response_format: 'b64_json',
            size: input.size,
          }),
          headers: jsonHeaders,
          method: 'POST',
          signal: input.signal,
        }
      }
      const { body, requestId } = await requestJSON(fetchImplementation, url, init)
      const { revisedPrompt, ...image } = extractImage(body)
      return {
        image,
        model: typeof body.model === 'string' ? body.model : input.model,
        requestId,
        revisedPrompt,
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
        headers: jsonHeaders,
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
