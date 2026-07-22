import type { CollectionConfig } from 'payload'

import { knowledgeAdmin, knowledgeRead } from '../access/knowledge'

export const KnowledgeChunks: CollectionConfig = {
  slug: 'knowledge-chunks',
  access: {
    admin: knowledgeAdmin,
    create: () => false,
    delete: () => false,
    read: knowledgeRead,
    update: () => false,
  },
  admin: {
    defaultColumns: ['sourceTitle', 'locale', 'index', 'embeddingModel', 'updatedAt'],
    group: 'Knowledge Base',
    useAsTitle: 'stableId',
  },
  fields: [
    {
      name: 'document',
      type: 'relationship',
      index: true,
      relationTo: 'knowledge-documents',
      required: true,
    },
    {
      name: 'stableId',
      type: 'text',
      index: true,
      required: true,
      unique: true,
    },
    {
      name: 'index',
      type: 'number',
      min: 0,
      required: true,
    },
    {
      name: 'locale',
      type: 'select',
      index: true,
      options: [
        { label: 'English', value: 'en' },
        { label: 'العربية', value: 'ar' },
      ],
      required: true,
    },
    {
      name: 'content',
      type: 'textarea',
      required: true,
    },
    {
      name: 'sourceTitle',
      type: 'text',
      required: true,
    },
    {
      name: 'sourceVersion',
      type: 'text',
      required: true,
    },
    {
      name: 'sourceURL',
      type: 'text',
    },
    {
      name: 'embeddingModel',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'embeddingSpace',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'embeddingDimensions',
      type: 'number',
      admin: { readOnly: true },
      min: 1,
    },
    {
      name: 'embeddedAt',
      type: 'date',
      admin: { readOnly: true },
    },
  ],
}
