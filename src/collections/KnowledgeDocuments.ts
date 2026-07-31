import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import {
  knowledgeAdmin,
  knowledgeCreate,
  knowledgeDelete,
  knowledgeRead,
  knowledgeUpdate,
} from '../access/knowledge'

const reviewRelevantFields = [
  'content',
  'customerVisible',
  'locale',
  'sourceFile',
  'sourceTitle',
  'sourceType',
  'sourceURL',
  'sourceVersion',
] as const

const systemManagedFields = [
  'embeddingModel',
  'embeddingSpace',
  'indexJobId',
  'indexOwnerToken',
  'indexedAt',
  'indexStatus',
  'reviewedAt',
  'reviewedBy',
] as const

const stampReview: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
  if (!data) return data

  if (req.user) {
    for (const field of systemManagedFields) {
      if (operation === 'update' && Object.prototype.hasOwnProperty.call(data, field)) {
        data[field] = originalDoc?.[field] ?? null
      } else if (operation === 'create') {
        delete data[field]
      }
    }
  }

  const changedReviewedContent =
    operation === 'update' &&
    reviewRelevantFields.some(
      (field) =>
        Object.prototype.hasOwnProperty.call(data, field) && data[field] !== originalDoc?.[field],
    )
  const reviewStatusChanged =
    data.reviewStatus !== undefined && data.reviewStatus !== originalDoc?.reviewStatus

  if (changedReviewedContent) {
    data.reviewStatus = 'draft'
  }

  const nextReviewStatus = data.reviewStatus ?? originalDoc?.reviewStatus ?? 'draft'
  if (nextReviewStatus === 'reviewed') {
    if (originalDoc?.reviewStatus !== 'reviewed' || changedReviewedContent) {
      data.reviewedAt = new Date().toISOString()
      data.reviewedBy = req.user?.id || undefined
    }
  } else if (operation === 'create' || reviewStatusChanged || changedReviewedContent) {
    data.reviewedAt = null
    data.reviewedBy = null
  }

  if (operation === 'create' || changedReviewedContent || reviewStatusChanged) {
    data.indexStatus = 'pending'
    data.indexedAt = null
    data.embeddingModel = null
    data.embeddingSpace = null
    data.indexJobId = null
    data.indexOwnerToken = null
  }

  return data
}

export const KnowledgeDocuments: CollectionConfig = {
  slug: 'knowledge-documents',
  access: {
    admin: knowledgeAdmin,
    create: knowledgeCreate,
    delete: knowledgeDelete,
    read: knowledgeRead,
    update: knowledgeUpdate,
  },
  admin: {
    components: {
      edit: {
        beforeDocumentControls: ['/admin/components/KnowledgeIndexActions'],
      },
    },
    defaultColumns: [
      'sourceTitle',
      'sourceType',
      'customerVisible',
      'locale',
      'sourceVersion',
      'reviewStatus',
    ],
    group: 'Knowledge Base',
    useAsTitle: 'sourceTitle',
  },
  fields: [
    {
      name: 'sourceTitle',
      type: 'text',
      required: true,
    },
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
    {
      name: 'customerVisible',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description:
          'Only reviewed, indexed documents marked here may be used by the public website chat.',
      },
    },
    {
      name: 'sourceURL',
      type: 'text',
    },
    {
      name: 'sourceFile',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'sourceVersion',
      type: 'text',
      required: true,
    },
    {
      name: 'locale',
      type: 'select',
      defaultValue: 'en',
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
      name: 'reviewStatus',
      type: 'select',
      defaultValue: 'draft',
      index: true,
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Reviewed', value: 'reviewed' },
        { label: 'Archived', value: 'archived' },
      ],
      required: true,
    },
    {
      name: 'reviewedAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'reviewedBy',
      type: 'relationship',
      admin: { readOnly: true },
      relationTo: 'users',
    },
    {
      name: 'indexStatus',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Processing', value: 'processing' },
        { label: 'Ready', value: 'ready' },
        { label: 'Failed', value: 'failed' },
      ],
      required: true,
    },
    {
      name: 'indexedAt',
      type: 'date',
      admin: { readOnly: true },
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
      name: 'indexJobId',
      type: 'number',
      access: {
        create: () => false,
        read: () => false,
        update: () => false,
      },
      admin: { hidden: true, readOnly: true },
    },
    {
      name: 'indexOwnerToken',
      type: 'text',
      access: {
        create: () => false,
        read: () => false,
        update: () => false,
      },
      admin: { hidden: true, readOnly: true },
    },
  ],
  hooks: {
    beforeChange: [stampReview],
  },
}
