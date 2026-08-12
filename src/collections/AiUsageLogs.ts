import type { CollectionConfig } from 'payload'

import { admins } from '../access/roles'

const internalWrite = () => false

/**
 * Immutable, credential-free telemetry emitted by the AI gateway after a
 * successful provider call. Prompts and response bodies intentionally are not
 * stored here.
 */
export const AiUsageLogs: CollectionConfig = {
  slug: 'ai-usage-logs',
  access: {
    create: internalWrite,
    delete: internalWrite,
    read: admins,
    update: internalWrite,
  },
  admin: {
    defaultColumns: ['operation', 'provider', 'model', 'totalTokens', 'estimatedCostUSD', 'createdAt'],
    group: 'AI Management',
    useAsTitle: 'model',
  },
  fields: [
    {
      name: 'operation',
      type: 'select',
      options: [
        { label: 'Embedding', value: 'embed' },
        { label: 'Image generation', value: 'generateImage' },
        { label: 'Text generation', value: 'generateText' },
      ],
      required: true,
    },
    { name: 'provider', type: 'text', required: true },
    { name: 'model', type: 'text', required: true },
    { name: 'requestId', type: 'text' },
    { name: 'inputTokens', type: 'number', min: 0, required: true },
    { name: 'outputTokens', type: 'number', min: 0 },
    { name: 'totalTokens', type: 'number', min: 0, required: true },
    { name: 'estimatedCostUSD', type: 'number', min: 0 },
    { name: 'durationMs', type: 'number', min: 0, required: true },
  ],
}
