import type { CollectionConfig } from 'payload'

import {
  contentAdmin,
  contentCreate,
  contentDelete,
  contentUpdate,
  publishedContentRead,
} from '../access/content'
import { internalNotesField } from '../fields/internalNotes'
import { imageMediaFilter } from '../fields/media'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'
import {
  revalidateContentAfterChange,
  revalidateContentAfterDelete,
} from '../hooks/revalidateContent'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    admin: contentAdmin,
    create: contentCreate,
    delete: contentDelete,
    read: publishedContentRead,
    update: contentUpdate,
  },
  admin: {
    defaultColumns: ['title', 'category', 'publishedAt', '_status', 'updatedAt'],
    group: 'Website Content',
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      required: true,
    },
    stableSlugField(),
    {
      name: 'excerpt',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'content',
      type: 'richText',
      localized: true,
    },
    {
      name: 'category',
      type: 'select',
      defaultValue: 'industry',
      options: [
        { label: 'Industry', value: 'industry' },
        { label: 'Products', value: 'products' },
        { label: 'Projects', value: 'projects' },
        { label: 'Company', value: 'company' },
      ],
      required: true,
    },
    {
      name: 'featuredImage',
      type: 'upload',
      filterOptions: imageMediaFilter,
      relationTo: 'media',
    },
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    seoField(),
    internalNotesField(),
  ],
  hooks: {
    afterChange: [revalidateContentAfterChange, writeAuditLogAfterChange],
    afterDelete: [revalidateContentAfterDelete, writeAuditLogAfterDelete],
  },
  versions: {
    drafts: true,
    maxPerDoc: 50,
  },
}
