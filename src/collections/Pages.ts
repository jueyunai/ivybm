import type { CollectionConfig } from 'payload'

import { internalNotesField } from '../fields/internalNotes'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'

export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
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
      name: 'summary',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'body',
      type: 'richText',
      localized: true,
    },
    {
      name: 'heroImage',
      type: 'upload',
      relationTo: 'media',
    },
    seoField(),
    internalNotesField(),
  ],
  versions: {
    drafts: true,
    maxPerDoc: 50,
  },
}
