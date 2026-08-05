import type { Payload, PayloadRequest } from 'payload'

import { readAiConfigurationEncryptionKey } from '@/modules/ai/credentials'
import { AI_USAGE_KEYS } from '@/modules/ai/registry'

export type PortalAiCapability = 'embedding' | 'text'
export type PortalAiSettingsAccess = 'admin' | 'admin-only'
export type PortalAiReadinessReason = 'encryption-key' | 'profile' | 'provider' | 'route'

export interface PortalAiProviderSummary {
  apiKeyConfigured: boolean
  baseURL: string
  enabled: boolean
  id: number
  name: string
  protocol: 'openai-compatible'
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
  status: 'action-required' | 'ready'
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
    capability: profile.capability === 'embedding' ? 'embedding' : 'text',
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
    operation: route.operation === 'embedding' ? 'embedding' : 'text',
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
  routes,
  usageKey,
}: {
  capability: PortalAiCapability
  encryptionKeyConfigured: boolean
  profiles: readonly PortalAiModelProfileSummary[]
  providers: readonly PortalAiProviderSummary[]
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
  return provider ? null : 'provider'
}

export const buildPortalAiReadiness = ({
  encryptionKeyConfigured,
  profiles,
  providers,
  routes,
}: Pick<
  PortalAiSettingsSummary,
  'encryptionKeyConfigured' | 'profiles' | 'providers' | 'routes'
>): PortalAiReadinessSummary[] => {
  const textReason = routeReadiness({
    capability: 'text',
    encryptionKeyConfigured,
    profiles,
    providers,
    routes,
    usageKey: AI_USAGE_KEYS.chatReply,
  })
  const embeddingReason = routeReadiness({
    capability: 'embedding',
    encryptionKeyConfigured,
    profiles,
    providers,
    routes,
    usageKey: AI_USAGE_KEYS.knowledgeEmbedding,
  })
  const item = (
    key: PortalAiReadinessKey,
    reason: PortalAiReadinessReason | null,
  ): PortalAiReadinessSummary => ({
    key,
    reason,
    status: reason ? 'action-required' : 'ready',
  })
  return [
    item('customer-chat', textReason ?? embeddingReason),
    item('content-studio', textReason),
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
  const [providerResult, profileResult, routeResult] = await Promise.all([
    payload.find({
      collection: 'ai-providers',
      depth: 0,
      limit: 100,
      overrideAccess: false,
      pagination: false,
      req,
      select: {
        apiKeyConfigured: true,
        baseURL: true,
        enabled: true,
        id: true,
        name: true,
        protocol: true,
        updatedAt: true,
      },
      sort: 'name',
    }),
    payload.find({
      collection: 'ai-model-profiles',
      depth: 0,
      limit: 100,
      overrideAccess: false,
      pagination: false,
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
    }),
    payload.find({
      collection: 'ai-usage-routes',
      depth: 0,
      limit: 100,
      overrideAccess: false,
      pagination: false,
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
    }),
  ])
  const providers = providerResult.docs.map(mapPortalAiProvider)
  const profiles = profileResult.docs.map((profile) => mapPortalAiProfile(profile, providers))
  const routes = routeResult.docs.map((route) => mapPortalAiRoute(route, profiles))
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
    readiness: buildPortalAiReadiness({ encryptionKeyConfigured, profiles, providers, routes }),
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
