import type { CollectionConfig } from 'payload'

import { contentStudioAdmin, contentStudioCommandWrite, contentStudioRead } from '../access/contentStudio'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const PUBLISH_JOB_MODES = ['assisted', 'automatic'] as const
export const PUBLISH_JOB_STATUSES = [
  'scheduled',
  'accepted',
  'publishing',
  'published',
  'failed',
  'delivery_unknown',
] as const

export const PublishJobs: CollectionConfig = {
  slug: 'publish-jobs',
  access: {
    admin: contentStudioAdmin,
    create: contentStudioCommandWrite,
    delete: contentStudioCommandWrite,
    read: contentStudioRead,
    update: contentStudioCommandWrite,
  },
  admin: {
    defaultColumns: ['content', 'platform', 'mode', 'status', 'scheduledFor', 'updatedAt'],
    group: 'Content Studio',
  },
  fields: [
    { name: 'content', type: 'relationship', index: true, relationTo: 'generated-contents', required: true },
    {
      name: 'platform',
      type: 'select',
      index: true,
      options: ['facebook', 'instagram', 'linkedin'],
      required: true,
    },
    { name: 'platformAccount', type: 'relationship', relationTo: 'platform-accounts' },
    { name: 'mode', type: 'select', options: [...PUBLISH_JOB_MODES], required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'scheduled',
      index: true,
      options: [...PUBLISH_JOB_STATUSES],
      required: true,
    },
    { name: 'scheduledFor', type: 'date', index: true, required: true },
    { name: 'acceptedAt', type: 'date' },
    { name: 'publishedAt', type: 'date' },
    { name: 'externalPublicationId', type: 'text', maxLength: 500 },
    { name: 'lastErrorCode', type: 'text', maxLength: 100 },
    { name: 'lastErrorSummary', type: 'textarea', maxLength: 1_000 },
    { name: 'idempotencyKey', type: 'text', index: true, required: true, unique: true },
    { name: 'createdBy', type: 'relationship', relationTo: 'users', required: true },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
  },
}
