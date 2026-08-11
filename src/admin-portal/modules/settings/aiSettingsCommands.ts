import type { Payload, PayloadRequest } from 'payload'

import { AI_REASONING_EFFORTS } from '@/modules/ai/gateway'
import { AI_USAGE_KEYS } from '@/modules/ai/registry'

import {
  mapPortalAiProfile,
  mapPortalAiProvider,
  mapPortalAiRoute,
  portalAiRelationshipID,
  type PortalAiCapability,
} from './getPortalAiSettings'

export const PORTAL_AI_RESOURCES = ['providers', 'profiles', 'routes'] as const
export type PortalAiResource = (typeof PORTAL_AI_RESOURCES)[number]

type JsonInput = Record<string, unknown>

export class AiSettingsCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AiSettingsCommandError'
  }
}

const fail = (field: string): never => {
  throw new AiSettingsCommandError(
    'ai-settings-validation-failed',
    `A valid ${field} is required.`,
    400,
  )
}

const requiredText = (value: unknown, field: string, maximum: number): string => {
  if (typeof value !== 'string') return fail(field)
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum) return fail(field)
  return normalized
}

const optionalText = (value: unknown, field: string, maximum: number): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, field, maximum)
}

const requiredBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') return fail(field)
  return value
}

const requiredID = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return fail(field)
  return value
}

const requiredInteger = (value: unknown, field: string, minimum: number, maximum: number): number => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return fail(field)
  }
  return value
}

const optionalNumber = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return fail(field)
  }
  return value
}

const capability = (value: unknown): PortalAiCapability => {
  if (value !== 'text' && value !== 'embedding') return fail('capability')
  return value
}

const providerData = (input: JsonInput) => {
  const apiKey = optionalText(input.apiKey, 'API key', 4_096)
  return {
    ...(apiKey ? { apiKey } : {}),
    baseURL: requiredText(input.baseURL, 'provider endpoint', 600),
    enabled: requiredBoolean(input.enabled, 'enabled state'),
    name: requiredText(input.name, 'provider name', 100),
    protocol: 'openai-compatible' as const,
  }
}

const profileData = (input: JsonInput) => {
  const selectedCapability = capability(input.capability)
  const parameters = input.parameters && typeof input.parameters === 'object'
    ? (input.parameters as JsonInput)
    : fail('model parameters')
  const reasoningEffort = optionalText(parameters.reasoningEffort, 'reasoning effort', 20) ?? 'medium'
  if (!AI_REASONING_EFFORTS.includes(reasoningEffort as never)) return fail('reasoning effort')
  return {
    capability: selectedCapability,
    enabled: requiredBoolean(input.enabled, 'enabled state'),
    model: requiredText(input.model, 'model identifier', 200),
    name: requiredText(input.name, 'profile name', 100),
    parameters: selectedCapability === 'text'
      ? {
          maxOutputTokens: optionalNumber(parameters.maxOutputTokens, 'maximum output tokens', 1, 128_000),
          reasoningEffort,
          reasoningEnabled: requiredBoolean(parameters.reasoningEnabled, 'reasoning state'),
          temperature: optionalNumber(parameters.temperature, 'temperature', 0, 2),
          timeoutMs: requiredInteger(parameters.timeoutMs, 'timeout', 1_000, 120_000),
          topP: optionalNumber(parameters.topP, 'top-p', 0, 1),
        }
      : {
          dimensions: requiredInteger(parameters.dimensions, 'embedding dimensions', 1, 16_384),
          reasoningEffort: 'medium' as const,
          reasoningEnabled: false,
          timeoutMs: requiredInteger(parameters.timeoutMs, 'timeout', 1_000, 120_000),
        },
    provider: requiredID(input.providerID, 'provider'),
  }
}

const routeData = (input: JsonInput) => {
  const usageKey = requiredText(input.usageKey, 'usage key', 100)
  const operation = capability(input.operation)
  if (
    ![
      AI_USAGE_KEYS.chatReply,
      AI_USAGE_KEYS.knowledgeEmbedding,
      AI_USAGE_KEYS.knowledgeTranslation,
    ].includes(usageKey as never)
  ) {
    return fail('supported usage key')
  }
  if (
    (usageKey === AI_USAGE_KEYS.chatReply && operation !== 'text') ||
    (usageKey === AI_USAGE_KEYS.knowledgeEmbedding && operation !== 'embedding') ||
    (usageKey === AI_USAGE_KEYS.knowledgeTranslation && operation !== 'text')
  ) {
    return fail('usage operation')
  }
  return {
    enabled: requiredBoolean(input.enabled, 'enabled state'),
    operation,
    profile: requiredID(input.profileID, 'model profile'),
    usageKey,
  }
}

export const parsePortalAiResource = (value: string): PortalAiResource => {
  if (!PORTAL_AI_RESOURCES.includes(value as PortalAiResource)) {
    throw new AiSettingsCommandError('ai-settings-invalid-resource', 'Unsupported AI resource.', 404)
  }
  return value as PortalAiResource
}

export const requirePortalAiID = (value: string): number => {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new AiSettingsCommandError('ai-settings-invalid-id', 'A valid AI resource id is required.', 400)
  }
  return id
}

const collectionFor = (resource: PortalAiResource) => ({
  profiles: 'ai-model-profiles',
  providers: 'ai-providers',
  routes: 'ai-usage-routes',
} as const)[resource]

const requireUpdatedAt = (input: JsonInput): string =>
  requiredText(input.updatedAt, 'configuration version', 80)

const assertCurrentVersion = async ({
  id,
  input,
  payload,
  req,
  resource,
}: {
  id: number
  input: JsonInput
  payload: Payload
  req: PayloadRequest
  resource: PortalAiResource
}) => {
  const current = await payload.findByID({
    collection: collectionFor(resource),
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  if (current.updatedAt !== requireUpdatedAt(input)) {
    throw new AiSettingsCommandError(
      'ai-settings-stale',
      'This AI configuration changed. Reload it before saving.',
      409,
    )
  }
}

const dataFor = (resource: PortalAiResource, input: JsonInput) => ({
  profiles: profileData,
  providers: providerData,
  routes: routeData,
})[resource](input)

const resultFor = async ({
  document,
  payload,
  req,
  resource,
}: {
  document: unknown
  payload: Payload
  req: PayloadRequest
  resource: PortalAiResource
}) => {
  if (resource === 'providers') return mapPortalAiProvider(document)
  const relation = document && typeof document === 'object'
    ? (document as Record<string, unknown>)
    : {}
  if (resource === 'profiles') {
    const providerID = portalAiRelationshipID(relation.provider)
    const provider = await payload.findByID({
      collection: 'ai-providers',
      depth: 0,
      id: providerID,
      overrideAccess: false,
      req,
      select: { id: true, name: true },
    })
    return mapPortalAiProfile(document, [mapPortalAiProvider(provider)])
  }
  const profileID = portalAiRelationshipID(relation.profile)
  const profile = await payload.findByID({
    collection: 'ai-model-profiles',
    depth: 0,
    id: profileID,
    overrideAccess: false,
    req,
    select: { id: true, name: true },
  })
  return mapPortalAiRoute(document, [mapPortalAiProfile(profile, [])])
}

export const createPortalAiResource = async ({
  input,
  payload,
  req,
  resource,
}: {
  input: JsonInput
  payload: Payload
  req: PayloadRequest
  resource: PortalAiResource
}) => {
  const document = await payload.create({
    collection: collectionFor(resource),
    data: dataFor(resource, input) as never,
    depth: 0,
    overrideAccess: false,
    req,
  })
  return { item: await resultFor({ document, payload, req, resource }), resource }
}

export const updatePortalAiResource = async ({
  id,
  input,
  payload,
  req,
  resource,
}: {
  id: number
  input: JsonInput
  payload: Payload
  req: PayloadRequest
  resource: PortalAiResource
}) => {
  await assertCurrentVersion({ id, input, payload, req, resource })
  const document = await payload.update({
    collection: collectionFor(resource),
    data: dataFor(resource, input) as never,
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  return { item: await resultFor({ document, payload, req, resource }), resource }
}

export const deletePortalAiResource = async ({
  id,
  input,
  payload,
  req,
  resource,
}: {
  id: number
  input: JsonInput
  payload: Payload
  req: PayloadRequest
  resource: PortalAiResource
}) => {
  await assertCurrentVersion({ id, input, payload, req, resource })
  await payload.delete({
    collection: collectionFor(resource),
    id,
    overrideAccess: false,
    req,
  })
  return { deleted: true as const, id, resource }
}
