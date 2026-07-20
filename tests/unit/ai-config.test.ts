import { describe, expect, it } from 'vitest'

import { AiConfigurationError, readAIConfiguration } from '@/modules/ai/config'

const requiredEnvironment = {
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
})
