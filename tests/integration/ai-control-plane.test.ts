import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, initTransaction, killTransaction, type Payload } from 'payload'
import { NextRequest } from 'next/server'
import type { MigrateDownArgs, PostgresAdapter } from '@payloadcms/db-postgres'

import { POST as graphQLPost } from '@/app/(payload)/api/graphql/route'
import { GET as restGet } from '@/app/(payload)/api/[...slug]/route'
import type { User } from '@/payload-types'
import type { AiProvider } from '@/modules/ai/gateway'
import { AiConfigurationError } from '@/modules/ai/config'
import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'
import type { OpenAICompatibleProviderOptions } from '@/modules/ai/providers/openaiCompatible'
import { down as removeImageGenerationContract } from '@/migrations/20260813_055309_image_generation_provider_contract'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let sales: User
let providerID: number
let profileID: number
let routeID: number
let embeddingProfileID: number
let embeddingRouteID: number
let imageProfileID: number
let imageRouteID: number
let textUsageKey: string
let originalEncryptionKey: string | undefined

const createdUserIDs: Array<number | string> = []
const createdUsageLogIDs: Array<number | string> = []

describe.sequential('AI control plane', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for AI control-plane integration tests')
    }

    originalEncryptionKey = process.env.AI_CONFIG_ENCRYPTION_KEY
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'b'.repeat(64)
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'ai-control-plane-integration-tests',
    })

    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `ai-admin-${suffix}@example.invalid`,
        password: 'ai-control-plane-admin-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `ai-operator-${suffix}@example.invalid`,
        password: 'ai-control-plane-operator-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    sales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `ai-sales-${suffix}@example.invalid`,
        password: 'ai-control-plane-sales-password',
        role: 'sales',
      },
      overrideAccess: true,
    })
    createdUserIDs.push(admin.id, operator.id, sales.id)
  })

  afterAll(async () => {
    if (payload) {
      if (createdUsageLogIDs.length > 0) {
        await payload.delete({
          collection: 'ai-usage-logs',
          overrideAccess: true,
          where: { id: { in: createdUsageLogIDs } },
        })
      }
      for (const [collection, id] of [
        ['ai-usage-routes', routeID],
        ['ai-usage-routes', embeddingRouteID],
        ['ai-usage-routes', imageRouteID],
        ['ai-model-profiles', profileID],
        ['ai-model-profiles', embeddingProfileID],
        ['ai-model-profiles', imageProfileID],
        ['ai-providers', providerID],
      ] as const) {
        if (id) {
          await payload.delete({ collection, id, overrideAccess: true }).catch(() => undefined)
        }
      }
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { in: createdUserIDs } },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: createdUserIDs } },
      })
      await payload.destroy()
    }

    if (originalEncryptionKey === undefined) {
      delete process.env.AI_CONFIG_ENCRYPTION_KEY
    } else {
      process.env.AI_CONFIG_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('allows only admins to manage encrypted provider credentials and model routes', async () => {
    const suffix = randomUUID()
    const visibleProvider = await payload.create({
      collection: 'ai-providers',
      data: {
        apiKey: `provider-secret-${suffix}`,
        apiKeyConfigured: true,
        baseURL: 'https://ai.example.invalid/v1',
        enabled: true,
        name: `Provider ${suffix}`,
        protocol: 'openai-compatible',
        textGenerationContract: 'responses',
      },
      overrideAccess: false,
      user: admin,
    })
    providerID = visibleProvider.id

    expect(visibleProvider).not.toHaveProperty('apiKey')
    expect(visibleProvider.apiKeyConfigured).toBe(true)

    const adminVisibleProvider = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: false,
      user: admin,
    })
    expect(adminVisibleProvider).not.toHaveProperty('apiKey')

    const storedProvider = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })
    expect(storedProvider.apiKey).toMatch(/^v1:/)
    expect(storedProvider.apiKey).not.toContain(`provider-secret-${suffix}`)

    const providerSecret = `provider-secret-${suffix}`
    const login = await payload.login({
      collection: 'users',
      data: {
        email: admin.email,
        password: 'ai-control-plane-admin-password',
      },
    })
    const authorization = `JWT ${login.token}`
    const restResponse = await restGet(
      new NextRequest(`http://localhost/api/ai-providers/${providerID}`, {
        headers: { authorization },
      }),
      { params: Promise.resolve({ slug: ['ai-providers', String(providerID)] }) },
    )
    const restBody = await restResponse.text()
    expect(restResponse.status).toBe(200)
    expect(restBody).not.toContain(providerSecret)

    const graphQLResponse = await graphQLPost(
      new NextRequest('http://localhost/api/graphql', {
        body: JSON.stringify({
          query: `query Provider($id: Int!) {
            AiProvider(id: $id) {
              apiKey
              apiKeyConfigured
              id
              name
            }
          }`,
          variables: { id: providerID },
        }),
        headers: { authorization, 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    const graphQLBody = await graphQLResponse.text()
    expect(graphQLResponse.status).toBe(200)
    expect(graphQLBody).not.toContain(providerSecret)

    await expect(
      payload.update({
        collection: 'ai-providers',
        data: { name: `Updated Provider ${suffix}` },
        id: providerID,
        overrideAccess: false,
        user: operator,
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      payload.create({
        collection: 'ai-providers',
        data: {
          apiKey: `sales-secret-${suffix}`,
          apiKeyConfigured: true,
          baseURL: 'https://ai.example.invalid/v1',
          enabled: true,
          name: `Sales provider ${suffix}`,
          protocol: 'openai-compatible',
          textGenerationContract: 'responses',
        },
        overrideAccess: false,
        user: sales,
      }),
    ).rejects.toMatchObject({ status: 403 })

    const profile = await payload.create({
      collection: 'ai-model-profiles',
      data: {
        capability: 'text',
        enabled: true,
        model: 'gpt-test',
        name: `Chat model ${suffix}`,
        parameters: {
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          timeoutMs: 30_000,
        },
        provider: providerID,
      },
      overrideAccess: false,
      user: admin,
    })
    profileID = profile.id

    await expect(
      payload.create({
        collection: 'ai-model-profiles',
        data: {
          capability: 'embedding',
          enabled: true,
          model: 'embedding-test',
          name: `Invalid embedding model ${suffix}`,
          parameters: {
            maxOutputTokens: 1,
            reasoningEffort: 'medium',
            reasoningEnabled: false,
            timeoutMs: 30_000,
          },
          provider: providerID,
        },
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeDefined()

    textUsageKey = `chat.reply.${suffix.replaceAll('-', '')}`
    const route = await payload.create({
      collection: 'ai-usage-routes',
      data: {
        enabled: true,
        operation: 'text',
        profile: profileID,
        usageKey: textUsageKey,
      },
      overrideAccess: false,
      user: admin,
    })
    routeID = route.id

    await expect(
      payload.create({
        collection: 'ai-usage-routes',
        data: {
          enabled: true,
          operation: 'text',
          profile: profileID,
          usageKey: route.usageKey,
        },
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeDefined()
  })

  it('preserves an encrypted provider key when an administrator changes non-secret fields', async () => {
    const before = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })
    const updated = await payload.update({
      collection: 'ai-providers',
      data: { name: `Renamed ${randomUUID()}` },
      id: providerID,
      overrideAccess: false,
      user: admin,
    })
    const after = await payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })

    expect(updated).not.toHaveProperty('apiKey')
    expect(after.apiKey).toBe(before.apiKey)
  })

  it('persists an image profile, matching usage route and zero-token image telemetry', async () => {
    const suffix = randomUUID()
    const imageProfile = await payload.create({
      collection: 'ai-model-profiles',
      data: {
        capability: 'image',
        enabled: true,
        model: 'image-model',
        name: `Image model ${suffix}`,
        parameters: {
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          timeoutMs: 60_000,
        },
        provider: providerID,
      },
      overrideAccess: false,
      user: admin,
    })
    imageProfileID = imageProfile.id

    await expect(
      payload.create({
        collection: 'ai-usage-routes',
        data: {
          enabled: true,
          operation: 'text',
          profile: imageProfileID,
          usageKey: `content.image.invalid.${suffix.replaceAll('-', '')}`,
        },
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toBeDefined()

    const imageRoute = await payload.create({
      collection: 'ai-usage-routes',
      data: {
        enabled: true,
        operation: 'image',
        profile: imageProfileID,
        usageKey: 'content.image-generation',
      },
      overrideAccess: false,
      user: admin,
    })
    imageRouteID = imageRoute.id

    const usage = await payload.create({
      collection: 'ai-usage-logs',
      data: {
        durationMs: 250,
        inputTokens: 0,
        model: 'image-model',
        operation: 'generateImage',
        outputTokens: 0,
        provider: 'configured-provider',
        requestId: `${suffix}-image`,
        totalTokens: 0,
      },
      overrideAccess: true,
    })
    createdUsageLogIDs.push(usage.id)

    expect(imageProfile.capability).toBe('image')
    expect(imageRoute.operation).toBe('image')
    expect(usage).toMatchObject({ operation: 'generateImage', totalTokens: 0 })
  })

  it('refuses an image schema downgrade before DDL while image data exists', async () => {
    const request = await createLocalReq({}, payload)
    await initTransaction(request)
    const transactionID = await request.transactionID
    const transaction = transactionID
      ? (payload.db as unknown as PostgresAdapter).sessions[String(transactionID)]?.db
      : undefined
    if (!transaction) throw new Error('Expected an isolated image migration transaction')

    try {
      await expect(
        removeImageGenerationContract({
          db: transaction as MigrateDownArgs['db'],
          payload,
          req: request,
        }),
      ).rejects.toThrow(
        'Cannot roll back image generation migration while image configuration or usage data exists',
      )
    } finally {
      await killTransaction(request)
    }

    await expect(
      payload.findByID({
        collection: 'ai-model-profiles',
        id: imageProfileID,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ capability: 'image' })
    await expect(
      payload.findByID({
        collection: 'ai-usage-routes',
        id: imageRouteID,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ operation: 'image' })
    await expect(
      payload.findByID({
        collection: 'ai-usage-logs',
        id: createdUsageLogIDs.at(-1),
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ operation: 'generateImage' })
  })

  it('resolves the persisted route snapshot and fails closed for a disabled route', async () => {
    const suffix = randomUUID()
    const embeddingProfile = await payload.create({
      collection: 'ai-model-profiles',
      data: {
        capability: 'embedding',
        enabled: true,
        model: 'embedding-model',
        name: `Embedding model ${suffix}`,
        parameters: {
          dimensions: 3,
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          timeoutMs: 15_000,
        },
        provider: providerID,
      },
      overrideAccess: false,
      user: admin,
    })
    embeddingProfileID = embeddingProfile.id
    const embeddingRoute = await payload.create({
      collection: 'ai-usage-routes',
      data: {
        enabled: true,
        operation: 'embedding',
        profile: embeddingProfileID,
        usageKey: AI_USAGE_KEYS.knowledgeEmbedding,
      },
      overrideAccess: false,
      user: admin,
    })
    embeddingRouteID = embeddingRoute.id

    const calls: Array<Record<string, unknown>> = []
    const createProvider = vi.fn((options: OpenAICompatibleProviderOptions): AiProvider => ({
      embed: async ({ input, model }) => {
        calls.push({ model, operation: 'embedding', provider: options.name })
        return {
          embeddings: input.map(() => [1, 0, 0]),
          model,
          requestId: `${suffix}-embed`,
          usage: { inputTokens: 2, totalTokens: 2 },
        }
      },
      generateText: async ({ model }) => {
        calls.push({ model, operation: 'text', provider: options.name })
        return {
          model,
          requestId: `${suffix}-text`,
          text: 'Configured response',
          usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        }
      },
      name: options.name || 'configured-provider',
    }))
    const gateway = await resolveAiGateway({
      createProvider,
      payload,
      routes: [
        { operation: 'text', usageKey: textUsageKey },
        { operation: 'embedding', usageKey: AI_USAGE_KEYS.knowledgeEmbedding },
      ],
    })

    await gateway.generateText({ input: 'Configured text' })
    await gateway.embed({ input: ['Configured embedding'] })
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: 'gpt-test', operation: 'text' }),
        expect.objectContaining({ model: 'embedding-model', operation: 'embedding' }),
      ]),
    )
    const usage = await payload.find({
      collection: 'ai-usage-logs',
      limit: 10,
      overrideAccess: true,
      pagination: false,
      where: { requestId: { in: [`${suffix}-embed`, `${suffix}-text`] } },
    })
    createdUsageLogIDs.push(...usage.docs.map(({ id }) => id))
    expect(usage.docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inputTokens: 2,
          model: 'gpt-test',
          operation: 'generateText',
          outputTokens: 1,
          requestId: `${suffix}-text`,
          totalTokens: 3,
        }),
        expect.objectContaining({
          inputTokens: 2,
          model: 'embedding-model',
          operation: 'embed',
          requestId: `${suffix}-embed`,
          totalTokens: 2,
        }),
      ]),
    )

    await payload.update({
      collection: 'ai-usage-routes',
      data: { enabled: false },
      id: routeID,
      overrideAccess: false,
      user: admin,
    })
    await expect(
      resolveAiGateway({
        createProvider,
        payload,
        routes: [{ operation: 'text', usageKey: textUsageKey }],
      }),
    ).rejects.toMatchObject({ name: 'AiConfigurationError' })
  })

  it('rejects an upgraded embedding route whose existing profile has no fixed dimensions', async () => {
    const suffix = randomUUID()
    const profile = await payload.create({
      collection: 'ai-model-profiles',
      data: {
        capability: 'embedding',
        enabled: true,
        model: 'legacy-embedding-model',
        name: `Legacy embedding ${suffix}`,
        parameters: {
          dimensions: 3,
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          timeoutMs: 15_000,
        },
        provider: providerID,
      },
      overrideAccess: true,
    })
    const route = await payload.create({
      collection: 'ai-usage-routes',
      data: {
        enabled: true,
        operation: 'embedding',
        profile: profile.id,
        usageKey: `legacy.embedding.${suffix.replaceAll('-', '')}`,
      },
      overrideAccess: true,
    })

    try {
      await (payload.db as unknown as PostgresAdapter).pool.query(
        'UPDATE ai_model_profiles SET parameters_dimensions = NULL WHERE id = $1',
        [profile.id],
      )
      await expect(
        resolveAiGateway({
          payload,
          routes: [{ operation: 'embedding', usageKey: route.usageKey }],
        }),
      ).rejects.toBeInstanceOf(AiConfigurationError)
    } finally {
      await payload.delete({ collection: 'ai-usage-routes', id: route.id, overrideAccess: true })
      await payload.delete({
        collection: 'ai-model-profiles',
        id: profile.id,
        overrideAccess: true,
      })
    }
  })
})
