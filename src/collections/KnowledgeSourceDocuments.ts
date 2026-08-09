import path from 'node:path'

import { ValidationError, type Access, type CollectionBeforeChangeHook, type CollectionBeforeOperationHook, type CollectionConfig } from 'payload'

import {
  knowledgeAdmin,
  knowledgeCreate,
  knowledgeRead,
} from '@/access/knowledge'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '@/hooks/writeAuditLog'
import {
  KNOWLEDGE_SOURCE_MIME_TYPES,
  validateStoredKnowledgeSourceFile,
} from '@/modules/knowledge/ingestion/parser'

export const KNOWLEDGE_SOURCE_STATUSES = ['queued', 'processing', 'needs_review', 'failed', 'archived'] as const
export const KNOWLEDGE_SOURCE_STAGES = ['queued', 'parsing', 'translating', 'finalizing', 'complete'] as const
export const KNOWLEDGE_SOURCE_LANGUAGES = ['auto', 'en', 'ar', 'zh'] as const

const knowledgeSourceCreate: Access = (args) =>
  args.req.context?.knowledgeIngestion === true && knowledgeCreate(args) === true

const knowledgeSourceInternalWrite: Access = () => false

const protectSourceSystemFields: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
  if (!data || req.context?.knowledgeIngestion === true) return data
  const managed = [
    'sourceTitle',
    'sourceType',
    'sourceVersion',
    'originalLanguage',
    'sourceHash',
    'ingestionRevision',
    'detectedLanguage',
    'extractedText',
    'pageCount',
    'paragraphCount',
    'imageCount',
    'parserVersion',
    'processingStatus',
    'processingStage',
    'currentJobId',
    'currentJobOwnerToken',
    'errorCode',
    'errorSummary',
    'completedAt',
  ]
  for (const field of managed) {
    if (operation === 'update' && Object.prototype.hasOwnProperty.call(data, field)) {
      data[field] = originalDoc?.[field] ?? null
    } else if (operation === 'create') {
      delete data[field]
    }
  }
  return data
}

const validateSourceUpload: CollectionBeforeOperationHook = ({ operation, req }) => {
  if ((operation !== 'create' && operation !== 'update') || !req.file) return
  if (operation === 'update') {
    throw new ValidationError({
      collection: 'knowledge-source-documents',
      errors: [
        {
          message: 'Source files are immutable; upload a new source version instead.',
          path: 'file',
        },
      ],
      req,
    })
  }
  try {
    validateStoredKnowledgeSourceFile({ data: req.file.data, mimetype: req.file.mimetype, name: req.file.name, size: req.file.size })
  } catch (error) {
    throw new ValidationError({
      collection: 'knowledge-source-documents',
      errors: [{ message: error instanceof Error ? error.message : 'The source upload is invalid', path: 'file' }],
      req,
    })
  }
}

export const KnowledgeSourceDocuments: CollectionConfig = {
  slug: 'knowledge-source-documents',
  access: {
    admin: knowledgeAdmin,
    create: knowledgeSourceCreate,
    delete: knowledgeSourceInternalWrite,
    read: knowledgeRead,
    update: knowledgeSourceInternalWrite,
  },
  admin: {
    defaultColumns: ['sourceTitle', 'sourceVersion', 'processingStatus', 'processingStage', 'updatedAt'],
    group: 'Knowledge Base',
    useAsTitle: 'sourceTitle',
  },
  fields: [
    { name: 'sourceTitle', type: 'text', maxLength: 500, required: true },
    {
      name: 'sourceType',
      type: 'select',
      options: [
        { label: 'FAQ', value: 'faq' },
        { label: 'Product Manual', value: 'product-manual' },
        { label: 'Technical Specification', value: 'technical-specification' },
        { label: 'Sales Script', value: 'sales-script' },
        { label: 'Project Case', value: 'project-case' },
        { label: 'Other', value: 'other' },
      ],
      required: true,
    },
    { name: 'sourceVersion', type: 'text', maxLength: 100, required: true },
    {
      name: 'originalLanguage',
      type: 'select',
      defaultValue: 'auto',
      options: KNOWLEDGE_SOURCE_LANGUAGES.map((value) => ({ label: value.toUpperCase(), value })),
      required: true,
    },
    {
      name: 'sourceHash',
      type: 'text',
      index: true,
      maxLength: 64,
      minLength: 64,
      required: true,
      admin: { hidden: true },
    },
    {
      name: 'ingestionRevision',
      type: 'text',
      index: true,
      maxLength: 200,
      required: true,
      admin: { hidden: true },
    },
    {
      name: 'detectedLanguage',
      type: 'select',
      options: [
        { label: 'Unknown', value: 'unknown' },
        { label: 'English', value: 'en' },
        { label: 'Arabic', value: 'ar' },
        { label: 'Chinese', value: 'zh' },
      ],
    },
    {
      name: 'extractedText',
      type: 'textarea',
      maxLength: 1_000_000,
      admin: { readOnly: true },
    },
    { name: 'pageCount', type: 'number', min: 0, admin: { readOnly: true } },
    { name: 'paragraphCount', type: 'number', min: 0, admin: { readOnly: true } },
    { name: 'imageCount', type: 'number', min: 0, admin: { readOnly: true } },
    {
      name: 'parserVersion',
      type: 'text',
      maxLength: 100,
      admin: { hidden: true, readOnly: true },
    },
    {
      name: 'processingStatus',
      type: 'select',
      defaultValue: 'queued',
      index: true,
      options: KNOWLEDGE_SOURCE_STATUSES.map((value) => ({ label: value, value })),
      required: true,
    },
    {
      name: 'processingStage',
      type: 'select',
      defaultValue: 'queued',
      options: KNOWLEDGE_SOURCE_STAGES.map((value) => ({ label: value, value })),
      required: true,
    },
    { name: 'currentJobId', type: 'number', min: 1, admin: { hidden: true, readOnly: true } },
    {
      name: 'currentJobOwnerToken',
      type: 'text',
      access: { create: () => false, read: () => false, update: () => false },
      admin: { hidden: true, readOnly: true },
    },
    { name: 'errorCode', type: 'text', maxLength: 100, admin: { readOnly: true } },
    { name: 'errorSummary', type: 'textarea', maxLength: 2_000, admin: { readOnly: true } },
    { name: 'completedAt', type: 'date', admin: { readOnly: true } },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeOperation: [validateSourceUpload],
    beforeChange: [protectSourceSystemFields],
  },
  indexes: [
    { fields: ['sourceHash', 'sourceVersion'], unique: true },
    { fields: ['processingStatus', 'updatedAt'] },
  ],
  upload: {
    staticDir: path.resolve(process.cwd(), 'private/knowledge-sources'),
    // Payload identifies the OOXML ZIP container as application/zip. The
    // beforeOperation hook still rejects ordinary ZIP files and renamed input.
    mimeTypes: [...KNOWLEDGE_SOURCE_MIME_TYPES, 'application/zip'],
  },
}
