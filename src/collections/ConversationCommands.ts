import type { CollectionConfig } from 'payload'

import { conversationInternalWrite } from '../access/conversations'

export const ConversationCommands: CollectionConfig = {
  slug: 'conversation-commands',
  access: {
    admin: () => false,
    create: conversationInternalWrite,
    delete: conversationInternalWrite,
    read: conversationInternalWrite,
    update: conversationInternalWrite,
  },
  admin: { hidden: true },
  fields: [
    { name: 'scope', type: 'text', index: true, required: true },
    // Idempotency is scoped by command + conversation, so no broad key-only index
    // should imply that identifiers can be queried across tenants/sessions.
    { name: 'idempotencyKey', type: 'text', required: true },
    { name: 'ownerToken', type: 'text', required: true },
    { name: 'leaseExpiresAt', type: 'date', index: true, required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'processing',
      index: true,
      options: ['processing', 'completed', 'failed'],
      required: true,
    },
    { name: 'conversation', type: 'relationship', index: true, relationTo: 'conversations' },
    { name: 'result', type: 'json' },
    { name: 'errorCode', type: 'text' },
  ],
}
