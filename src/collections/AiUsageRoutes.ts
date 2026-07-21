import { ValidationError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { admins } from '../access/roles'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'
import { AI_MODEL_CAPABILITIES } from './AiModelProfiles'

const USAGE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

const relationshipID = (value: unknown): number | string | undefined => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : undefined
  }
  return undefined
}

const routeProfileBeforeChange: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  if (!data) return data

  const candidate = data as Record<string, unknown>
  const operation = candidate.operation ?? originalDoc?.operation
  const profileID = relationshipID(candidate.profile ?? originalDoc?.profile)
  const enabled = candidate.enabled ?? originalDoc?.enabled
  if (!profileID || !AI_MODEL_CAPABILITIES.some((capability) => capability === operation)) {
    return candidate
  }

  const profile = await req.payload.findByID({
    collection: 'ai-model-profiles',
    id: profileID,
    overrideAccess: true,
  })
  if (profile.capability !== operation) {
    throw new ValidationError({
      collection: 'ai-usage-routes',
      errors: [
        { message: 'Route operation must match the selected model capability', path: 'profile' },
      ],
      req,
    })
  }
  if (enabled === true && profile.enabled !== true) {
    throw new ValidationError({
      collection: 'ai-usage-routes',
      errors: [
        { message: 'An enabled route must reference an enabled model profile', path: 'profile' },
      ],
      req,
    })
  }

  const providerID = relationshipID(profile.provider)
  if (enabled === true && providerID) {
    const provider = await req.payload.findByID({
      collection: 'ai-providers',
      id: providerID,
      overrideAccess: true,
    })
    if (provider.enabled !== true || provider.apiKeyConfigured !== true) {
      throw new ValidationError({
        collection: 'ai-usage-routes',
        errors: [
          {
            message: 'An enabled route requires an enabled provider with a configured API key',
            path: 'profile',
          },
        ],
        req,
      })
    }
  }

  return candidate
}

export const AiUsageRoutes: CollectionConfig = {
  slug: 'ai-usage-routes',
  access: {
    admin: admins,
    create: admins,
    delete: admins,
    read: admins,
    update: admins,
  },
  admin: {
    defaultColumns: ['usageKey', 'operation', 'profile', 'enabled', 'updatedAt'],
    group: 'AI Management',
    useAsTitle: 'usageKey',
  },
  fields: [
    {
      name: 'usageKey',
      type: 'text',
      admin: {
        description: 'Stable internal key, for example chat.reply or knowledge.embedding.',
      },
      index: true,
      required: true,
      unique: true,
      validate: (value: unknown): true | string =>
        typeof value === 'string' && USAGE_KEY_PATTERN.test(value)
          ? true
          : 'Usage key must use lowercase letters, numbers, dots or hyphens',
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      required: true,
    },
    {
      name: 'operation',
      type: 'select',
      options: [...AI_MODEL_CAPABILITIES],
      required: true,
    },
    {
      name: 'profile',
      type: 'relationship',
      relationTo: 'ai-model-profiles',
      required: true,
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeChange: [routeProfileBeforeChange],
  },
}
