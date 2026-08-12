import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import {
  AiSettingsCommandError,
  createPortalAiResource,
  parsePortalAiResource,
  updatePortalAiResource,
} from '@/admin-portal/modules/settings/aiSettingsCommands'

const req = { user: { collection: 'users', id: 1, role: 'admin' } } as unknown as PayloadRequest

describe('Portal AI settings commands', () => {
  it('whitelists AI resources and usage routes', async () => {
    expect(parsePortalAiResource('providers')).toBe('providers')
    expect(() => parsePortalAiResource('usage-logs')).toThrow(AiSettingsCommandError)

    await expect(
      createPortalAiResource({
        input: { enabled: true, operation: 'text', profileID: 1, usageKey: 'arbitrary.route' },
        payload: { create: vi.fn() } as unknown as Payload,
        req,
        resource: 'routes',
      }),
    ).rejects.toMatchObject({ code: 'ai-settings-validation-failed', status: 400 })

    const create = vi.fn().mockResolvedValue({ enabled: true, id: 10, operation: 'image', profile: 8, updatedAt: '', usageKey: 'content.image-generation' })
    await expect(createPortalAiResource({
      input: { enabled: true, operation: 'image', profileID: 8, usageKey: 'content.image-generation' },
      payload: { create, findByID: vi.fn().mockResolvedValue({ id: 8, name: 'Image' }) } as unknown as Payload,
      req,
      resource: 'routes',
    })).resolves.toMatchObject({ item: { operation: 'image' } })
  })

  it('creates an image model without text or embedding parameters', async () => {
    const create = vi.fn().mockResolvedValue({ capability: 'image', enabled: true, id: 11, model: 'image-model', name: 'Image', parameters: { reasoningEffort: 'medium', reasoningEnabled: false, timeoutMs: 60_000 }, provider: 4, updatedAt: '' })
    await createPortalAiResource({
      input: { capability: 'image', enabled: true, model: 'image-model', name: 'Image', parameters: { timeoutMs: 60_000 }, providerID: 4 },
      payload: { create, findByID: vi.fn().mockResolvedValue({ id: 4, name: 'Primary' }) } as unknown as Payload,
      req,
      resource: 'profiles',
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ capability: 'image', parameters: { reasoningEffort: 'medium', reasoningEnabled: false, timeoutMs: 60_000 } }) }))
  })

  it('creates providers through current access-controlled request and never returns the key', async () => {
    const create = vi.fn().mockResolvedValue({ apiKey: 'v1:ciphertext', apiKeyConfigured: true, baseURL: 'https://api.example.invalid/v1', enabled: true, id: 4, name: 'Primary', protocol: 'openai-compatible', updatedAt: '' })
    const result = await createPortalAiResource({
      input: { apiKey: 'submitted-secret', baseURL: 'https://api.example.invalid/v1', enabled: true, name: 'Primary' },
      payload: { create } as unknown as Payload,
      req,
      resource: 'providers',
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ collection: 'ai-providers', data: expect.objectContaining({ apiKey: 'submitted-secret' }), overrideAccess: false, req }))
    expect(JSON.stringify(result)).not.toMatch(/submitted-secret|ciphertext/)
  })

  it('returns related names after creating profiles and routes', async () => {
    const profile = await createPortalAiResource({
      input: {
        capability: 'text',
        enabled: true,
        model: 'text-model',
        name: 'Text',
        parameters: {
          maxOutputTokens: 2048,
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          temperature: null,
          timeoutMs: 30_000,
          topP: null,
        },
        providerID: 4,
      },
      payload: {
        create: vi.fn().mockResolvedValue({
          capability: 'text',
          enabled: true,
          id: 8,
          model: 'text-model',
          name: 'Text',
          parameters: {},
          provider: 4,
          updatedAt: '',
        }),
        findByID: vi.fn().mockResolvedValue({ id: 4, name: 'Primary' }),
      } as unknown as Payload,
      req,
      resource: 'profiles',
    })
    const route = await createPortalAiResource({
      input: { enabled: true, operation: 'text', profileID: 8, usageKey: 'chat.reply' },
      payload: {
        create: vi.fn().mockResolvedValue({
          enabled: true,
          id: 9,
          operation: 'text',
          profile: 8,
          updatedAt: '',
          usageKey: 'chat.reply',
        }),
        findByID: vi.fn().mockResolvedValue({ id: 8, name: 'Text' }),
      } as unknown as Payload,
      req,
      resource: 'routes',
    })

    expect(profile.item).toMatchObject({ providerName: 'Primary' })
    expect(route.item).toMatchObject({ profileName: 'Text' })
  })

  it('returns related names after updating profiles and routes', async () => {
    const profileFindByID = vi.fn(async ({ collection }: { collection: string }) =>
      collection === 'ai-model-profiles'
        ? { updatedAt: 'current' }
        : { id: 4, name: 'Primary' },
    )
    const profile = await updatePortalAiResource({
      id: 8,
      input: {
        capability: 'text',
        enabled: true,
        model: 'text-model',
        name: 'Text',
        parameters: {
          maxOutputTokens: 2048,
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          temperature: null,
          timeoutMs: 30_000,
          topP: null,
        },
        providerID: 4,
        updatedAt: 'current',
      },
      payload: {
        findByID: profileFindByID,
        update: vi.fn().mockResolvedValue({
          capability: 'text',
          enabled: true,
          id: 8,
          model: 'text-model',
          name: 'Text',
          parameters: {},
          provider: 4,
          updatedAt: 'next',
        }),
      } as unknown as Payload,
      req,
      resource: 'profiles',
    })
    const routeFindByID = vi.fn(async ({ collection }: { collection: string }) =>
      collection === 'ai-usage-routes'
        ? { updatedAt: 'current' }
        : { id: 8, name: 'Text' },
    )
    const route = await updatePortalAiResource({
      id: 9,
      input: {
        enabled: true,
        operation: 'text',
        profileID: 8,
        updatedAt: 'current',
        usageKey: 'chat.reply',
      },
      payload: {
        findByID: routeFindByID,
        update: vi.fn().mockResolvedValue({
          enabled: true,
          id: 9,
          operation: 'text',
          profile: 8,
          updatedAt: 'next',
          usageKey: 'chat.reply',
        }),
      } as unknown as Payload,
      req,
      resource: 'routes',
    })

    expect(profile.item).toMatchObject({ providerName: 'Primary' })
    expect(route.item).toMatchObject({ profileName: 'Text' })
    expect(profileFindByID).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: 'ai-providers', overrideAccess: false, req }),
    )
    expect(routeFindByID).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: 'ai-model-profiles', overrideAccess: false, req }),
    )
  })

  it('retains an existing key by omitting blank API key updates', async () => {
    const update = vi.fn().mockResolvedValue({ apiKeyConfigured: true, baseURL: 'https://api.example.invalid/v1', enabled: true, id: 4, name: 'Primary', protocol: 'openai-compatible', updatedAt: '' })
    const findByID = vi.fn().mockResolvedValue({ updatedAt: '2026-08-05T00:00:00.000Z' })
    await updatePortalAiResource({
      id: 4,
      input: { apiKey: '', baseURL: 'https://api.example.invalid/v1', enabled: true, name: 'Primary', updatedAt: '2026-08-05T00:00:00.000Z' },
      payload: { findByID, update } as unknown as Payload,
      req,
      resource: 'providers',
    })
    expect(update.mock.calls[0][0].data).not.toHaveProperty('apiKey')
  })

  it('rejects stale writers before updating the record', async () => {
    const update = vi.fn()
    await expect(
      updatePortalAiResource({
        id: 4,
        input: { apiKey: '', baseURL: 'https://api.example.invalid/v1', enabled: true, name: 'Primary', updatedAt: 'stale' },
        payload: { findByID: vi.fn().mockResolvedValue({ updatedAt: 'current' }), update } as unknown as Payload,
        req,
        resource: 'providers',
      }),
    ).rejects.toMatchObject({ code: 'ai-settings-stale', status: 409 })
    expect(update).not.toHaveBeenCalled()
  })
})
