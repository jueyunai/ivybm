import type { CollectionConfig } from 'payload'

import {
  contentStudioAdmin,
  contentStudioCommandWrite,
  contentStudioRead,
} from '../access/contentStudio'
import { writeAuditLogAfterChange } from '../hooks/writeAuditLog'

export const PUBLISH_LOG_EVENTS = [
  'created',
  'claimed',
  'scheduled',
  'accepted',
  'assisted-package-ready',
  'provider-io-started',
  'checkpoint-committed',
  'status-updated',
  'failed',
  'delivery-unknown',
] as const

export const PublishLogs: CollectionConfig = {
  slug: 'publish-logs',
  access: {
    admin: contentStudioAdmin,
    create: contentStudioCommandWrite,
    delete: contentStudioCommandWrite,
    read: contentStudioRead,
    update: () => false,
  },
  admin: {
    defaultColumns: ['publishJob', 'event', 'createdAt'],
    group: 'Content Studio',
  },
  fields: [
    {
      name: 'publishJob',
      type: 'relationship',
      index: true,
      relationTo: 'publish-jobs',
      required: true,
    },
    { name: 'event', type: 'select', options: [...PUBLISH_LOG_EVENTS], required: true },
    { name: 'summary', type: 'textarea', maxLength: 1_000, required: true },
    { name: 'actor', type: 'relationship', relationTo: 'users' },
  ],
  hooks: { afterChange: [writeAuditLogAfterChange] },
}
