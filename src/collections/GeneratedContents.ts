import { ValidationError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import {
  contentStudioAdmin,
  contentStudioCommandWrite,
  contentStudioRead,
} from '../access/contentStudio'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const GENERATED_CONTENT_STATUSES = ['draft', 'review', 'approved'] as const
export const GENERATED_CONTENT_PLATFORMS = ['facebook', 'instagram', 'linkedin'] as const
export const GENERATED_CONTENT_TYPES = ['post', 'carousel', 'long-form'] as const

const lifecycleFields = new Set([
  'assets',
  'body',
  'contentLocale',
  'contentType',
  'knowledgeSources',
  'platform',
  'sourceReferences',
  'title',
])

const preserveWorkflowTruth: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
  const candidate = (data ?? {}) as Record<string, unknown>
  const commandWrite = req.context.portalContentStudioCommand === true

  if (!commandWrite) {
    if (operation === 'create') {
      candidate.status = 'draft'
      return candidate
    }

    if (candidate.status !== undefined && candidate.status !== originalDoc?.status) {
      throw new ValidationError({
        collection: 'generated-contents',
        errors: [{ message: 'Workflow status can only change through a Portal command', path: 'status' }],
        req,
      })
    }

    if (Object.keys(candidate).some((key) => lifecycleFields.has(key))) {
      candidate.status = 'draft'
      candidate.reviewedAt = null
      candidate.reviewedBy = null
    }
  }

  if (
    operation === 'update' &&
    (candidate.idempotencyKey !== undefined || candidate.creationFingerprint !== undefined) &&
    (candidate.idempotencyKey !== originalDoc?.idempotencyKey ||
      candidate.creationFingerprint !== originalDoc?.creationFingerprint)
  ) {
    throw new ValidationError({
      collection: 'generated-contents',
      errors: [{ message: 'Create idempotency metadata cannot be changed', path: 'idempotencyKey' }],
      req,
    })
  }

  return candidate
}

export const GeneratedContents: CollectionConfig = {
  slug: 'generated-contents',
  access: {
    admin: contentStudioAdmin,
    create: contentStudioCommandWrite,
    delete: contentStudioCommandWrite,
    read: contentStudioRead,
    update: contentStudioCommandWrite,
  },
  admin: {
    defaultColumns: ['title', 'platform', 'contentLocale', 'status', 'updatedAt'],
    group: 'Content Studio',
    useAsTitle: 'title',
  },
  fields: [
    { name: 'title', type: 'text', maxLength: 180, required: true },
    {
      name: 'platform',
      type: 'select',
      index: true,
      options: [...GENERATED_CONTENT_PLATFORMS],
      required: true,
    },
    {
      name: 'contentLocale',
      type: 'select',
      index: true,
      options: [
        { label: 'English', value: 'en' },
        { label: 'العربية', value: 'ar' },
      ],
      required: true,
    },
    {
      name: 'contentType',
      type: 'select',
      options: [...GENERATED_CONTENT_TYPES],
      required: true,
    },
    { name: 'body', type: 'textarea', maxLength: 30_000, required: true },
    {
      name: 'sourceReferences',
      type: 'array',
      fields: [
        { name: 'claim', type: 'text', maxLength: 500, required: true },
        { name: 'source', type: 'text', maxLength: 2_000, required: true },
      ],
    },
    {
      name: 'assets',
      type: 'relationship',
      hasMany: true,
      relationTo: 'media',
    },
    {
      name: 'knowledgeSources',
      type: 'relationship',
      hasMany: true,
      relationTo: 'knowledge-documents',
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      index: true,
      options: [...GENERATED_CONTENT_STATUSES],
      required: true,
    },
    // Kept with the draft so a lost create response cannot duplicate work.
    { name: 'idempotencyKey', type: 'text', index: true, maxLength: 200, required: true, unique: true },
    { name: 'creationFingerprint', type: 'text', maxLength: 64, required: true },
    { name: 'createdBy', type: 'relationship', relationTo: 'users', required: true },
    { name: 'reviewedAt', type: 'date' },
    { name: 'reviewedBy', type: 'relationship', relationTo: 'users' },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeChange: [preserveWorkflowTruth],
  },
}
