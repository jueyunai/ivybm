import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
} from 'payload'

import {
  knowledgeAdmin,
  knowledgeCreate,
  knowledgeDelete,
  knowledgeRead,
  knowledgeUpdate,
} from '../access/knowledge'

const versionedPromptFields = [
  'key',
  'locale',
  'model',
  'purpose',
  'template',
  'variables',
  'version',
] as const

const enforcePromptVersionHistory: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'update' || !data || !originalDoc || originalDoc.status === 'draft') {
    return data
  }

  const changesVersionedContent = versionedPromptFields.some(
    (field) =>
      Object.prototype.hasOwnProperty.call(data, field) && data[field] !== originalDoc[field],
  )
  const reopensAsDraft = data.status === 'draft'

  if (changesVersionedContent || reopensAsDraft) {
    throw new ValidationError({
      collection: 'prompt-templates',
      errors: [
        {
          message: 'Active or archived prompt versions are immutable; create a new version instead.',
          path: changesVersionedContent ? 'version' : 'status',
        },
      ],
      req,
    })
  }

  return data
}

export const PromptTemplates: CollectionConfig = {
  slug: 'prompt-templates',
  access: {
    admin: knowledgeAdmin,
    create: knowledgeCreate,
    delete: knowledgeDelete,
    read: knowledgeRead,
    update: knowledgeUpdate,
  },
  admin: {
    defaultColumns: ['key', 'purpose', 'locale', 'version', 'status'],
    group: 'Knowledge Base',
    useAsTitle: 'key',
  },
  fields: [
    {
      name: 'key',
      type: 'text',
      index: true,
      required: true,
    },
    {
      name: 'purpose',
      type: 'select',
      options: [
        { label: 'Customer Chat', value: 'customer-chat' },
        { label: 'Conversation Summary', value: 'conversation-summary' },
        { label: 'Translation', value: 'translation' },
        { label: 'Content Generation', value: 'content-generation' },
      ],
      required: true,
    },
    {
      name: 'locale',
      type: 'select',
      defaultValue: 'all',
      options: [
        { label: 'All', value: 'all' },
        { label: 'English', value: 'en' },
        { label: 'العربية', value: 'ar' },
      ],
      required: true,
    },
    {
      name: 'version',
      type: 'number',
      defaultValue: 1,
      min: 1,
      required: true,
    },
    {
      name: 'template',
      type: 'textarea',
      required: true,
    },
    {
      name: 'variables',
      type: 'json',
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      index: true,
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Active', value: 'active' },
        { label: 'Archived', value: 'archived' },
      ],
      required: true,
    },
    {
      name: 'model',
      type: 'text',
    },
  ],
  hooks: {
    beforeChange: [enforcePromptVersionHistory],
  },
}
