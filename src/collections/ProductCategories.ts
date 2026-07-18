import type { CollectionConfig } from 'payload'

import {
  contentAdmin,
  contentCreate,
  contentDelete,
  contentUpdate,
  publicRead,
} from '../access/content'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'
import {
  revalidateContentAfterChange,
  revalidateContentAfterDelete,
} from '../hooks/revalidateContent'

export const ProductCategories: CollectionConfig = {
  slug: 'product-categories',
  access: {
    admin: contentAdmin,
    create: contentCreate,
    delete: contentDelete,
    read: publicRead,
    update: contentUpdate,
  },
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
  hooks: {
    afterChange: [revalidateContentAfterChange],
    afterDelete: [revalidateContentAfterDelete],
  },
}
