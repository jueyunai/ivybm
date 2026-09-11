import { describe, expect, it, vi } from 'vitest'

import type { CollectionBeforeChangeHook } from 'payload'

import { AiModelProfiles } from '@/collections/AiModelProfiles'

// Regression for the Ready-gate failure: a field-level defaultValue on
// maxOutputTokens is applied to every capability, so embedding and image
// profiles were written with a text-only setting and then rejected.
describe('task-17: maxOutputTokens default must stay text-only', () => {
  const runHook = async (data: Record<string, unknown>) => {
    const hook = AiModelProfiles.hooks?.beforeChange?.[0] as CollectionBeforeChangeHook
    return hook({
      data,
      operation: 'create',
      originalDoc: undefined,
      req: {
        payload: {
          findByID: vi.fn().mockResolvedValue({ apiKeyConfigured: true, enabled: true }),
        },
      },
    } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  }

  it('does not put a text-only default on an embedding profile', async () => {
    // Payload would have injected maxOutputTokens here if the field carried a
    // defaultValue; with the fix the hook sees only caller-supplied settings.
    await expect(
      runHook({
        capability: 'embedding',
        parameters: { dimensions: 3, timeoutMs: 90_000 },
        provider: 1,
      }),
    ).resolves.toMatchObject({ capability: 'embedding' })
  })

  it('does not put a text-only default on an image profile', async () => {
    await expect(
      runHook({
        capability: 'image',
        parameters: { timeoutMs: 120_000 },
        provider: 1,
      }),
    ).resolves.toMatchObject({ capability: 'image' })
  })

  it('still fills the pair default for a text profile that omits them', async () => {
    // Mirror what Payload does for a text profile: only the field that carries a
    // defaultValue is pre-filled, so the hook must supply maxOutputTokens itself.
    const result = await runHook({
      capability: 'text',
      parameters: { reasoningEffort: 'medium', reasoningEnabled: false, timeoutMs: 90_000 },
      provider: 1,
    })
    expect((result as { parameters: Record<string, unknown> }).parameters).toMatchObject({
      maxOutputTokens: 8_192,
    })
  })
})
