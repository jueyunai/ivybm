import type { CollectionConfig } from 'payload'

import { internalNotesField } from '../fields/internalNotes'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    defaultColumns: ['title', 'location', 'slug', '_status', 'updatedAt'],
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
      name: 'description',
      type: 'richText',
      localized: true,
    },
    {
      name: 'location',
      type: 'text',
      localized: true,
    },
    {
      name: 'application',
      type: 'text',
      localized: true,
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
    seoField(),
    internalNotesField(),
  ],
  versions: {
    drafts: true,
    maxPerDoc: 50,
  },
}
