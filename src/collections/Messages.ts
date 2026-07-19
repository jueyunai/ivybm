import type { CollectionConfig } from 'payload'

import {
  conversationInternalWrite,
  conversationMessagesRead,
  conversationsAdmin,
} from '../access/conversations'

export const Messages: CollectionConfig = {
  slug: 'messages',
  access: {
    admin: conversationsAdmin,
    create: conversationInternalWrite,
    delete: conversationInternalWrite,
    read: conversationMessagesRead,
    update: conversationInternalWrite,
  },
  admin: {
    defaultColumns: ['conversation', 'author', 'status', 'createdAt'],
    group: 'Conversations',
    useAsTitle: 'requestId',
  },
  fields: [
    {
      name: 'conversation',
      type: 'relationship',
      index: true,
      relationTo: 'conversations',
      required: true,
    },
    { name: 'requestId', type: 'text', index: true, required: true, unique: true },
    { name: 'idempotencyKey', type: 'text', index: true, required: true, unique: true },
    { name: 'externalMessageId', type: 'text', index: true },
    {
      name: 'author',
      type: 'select',
      index: true,
      options: ['visitor', 'ai', 'operator', 'system'],
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'sent',
      index: true,
      options: ['pending', 'sent', 'failed'],
      required: true,
    },
    { name: 'content', type: 'textarea', maxLength: 20_000, required: true },
    {
      name: 'citations',
      type: 'array',
      fields: [
        { name: 'documentId', type: 'text', required: true },
        { name: 'title', type: 'text', required: true },
        { name: 'version', type: 'text', required: true },
        { name: 'url', type: 'text' },
      ],
    },
    { name: 'promptVersion', type: 'number', min: 1 },
    { name: 'model', type: 'text' },
    {
      name: 'tokenUsage',
      type: 'group',
      fields: [
        { name: 'inputTokens', type: 'number', min: 0 },
        { name: 'outputTokens', type: 'number', min: 0 },
        { name: 'totalTokens', type: 'number', min: 0 },
      ],
    },
    { name: 'estimatedCostUSD', type: 'number', min: 0 },
    { name: 'errorCode', type: 'text' },
  ],
}
