import { describe, expect, it, vi } from 'vitest'

import { createAiGateway, type AiProvider } from '@/modules/ai/gateway'
import {
  detectKnowledgeRiskTopics,
  resolveKnowledgeTranslationPrompt,
  splitKnowledgeTranslationText,
  translateKnowledgeText,
} from '@/modules/knowledge/ingestion/translation'

describe('knowledge translation safeguards', () => {
  it('selects the latest exact-locale active prompt, then falls back to all', async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [
        { id: 1, key: 'all', locale: 'all', purpose: 'translation', status: 'active', template: 'all', version: 2 },
        { id: 2, key: 'arabic', locale: 'ar', purpose: 'translation', status: 'active', template: 'ar', version: 3 },
      ],
    })
    await expect(resolveKnowledgeTranslationPrompt({ locale: 'ar', payload: { find } })).resolves.toMatchObject({ id: 2, version: 3, template: 'ar' })
    await expect(resolveKnowledgeTranslationPrompt({
      locale: 'en',
      payload: { find: vi.fn().mockResolvedValue({ docs: [] }) },
    })).rejects.toMatchObject({ code: 'translation-prompt-unavailable' })
  })

  it('splits deterministically and enforces a stable chunk budget', () => {
    expect(splitKnowledgeTranslationText('one two\n\nthree four', 10)).toEqual(['one two', 'three four'])
    expect(() => splitKnowledgeTranslationText('a'.repeat(100), 9)).toThrow('budget')
  })

  it('translates both units through the gateway without exposing route model control', async () => {
    const generateText = vi.fn<AiProvider['generateText']>(async ({ input, model }) => ({
      model,
      text: `translated:${input}`,
      usage: { inputTokens: input.length, outputTokens: input.length, totalTokens: input.length * 2 },
    }))
    const gateway = createAiGateway({
      operations: {
        text: {
          model: 'configured-model',
          provider: { embed: vi.fn(), generateText, name: 'test' },
        },
      },
    })
    const result = await translateKnowledgeText({
      gateway,
      prompt: { id: 1, key: 'translation', locale: 'all', model: 'untrusted-prompt-model', template: 'Translate to {{targetLocale}}', version: 4 },
      sourceLocale: 'zh',
      targetLocale: 'ar',
      text: 'Price and warranty must be reviewed.',
    })
    expect(result).toMatchObject({ locale: 'ar', model: 'configured-model', promptVersion: 4 })
    expect(generateText.mock.calls[0][0].model).toBe('configured-model')
  })

  it('fails closed when the provider changes a unit, product code, or image placeholder', async () => {
    const generateText = vi.fn<AiProvider['generateText']>(async ({ model }) => ({
      model,
      text: 'Changed translation 1200 cm',
      usage: { inputTokens: 4, outputTokens: 4, totalTokens: 8 },
    }))
    const gateway = createAiGateway({
      operations: {
        text: {
          model: 'configured-model',
          provider: { embed: vi.fn(), generateText, name: 'test' },
        },
      },
    })
    await expect(translateKnowledgeText({
      gateway,
      prompt: { id: 1, key: 'translation', locale: 'all', model: null, template: 'Translate', version: 1 },
      sourceLocale: 'en',
      targetLocale: 'ar',
      text: 'AA3003 is 1200 mm [[source-image-1]]',
    })).rejects.toMatchObject({ code: 'translation-fidelity' })
  })

  it('returns stable multilingual high-risk labels', () => {
    expect(detectKnowledgeRiskTopics('价格、交期、质保、السعر والضمان')).toEqual(['price', 'lead-time', 'warranty'])
  })
})
