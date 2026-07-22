import { describe, expect, it } from 'vitest'

import {
  AiConfigurationError,
  readAIConfiguration,
  readAIConfigurationOperation,
} from '@/modules/ai/config'

const requiredEnvironment = {
  AI_EMBEDDING_DIMENSIONS: '1536',
  AI_EMBEDDING_MODEL: 'text-embedding-3-small',
  AI_PROVIDER_API_KEY: 'test-key',
  AI_PROVIDER_BASE_URL: 'https://api.example.invalid/v1',
  AI_TEXT_MODEL: 'gpt-5-mini',
}

describe('AI deployment configuration', () => {
  it('keeps OpenAI-compatible reasoning disabled unless explicitly enabled', () => {
    expect(readAIConfiguration(requiredEnvironment)).toMatchObject({
      apiKey: 'test-key',
      baseURL: 'https://api.example.invalid/v1',
      embedding: 'text-embedding-3-small',
      reasoning: undefined,
      text: 'gpt-5-mini',
    })
  })

  it('maps the deployment thinking switch to the standard Responses reasoning object', () => {
    expect(
      readAIConfiguration({
        ...requiredEnvironment,
        AI_REASONING_EFFORT: 'high',
        AI_REASONING_ENABLED: 'true',
      }),
    ).toMatchObject({ reasoning: { effort: 'high' } })
  })

  it('rejects malformed reasoning settings without exposing any provider secret', () => {
    expect(() =>
      readAIConfiguration({ ...requiredEnvironment, AI_REASONING_ENABLED: 'sometimes' }),
    ).toThrow(AiConfigurationError)
    expect(() =>
      readAIConfiguration({ ...requiredEnvironment, AI_REASONING_EFFORT: 'ultra' }),
    ).toThrow(AiConfigurationError)
  })

  it('allows each environment fallback operation to be absent while rejecting partial values', () => {
    expect(readAIConfigurationOperation('text', {})).toBeUndefined()
    expect(readAIConfigurationOperation('embedding', {})).toBeUndefined()

    expect(() =>
      readAIConfigurationOperation('text', {
        AI_PROVIDER_BASE_URL: 'https://api.example.invalid/v1',
        AI_TEXT_MODEL: 'gpt-5-mini',
      }),
    ).toThrow(AiConfigurationError)

    expect(() =>
      readAIConfigurationOperation('embedding', {
        AI_EMBEDDING_MODEL: 'text-embedding-3-small',
        AI_PROVIDER_API_KEY: 'test-key',
        AI_PROVIDER_BASE_URL: 'https://api.example.invalid/v1',
      }),
    ).toThrow(AiConfigurationError)
    expect(() =>
      readAIConfigurationOperation('embedding', {
        ...requiredEnvironment,
        AI_EMBEDDING_DIMENSIONS: 'dynamic',
      }),
    ).toThrow(AiConfigurationError)
  })
})
