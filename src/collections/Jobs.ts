import type { Access, CollectionConfig } from 'payload'

import { admins } from '../access/roles'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'
import { JOB_STATUSES } from '../modules/jobs/contracts'

const jobInternalWrite: Access = () => false

export const Jobs: CollectionConfig = {
  slug: 'jobs',
  access: {
    admin: admins,
    create: jobInternalWrite,
    delete: jobInternalWrite,
    read: admins,
    update: jobInternalWrite,
  },
  admin: {
    defaultColumns: ['type', 'status', 'attempts', 'maxAttempts', 'nextRunAt', 'updatedAt'],
    group: 'Operations',
    useAsTitle: 'type',
  },
  fields: [
    { name: 'type', type: 'text', index: true, required: true },
    { name: 'idempotencyKey', type: 'text' },
    { name: 'payload', type: 'json', required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      index: true,
      options: [...JOB_STATUSES],
      required: true,
    },
    { name: 'attempts', type: 'number', defaultValue: 0, min: 0, required: true },
    {
      name: 'maxAttempts',
      type: 'number',
      defaultValue: 5,
      max: 5,
      min: 1,
      required: true,
    },
    { name: 'nextRunAt', type: 'date', index: true },
    { name: 'leaseExpiresAt', type: 'date', index: true },
    { name: 'ownerToken', type: 'text' },
    { name: 'lastError', type: 'textarea' },
    { name: 'completedAt', type: 'date' },
    { name: 'deadAt', type: 'date' },
    { name: 'manualRetryCount', type: 'number', defaultValue: 0, min: 0, required: true },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
  },
  indexes: [
    {
      fields: ['type', 'idempotencyKey'],
      unique: true,
    },
  ],
}
