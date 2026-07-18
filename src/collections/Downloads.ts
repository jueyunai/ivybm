import type { CollectionConfig } from 'payload'

import {
  activeDownloadsRead,
  contentAdmin,
  contentCreate,
  contentDelete,
  contentUpdate,
} from '../access/content'
import { seoField } from '../fields/seo'
import { stableSlugField } from '../fields/slug'
import {
  revalidateContentAfterChange,
  revalidateContentAfterDelete,
} from '../hooks/revalidateContent'

export const Downloads: CollectionConfig = {
  slug: 'downloads',
  access: {
    admin: contentAdmin,
    create: contentCreate,
    delete: contentDelete,
    read: activeDownloadsRead,
    update: contentUpdate,
  },
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
  hooks: {
    afterChange: [revalidateContentAfterChange],
    afterDelete: [revalidateContentAfterDelete],
  },
}
