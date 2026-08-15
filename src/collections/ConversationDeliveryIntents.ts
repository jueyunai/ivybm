import type { CollectionConfig } from 'payload'

import {
  conversationInternalWrite,
  conversationMessagesRead,
  conversationsAdmin,
} from '../access/conversations'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const CONVERSATION_DELIVERY_STATUSES = [
  'queued',
  'retrying',
  'accepted',
  'blocked',
  'failed',
  'dead',
  'delivery_unknown',
] as const

export const ConversationDeliveryIntents: CollectionConfig = {
  slug: 'conversation-delivery-intents',
  access: {
    admin: conversationsAdmin,
    create: conversationInternalWrite,
    delete: conversationInternalWrite,
    read: conversationMessagesRead,
    update: conversationInternalWrite,
  },
  admin: {
    defaultColumns: ['conversation', 'platform', 'status', 'requiredHandoffStatus', 'updatedAt'],
    group: 'Conversations',
    useAsTitle: 'deliveryKey',
  },
  fields: [
    {
      name: 'conversation',
      type: 'relationship',
      index: true,
      relationTo: 'conversations',
      required: true,
    },
    {
      name: 'replyMessage',
      type: 'relationship',
      index: true,
      relationTo: 'messages',
      required: true,
      unique: true,
    },
    {
      name: 'queueJob',
      type: 'relationship',
      index: true,
      relationTo: 'jobs',
      required: true,
      unique: true,
    },
    {
      name: 'requiredHandoffStatus',
      type: 'select',
      options: ['ai_active', 'human_active'],
      required: true,
    },
    { name: 'expectedRevision', type: 'number', min: 1, required: true },
    {
      name: 'platform',
      type: 'select',
      index: true,
      options: ['facebook-messenger', 'instagram'],
      required: true,
    },
    { name: 'accountExternalId', type: 'text', maxLength: 32, required: true },
    { name: 'recipientExternalId', type: 'text', maxLength: 64, required: true },
    { name: 'text', type: 'textarea', maxLength: 5_000, required: true },
    { name: 'deliveryKey', type: 'text', maxLength: 200, required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'queued',
      index: true,
      options: [...CONVERSATION_DELIVERY_STATUSES],
      required: true,
    },
    { name: 'claimId', type: 'text', maxLength: 240 },
    { name: 'claimOwnerToken', type: 'text', maxLength: 240 },
    { name: 'claimLeaseExpiresAt', type: 'date', index: true },
    { name: 'fencingGeneration', type: 'number', defaultValue: 0, min: 0, required: true },
    { name: 'providerIOStartedAt', type: 'date' },
    { name: 'acceptedAt', type: 'date' },
    { name: 'deliveryUnknownAt', type: 'date' },
    { name: 'providerReference', type: 'text', maxLength: 512 },
    { name: 'lastErrorCode', type: 'text', maxLength: 100 },
    { name: 'lastErrorSummary', type: 'textarea', maxLength: 1_000 },
    { name: 'retryable', type: 'checkbox', defaultValue: false, required: true },
    { name: 'retryAfterSeconds', type: 'number', min: 1 },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
  },
  indexes: [
    { fields: ['conversation', 'status'] },
    {
      fields: ['platform', 'accountExternalId', 'deliveryKey'],
      unique: true,
    },
  ],
}
