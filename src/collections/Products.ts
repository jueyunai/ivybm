import type { CollectionConfig } from 'payload'

import { internalNotesField } from '../fields/internalNotes'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'

export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    defaultColumns: ['title', 'category', 'slug', '_status', 'updatedAt'],
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
      name: 'shortDescription',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'description',
      type: 'richText',
      localized: true,
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'product-categories',
      required: true,
    },
    {
      name: 'coverImage',
      type: 'upload',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'gallery',
      type: 'upload',
      hasMany: true,
      relationTo: 'media',
    },
    {
      name: 'specifications',
      type: 'array',
      fields: [
        {
          name: 'label',
          type: 'text',
          localized: true,
          required: true,
        },
        {
          name: 'value',
          type: 'text',
          localized: true,
          required: true,
        },
      ],
    },
    seoField(),
    internalNotesField(),
  ],
  versions: {
    drafts: true,
    maxPerDoc: 50,
  },
}
