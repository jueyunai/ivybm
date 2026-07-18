import type { GroupField } from 'payload'

import { imageMediaFilter } from './media'

export const seoField = (name = 'seo'): GroupField => ({
  name,
  type: 'group',
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      maxLength: 70,
    },
    {
      name: 'description',
      type: 'textarea',
      localized: true,
      maxLength: 180,
    },
    {
      name: 'keywords',
      type: 'textarea',
      localized: true,
      admin: {
        description: 'Comma-separated keywords for search and content planning.',
      },
    },
    {
      name: 'canonical',
      type: 'text',
      localized: true,
      admin: {
        description: 'Optional canonical URL for this locale.',
      },
    },
    {
      name: 'ogImage',
      type: 'upload',
      filterOptions: imageMediaFilter,
      relationTo: 'media',
    },
    {
      name: 'noIndex',
      type: 'checkbox',
      defaultValue: false,
    },
  ],
  label: 'SEO',
})
