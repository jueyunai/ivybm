import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import {
  createPortalAiResource,
  deletePortalAiResource,
  updatePortalAiResource,
} from '@/admin-portal/modules/settings/aiSettingsCommands'
import { getPortalAiSettings } from '@/admin-portal/modules/settings/getPortalAiSettings'
import { executePortalCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let providerID = 0
let textProfileID = 0
let embeddingProfileID = 0
let imageProfileID = 0
let textRouteID = 0
let translationRouteID = 0
let embeddingRouteID = 0
let imageRouteID = 0
let originalEncryptionKey: string | undefined

describe.sequential('Portal AI settings', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Portal AI settings integration tests')
    }
    originalEncryptionKey = process.env.AI_CONFIG_ENCRYPTION_KEY
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'd'.repeat(64)
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'portal-ai-settings-integration',
    })
    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `portal-ai-settings-${suffix}@example.invalid`,
        password: 'portal-ai-settings-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    try {
      if (!payload) return
      for (const [collection, id] of [
        ['ai-usage-routes', textRouteID],
        ['ai-usage-routes', translationRouteID],
        ['ai-usage-routes', embeddingRouteID],
        ['ai-usage-routes', imageRouteID],
        ['ai-model-profiles', textProfileID],
        ['ai-model-profiles', embeddingProfileID],
        ['ai-model-profiles', imageProfileID],
        ['ai-providers', providerID],
      ] as const) {
        if (id)
          await payload.delete({ collection, id, overrideAccess: true }).catch(() => undefined)
      }
      await payload
        .delete({
          collection: 'portal-command-receipts',
          overrideAccess: true,
          where: { actor: { equals: admin?.id } },
        })
        .catch(() => undefined)
      await payload
        .delete({
          collection: 'audit-logs',
          overrideAccess: true,
          where: { actor: { equals: admin?.id } },
        })
        .catch(() => undefined)
      if (admin?.id)
        await payload
          .delete({
            collection: 'users',
            context: { skipAudit: true },
            id: admin.id,
            overrideAccess: true,
          })
          .catch(() => undefined)
      await payload.destroy()
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY
      else process.env.AI_CONFIG_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('creates encrypted provider/model/route configuration and reports business readiness', async () => {
    const req = await createLocalReq({ user: admin }, payload)
    const providerInput = {
      apiKey: `portal-secret-${randomUUID()}`,
      baseURL: 'https://api.example.invalid/v1',
      enabled: true,
      name: `Portal provider ${randomUUID()}`,
    }
    const operation = vi.fn((transactionReq) =>
      createPortalAiResource({
        input: providerInput,
        payload,
        req: transactionReq,
        resource: 'providers',
      }),
    )
    const idempotencyKey = `portal-ai:${randomUUID()}`
    const created = await executePortalCommand({
      fingerprintInput: providerInput,
      idempotencyKey,
      operation,
      payload,
      req,
      scope: 'portal.ai-settings:providers:create',
    })
    const replayed = await executePortalCommand({
      fingerprintInput: providerInput,
      idempotencyKey,
      operation,
      payload,
      req,
      scope: 'portal.ai-settings:providers:create',
    })
    providerID = created.item.id
    expect(replayed).toEqual(created)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(created)).not.toContain(providerInput.apiKey)

    const stored = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })
    expect(stored.apiKey).toMatch(/^v1:/)
    expect(stored.apiKey).not.toContain(providerInput.apiKey)

    const textProfile = await createPortalAiResource({
      input: {
        capability: 'text',
        enabled: true,
        model: 'text-model',
        name: `Text ${randomUUID()}`,
        parameters: {
          maxOutputTokens: 2048,
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          temperature: null,
          timeoutMs: 30000,
          topP: null,
        },
        providerID,
      },
      payload,
      req,
      resource: 'profiles',
    })
    textProfileID = textProfile.item.id
    const embeddingProfile = await createPortalAiResource({
      input: {
        capability: 'embedding',
        enabled: true,
        model: 'embedding-model',
        name: `Embedding ${randomUUID()}`,
        parameters: {
          dimensions: 3,
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          timeoutMs: 30000,
        },
        providerID,
      },
      payload,
      req,
      resource: 'profiles',
    })
    embeddingProfileID = embeddingProfile.item.id
    const imageProfile = await createPortalAiResource({
      input: {
        capability: 'image',
        enabled: true,
        model: 'image-model',
        name: `Image ${randomUUID()}`,
        parameters: { timeoutMs: 60000 },
        providerID,
      },
      payload,
      req,
      resource: 'profiles',
    })
    imageProfileID = imageProfile.item.id
    const textRoute = await createPortalAiResource({
      input: { enabled: true, operation: 'text', profileID: textProfileID, usageKey: 'chat.reply' },
      payload,
      req,
      resource: 'routes',
    })
    textRouteID = textRoute.item.id
    const translationRoute = await createPortalAiResource({
      input: {
        enabled: true,
        operation: 'text',
        profileID: textProfileID,
        usageKey: 'knowledge.translation',
      },
      payload,
      req,
      resource: 'routes',
    })
    translationRouteID = translationRoute.item.id
    const embeddingRoute = await createPortalAiResource({
      input: {
        enabled: true,
        operation: 'embedding',
        profileID: embeddingProfileID,
        usageKey: 'knowledge.embedding',
      },
      payload,
      req,
      resource: 'routes',
    })
    embeddingRouteID = embeddingRoute.item.id
    const imageRoute = await createPortalAiResource({
      input: {
        enabled: true,
        operation: 'image',
        profileID: imageProfileID,
        usageKey: 'content.image-generation',
      },
      payload,
      req,
      resource: 'routes',
    })
    imageRouteID = imageRoute.item.id

    const summary = await getPortalAiSettings({ payload, req })
    expect(summary.readiness).toEqual([
      { key: 'customer-chat', reason: null, status: 'ready' },
      { key: 'content-studio', reason: null, status: 'configured-pending-verification' },
      { key: 'knowledge-index', reason: null, status: 'ready' },
      { key: 'knowledge-translation', reason: null, status: 'ready' },
    ])
    expect(JSON.stringify(summary)).not.toContain(providerInput.apiKey)

    process.env.AI_CONFIG_ENCRYPTION_KEY = 'e'.repeat(64)
    try {
      const unreadableSummary = await getPortalAiSettings({ payload, req })
      expect(unreadableSummary.readiness).toEqual([
        { key: 'customer-chat', reason: 'credential', status: 'action-required' },
        { key: 'content-studio', reason: 'credential', status: 'action-required' },
        { key: 'knowledge-index', reason: 'credential', status: 'action-required' },
        { key: 'knowledge-translation', reason: 'credential', status: 'action-required' },
      ])
      expect(JSON.stringify(unreadableSummary)).not.toContain(stored.apiKey)
    } finally {
      process.env.AI_CONFIG_ENCRYPTION_KEY = 'd'.repeat(64)
    }
  })

  it('preserves encrypted keys, rejects stale writes, and deletes in dependency order', async () => {
    const req = await createLocalReq({ user: admin }, payload)
    const before = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })
    await expect(
      updatePortalAiResource({
        id: providerID,
        input: {
          apiKey: '',
          baseURL: 'https://api.example.invalid/v1',
          enabled: true,
          name: 'Stale',
          updatedAt: 'stale',
        },
        payload,
        req,
        resource: 'providers',
      }),
    ).rejects.toMatchObject({ code: 'ai-settings-stale', status: 409 })

    const contenders = ['Concurrent provider A', 'Concurrent provider B']
    const outcomes = await Promise.allSettled(
      contenders.map((name) =>
        executePortalCommand({
          fingerprintInput: { name, updatedAt: before.updatedAt },
          idempotencyKey: `portal-ai:${randomUUID()}`,
          operation: (transactionReq) =>
            updatePortalAiResource({
              id: providerID,
              input: {
                apiKey: '',
                baseURL: 'https://api.example.invalid/v1',
                enabled: true,
                name,
                updatedAt: before.updatedAt,
              },
              payload,
              req: transactionReq,
              resource: 'providers',
            }),
          payload,
          req,
          scope: `portal.ai-settings:providers:update:${providerID}`,
          target: { collection: 'ai-providers', id: providerID },
        }),
      ),
    )
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'ai-settings-stale', status: 409 } })

    const afterConcurrent = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })
    expect(contenders).toContain(afterConcurrent.name)
    expect(afterConcurrent.apiKey).toBe(before.apiKey)

    const updated = await updatePortalAiResource({
      id: providerID,
      input: {
        apiKey: '',
        baseURL: 'https://api.example.invalid/v1',
        enabled: true,
        name: 'Renamed provider',
        updatedAt: afterConcurrent.updatedAt,
      },
      payload,
      req,
      resource: 'providers',
    })
    const after = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })
    expect(updated).toMatchObject({ item: { name: 'Renamed provider' } })
    expect(after.apiKey).toBe(before.apiKey)

    for (const [resource, id] of [
      ['routes', textRouteID],
      ['routes', embeddingRouteID],
      ['routes', imageRouteID],
      ['profiles', textProfileID],
      ['profiles', embeddingProfileID],
      ['profiles', imageProfileID],
    ] as const) {
      const collection = resource === 'routes' ? 'ai-usage-routes' : 'ai-model-profiles'
      const current = await payload.findByID({ collection, id, overrideAccess: true })
      await deletePortalAiResource({
        id,
        input: { updatedAt: current.updatedAt },
        payload,
        req,
        resource,
      })
    }
    const currentProvider = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })
    await deletePortalAiResource({
      id: providerID,
      input: { updatedAt: currentProvider.updatedAt },
      payload,
      req,
      resource: 'providers',
    })
    textRouteID =
      embeddingRouteID =
      imageRouteID =
      textProfileID =
      embeddingProfileID =
      imageProfileID =
      providerID =
        0
  })
})
