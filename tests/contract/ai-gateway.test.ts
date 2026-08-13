import embeddingsFixture from '../fixtures/ai/embeddings.success.json'
import imagesFixture from '../fixtures/ai/images.success.json'
import responsesFixture from '../fixtures/ai/responses.success.json'
import { describe, expect, it, vi } from 'vitest'

import {
  AiGatewayError,
  AiProviderError,
  createAiGateway,
  type AiProvider,
} from '@/modules/ai/gateway'
import { createOpenAICompatibleProvider } from '@/modules/ai/providers/openaiCompatible'

const fakeProvider: AiProvider = {
  embed: async ({ input, model }) => ({
    embeddings: input.map((_, index) => (index === 0 ? [1, 0, 0] : [0, 1, 0])),
    model,
    usage: { inputTokens: 12, totalTokens: 12 },
  }),
  generateText: async ({ model }) => ({
    model,
    text: 'Reviewed answer',
    usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
  }),
  generateImage: async ({ model }) => ({
    image: {
      data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimeType: 'image/png',
    },
    model,
  }),
  name: 'fake',
}

describe('AI gateway contract', () => {
  it('marks dispatch only when the provider call is about to start', async () => {
    const onDispatch = vi.fn()
    const generateText = vi.fn(fakeProvider.generateText)
    const gateway = createAiGateway({
      models: { text: 'fake-text' },
      provider: { ...fakeProvider, generateText },
    })

    await gateway.generateText({ input: 'dispatch boundary', onDispatch })
    expect(onDispatch).toHaveBeenCalledTimes(1)
    expect(onDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      generateText.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )

    const invalidDispatch = vi.fn()
    await expect(
      createAiGateway({}).generateText({
        input: 'missing configuration',
        onDispatch: invalidDispatch,
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(invalidDispatch).not.toHaveBeenCalled()
  })

  it('normalizes generation, embedding, token usage and estimated cost', async () => {
    const onUsage = vi.fn()
    const gateway = createAiGateway({
      models: { embedding: 'fake-embedding', text: 'fake-text' },
      onUsage,
      pricing: {
        'fake-embedding': { inputPerMillionTokens: 0.02 },
        'fake-text': { inputPerMillionTokens: 2, outputPerMillionTokens: 8 },
      },
      provider: fakeProvider,
    })

    const generated = await gateway.generateText({ input: 'Answer from reviewed knowledge.' })
    const embedded = await gateway.embed({ input: ['first', 'second'] })

    expect(generated).toMatchObject({
      cost: { currency: 'USD' },
      model: 'fake-text',
      provider: 'fake',
      text: 'Reviewed answer',
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    })
    expect(generated.cost.estimated).toBeCloseTo(0.0004)
    expect(embedded.embeddings).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ])
    expect(embedded.cost.estimated).toBeCloseTo(0.00000024)
    expect(onUsage).toHaveBeenCalledTimes(2)
  })

  it('applies the deployment reasoning default while allowing trusted internal overrides', async () => {
    const generateText = vi.fn(fakeProvider.generateText)
    const gateway = createAiGateway({
      defaultReasoning: { effort: 'low' },
      models: { embedding: 'fake-embedding', text: 'fake-text' },
      provider: { ...fakeProvider, generateText },
    })

    await gateway.generateText({ input: 'use deployment default' })
    await gateway.generateText({ input: 'use trusted override', reasoning: { effort: 'high' } })

    expect(generateText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reasoning: { effort: 'low' } }),
    )
    expect(generateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reasoning: { effort: 'high' } }),
    )
  })

  it('uses separately configured providers for text and embedding operations', async () => {
    const textProvider: AiProvider = {
      ...fakeProvider,
      name: 'text-provider',
    }
    const embeddingProvider: AiProvider = {
      ...fakeProvider,
      name: 'embedding-provider',
    }
    const gateway = createAiGateway({
      models: { embedding: 'embedding-model', text: 'text-model' },
      provider: fakeProvider,
      providers: { embedding: embeddingProvider, text: textProvider },
    })

    const [generated, embedded] = await Promise.all([
      gateway.generateText({ input: 'text request' }),
      gateway.embed({ input: ['embedding request'] }),
    ])

    expect(generated.provider).toBe('text-provider')
    expect(embedded.provider).toBe('embedding-provider')
  })

  it('normalizes image generation, zero-token telemetry and dispatch timing', async () => {
    const onDispatch = vi.fn()
    const onUsage = vi.fn()
    const generateImage = vi.fn(fakeProvider.generateImage)
    const gateway = createAiGateway({
      onUsage,
      operations: {
        image: { model: 'fixture-image-model', provider: { ...fakeProvider, generateImage } },
      },
    })

    const result = await gateway.generateImage({
      onDispatch,
      prompt: 'Architectural aluminium facade product photography',
      size: '1024x1024',
    })

    expect(result).toMatchObject({
      cost: { currency: 'USD', estimated: null },
      image: { mimeType: 'image/png' },
      model: 'fixture-image-model',
      provider: 'fake',
    })
    expect(result.image.data).toBeInstanceOf(Uint8Array)
    expect(onDispatch).toHaveBeenCalledTimes(1)
    expect(onDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      generateImage.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'generateImage',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    )
  })

  it.each([
    {
      data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      label: 'a malformed declared PNG',
    },
    {
      data: new Uint8Array(8 * 1024 * 1024 + 1),
      label: 'an image larger than 8 MiB',
    },
  ])('rejects $label before image provider dispatch', async ({ data }) => {
    const onDispatch = vi.fn()
    const generateImage = vi.fn(fakeProvider.generateImage)
    const gateway = createAiGateway({
      operations: {
        image: { model: 'fixture-image-model', provider: { ...fakeProvider, generateImage } },
      },
    })

    await expect(
      gateway.generateImage({
        onDispatch,
        prompt: 'Polish the reference image',
        referenceImage: { data, mimeType: 'image/png' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' })

    expect(onDispatch).not.toHaveBeenCalled()
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('fingerprints the provider endpoint even when model and dimensions are identical', async () => {
    const createGateway = (embeddingSpaceIdentity: string) =>
      createAiGateway({
        operations: {
          embedding: {
            dimensions: 3,
            embeddingSpaceIdentity,
            model: 'shared-model-name',
            provider: fakeProvider,
          },
        },
      })

    const providerA = createGateway('openai-compatible:https://provider-a.example.invalid/v1')
    const renamedProviderA = createGateway(
      'openai-compatible:https://provider-a.example.invalid/v1',
    )
    const providerB = createGateway('openai-compatible:https://provider-b.example.invalid/v1')

    const [a, renamedA, b] = await Promise.all([
      providerA.embed({ input: ['same input'] }),
      renamedProviderA.embed({ input: ['same input'] }),
      providerB.embed({ input: ['same input'] }),
    ])

    expect(a.embeddingSpace).toBe(renamedA.embeddingSpace)
    expect(a.embeddingSpace).not.toBe(b.embeddingSpace)
    expect(providerA.embeddingConfigurationKey).toBe(a.embeddingSpace)
    expect(providerA.embeddingConfigurationKey).toBe(renamedProviderA.embeddingConfigurationKey)
    expect(providerA.embeddingConfigurationKey).not.toBe(providerB.embeddingConfigurationKey)
  })

  it('fails closed when an embedding provider drifts from the configured model or dimensions', async () => {
    const gatewayFor = (result: { dimensions: number; model: string }) =>
      createAiGateway({
        operations: {
          embedding: {
            dimensions: 3,
            embeddingSpaceIdentity: 'openai-compatible:https://provider-drift.example.invalid/v1',
            model: 'configured-embedding-model',
            provider: {
              ...fakeProvider,
              embed: async ({ input }) => ({
                embeddings: input.map(() => Array.from({ length: result.dimensions }, () => 1)),
                model: result.model,
                usage: { inputTokens: input.length, totalTokens: input.length },
              }),
            },
          },
        },
      })

    await expect(
      gatewayFor({ dimensions: 3, model: 'provider-resolved-model-v2' }).embed({
        input: ['model drift'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' } satisfies Partial<AiGatewayError>)
    await expect(
      gatewayFor({ dimensions: 4, model: 'configured-embedding-model' }).embed({
        input: ['dimension drift'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' } satisfies Partial<AiGatewayError>)

    const unfixedDimensions = createAiGateway({
      operations: {
        embedding: {
          embeddingSpaceIdentity: 'openai-compatible:https://provider.example.invalid/v1',
          model: 'configured-embedding-model',
          provider: fakeProvider,
        },
      },
    })
    expect(unfixedDimensions.embeddingConfigurationKey).toBeUndefined()
  })

  it('applies per-operation model defaults and reports an absent operation as recoverable', async () => {
    const generateText = vi.fn(fakeProvider.generateText)
    const gateway = createAiGateway({
      operations: {
        text: {
          defaultReasoning: { effort: 'medium' },
          maxOutputTokens: 256,
          model: 'profile-text-model',
          provider: { ...fakeProvider, generateText },
          temperature: 0.4,
          timeoutMs: 20_000,
          topP: 0.9,
        },
      },
    })

    await gateway.generateText({ input: 'profile defaults' })

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 256,
        model: 'profile-text-model',
        reasoning: { effort: 'medium' },
        temperature: 0.4,
        topP: 0.9,
      }),
    )
    await expect(gateway.embed({ input: ['missing embedding route'] })).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    } satisfies Partial<AiGatewayError>)
  })

  it('does not turn successful provider calls into failures when usage reporting fails', async () => {
    const provider = {
      ...fakeProvider,
      embed: vi.fn(fakeProvider.embed),
      generateText: vi.fn(fakeProvider.generateText),
    }
    const usageFailure = new Error('usage store unavailable')
    const onUsage = vi.fn().mockRejectedValue(usageFailure)
    const onUsageError = vi.fn()
    const gateway = createAiGateway({
      models: { embedding: 'fake-embedding', text: 'fake-text' },
      onUsage,
      onUsageError,
      provider,
    })

    await expect(gateway.generateText({ input: 'successful generation' })).resolves.toMatchObject({
      text: 'Reviewed answer',
    })
    await expect(gateway.embed({ input: ['successful embedding'] })).resolves.toMatchObject({
      embeddings: [[1, 0, 0]],
    })

    expect(provider.generateText).toHaveBeenCalledTimes(1)
    expect(provider.embed).toHaveBeenCalledTimes(1)
    expect(onUsage).toHaveBeenCalledTimes(2)
    expect(onUsageError).toHaveBeenCalledTimes(2)
    expect(onUsageError).toHaveBeenNthCalledWith(
      1,
      usageFailure,
      expect.objectContaining({
        operation: 'generateText',
      }),
    )
    expect(onUsageError).toHaveBeenNthCalledWith(
      2,
      usageFailure,
      expect.objectContaining({
        operation: 'embed',
      }),
    )
  })

  it('rejects invalid token accounting before cost or usage persistence', async () => {
    for (const usage of [
      { inputTokens: -1, totalTokens: 1 },
      { inputTokens: 1.5, totalTokens: 2 },
      { inputTokens: 3, outputTokens: 2, totalTokens: 4 },
    ]) {
      const gateway = createAiGateway({
        models: { text: 'fake-text' },
        provider: {
          ...fakeProvider,
          generateText: async ({ model }) => ({
            model,
            text: 'Invalid accounting fixture',
            usage,
          }),
        },
      })
      await expect(gateway.generateText({ input: 'validate usage' })).rejects.toMatchObject({
        code: 'invalid_response',
      } satisfies Partial<AiGatewayError>)
    }
  })

  it('normalizes timeout and provider errors without exposing credentials', async () => {
    const timeoutGateway = createAiGateway({
      models: { embedding: 'fake-embedding', text: 'fake-text' },
      provider: {
        ...fakeProvider,
        generateText: async () => new Promise(() => undefined),
      },
      timeouts: { generateTextMs: 10 },
    })

    await expect(timeoutGateway.generateText({ input: 'timeout' })).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    } satisfies Partial<AiGatewayError>)

    const errorGateway = createAiGateway({
      models: { embedding: 'fake-embedding', text: 'fake-text' },
      provider: {
        ...fakeProvider,
        generateText: async () => {
          throw new AiProviderError('rate_limit', 'Provider rejected the request', {
            retryable: true,
            status: 429,
          })
        },
      },
    })

    await expect(errorGateway.generateText({ input: 'limited' })).rejects.toMatchObject({
      code: 'rate_limit',
      retryable: true,
      status: 429,
    } satisfies Partial<AiGatewayError>)
  })

  it('stops waiting for an embedding provider when the caller aborts the request', async () => {
    let providerSignal: AbortSignal | undefined
    const gateway = createAiGateway({
      models: { embedding: 'fake-embedding', text: 'fake-text' },
      provider: {
        ...fakeProvider,
        embed: async ({ signal }) => {
          providerSignal = signal
          return await new Promise(() => undefined)
        },
      },
    })
    const controller = new AbortController()
    const request = gateway.embed({ input: ['slow embedding'], signal: controller.signal })

    controller.abort(new Error('job lease lost'))

    await expect(request).rejects.toMatchObject({ code: 'provider_error' })
    expect(providerSignal?.aborted).toBe(true)
  })

  it('rejects empty requests before calling a provider', async () => {
    const provider = {
      ...fakeProvider,
      embed: vi.fn(fakeProvider.embed),
      generateText: vi.fn(fakeProvider.generateText),
    }
    const gateway = createAiGateway({
      models: { embedding: 'fake-embedding', text: 'fake-text' },
      provider,
    })

    await expect(gateway.generateText({ input: '  ' })).rejects.toMatchObject({
      code: 'invalid_request',
    })
    await expect(gateway.embed({ input: [] })).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(provider.generateText).not.toHaveBeenCalled()
    expect(provider.embed).not.toHaveBeenCalled()
  })

  it('adapts Responses and Embeddings compatible HTTP payloads without real network access', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responsesFixture), {
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_text_fixture' },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(embeddingsFixture), {
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_embed_fixture' },
          status: 200,
        }),
      )
    const provider = createOpenAICompatibleProvider({
      apiKey: 'fixture-key-never-sent-to-network',
      baseURL: 'https://ai.example.invalid/v1',
      fetch: fetchMock,
    })

    const generated = await provider.generateText({
      input: 'question',
      instructions: 'Use reviewed knowledge only.',
      model: 'fixture-text-model',
    })
    const embedded = await provider.embed({
      input: ['first', 'second'],
      model: 'fixture-embedding-model',
    })

    expect(generated).toMatchObject({
      model: responsesFixture.model,
      requestId: 'req_text_fixture',
      text: 'Use reviewed knowledge and confirm delivery dates with sales.',
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    })
    expect(embedded).toMatchObject({
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      model: embeddingsFixture.model,
      requestId: 'req_embed_fixture',
      usage: { inputTokens: 12, totalTokens: 12 },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://ai.example.invalid/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://ai.example.invalid/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('adapts the explicitly configured Chat Completions text contract', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Configured chat completion.' } }],
          model: 'fixture-chat-model',
          usage: { completion_tokens: 7, prompt_tokens: 11, total_tokens: 18 },
        }),
        {
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_chat_fixture' },
          status: 200,
        },
      ),
    )
    const provider = createOpenAICompatibleProvider({
      apiKey: 'fixture-key-never-sent-to-network',
      baseURL: 'https://ai.example.invalid/v1',
      fetch: fetchMock,
      textGenerationContract: 'chat-completions',
    })

    await expect(
      provider.generateText({
        input: 'question',
        instructions: 'Use reviewed knowledge only.',
        maxOutputTokens: 64,
        model: 'fixture-chat-model',
        reasoning: { effort: 'medium' },
        temperature: 0.2,
        topP: 0.9,
      }),
    ).resolves.toMatchObject({
      model: 'fixture-chat-model',
      requestId: 'req_chat_fixture',
      text: 'Configured chat completion.',
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ai.example.invalid/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      max_tokens: 64,
      messages: [
        { content: 'Use reviewed knowledge only.', role: 'system' },
        { content: 'question', role: 'user' },
      ],
      model: 'fixture-chat-model',
      reasoning_effort: 'medium',
      temperature: 0.2,
      top_p: 0.9,
    })
  })

  it('fails closed for a malformed Chat Completions response', async () => {
    const provider = createOpenAICompatibleProvider({
      apiKey: 'fixture-key-never-sent-to-network',
      baseURL: 'https://ai.example.invalid/v1',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ choices: [], usage: {} }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
      textGenerationContract: 'chat-completions',
    })

    await expect(
      provider.generateText({ input: 'question', model: 'fixture-chat-model' }),
    ).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('adapts OpenAI-compatible image generations and edits without real network access', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(imagesFixture), {
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_image_generate' },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(imagesFixture), {
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_image_edit' },
          status: 200,
        }),
      )
    const provider = createOpenAICompatibleProvider({
      apiKey: 'fixture-key-never-sent-to-network',
      baseURL: 'https://ai.example.invalid/v1',
      fetch: fetchMock,
    })

    const generated = await provider.generateImage!({
      model: 'fixture-image-model',
      prompt: 'Generate a facade product image',
      size: '1024x1024',
    })
    const edited = await provider.generateImage!({
      model: 'fixture-image-model',
      prompt: 'Polish the reference product photo',
      referenceImage: {
        data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        mimeType: 'image/png',
      },
      size: '1536x1024',
    })

    expect(generated).toMatchObject({
      image: { mimeType: 'image/png' },
      model: imagesFixture.model,
      requestId: 'req_image_generate',
      revisedPrompt: imagesFixture.data[0].revised_prompt,
    })
    expect(edited.requestId).toBe('req_image_edit')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://ai.example.invalid/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
    const generationBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(generationBody).toEqual({
      model: 'fixture-image-model',
      n: 1,
      prompt: 'Generate a facade product image',
      response_format: 'b64_json',
      size: '1024x1024',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://ai.example.invalid/v1/images/edits',
      expect.objectContaining({ body: expect.any(FormData), method: 'POST' }),
    )
    const editBody = fetchMock.mock.calls[1]?.[1]?.body as FormData
    expect(editBody.get('model')).toBe('fixture-image-model')
    expect(editBody.get('prompt')).toBe('Polish the reference product photo')
    expect(editBody.get('response_format')).toBe('b64_json')
    expect(editBody.get('image')).toBeInstanceOf(Blob)
  })

  it('fails closed for URL-only and malformed provider image responses', async () => {
    const responses = [
      { data: [{ url: 'https://untrusted.example.invalid/image.png' }] },
      { data: [{ b64_json: 'not-valid-base64!' }] },
    ]

    for (const body of responses) {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'fixture-secret-key',
        baseURL: 'https://ai.example.invalid/v1',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify(body), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
        ),
      })

      await expect(
        provider.generateImage!({ model: 'fixture-image-model', prompt: 'safe prompt' }),
      ).rejects.toMatchObject({ code: 'invalid_response' })
    }
  })

  it('fails closed when a provider returns an oversized inline image', async () => {
    const gateway = createAiGateway({
      operations: {
        image: {
          model: 'fixture-image-model',
          provider: {
            ...fakeProvider,
            generateImage: async ({ model }) => ({
              image: {
                data: new Uint8Array(8 * 1024 * 1024 + 1),
                mimeType: 'image/png' as const,
              },
              model,
            }),
          },
        },
      },
    })

    await expect(gateway.generateImage({ prompt: 'safe prompt' })).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  it('sends the standard Responses reasoning object only when configured', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responsesFixture), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responsesFixture), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      )
    const provider = createOpenAICompatibleProvider({
      apiKey: 'fixture-key-never-sent-to-network',
      baseURL: 'https://ai.example.invalid/v1',
      fetch: fetchMock,
    })

    await provider.generateText({
      input: 'reasoning request',
      model: 'fixture-text-model',
      reasoning: { effort: 'medium' },
    })
    await provider.generateText({
      input: 'ordinary request',
      model: 'fixture-text-model',
    })

    const enabledBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    const disabledBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))

    expect(enabledBody).toMatchObject({
      model: 'fixture-text-model',
      reasoning: { effort: 'medium' },
    })
    expect(disabledBody).not.toHaveProperty('reasoning')
  })

  it('normalizes compatible HTTP errors without copying provider secrets', async () => {
    const provider = createOpenAICompatibleProvider({
      apiKey: 'fixture-secret-key',
      baseURL: 'https://ai.example.invalid/v1',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: 'fixture-secret-key must not escape' } }),
            { headers: { 'content-type': 'application/json' }, status: 429 },
          ),
        ),
    })
    const gateway = createAiGateway({
      models: { embedding: 'fixture-embedding', text: 'fixture-text' },
      provider,
    })

    try {
      await gateway.generateText({ input: 'rate limited request' })
      throw new Error('Expected the gateway call to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 'rate_limit', retryable: true, status: 429 })
      expect((error as Error).message).not.toContain('fixture-secret-key')
    }
  })
})
