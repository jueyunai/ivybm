import { ValidationError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { admins } from '../access/roles'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'
import { AI_REASONING_EFFORTS } from '../modules/ai/gateway'

export const AI_MODEL_CAPABILITIES = ['text', 'embedding', 'image'] as const

const relationshipID = (value: unknown): number | string | undefined => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : undefined
  }
  return undefined
}

const isFiniteNumberInRange = (value: unknown, minimum: number, maximum: number): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): boolean =>
  isFiniteNumberInRange(value, minimum, maximum) && Number.isInteger(value)

const validationError = (
  req: Parameters<CollectionBeforeChangeHook>[0]['req'],
  message: string,
  path: string,
): ValidationError =>
  new ValidationError({
    collection: 'ai-model-profiles',
    errors: [{ message, path }],
    req,
  })

const profileBeforeChange: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  if (!data) return data

  const candidate = data as Record<string, unknown>
  const capability = candidate.capability ?? originalDoc?.capability
  const providerID = relationshipID(candidate.provider ?? originalDoc?.provider)
  if (!AI_MODEL_CAPABILITIES.some((value) => value === capability) || !providerID) {
    return candidate
  }

  const provider = await req.payload.findByID({
    collection: 'ai-providers',
    id: providerID,
    overrideAccess: true,
  })
  if (provider.enabled !== true || provider.apiKeyConfigured !== true) {
    throw validationError(
      req,
      'An enabled provider with a configured API key is required',
      'provider',
    )
  }

  const originalParameters =
    originalDoc?.parameters && typeof originalDoc.parameters === 'object'
      ? originalDoc.parameters
      : {}
  const submittedParameters =
    candidate.parameters && typeof candidate.parameters === 'object' ? candidate.parameters : {}
  const parameters = { ...originalParameters, ...submittedParameters } as Record<string, unknown>
  if (Object.keys(parameters).length === 0) return candidate

  if (!isIntegerInRange(parameters.timeoutMs, 1_000, 120_000)) {
    throw validationError(
      req,
      'Timeout must be an integer between 1000 and 120000 ms',
      'parameters.timeoutMs',
    )
  }

  if (capability === 'text') {
    if (parameters.dimensions !== undefined && parameters.dimensions !== null) {
      throw validationError(
        req,
        'Text models cannot define embedding dimensions',
        'parameters.dimensions',
      )
    }
    if (
      parameters.maxOutputTokens !== undefined &&
      parameters.maxOutputTokens !== null &&
      !isIntegerInRange(parameters.maxOutputTokens, 1, 128_000)
    ) {
      throw validationError(
        req,
        'Maximum output tokens must be an integer between 1 and 128000',
        'parameters.maxOutputTokens',
      )
    }
    if (
      parameters.temperature !== undefined &&
      parameters.temperature !== null &&
      !isFiniteNumberInRange(parameters.temperature, 0, 2)
    ) {
      throw validationError(req, 'Temperature must be between 0 and 2', 'parameters.temperature')
    }
    if (
      parameters.topP !== undefined &&
      parameters.topP !== null &&
      !isFiniteNumberInRange(parameters.topP, 0, 1)
    ) {
      throw validationError(req, 'Top-p must be between 0 and 1', 'parameters.topP')
    }
    if (
      parameters.reasoningEnabled === true &&
      !AI_REASONING_EFFORTS.includes(parameters.reasoningEffort as never)
    ) {
      throw validationError(
        req,
        'Select a supported reasoning effort when reasoning is enabled',
        'parameters.reasoningEffort',
      )
    }
    return candidate
  }

  for (const [field, value] of Object.entries({
    maxOutputTokens: parameters.maxOutputTokens,
    temperature: parameters.temperature,
    topP: parameters.topP,
  })) {
    if (value !== undefined && value !== null) {
      throw validationError(
        req,
        `${capability === 'image' ? 'Image' : 'Embedding'} models cannot define text-generation settings`,
        `parameters.${field}`,
      )
    }
  }
  if (parameters.reasoningEnabled === true) {
    throw validationError(
      req,
      `${capability === 'image' ? 'Image' : 'Embedding'} models cannot enable reasoning`,
      'parameters.reasoningEnabled',
    )
  }
  if (capability === 'image') {
    if (parameters.dimensions !== undefined && parameters.dimensions !== null) {
      throw validationError(
        req,
        'Image models cannot define embedding dimensions',
        'parameters.dimensions',
      )
    }
    return candidate
  }
  if (!isIntegerInRange(parameters.dimensions, 1, 16_384)) {
    throw validationError(
      req,
      'Embedding models require fixed dimensions between 1 and 16384',
      'parameters.dimensions',
    )
  }

  return candidate
}

export const AiModelProfiles: CollectionConfig = {
  slug: 'ai-model-profiles',
  access: {
    admin: admins,
    create: admins,
    delete: admins,
    read: admins,
    update: admins,
  },
  admin: {
    defaultColumns: ['name', 'capability', 'model', 'provider', 'enabled', 'updatedAt'],
    group: 'AI Management',
    useAsTitle: 'name',
  },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      required: true,
    },
    {
      name: 'provider',
      type: 'relationship',
      relationTo: 'ai-providers',
      required: true,
    },
    {
      name: 'capability',
      type: 'select',
      options: [...AI_MODEL_CAPABILITIES],
      required: true,
    },
    {
      name: 'model',
      type: 'text',
      admin: {
        description: 'Exact model identifier accepted by the selected provider.',
      },
      required: true,
    },
    {
      type: 'group',
      name: 'parameters',
      fields: [
        {
          name: 'timeoutMs',
          type: 'number',
          defaultValue: 30_000,
          max: 120_000,
          min: 1_000,
          required: true,
        },
        {
          name: 'maxOutputTokens',
          type: 'number',
          admin: {
            condition: (data) => data.capability === 'text',
          },
          max: 128_000,
          min: 1,
        },
        {
          name: 'reasoningEnabled',
          type: 'checkbox',
          admin: {
            condition: (data) => data.capability === 'text',
          },
          defaultValue: false,
          required: true,
        },
        {
          name: 'reasoningEffort',
          type: 'select',
          admin: {
            condition: (data) => data.capability === 'text',
          },
          defaultValue: 'medium',
          options: [...AI_REASONING_EFFORTS],
          required: true,
        },
        {
          name: 'temperature',
          type: 'number',
          admin: {
            condition: (data) => data.capability === 'text',
            description: 'Optional sampling temperature, from 0 to 2.',
          },
          max: 2,
          min: 0,
        },
        {
          name: 'topP',
          type: 'number',
          admin: {
            condition: (data) => data.capability === 'text',
            description: 'Optional nucleus-sampling top-p value, from 0 to 1.',
          },
          max: 1,
          min: 0,
        },
        {
          name: 'dimensions',
          type: 'number',
          admin: {
            condition: (data) => data.capability === 'embedding',
            description:
              'Required fixed output dimensions. Provider responses with a different size are rejected.',
          },
          max: 16_384,
          min: 1,
        },
      ],
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeChange: [profileBeforeChange],
  },
}
