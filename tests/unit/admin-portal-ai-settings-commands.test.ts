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
