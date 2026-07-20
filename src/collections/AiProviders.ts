import { ValidationError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { admins } from '../access/roles'
import {
  decryptAiCredential,
  encryptAiCredential,
  isEncryptedAiCredential,
  readAiConfigurationEncryptionKey,
} from '../modules/ai/credentials'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const AI_PROVIDER_PROTOCOLS = ['openai-compatible'] as const

const normalizeBaseURL = (value: string): string =>
  new URL(value.trim()).toString().replace(/\/+$/, '')

const validateBaseURL = (value: unknown): true | string => {
  if (typeof value !== 'string' || !value.trim()) {
    return 'A provider endpoint is required'
  }

  try {
    const url = new URL(value.trim())
    const allowsHttpForLocalDevelopment = process.env.NODE_ENV !== 'production'
    if (url.protocol !== 'https:' && !(allowsHttpForLocalDevelopment && url.protocol === 'http:')) {
      return 'Provider endpoint must use HTTPS in production'
    }
    if (url.username || url.password || url.search || url.hash) {
      return 'Provider endpoint cannot contain credentials, query parameters or fragments'
    }
    return true
  } catch {
    return 'Provider endpoint must be a valid HTTP URL'
  }
}

const providerCredentialBeforeChange: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

  const candidate = data as Record<string, unknown>
  if (typeof candidate.baseURL === 'string') {
    candidate.baseURL = normalizeBaseURL(candidate.baseURL)
  }

  const existingCredential =
    typeof originalDoc?.apiKey === 'string' ? originalDoc.apiKey : undefined
  const submittedCredential =
    typeof candidate.apiKey === 'string' ? candidate.apiKey.trim() : undefined

  if (submittedCredential) {
    const encryptionKey = readAiConfigurationEncryptionKey()
    if (isEncryptedAiCredential(submittedCredential)) {
      // The Local API may re-submit an existing value. Authenticate it before
      // accepting it so a crafted ciphertext cannot be saved for later use.
      decryptAiCredential(submittedCredential, encryptionKey)
      candidate.apiKey = submittedCredential
    } else {
      candidate.apiKey = encryptAiCredential(submittedCredential, encryptionKey)
    }
    candidate.apiKeyConfigured = true
    return candidate
  }

  if (existingCredential) {
    const encryptionKey = readAiConfigurationEncryptionKey()
    if (!isEncryptedAiCredential(existingCredential)) {
      throw new ValidationError({
        collection: 'ai-providers',
        errors: [{ message: 'The existing AI provider credential is invalid', path: 'apiKey' }],
        req,
      })
    }
    decryptAiCredential(existingCredential, encryptionKey)
    candidate.apiKey = existingCredential
    candidate.apiKeyConfigured = true
    return candidate
  }

  if (operation === 'create') {
    throw new ValidationError({
      collection: 'ai-providers',
      errors: [{ message: 'An API key is required when creating an AI provider', path: 'apiKey' }],
      req,
    })
  }

  candidate.apiKeyConfigured = false
  return candidate
}

export const AiProviders: CollectionConfig = {
  slug: 'ai-providers',
  access: {
    admin: admins,
    create: admins,
    delete: admins,
    read: admins,
    update: admins,
  },
  admin: {
    defaultColumns: ['name', 'protocol', 'baseURL', 'enabled', 'apiKeyConfigured', 'updatedAt'],
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
      name: 'protocol',
      type: 'select',
      defaultValue: 'openai-compatible',
      options: [...AI_PROVIDER_PROTOCOLS],
      required: true,
    },
    {
      name: 'baseURL',
      type: 'text',
      admin: {
        description: 'Include the API version prefix, for example https://api.openai.com/v1.',
      },
      required: true,
      validate: validateBaseURL,
    },
    {
      name: 'apiKey',
      type: 'text',
      access: {
        read: () => false,
      },
      admin: {
        description:
          'Write-only. Enter a value to set or replace the key; leave blank to retain it.',
      },
    },
    {
      name: 'apiKeyConfigured',
      type: 'checkbox',
      admin: {
        description: 'This indicator never reveals the key.',
        readOnly: true,
      },
      defaultValue: false,
      required: true,
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeChange: [providerCredentialBeforeChange],
  },
}
