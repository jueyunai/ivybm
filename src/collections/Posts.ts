import type { CollectionConfig } from 'payload'

import { internalNotesField } from '../fields/internalNotes'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'

export const Posts: CollectionConfig = {
  slug: 'posts',
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
  versions: {
    drafts: true,
    maxPerDoc: 50,
  },
}
