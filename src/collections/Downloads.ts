import type { CollectionConfig } from 'payload'

import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'

export const Downloads: CollectionConfig = {
  slug: 'downloads',
  admin: {
    defaultColumns: ['title', 'type', 'isActive', 'updatedAt'],
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
      name: 'description',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'type',
      type: 'select',
      options: [
        { label: 'Catalog', value: 'catalog' },
        { label: 'Technical Data', value: 'technical-data' },
        { label: 'Certificate', value: 'certificate' },
        { label: 'Other', value: 'other' },
      ],
      required: true,
    },
    {
      name: 'file',
      type: 'upload',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'coverImage',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
    },
    seoField(),
  ],
}
