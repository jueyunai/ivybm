import type { CollectionConfig } from 'payload'

import {
  conversationsAdmin,
  conversationsCreate,
  conversationsDelete,
  conversationsRead,
  conversationsUpdate,
} from '../access/conversations'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const Handoffs: CollectionConfig = {
  slug: 'handoffs',
  access: {
    admin: conversationsAdmin,
    create: conversationsCreate,
    delete: conversationsDelete,
    read: conversationsRead,
    update: conversationsUpdate,
  },
  admin: {
    defaultColumns: ['publicId', 'conversation', 'status', 'source', 'assignedTo', 'requestedAt'],
    group: 'Conversations',
    useAsTitle: 'publicId',
  },
  fields: [
    { name: 'publicId', type: 'text', index: true, required: true, unique: true },
    {
      name: 'conversation',
      type: 'relationship',
      index: true,
      relationTo: 'conversations',
      required: true,
    },
    { name: 'idempotencyKey', type: 'text', index: true, required: true, unique: true },
    { name: 'domainEventId', type: 'text', index: true, required: true, unique: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'requested',
      index: true,
      options: ['requested', 'active', 'resolved'],
      required: true,
    },
    {
      name: 'source',
      type: 'select',
      options: ['visitor', 'ai_policy', 'operator'],
      required: true,
    },
    { name: 'reason', type: 'textarea', maxLength: 2_000, required: true },
    { name: 'requestedBy', type: 'relationship', relationTo: 'users' },
    { name: 'assignedTo', type: 'relationship', index: true, relationTo: 'users' },
    { name: 'requestedAt', type: 'date', index: true, required: true },
    { name: 'acceptedAt', type: 'date' },
    { name: 'resolvedAt', type: 'date' },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
  },
}
