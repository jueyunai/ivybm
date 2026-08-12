import type { Payload, PayloadRequest } from 'payload'

import { portalAiReadinessCredentialReadContext } from '@/access/aiCredentials'
import {
  canDecryptAiCredential,
  readAiConfigurationEncryptionKey,
} from '@/modules/ai/credentials'
import { AI_USAGE_KEYS } from '@/modules/ai/registry'
import type { OpenAICompatibleTextGenerationContract } from '@/modules/ai/providers/openaiCompatible'

export type PortalAiCapability = 'embedding' | 'image' | 'text'
export type PortalAiSettingsAccess = 'admin' | 'admin-only'
export type PortalAiReadinessReason =
  | 'credential'
  | 'encryption-key'
  | 'profile'
  | 'provider'
  | 'route'

export interface PortalAiProviderSummary {
  apiKeyConfigured: boolean
  baseURL: string
  enabled: boolean
  id: number
  name: string
  protocol: 'openai-compatible'
  textGenerationContract: OpenAICompatibleTextGenerationContract
  updatedAt: string
}

export interface PortalAiModelParameters {
  dimensions: number | null
  maxOutputTokens: number | null
  reasoningEffort: string | null
  reasoningEnabled: boolean
  temperature: number | null
  timeoutMs: number
  topP: number | null
}

export interface PortalAiModelProfileSummary {
  capability: PortalAiCapability
  enabled: boolean
  id: number
  model: string
  name: string
  parameters: PortalAiModelParameters
  providerID: number
  providerName: string | null
  updatedAt: string
}

export interface PortalAiUsageRouteSummary {
  enabled: boolean
  id: number
  operation: PortalAiCapability
  profileID: number
  profileName: string | null
  updatedAt: string
  usageKey: string
}

export type PortalAiReadinessKey = 'content-studio' | 'customer-chat' | 'knowledge-index'

export interface PortalAiReadinessSummary {
  key: PortalAiReadinessKey
  reason: PortalAiReadinessReason | null
  status: 'action-required' | 'configured-pending-verification' | 'ready'
}

export interface PortalAiSettingsSummary {
  access: PortalAiSettingsAccess
  encryptionKeyConfigured: boolean
  profiles: PortalAiModelProfileSummary[]
  providers: PortalAiProviderSummary[]
  readiness: PortalAiReadinessSummary[]
  routes: PortalAiUsageRouteSummary[]
}

type UnknownRecord = Record<string, unknown>

const record = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' ? (value as UnknownRecord) : {}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const nullableNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

interface PortalAiPage<Document> {
  docs: Document[]
  hasNextPage?: boolean
  nextPage?: null | number
}

const readAllPortalAiPages = async <Document>(
  findPage: (page: number) => Promise<PortalAiPage<Document>>,
): Promise<Document[]> => {
  const documents: Document[] = []
  let page = 1

  while (true) {
    const result = await findPage(page)
    documents.push(...result.docs)
    if (!result.hasNextPage) return documents

    const nextPage = result.nextPage
    if (typeof nextPage !== 'number' || !Number.isSafeInteger(nextPage) || nextPage <= page) {
      throw new Error('AI settings pagination did not advance')
    }
    page = nextPage
  }
}

export const portalAiRelationshipID = (value: unknown): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  const id = record(value).id
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : 0
}

export const mapPortalAiProvider = (value: unknown): PortalAiProviderSummary => {
  const provider = record(value)
  return {
    apiKeyConfigured: provider.apiKeyConfigured === true,
    baseURL: text(provider.baseURL),
    enabled: provider.enabled === true,
    id: portalAiRelationshipID(provider.id),
    name: text(provider.name),
    protocol: 'openai-compatible',
    textGenerationContract:
      provider.textGenerationContract === 'chat-completions'
        ? 'chat-completions'
        : 'responses',
    updatedAt: text(provider.updatedAt),
  }
}

export const mapPortalAiProfile = (
  value: unknown,
  providers: readonly PortalAiProviderSummary[],
): PortalAiModelProfileSummary => {
  const profile = record(value)
  const parameters = record(profile.parameters)
  const providerID = portalAiRelationshipID(profile.provider)
  return {
    capability: profile.capability === 'embedding'
      ? 'embedding'
      : profile.capability === 'image'
        ? 'image'
        : 'text',
    enabled: profile.enabled === true,
    id: portalAiRelationshipID(profile.id),
    model: text(profile.model),
    name: text(profile.name),
    parameters: {
      dimensions: nullableNumber(parameters.dimensions),
      maxOutputTokens: nullableNumber(parameters.maxOutputTokens),
      reasoningEffort: text(parameters.reasoningEffort) || null,
      reasoningEnabled: parameters.reasoningEnabled === true,
      temperature: nullableNumber(parameters.temperature),
      timeoutMs: nullableNumber(parameters.timeoutMs) ?? 30_000,
      topP: nullableNumber(parameters.topP),
    },
    providerID,
    providerName: providers.find((provider) => provider.id === providerID)?.name ?? null,
    updatedAt: text(profile.updatedAt),
  }
}

export const mapPortalAiRoute = (
  value: unknown,
  profiles: readonly PortalAiModelProfileSummary[],
): PortalAiUsageRouteSummary => {
  const route = record(value)
  const profileID = portalAiRelationshipID(route.profile)
  return {
    enabled: route.enabled === true,
    id: portalAiRelationshipID(route.id),
    operation: route.operation === 'embedding'
      ? 'embedding'
      : route.operation === 'image'
        ? 'image'
        : 'text',
    profileID,
    profileName: profiles.find((profile) => profile.id === profileID)?.name ?? null,
    updatedAt: text(route.updatedAt),
    usageKey: text(route.usageKey),
  }
}

const routeReadiness = ({
  capability,
  encryptionKeyConfigured,
  profiles,
  providers,
  readableProviderIDs,
  routes,
  usageKey,
}: {
  capability: PortalAiCapability
  encryptionKeyConfigured: boolean
  profiles: readonly PortalAiModelProfileSummary[]
  providers: readonly PortalAiProviderSummary[]
  readableProviderIDs: ReadonlySet<number>
  routes: readonly PortalAiUsageRouteSummary[]
  usageKey: string
}): PortalAiReadinessReason | null => {
  if (!encryptionKeyConfigured) return 'encryption-key'
  const route = routes.find(
    (candidate) =>
      candidate.usageKey === usageKey && candidate.operation === capability && candidate.enabled,
  )
  if (!route) return 'route'
  const profile = profiles.find(
    (candidate) =>
      candidate.id === route.profileID &&
      candidate.capability === capability &&
      candidate.enabled &&
      candidate.model,
  )
  if (!profile) return 'profile'
  if (capability === 'embedding' && !profile.parameters.dimensions) return 'profile'
  const provider = providers.find(
    (candidate) =>
      candidate.id === profile.providerID && candidate.enabled && candidate.apiKeyConfigured,
  )
  if (!provider) return 'provider'
  return readableProviderIDs.has(provider.id) ? null : 'credential'
}

export const buildPortalAiReadiness = ({
  encryptionKeyConfigured,
  profiles,
  providers,
  readableProviderIDs,
  routes,
}: Pick<PortalAiSettingsSummary, 'encryptionKeyConfigured' | 'profiles' | 'providers' | 'routes'> & {
  readableProviderIDs: ReadonlySet<number>
}): PortalAiReadinessSummary[] => {
  const textReason = routeReadiness({
    capability: 'text',
    encryptionKeyConfigured,
    profiles,
    providers,
    readableProviderIDs,
    routes,
    usageKey: AI_USAGE_KEYS.chatReply,
  })
  const embeddingReason = routeReadiness({
    capability: 'embedding',
    encryptionKeyConfigured,
    profiles,
    providers,
    readableProviderIDs,
    routes,
    usageKey: AI_USAGE_KEYS.knowledgeEmbedding,
  })
  const imageReason = routeReadiness({
    capability: 'image',
    encryptionKeyConfigured,
    profiles,
    providers,
    readableProviderIDs,
    routes,
    usageKey: AI_USAGE_KEYS.contentImageGeneration,
  })
  const item = (
    key: PortalAiReadinessKey,
    reason: PortalAiReadinessReason | null,
    configuredPendingVerification = false,
  ): PortalAiReadinessSummary => ({
    key,
    reason,
    status: reason
      ? 'action-required'
      : configuredPendingVerification
        ? 'configured-pending-verification'
        : 'ready',
  })
  return [
    item('customer-chat', textReason ?? embeddingReason),
    item('content-studio', textReason ?? imageReason, true),
    item('knowledge-index', embeddingReason),
  ]
}

export const getPortalAiSettings = async ({
  payload,
  req,
}: {
  payload: Payload
  req: PayloadRequest
}): Promise<PortalAiSettingsSummary> => {
  // Payload merges Local API context back into the supplied request. Use a
  // scoped clone so ciphertext read permission cannot survive this query.
  const credentialReadReq = {
    ...req,
    context: { ...req.context },
    query: { ...req.query },
  } as PayloadRequest
  const [providerDocuments, profileDocuments, routeDocuments] = await Promise.all([
    readAllPortalAiPages((page) => payload.find({
      collection: 'ai-providers',
      context: portalAiReadinessCredentialReadContext,
      depth: 0,
      limit: 100,
      overrideAccess: false,
      page,
      pagination: true,
      req: credentialReadReq,
      select: {
        apiKey: true,
        apiKeyConfigured: true,
        baseURL: true,
        enabled: true,
        id: true,
        name: true,
        protocol: true,
        textGenerationContract: true,
        updatedAt: true,
      },
      sort: 'name',
    })),
    readAllPortalAiPages((page) => payload.find({
      collection: 'ai-model-profiles',
      depth: 0,
      limit: 100,
      overrideAccess: false,
      page,
      pagination: true,
      req,
      select: {
        capability: true,
        enabled: true,
        id: true,
        model: true,
        name: true,
        parameters: true,
        provider: true,
        updatedAt: true,
      },
      sort: 'name',
    })),
    readAllPortalAiPages((page) => payload.find({
      collection: 'ai-usage-routes',
      depth: 0,
      limit: 100,
      overrideAccess: false,
      page,
      pagination: true,
      req,
      select: {
        enabled: true,
        id: true,
        operation: true,
        profile: true,
        updatedAt: true,
        usageKey: true,
      },
      sort: 'usageKey',
    })),
  ])
  const providers = providerDocuments.map(mapPortalAiProvider)
  const profiles = profileDocuments.map((profile) => mapPortalAiProfile(profile, providers))
  const routes = routeDocuments.map((route) => mapPortalAiRoute(route, profiles))
  const readableProviderIDs = new Set(
    providerDocuments.flatMap((provider) => {
      const value = record(provider)
      const id = portalAiRelationshipID(value.id)
      return value.apiKeyConfigured === true && canDecryptAiCredential(value.apiKey) && id > 0
        ? [id]
        : []
    }),
  )
  let encryptionKeyConfigured = false
  try {
    readAiConfigurationEncryptionKey()
    encryptionKeyConfigured = true
  } catch {
    encryptionKeyConfigured = false
  }
  return {
    access: 'admin',
    encryptionKeyConfigured,
    profiles,
    providers,
    readiness: buildPortalAiReadiness({
      encryptionKeyConfigured,
      profiles,
      providers,
      readableProviderIDs,
      routes,
    }),
    routes,
  }
}

export const portalAiSettingsAdminOnly = (): PortalAiSettingsSummary => ({
  access: 'admin-only',
  encryptionKeyConfigured: false,
  profiles: [],
  providers: [],
  readiness: [],
  routes: [],
})
