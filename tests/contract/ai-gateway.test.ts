import embeddingsFixture from '../fixtures/ai/embeddings.success.json'
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
  name: 'fake',
}

describe('AI gateway contract', () => {
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
