import type { CollectionConfig } from 'payload'

import {
  conversationInternalFieldWrite,
  conversationInternalWrite,
  conversationMessagesRead,
  conversationsAdmin,
} from '../access/conversations'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const Handoffs: CollectionConfig = {
  slug: 'handoffs',
  access: {
    admin: conversationsAdmin,
    create: conversationInternalWrite,
    delete: conversationInternalWrite,
    read: conversationMessagesRead,
    update: conversationInternalWrite,
  },
  admin: {
    defaultColumns: ['publicId', 'conversation', 'status', 'source', 'assignedTo', 'requestedAt'],
    group: 'Conversations',
    useAsTitle: 'publicId',
  },
  fields: [
    {
      name: 'publicId', type: 'text', index: true, required: true, unique: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'conversation',
      type: 'relationship',
      index: true,
      relationTo: 'conversations',
      required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      // Commands are only queried by (conversation, idempotencyKey); the composite
      // unique index in the migration is both the constraint and the lookup index.
      name: 'idempotencyKey', type: 'text', required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'domainEventId', type: 'text', index: true, required: true, unique: true,
      // The Handoff row is the durable Task 9 outbox record for `handoff.created`.
      // Task 10 consumes this stable ID when it creates retryable notification jobs.
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'requested',
      index: true,
      options: ['requested', 'active', 'resolved'],
      required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'source',
      type: 'select',
      options: ['visitor', 'ai_policy', 'operator'],
      required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'reason', type: 'textarea', maxLength: 2_000, required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'requestedBy', type: 'relationship', relationTo: 'users',
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'assignedTo', type: 'relationship', index: true, relationTo: 'users',
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'requestedAt', type: 'date', index: true, required: true,
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'acceptedAt', type: 'date',
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
    {
      name: 'resolvedAt', type: 'date',
      access: { create: conversationInternalFieldWrite, update: conversationInternalFieldWrite },
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
  },
}
