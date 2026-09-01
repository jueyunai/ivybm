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
import { preservePublicationHistory, publicationHistoryField } from '../fields/publicationHistory'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'
import {
  revalidateContentAfterChange,
  revalidateContentAfterDelete,
} from '../hooks/revalidateContent'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'

export const POST_CONTENT_TYPES = ['news', 'knowledge'] as const
export type PostContentType = (typeof POST_CONTENT_TYPES)[number]

export const POST_CATEGORIES = [
  'industry',
  'products',
  'projects',
  'company',
  'material-comparison',
  'technical-guide',
  'procurement',
  'quality-logistics',
] as const
export type PostCategory = (typeof POST_CATEGORIES)[number]

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
    defaultColumns: ['title', 'contentType', 'category', 'publishedAt', '_status', 'updatedAt'],
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
    publicationHistoryField,
    {
      name: 'contentType',
      type: 'select',
      defaultValue: 'news',
      index: true,
      options: [
        { label: 'News', value: 'news' },
        { label: 'Knowledge', value: 'knowledge' },
      ],
      required: true,
    },
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
        { label: 'Material Comparison', value: 'material-comparison' },
        { label: 'Technical Guide', value: 'technical-guide' },
        { label: 'Procurement', value: 'procurement' },
        { label: 'Quality & Logistics', value: 'quality-logistics' },
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
    beforeChange: [preservePublicationHistory],
  },
  versions: {
    drafts: true,
    maxPerDoc: 50,
  },
}
