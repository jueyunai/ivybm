import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import { encryptAiCredential, readAiConfigurationEncryptionKey } from '@/modules/ai/credentials'
import { AiConfigurationError } from '@/modules/ai/config'
import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'

const encryptionKey = 'c'.repeat(64)

const createProviderDocument = (overrides: Record<string, unknown> = {}) => ({
  apiKey: encryptAiCredential(
    'cms-provider-secret',
    readAiConfigurationEncryptionKey({
      AI_CONFIG_ENCRYPTION_KEY: encryptionKey,
    }),
  ),
  apiKeyConfigured: true,
  baseURL: 'https://cms.example.invalid/v1',
  enabled: true,
  id: 1,
  name: 'CMS provider',
  protocol: 'openai-compatible',
  textGenerationContract: 'responses',
  ...overrides,
})

const createPayload = (docs: unknown[]) =>
  ({
    find: vi.fn().mockResolvedValue({ docs }),
  }) as unknown as Payload

const createFakeProvider = (calls: Array<Record<string, unknown>>) =>
  vi.fn(
    (options: {
      apiKey: string
      baseURL: string
      name?: string
      textGenerationContract?: string
    }) => ({
      embed: async (input: { dimensions?: number; input: string[]; model: string }) => {
        calls.push({ ...options, operation: 'embedding', ...input })
        return {
          embeddings: input.input.map(() => [1, 0, 0]),
          model: input.model,
          usage: { inputTokens: 2, totalTokens: 2 },
        }
      },
      generateText: async (input: {
        maxOutputTokens?: number
        model: string
        reasoning?: { effort: string }
      }) => {
        calls.push({ ...options, operation: 'text', ...input })
        return {
          model: input.model,
          text: 'Configured response',
          usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        }
      },
      generateImage: async (input: { model: string; prompt: string }) => {
        calls.push({ ...options, operation: 'image', ...input })
        return {
          image: {
            data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            mimeType: 'image/png' as const,
          },
          model: input.model,
        }
      },
      name: options.name ?? 'fake-provider',
    }),
  )

describe('AI control-plane registry', () => {
  it('resolves one CMS snapshot with independent text and embedding providers', async () => {
    const calls: Array<Record<string, unknown>> = []
    const payload = createPayload([
      {
        enabled: true,
        operation: 'text',
        profile: {
          capability: 'text',
          enabled: true,
          model: 'cms-text-model',
          parameters: {
            maxOutputTokens: 128,
            reasoningEffort: 'high',
            reasoningEnabled: true,
            temperature: 0.4,
            timeoutMs: 30_000,
            topP: 0.9,
          },
          provider: createProviderDocument({ id: 11, name: 'CMS text provider' }),
        },
        usageKey: AI_USAGE_KEYS.chatReply,
      },
      {
        enabled: true,
        operation: 'embedding',
        profile: {
          capability: 'embedding',
          enabled: true,
          model: 'cms-embedding-model',
          parameters: { dimensions: 3, timeoutMs: 15_000 },
          provider: createProviderDocument({ id: 12, name: 'CMS embedding provider' }),
        },
        usageKey: AI_USAGE_KEYS.knowledgeEmbedding,
      },
    ])

    const gateway = await resolveAiGateway({
      createProvider: createFakeProvider(calls),
      environment: { AI_CONFIG_ENCRYPTION_KEY: encryptionKey },
      payload,
      routes: [
        { operation: 'text', usageKey: AI_USAGE_KEYS.chatReply },
        { operation: 'embedding', usageKey: AI_USAGE_KEYS.knowledgeEmbedding },
      ],
    })

    await gateway.generateText({ input: 'A visitor question' })
    await gateway.embed({ input: ['A retrieval query'] })

    expect(payload.find).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseURL: 'https://cms.example.invalid/v1',
          maxOutputTokens: 128,
          model: 'cms-text-model',
          operation: 'text',
          reasoning: { effort: 'high' },
          temperature: 0.4,
          topP: 0.9,
        }),
        expect.objectContaining({
          baseURL: 'https://cms.example.invalid/v1',
          dimensions: 3,
          model: 'cms-embedding-model',
          operation: 'embedding',
        }),
      ]),
    )
  })

  it('uses environment values only for a usage key that has no CMS route', async () => {
    const calls: Array<Record<string, unknown>> = []
    const gateway = await resolveAiGateway({
      createProvider: createFakeProvider(calls),
      environment: {
        AI_EMBEDDING_DIMENSIONS: '3',
        AI_EMBEDDING_MODEL: 'environment-embedding-model',
        AI_PROVIDER_API_KEY: 'environment-api-key',
        AI_PROVIDER_BASE_URL: 'https://environment.example.invalid/v1',
        AI_TEXT_MODEL: 'environment-text-model',
      },
      payload: createPayload([]),
      routes: [
        { operation: 'text', usageKey: AI_USAGE_KEYS.chatReply },
        { operation: 'embedding', usageKey: AI_USAGE_KEYS.knowledgeEmbedding },
      ],
    })

    await gateway.generateText({ input: 'Fallback text' })
    await gateway.embed({ input: ['Fallback embedding'] })
    expect(gateway.embeddingConfigurationKey).toBeTypeOf('string')

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: 'environment-text-model', operation: 'text' }),
        expect.objectContaining({ model: 'environment-embedding-model', operation: 'embedding' }),
      ]),
    )
  })

  it('resolves the stable content image route from the CMS snapshot', async () => {
    const calls: Array<Record<string, unknown>> = []
    const payload = createPayload([
      {
        enabled: true,
        operation: 'image',
        profile: {
          capability: 'image',
          enabled: true,
          model: 'cms-image-model',
          parameters: { reasoningEnabled: false, timeoutMs: 60_000 },
          provider: createProviderDocument({ name: 'CMS image provider' }),
        },
        usageKey: AI_USAGE_KEYS.contentImageGeneration,
      },
    ])

    const gateway = await resolveAiGateway({
      allowEnvironmentFallback: false,
      createProvider: createFakeProvider(calls),
      environment: { AI_CONFIG_ENCRYPTION_KEY: encryptionKey },
      payload,
      routes: [{ operation: 'image', usageKey: AI_USAGE_KEYS.contentImageGeneration }],
    })

    await gateway.generateImage({ prompt: 'Facade campaign image' })
    expect(calls).toContainEqual(
      expect.objectContaining({
        model: 'cms-image-model',
        operation: 'image',
        prompt: 'Facade campaign image',
      }),
    )
  })

  it('passes the explicit provider text contract to the transport factory', async () => {
    const calls: Array<Record<string, unknown>> = []
    const createProvider = createFakeProvider(calls)
    const gateway = await resolveAiGateway({
      createProvider,
      environment: { AI_CONFIG_ENCRYPTION_KEY: encryptionKey },
      payload: createPayload([
        {
          enabled: true,
          operation: 'text',
          profile: {
            capability: 'text',
            enabled: true,
            model: 'cms-text-model',
            parameters: { reasoningEnabled: false, timeoutMs: 30_000 },
            provider: createProviderDocument({ textGenerationContract: 'chat-completions' }),
          },
          usageKey: AI_USAGE_KEYS.chatReply,
        },
      ]),
      routes: [{ operation: 'text', usageKey: AI_USAGE_KEYS.chatReply }],
    })

    await gateway.generateText({ input: 'Configured contract' })
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ textGenerationContract: 'chat-completions' }),
    )
  })

  it('changes the embedding space when only the provider endpoint changes', async () => {
    const resolveForBaseURL = async (baseURL: string) => {
      const calls: Array<Record<string, unknown>> = []
      const gateway = await resolveAiGateway({
        createProvider: createFakeProvider(calls),
        environment: { AI_CONFIG_ENCRYPTION_KEY: encryptionKey },
        payload: createPayload([
          {
            enabled: true,
            operation: 'embedding',
            profile: {
              capability: 'embedding',
              enabled: true,
              model: 'same-model',
              parameters: { dimensions: 3, timeoutMs: 15_000 },
              provider: createProviderDocument({ baseURL }),
            },
            usageKey: AI_USAGE_KEYS.knowledgeEmbedding,
          },
        ]),
        routes: [{ operation: 'embedding', usageKey: AI_USAGE_KEYS.knowledgeEmbedding }],
      })
      return gateway.embed({ input: ['same query'] })
    }

    const [providerA, providerB] = await Promise.all([
      resolveForBaseURL('https://provider-a.example.invalid/v1'),
      resolveForBaseURL('https://provider-b.example.invalid/v1'),
    ])

    expect(providerA.model).toBe(providerB.model)
    expect(providerA.embeddings[0]).toHaveLength(providerB.embeddings[0].length)
    expect(providerA.embeddingSpace).not.toBe(providerB.embeddingSpace)
  })

  it('fails closed when an existing CMS route is disabled instead of falling back to env', async () => {
    const createProvider = vi.fn()

    await expect(
      resolveAiGateway({
        createProvider,
        environment: {
          AI_EMBEDDING_DIMENSIONS: '3',
          AI_EMBEDDING_MODEL: 'environment-embedding-model',
          AI_PROVIDER_API_KEY: 'environment-api-key',
          AI_PROVIDER_BASE_URL: 'https://environment.example.invalid/v1',
          AI_TEXT_MODEL: 'environment-text-model',
        },
        payload: createPayload([
          {
            enabled: false,
            operation: 'text',
            profile: 1,
            usageKey: AI_USAGE_KEYS.chatReply,
          },
        ]),
        routes: [{ operation: 'text', usageKey: AI_USAGE_KEYS.chatReply }],
      }),
    ).rejects.toBeInstanceOf(AiConfigurationError)

    expect(createProvider).not.toHaveBeenCalled()
  })

  it('does not parse obsolete environment settings when every requested CMS route is configured', async () => {
    const calls: Array<Record<string, unknown>> = []
    const payload = createPayload([
      {
        enabled: true,
        operation: 'text',
        profile: {
          capability: 'text',
          enabled: true,
          model: 'cms-text-model',
          parameters: { reasoningEnabled: false, timeoutMs: 30_000 },
          provider: createProviderDocument(),
        },
        usageKey: AI_USAGE_KEYS.chatReply,
      },
    ])

    const gateway = await resolveAiGateway({
      createProvider: createFakeProvider(calls),
      environment: {
        AI_CONFIG_ENCRYPTION_KEY: encryptionKey,
        AI_REASONING_ENABLED: 'not-a-valid-legacy-value',
      },
      payload,
      routes: [{ operation: 'text', usageKey: AI_USAGE_KEYS.chatReply }],
    })

    await expect(gateway.generateText({ input: 'CMS first' })).resolves.toMatchObject({
      model: 'cms-text-model',
    })
  })
})
