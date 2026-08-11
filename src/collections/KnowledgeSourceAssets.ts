import path from 'node:path'

import { ValidationError, type CollectionBeforeChangeHook, type CollectionBeforeOperationHook, type CollectionConfig } from 'payload'

import { knowledgeAdmin, knowledgeRead } from '@/access/knowledge'
import {
  KNOWLEDGE_SOURCE_MAX_IMAGE_TOTAL_BYTES,
  validateKnowledgeSourceImage,
} from '@/modules/knowledge/ingestion/parser'

const IMAGE_MIME_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const
const knowledgeAssetInternalWrite = () => false

const protectAssetFields: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
  if (!data || req.context?.knowledgeIngestion === true) return data
  for (const field of ['sha256', 'byteSize', 'accessibility', 'sequence', 'originalName', 'source']) {
    if (operation === 'create') delete data[field]
    else if (operation === 'update' && Object.prototype.hasOwnProperty.call(data, field)) data[field] = originalDoc?.[field] ?? null
  }
  return data
}

const validateAssetUpload: CollectionBeforeOperationHook = ({ operation, req }) => {
  if ((operation !== 'create' && operation !== 'update') || !req.file) return
  try {
    validateKnowledgeSourceImage({ data: req.file.data, mimetype: req.file.mimetype, name: req.file.name, size: req.file.size })
  } catch (error) {
    throw new ValidationError({ collection: 'knowledge-source-assets', errors: [{ message: error instanceof Error ? error.message : 'The image is invalid', path: 'file' }], req })
  }
}

export const KnowledgeSourceAssets: CollectionConfig = {
  slug: 'knowledge-source-assets',
  access: {
    admin: knowledgeAdmin,
    create: knowledgeAssetInternalWrite,
    delete: knowledgeAssetInternalWrite,
    read: knowledgeRead,
    update: knowledgeAssetInternalWrite,
  },
  admin: {
    defaultColumns: ['source', 'sequence', 'originalName', 'mimeType', 'updatedAt'],
    group: 'Knowledge Base',
    useAsTitle: 'originalName',
  },
  fields: [
    {
      name: 'source',
      type: 'relationship',
      relationTo: 'knowledge-source-documents',
      required: true,
      index: true,
    },
    { name: 'sequence', type: 'number', required: true, min: 1 },
    { name: 'originalName', type: 'text', maxLength: 255, required: true },
    { name: 'sha256', type: 'text', maxLength: 64, minLength: 64, required: true, index: true },
    { name: 'byteSize', type: 'number', required: true, min: 1 },
    {
      name: 'accessibility',
      type: 'select',
      defaultValue: 'private',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Preview only', value: 'preview-only' },
      ],
      required: true,
    },
  ],
  hooks: { beforeChange: [protectAssetFields], beforeOperation: [validateAssetUpload] },
  indexes: [{ fields: ['source', 'sequence'], unique: true }],
  upload: {
    staticDir: path.resolve(process.cwd(), 'private/knowledge-source-assets'),
    mimeTypes: [...IMAGE_MIME_TYPES],
  },
}

export { IMAGE_MIME_TYPES, KNOWLEDGE_SOURCE_MAX_IMAGE_TOTAL_BYTES }
