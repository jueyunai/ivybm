import { ValidationError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { admins } from '../access/roles'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'
import { parseFeishuMappingConfig } from '../modules/feishu/config'
import { FEISHU_LEAD_FIELDS, FeishuConfigurationError } from '../modules/feishu/contracts'

const mappingBeforeChange: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  if (!data) return data
  const candidate = { ...originalDoc, ...data }
  if (candidate.status !== 'active') return data

  try {
    parseFeishuMappingConfig({
      ...candidate,
      id: candidate.id ?? 'pending',
      updatedAt: candidate.updatedAt ?? new Date().toISOString(),
    })
  } catch (error) {
    throw new ValidationError({
      collection: 'feishu-mappings',
      errors: [
        {
          message:
            error instanceof FeishuConfigurationError ? error.message : 'Invalid Feishu mapping',
          path: 'status',
        },
      ],
      req,
    })
  }

  const active = await req.payload.find({
    collection: 'feishu-mappings',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    where: {
      and: [
        { status: { equals: 'active' } },
        ...(candidate.id ? [{ id: { not_equals: candidate.id } }] : []),
      ],
    },
  })
  if (active.totalDocs > 0) {
    throw new ValidationError({
      collection: 'feishu-mappings',
      errors: [{ message: 'Only one Feishu mapping may be active', path: 'status' }],
      req,
    })
  }
  return data
}

export const FeishuMappings: CollectionConfig = {
  slug: 'feishu-mappings',
  access: {
    admin: admins,
    create: admins,
    delete: admins,
    read: admins,
    update: admins,
  },
  admin: {
    defaultColumns: ['name', 'key', 'status', 'appToken', 'tableId', 'updatedAt'],
    group: 'Lead Management',
    useAsTitle: 'name',
  },
  fields: [
    { name: 'name', type: 'text', maxLength: 120, required: true },
    {
      name: 'key',
      type: 'text',
      admin: { description: 'Stable internal mapping key, for example primary-leads.' },
      index: true,
      maxLength: 80,
      required: true,
      unique: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      index: true,
      options: ['draft', 'active', 'disabled'],
      required: true,
    },
    {
      name: 'connection',
      type: 'relationship',
      admin: {
        description:
          'OAuth connection used by this mapping. Leave empty for manual App ID/Secret fallback.',
      },
      relationTo: 'feishu-connections',
    },
    {
      name: 'appToken',
      type: 'text',
      admin: {
        description: 'Bitable app token. This is an identifier, not the Feishu app secret.',
      },
      maxLength: 160,
    },
    {
      name: 'tableId',
      type: 'text',
      admin: { description: 'Bitable table identifier. Draft mappings may leave this empty.' },
      maxLength: 160,
    },
    {
      name: 'fieldMappings',
      type: 'array',
      admin: {
        description: 'Maps normalized lead fields to customer-defined Bitable field names.',
      },
      fields: [
        {
          name: 'localField',
          type: 'select',
          options: [...FEISHU_LEAD_FIELDS],
          required: true,
        },
        { name: 'targetField', type: 'text', maxLength: 160, required: true },
        { name: 'required', type: 'checkbox', defaultValue: false },
      ],
    },
    {
      name: 'memberMappings',
      type: 'array',
      admin: {
        description: 'Maps Payload sales users to Feishu open_id values for direct notifications.',
      },
      fields: [
        { name: 'user', type: 'relationship', relationTo: 'users', required: true },
        { name: 'openId', type: 'text', maxLength: 180, required: true },
        { name: 'enabled', type: 'checkbox', defaultValue: true },
      ],
    },
    {
      name: 'notificationRecipients',
      type: 'array',
      admin: { description: 'Recipients for high-intent and handoff notifications.' },
      fields: [
        { name: 'label', type: 'text', maxLength: 120 },
        {
          name: 'receiveIdType',
          type: 'select',
          options: ['open_id', 'chat_id'],
          required: true,
        },
        { name: 'receiveId', type: 'text', maxLength: 180, required: true },
        { name: 'enabled', type: 'checkbox', defaultValue: true },
      ],
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeChange: [mappingBeforeChange],
  },
}
