import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import {
  buildPortalAiReadiness,
  getPortalAiSettings,
  mapPortalAiProvider,
} from '@/admin-portal/modules/settings/getPortalAiSettings'
import {
  encryptAiCredential,
  readAiConfigurationEncryptionKey,
} from '@/modules/ai/credentials'

describe('Portal AI settings read model', () => {
  afterEach(() => vi.unstubAllEnvs())

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
      readableProviderIDs: new Set([provider.id]),
      routes: [{ enabled: true, id: 3, operation: 'text', profileID: 2, profileName: 'Text', updatedAt: '', usageKey: 'chat.reply' }],
    })

    expect(readiness).toEqual([
      { key: 'customer-chat', reason: 'route', status: 'action-required' },
      { key: 'content-studio', reason: null, status: 'ready' },
      { key: 'knowledge-index', reason: 'route', status: 'action-required' },
    ])
  })

  it('reads every access-controlled page and never returns credential ciphertext', async () => {
    vi.stubEnv('AI_CONFIG_ENCRYPTION_KEY', 'a'.repeat(64))
    const apiKey = encryptAiCredential(
      'never-return-me',
      readAiConfigurationEncryptionKey(),
    )
    const find = vi.fn(async ({
      collection,
      page,
    }: {
      collection: string
      page: number
      req: PayloadRequest
    }) => {
      const documents = {
        'ai-model-profiles': {
          1: [],
          2: [{ capability: 'text', enabled: true, id: 5, model: 'text-model', name: 'Text', parameters: {}, provider: 4, updatedAt: '' }],
        },
        'ai-providers': {
          1: [{ apiKey, apiKeyConfigured: true, baseURL: 'https://api.example.invalid/v1', enabled: true, id: 1, name: 'Primary', protocol: 'openai-compatible', updatedAt: '' }],
          2: [{ apiKey, apiKeyConfigured: true, baseURL: 'https://api.example.invalid/v1', enabled: true, id: 4, name: 'Secondary', protocol: 'openai-compatible', updatedAt: '' }],
        },
        'ai-usage-routes': {
          1: [],
          2: [{ enabled: true, id: 6, operation: 'text', profile: 5, updatedAt: '', usageKey: 'chat.reply' }],
        },
      } as const
      return {
        docs: documents[collection as keyof typeof documents][page as 1 | 2],
        hasNextPage: page === 1,
        nextPage: page === 1 ? 2 : null,
      }
    })
    const req = { context: {}, query: {}, user: { id: 1 } } as unknown as PayloadRequest
    const summary = await getPortalAiSettings({ payload: { find } as unknown as Payload, req })

    expect(find).toHaveBeenCalledTimes(6)
    for (const call of find.mock.calls) {
      expect(call[0]).toMatchObject({
        depth: 0,
        limit: 100,
        overrideAccess: false,
        pagination: true,
      })
    }
    expect(
      find.mock.calls.filter(([options]) => options.collection === 'ai-providers'),
    ).toEqual([
      [expect.objectContaining({
        context: { portalAiReadinessCredentialRead: true },
        page: 1,
        select: expect.objectContaining({ apiKey: true }),
      })],
      [expect.objectContaining({
        context: { portalAiReadinessCredentialRead: true },
        page: 2,
        select: expect.objectContaining({ apiKey: true }),
      })],
    ])
    for (const [options] of find.mock.calls.filter(
      ([candidate]) => candidate.collection === 'ai-providers',
    )) {
      expect(options.req).not.toBe(req)
      expect(options.req.user).toBe(req.user)
    }
    for (const [options] of find.mock.calls.filter(
      ([candidate]) => candidate.collection !== 'ai-providers',
    )) {
      expect(options.req).toBe(req)
    }
    expect(req.context).toEqual({})
    expect(summary.providers.map(({ id }) => id)).toEqual([1, 4])
    expect(summary.profiles).toEqual([
      expect.objectContaining({ id: 5, providerName: 'Secondary' }),
    ])
    expect(summary.routes).toEqual([expect.objectContaining({ id: 6, profileName: 'Text' })])
    expect(JSON.stringify(summary)).not.toContain('never-return-me')
    expect(JSON.stringify(summary)).not.toContain(apiKey)
  })

  it('fails closed when a paginated result does not advance', async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [],
      hasNextPage: true,
      nextPage: 1,
    })

    await expect(
      getPortalAiSettings({
        payload: { find } as unknown as Payload,
        req: { user: { id: 1 } } as unknown as PayloadRequest,
      }),
    ).rejects.toThrow('AI settings pagination did not advance')
    expect(find).toHaveBeenCalledTimes(3)
  })
})
