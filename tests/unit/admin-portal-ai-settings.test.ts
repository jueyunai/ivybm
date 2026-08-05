import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import {
  buildPortalAiReadiness,
  getPortalAiSettings,
  mapPortalAiProvider,
} from '@/admin-portal/modules/settings/getPortalAiSettings'

describe('Portal AI settings read model', () => {
  it('maps providers without returning write-only credentials', () => {
    const provider = mapPortalAiProvider({
      apiKey: 'v1:encrypted-secret',
      apiKeyConfigured: true,
      baseURL: 'https://api.example.invalid/v1',
      enabled: true,
      id: 1,
      name: 'Primary',
      protocol: 'openai-compatible',
      updatedAt: '2026-08-05T00:00:00.000Z',
    })

    expect(provider).toMatchObject({ apiKeyConfigured: true, name: 'Primary' })
    expect(JSON.stringify(provider)).not.toMatch(/encrypted-secret|apiKey":/)
  })

  it('requires both text and embedding routes for customer chat', () => {
    const provider = {
      apiKeyConfigured: true,
      baseURL: 'https://api.example.invalid/v1',
      enabled: true,
      id: 1,
      name: 'Primary',
      protocol: 'openai-compatible' as const,
      updatedAt: '',
    }
    const profiles = [
      {
        capability: 'text' as const,
        enabled: true,
        id: 2,
        model: 'text-model',
        name: 'Text',
        parameters: { dimensions: null, maxOutputTokens: null, reasoningEffort: null, reasoningEnabled: false, temperature: null, timeoutMs: 30000, topP: null },
        providerID: 1,
        providerName: 'Primary',
        updatedAt: '',
      },
    ]
    const readiness = buildPortalAiReadiness({
      encryptionKeyConfigured: true,
      profiles,
      providers: [provider],
      routes: [{ enabled: true, id: 3, operation: 'text', profileID: 2, profileName: 'Text', updatedAt: '', usageKey: 'chat.reply' }],
    })

    expect(readiness).toEqual([
      { key: 'customer-chat', reason: 'route', status: 'action-required' },
      { key: 'content-studio', reason: null, status: 'ready' },
      { key: 'knowledge-index', reason: 'route', status: 'action-required' },
    ])
  })

  it('uses bounded access-controlled reads for all three AI collections', async () => {
    const find = vi.fn()
      .mockResolvedValueOnce({ docs: [{ apiKey: 'never-return-me', apiKeyConfigured: true, baseURL: 'https://api.example.invalid/v1', enabled: true, id: 1, name: 'Primary', protocol: 'openai-compatible', updatedAt: '' }] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
    const req = { user: { id: 1 } } as unknown as PayloadRequest
    const summary = await getPortalAiSettings({ payload: { find } as unknown as Payload, req })

    expect(find).toHaveBeenCalledTimes(3)
    for (const call of find.mock.calls) {
      expect(call[0]).toMatchObject({ depth: 0, limit: 100, overrideAccess: false, pagination: false, req })
    }
    expect(JSON.stringify(summary)).not.toContain('never-return-me')
  })
})
