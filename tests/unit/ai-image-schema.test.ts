import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { AiModelProfiles } from '@/collections/AiModelProfiles'
import { AiUsageLogs } from '@/collections/AiUsageLogs'
import { AiUsageRoutes } from '@/collections/AiUsageRoutes'

const namedField = (collection: CollectionConfig, name: string) => {
  const field = collection.fields.find(
    (candidate) => 'name' in candidate && candidate.name === name,
  )
  if (!field || !('name' in field)) throw new Error(`Missing field ${name}`)
  return field
}

const optionValues = (collection: CollectionConfig, name: string): string[] => {
  const field = namedField(collection, name)
  if (!('options' in field) || !Array.isArray(field.options)) return []
  return field.options.map((option) => (typeof option === 'string' ? option : String(option.value)))
}

describe('AI model profile timeout and output defaults', () => {
  const parametersField = (name: string) => {
    const group = namedField(AiModelProfiles, 'parameters')
    if (!('fields' in group)) throw new Error('parameters group has no fields')
    const field = group.fields.find((candidate) => 'name' in candidate && candidate.name === name)
    if (!field || !('name' in field)) throw new Error(`Missing parameters.${name}`)
    return field
  }

  it('defaults the text timeout high enough for long-tail provider latency', () => {
    const timeout = parametersField('timeoutMs')
    expect('defaultValue' in timeout ? timeout.defaultValue : undefined).toBe(90_000)
  })

  it('defaults maxOutputTokens so long engineering copy is not truncated', () => {
    const maxOutputTokens = parametersField('maxOutputTokens')
    expect('defaultValue' in maxOutputTokens ? maxOutputTokens.defaultValue : undefined).toBe(8_192)
  })
})

describe('AI image control-plane schema', () => {
  it('registers image capability, route operation and usage telemetry operation', () => {
    expect(optionValues(AiModelProfiles, 'capability')).toContain('image')
    expect(optionValues(AiUsageRoutes, 'operation')).toContain('image')
    expect(optionValues(AiUsageLogs, 'operation')).toContain('generateImage')
  })

  it('accepts an image profile without embedding or text-only parameters', async () => {
    const hook = AiModelProfiles.hooks?.beforeChange?.[0]
    expect(typeof hook).toBe('function')

    const result = await (hook as CollectionBeforeChangeHook)({
      data: {
        capability: 'image',
        parameters: { timeoutMs: 60_000 },
        provider: 1,
      },
      operation: 'create',
      originalDoc: undefined,
      req: {
        payload: {
          findByID: vi.fn().mockResolvedValue({ apiKeyConfigured: true, enabled: true }),
        },
      },
    } as unknown as Parameters<CollectionBeforeChangeHook>[0])

    expect(result).toMatchObject({ capability: 'image' })
  })

  it('rejects text or embedding parameters on an image profile', async () => {
    const hook = AiModelProfiles.hooks?.beforeChange?.[0]

    await expect(
      (hook as CollectionBeforeChangeHook)({
        data: {
          capability: 'image',
          parameters: { dimensions: 3, maxOutputTokens: 100, timeoutMs: 60_000 },
          provider: 1,
        },
        operation: 'create',
        originalDoc: undefined,
        req: {
          payload: {
            findByID: vi.fn().mockResolvedValue({ apiKeyConfigured: true, enabled: true }),
          },
        },
      } as unknown as Parameters<CollectionBeforeChangeHook>[0]),
    ).rejects.toBeDefined()
  })
})
