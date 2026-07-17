import type { CollectionConfig } from 'payload'

import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'

export const ProductCategories: CollectionConfig = {
  slug: 'product-categories',
  admin: {
    defaultColumns: ['title', 'slug', 'sortOrder', 'updatedAt'],
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
      name: 'sortOrder',
      type: 'number',
      defaultValue: 0,
      min: 0,
    },
    seoField(),
  ],
}
